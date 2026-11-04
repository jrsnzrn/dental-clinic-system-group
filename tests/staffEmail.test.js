import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
const body = source.slice(source.indexOf("exports.setStaffAccountEmail ="), source.indexOf("exports.getStaffAccounts ="))
  .replace("exports.setStaffAccountEmail =", "const changeEmail =");

function harness({ role = "admin", occupied = false, failSave = false } = {}) {
  const records = new Map([
    ["admins/staff", { role: "dentist", email: "old@example.com", name: "Dr. James Reyes", mfaEnabled: true }],
    ["dentists/linked", { linkedStaffUid: "staff", linkedStaffEmail: "old@example.com", email: "old@example.com" }],
    ["staffEmailVerificationChallenges/staff", { email: "old@example.com" }],
  ]);
  const authRecord = { email: "old@example.com", emailVerified: true };
  let revoked = false;
  let failed = false;
  const db = {
    collection: name => ({ doc: id => ({ path: `${name}/${id}` }), where: (field, _operator, value) => ({ collection: name, field, value }) }),
    runTransaction: async callback => {
      const pending = [];
      const result = await callback({
        get: async ref => {
          if (ref.collection) return { docs: [...records].filter(([path, data]) => path.startsWith(`${ref.collection}/`) && data[ref.field] === ref.value)
            .map(([path, data]) => ({ ref: { path }, data: () => data })) };
          return { exists: records.has(ref.path), data: () => records.get(ref.path) };
        },
        update: (ref, data) => {
          if (failSave && data.email && !failed) { failed = true; throw new Error("Write failed"); }
          pending.push(() => { const current = { ...records.get(ref.path), ...data }; for (const [key, value] of Object.entries(current)) if (value === "DELETE") delete current[key]; records.set(ref.path, current); });
        },
        delete: ref => pending.push(() => records.delete(ref.path)),
      });
      pending.forEach(write => write());
      return result;
    },
  };
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const changeEmail = new Function("onCall", "getStaffContextFromRequest", "HttpsError", "ALLOWED_ROLES", "db", "crypto", "admin", "auth", "writeStaffAuditLog", `${body}; return changeEmail;`)(
    callback => callback,
    async (_request, allowed) => { if (!allowed.includes(role)) throw new HttpsError("permission-denied", "Administrator access required"); return { uid: "admin", role }; },
    HttpsError, ["dentist", "receptionist"], db, { randomUUID: () => "operation" },
    { firestore: { Timestamp: { fromMillis: value => ({ toMillis: () => value }) }, FieldValue: { delete: () => "DELETE", serverTimestamp: () => "now" } } },
    {
      getUser: async () => ({ ...authRecord }),
      updateUser: async (_uid, fields) => { if (occupied && fields.email === "new@example.com") throw Object.assign(new Error("Used email"), { code: "auth/email-already-exists" }); Object.assign(authRecord, fields); },
      revokeRefreshTokens: async () => { revoked = true; },
    }, async () => {},
  );
  return { records, authRecord, revoked: () => revoked, change: () => changeEmail({ data: { uid: "staff", email: "new@example.com" } }) };
}

test("only an administrator can use the staff email-change endpoint", async () => {
  for (const role of ["dentist", "receptionist"]) {
    const h = harness({ role });
    await assert.rejects(h.change(), /Administrator access/);
    assert.equal(h.authRecord.email, "old@example.com");
    assert.equal(h.records.get("admins/staff").email, "old@example.com");
  }
});

test("admin email changes sync Auth and staff records and reset verification without changing role", async () => {
  const h = harness();
  const result = await h.change();
  assert.equal(result.verificationRequired, true);
  assert.equal(h.authRecord.email, "new@example.com");
  assert.equal(h.authRecord.emailVerified, false);
  assert.equal(h.records.get("admins/staff").email, "new@example.com");
  assert.equal(h.records.get("admins/staff").role, "dentist");
  assert.equal(h.records.get("admins/staff").mfaEnabled, true);
  assert.equal(h.records.get("dentists/linked").linkedStaffEmail, "new@example.com");
  assert.equal(h.records.has("staffEmailVerificationChallenges/staff"), false);
  assert.equal(h.records.get("admins/staff").emailUpdateId, undefined);
  assert.equal(h.revoked(), true);
});

test("an occupied email or database failure leaves the original address and releases the update lock", async () => {
  for (const options of [{ occupied: true }, { failSave: true }]) {
    const h = harness(options);
    await assert.rejects(h.change(), /already used|could not be updated/);
    assert.equal(h.authRecord.email, "old@example.com");
    assert.equal(h.authRecord.emailVerified, true);
    assert.equal(h.records.get("admins/staff").email, "old@example.com");
    assert.equal(h.records.get("admins/staff").emailUpdateId, undefined);
    assert.equal(h.revoked(), false);
  }
});
