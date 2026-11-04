import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { getAdminProfile, getDefaultAdminPath, hasFreshStaffMfa, requiresStaffMfa, ROLES } from "../src/utils/rbac.js";

const source = fs.readFileSync(new URL("../src/pages/admin/Login.jsx", import.meta.url), "utf8");
const body = source.slice(source.indexOf("  async function completeStaffLogin("), source.indexOf("  async function onLogin("));

function harness(profile, { verified = true, next = "", authTime = 1000 } = {}) {
  const destinations = [];
  let signedOut = false;
  const login = new Function("auth", "db", "doc", "getDoc", "signOut", "getAdminProfile", "getDefaultAdminPath", "hasFreshStaffMfa", "requiresStaffMfa", "ROLES", "searchParams", "navigate", `${body}; return completeStaffLogin;`)(
    {}, {}, (_db, collection, uid) => ({ collection, uid }),
    async () => ({ exists: () => profile !== null, data: () => profile }),
    async () => { signedOut = true; }, getAdminProfile, getDefaultAdminPath, hasFreshStaffMfa, requiresStaffMfa, ROLES,
    new URLSearchParams({ next }), (path, options) => destinations.push({ path, options }),
  );
  const credential = { user: { uid: "staff", emailVerified: verified, getIdTokenResult: async () => ({ claims: { auth_time: authTime } }), reload: async () => {} } };
  return { login: () => login(credential), destinations, signedOut: () => signedOut };
}

test("admin, receptionist, and dentist roles are detected from the saved account", async () => {
  for (const [role, path] of [["admin", "/admin/patients"], ["receptionist", "/admin/bookings"], ["dentist", "/admin/patients"]]) {
    const state = harness({ role, mfaVerifiedAuthTime: 1000, mfaVerifiedUntil: new Date(Date.now() + 60000) });
    await state.login();
    assert.equal(state.destinations[0].path, path);
    assert.equal(state.signedOut(), false);
  }
});

test("nonstaff accounts, unknown roles, and disabled staff cannot enter", async () => {
  for (const profile of [null, {}, { role: "patient" }, { role: "receptionist", disabled: true }]) {
    const state = harness(profile);
    await assert.rejects(state.login(), /not-admin|account-disabled/);
    assert.equal(state.signedOut(), true);
    assert.equal(state.destinations.length, 0);
  }
});

test("unverified email still goes through staff email verification", async () => {
  const state = harness({ role: "receptionist" }, { verified: false });
  await state.login();
  assert.equal(state.destinations[0].path, "/admin/verify-email?next=%2Fadmin%2Fbookings");
});

test("automatic role detection keeps required MFA", async () => {
  const state = harness({ role: "admin" });
  await state.login();
  assert.equal(state.destinations[0].path, "/admin/mfa?next=%2Fadmin%2Fpatients");
});

test("a new login requires OTP even when an earlier MFA check has not expired", async () => {
  for (const role of ["admin", "receptionist", "dentist"]) {
    const state = harness({ role, mfaEnabled: true, mfaVerifiedAuthTime: 1000,
      mfaVerifiedUntil: new Date(Date.now() + 12 * 60 * 60 * 1000) }, { authTime: 2000 });
    await state.login();
    assert.match(state.destinations[0].path, /^\/admin\/mfa\?next=/);
  }
});

test("legacy MFA timestamps cannot skip verification, while the current login stays verified", () => {
  const profile = { role: "admin", mfaVerifiedUntil: new Date(Date.now() + 60000) };
  assert.equal(hasFreshStaffMfa(profile, 1000), false);
  assert.equal(hasFreshStaffMfa({ ...profile, mfaVerifiedAuthTime: 1000 }, 1000), true);
  assert.equal(hasFreshStaffMfa({ ...profile, mfaVerifiedAuthTime: 1000 }, 2000), false);
  assert.equal(hasFreshStaffMfa({ ...profile, mfaVerifiedAuthTime: 1000, mfaVerifiedUntil: new Date(0) }, 1000), false);
});

test("external next links are ignored while internal staff destinations are retained", async () => {
  const external = harness({ role: "receptionist" }, { next: "https://example.com" });
  await external.login();
  assert.equal(external.destinations[0].path, "/admin/bookings");
  const internal = harness({ role: "receptionist" }, { next: "/admin/payments" });
  await internal.login();
  assert.equal(internal.destinations[0].path, "/admin/payments");
});
