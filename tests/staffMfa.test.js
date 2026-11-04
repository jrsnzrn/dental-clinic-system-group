import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
const body = source.slice(source.indexOf("exports.verifyStaffMfaCode ="), source.indexOf("exports.approveReschedule ="));

function harness(challengeOverrides = {}) {
  const challenge = { uid: "staff", authTime: 1000, codeHash: "correct", salt: "salt", attemptCount: 0,
    expiresAt: { toMillis: () => Date.now() + 60000 }, ...challengeOverrides };
  const records = new Map([["admins/staff", { role: "admin", email: "current@example.com" }], ["staffMfaChallenges/challenge", challenge]]);
  const writes = [];
  const db = { collection: name => ({ doc: id => ({ path: `${name}/${id}` }) }), runTransaction: async callback => {
    const pending = [];
    const result = await callback({
      get: async ref => ({ exists: records.has(ref.path), data: () => records.get(ref.path) }),
      update: (ref, data) => pending.push([ref.path, data]),
      set: (ref, data) => pending.push([ref.path, data]),
    });
    for (const [path, data] of pending) { records.set(path, { ...records.get(path), ...data }); writes.push({ path, data }); }
    return result;
  } };
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const verify = new Function("exports", "onCall", "HttpsError", "assertRateLimit", "db", "admin", "STAFF_MFA_VERIFY_MIN_INTERVAL_MS", "STAFF_MFA_VERIFY_WINDOW_MS", "STAFF_MFA_VERIFY_MAX_CALLS", "STAFF_MFA_VERIFIED_MS", "hashMfaCode", `${body}; return exports.verifyStaffMfaCode;`)(
    {}, (_options, callback) => callback, HttpsError, async () => {}, db,
    { firestore: { Timestamp: { fromMillis: value => ({ toDate: () => new Date(value), toMillis: () => value }) },
      FieldValue: { serverTimestamp: () => "timestamp", increment: value => value } } },
    0, 0, 10, 12 * 60 * 60 * 1000, code => code === "123456" ? "correct" : "incorrect",
  );
  return { verify: code => verify({ auth: { uid: "staff", token: { auth_time: 1000 } }, data: { challengeId: "challenge", code: code || "123456" } }), records, writes };
}

test("a valid OTP authorizes only the login that requested it", async () => {
  const state = harness();
  const result = await state.verify();
  assert.equal(result.success, true);
  assert.equal(state.records.get("admins/staff").mfaVerifiedAuthTime, 1000);
  assert.ok(state.records.get("staffMfaChallenges/challenge").usedAt);
});

test("an OTP from an older login is rejected without authorizing the new login", async () => {
  const state = harness({ authTime: 900 });
  await assert.rejects(state.verify(), /previous login/);
  assert.equal(state.writes.length, 0);
});

test("expired and already-used OTPs cannot authorize a session", async () => {
  for (const overrides of [{ expiresAt: { toMillis: () => 0 } }, { usedAt: "timestamp" }]) {
    const state = harness(overrides);
    await assert.rejects(state.verify(), /expired|already used/);
    assert.equal(state.writes.length, 0);
  }
});

test("wrong OTPs still count attempts without authorizing the login", async () => {
  const state = harness();
  await assert.rejects(state.verify("654321"), /incorrect/);
  assert.equal(state.records.get("admins/staff").mfaVerifiedAuthTime, undefined);
  assert.equal(state.records.get("staffMfaChallenges/challenge").attemptCount, 1);
});

test("codes sent to an old email cannot authorize a session after an admin changes it", async () => {
  const state = harness({ email: "old@example.com" });
  await assert.rejects(state.verify(), /account email changed/);
  assert.equal(state.writes.length, 0);
});
