import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { getAdminProfile, getStaffLoginPath, hasFreshStaffMfa, requiresStaffMfa, ROLES } from "../src/utils/rbac.js";

const source = fs.readFileSync(new URL("../src/pages/admin/Login.jsx", import.meta.url), "utf8");
const body = source.slice(source.indexOf("  async function completeStaffLogin("), source.indexOf("  async function onLogin("));

function harness(profile, { verified = true, next = "", authTime = 1000 } = {}) {
  const destinations = [];
  let signedOut = false;
  const login = new Function("auth", "db", "doc", "getDoc", "signOut", "getAdminProfile", "getStaffLoginPath", "hasFreshStaffMfa", "requiresStaffMfa", "ROLES", "searchParams", "navigate", `${body}; return completeStaffLogin;`)(
    {}, {}, (_db, collection, uid) => ({ collection, uid }),
    async () => ({ exists: () => profile !== null, data: () => profile }),
    async () => { signedOut = true; }, getAdminProfile, getStaffLoginPath, hasFreshStaffMfa, requiresStaffMfa, ROLES,
    new URLSearchParams({ next }), (path, options) => destinations.push({ path, options }),
  );
  const credential = { user: { uid: "staff", emailVerified: verified, getIdTokenResult: async () => ({ claims: { auth_time: authTime } }), reload: async () => {} } };
  return { login: () => login(credential), destinations, signedOut: () => signedOut };
}

test("admin, receptionist, and dentist roles are detected from the saved account", async () => {
  for (const [role, path] of [["admin", "/admin/analytics"], ["receptionist", "/admin/dashboard"], ["dentist", "/admin/dashboard"]]) {
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
  assert.equal(state.destinations[0].path, "/admin/verify-email?next=%2Fadmin%2Fdashboard");
});

test("automatic role detection keeps required MFA", async () => {
  const state = harness({ role: "admin" });
  await state.login();
  assert.equal(state.destinations[0].path, "/admin/mfa?next=%2Fadmin%2Fanalytics");
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

test("receptionists land on the dashboard even with a saved next page", async () => {
  const external = harness({ role: "receptionist" }, { next: "https://example.com" });
  await external.login();
  assert.equal(external.destinations[0].path, "/admin/dashboard");
  const internal = harness({ role: "receptionist" }, { next: "/admin/payments" });
  await internal.login();
  assert.equal(internal.destinations[0].path, "/admin/dashboard");
});


test("dentists and receptionists use the dashboard after email and MFA verification even with a next link", async () => {
  for (const role of ["dentist", "receptionist"]) {
    const direct = harness({ role }, { next: "/admin/patients" });
    await direct.login();
    assert.equal(direct.destinations[0].path, "/admin/dashboard");
    const email = harness({ role }, { verified: false, next: "/admin/patients" });
    await email.login();
    assert.equal(email.destinations[0].path, "/admin/verify-email?next=%2Fadmin%2Fdashboard");
    const mfa = harness({ role, mfaRequired: true }, { next: "/admin/patients" });
    await mfa.login();
    assert.equal(mfa.destinations[0].path, "/admin/mfa?next=%2Fadmin%2Fdashboard");
  }
});

test("administrators always land on Overview, regardless of saved next links", () => {
  assert.equal(getStaffLoginPath("admin", "/admin/payments"), "/admin/analytics");
  assert.equal(getStaffLoginPath("admin", "https://example.com"), "/admin/analytics");
  assert.equal(getStaffLoginPath("admin", "/administrator"), "/admin/analytics");
});

test("admin sign-in, email verification, and OTP all lead to Overview", async () => {
  const direct = harness({ role: "admin", mfaVerifiedAuthTime: 1000, mfaVerifiedUntil: new Date(Date.now() + 60000) }, { next: "/admin/patients" });
  await direct.login();
  assert.equal(direct.destinations[0].path, "/admin/analytics");
  const email = harness({ role: "admin" }, { verified: false, next: "/admin/patients" });
  await email.login();
  assert.equal(email.destinations[0].path, "/admin/verify-email?next=%2Fadmin%2Fanalytics");
  const otp = harness({ role: "admin" }, { next: "/admin/patients" });
  await otp.login();
  assert.equal(otp.destinations[0].path, "/admin/mfa?next=%2Fadmin%2Fanalytics");
});
