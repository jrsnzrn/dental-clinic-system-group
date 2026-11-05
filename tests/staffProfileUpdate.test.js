import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildStaffProfile, dentistNameFields, formatStaffDisplayName, hasStaffProfilePhoto, validateStaffProfilePhoto } from "../functions/staffProfile.mjs";

const source = fs.readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
const body = source.slice(source.indexOf("exports.updateStaffProfile = onCall("), source.indexOf("exports.syncLinkedDentistName ="))
  .replace("exports.updateStaffProfile =", "const update =").replace('await import("./staffProfile.mjs")', "staffProfileModule");

function harness({ actorRole = "admin", actorUid = "admin", targetRole = "dentist", failWrite = false, ownAccount = false, includeEmail = false, photo, existingPhoto } = {}) {
  const stored = new Map([
    ["admins/staff", { name: "Old Name", role: targetRole, email: "staff@example.com", mfaEnabled: true, profilePhoto: existingPhoto }],
    ["dentists/linked", { name: "Old Name", linkedStaffUid: "staff", schedule: { monday: { active: true } } }],
    ["dentists/other", { name: "Other Dentist", linkedStaffUid: "other" }],
  ]);
  const authUpdates = [];
  const audit = [];
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const db = {
    collection: name => ({ doc: id => ({ path: `${name}/${id}` }), where: (field, _op, value) => ({ collection: name, field, value }) }),
    runTransaction: async callback => {
      const writes = [];
      await callback({
        get: async ref => {
          if (ref.collection) return { docs: [...stored].filter(([path, data]) => path.startsWith(`${ref.collection}/`) && data[ref.field] === ref.value).map(([path]) => ({ ref: { path } })) };
          return { exists: stored.has(ref.path), data: () => stored.get(ref.path) };
        },
        update: (ref, data) => { writes.push([ref.path, data]); if (failWrite && writes.length === 2) throw new Error("Database unavailable"); },
      });
      writes.forEach(([path, data]) => stored.set(path, { ...stored.get(path), ...data }));
    },
  };
  const update = new Function("onCall", "getStaffContextFromRequest", "HttpsError", "ALLOWED_ROLES", "db", "staffProfileModule", "admin", "auth", "writeStaffAuditLog", `${body}; return update;`)(
    callback => callback,
    async (_request, roles) => { if (!roles.includes(actorRole)) throw new HttpsError("permission-denied", "Staff access required"); return { uid: actorUid, role: actorRole }; },
    HttpsError, ["dentist", "receptionist"], db, { buildStaffProfile, dentistNameFields, formatStaffDisplayName, hasStaffProfilePhoto, validateStaffProfilePhoto }, { firestore: { FieldValue: { serverTimestamp: () => "now" } } },
    { updateUser: async (uid, data) => authUpdates.push({ uid, data }) }, async (_actor, entry) => audit.push(entry),
  );
  const request = { data: { ...(ownAccount ? {} : { uid: "staff" }), firstName: "Maria", middleName: "", lastName: "Reyes", nickname: "Mia", age: 30, gender: "female", phone: "09123456789",
    ...(photo === undefined ? {} : { profilePhoto: photo }), role: "admin", ...(includeEmail ? { email: "changed@example.com" } : {}), mfaEnabled: false } };
  return { stored, update: () => update(request), authUpdates, audit };
}

test("admin edits name fields and linked dentist names together while identity and role stay unchanged", async () => {
  const h = harness();
  await h.update();
  const staff = h.stored.get("admins/staff");
  assert.equal(staff.name, "Dra. Maria Reyes");
  assert.equal(staff.role, "dentist");
  assert.equal(staff.email, "staff@example.com");
  assert.equal(staff.mfaEnabled, true);
  assert.equal(staff.profileSetupCompleted, undefined);
  assert.equal(staff.fullName, "Maria Reyes");
  assert.equal(staff.nickname, "Mia");
  assert.equal(h.stored.get("dentists/linked").name, "Dra. Mia");
  assert.equal(h.stored.get("dentists/linked").nickname, "Mia");
  assert.equal(h.stored.get("dentists/linked").fullName, "");
  assert.equal(h.stored.get("dentists/linked").linkedStaffUid, "staff");
  assert.equal(h.stored.get("dentists/linked").schedule.monday.active, true);
  assert.equal(h.stored.get("dentists/other").name, "Other Dentist");
  assert.deepEqual(h.authUpdates, [{ uid: "staff", data: { displayName: "Dra. Mia" } }]);
  assert.equal(h.audit[0].action, "update_staff_profile");
});

test("receptionist updates use Ms. and do not modify dentist profiles", async () => {
  const h = harness({ targetRole: "receptionist" });
  await h.update();
  assert.equal(h.stored.get("admins/staff").name, "Ms. Maria Reyes");
  assert.equal(h.stored.get("dentists/linked").name, "Old Name");
});

test("staff cannot edit someone else's profile, and partial profile writes are not committed", async () => {
  for (const actorRole of ["dentist", "receptionist"]) {
    const h = harness({ actorRole });
    await assert.rejects(h.update(), /own account/);
    assert.equal(h.stored.get("admins/staff").name, "Old Name");
  }
  const failed = harness({ failWrite: true });
  await assert.rejects(failed.update(), /Database unavailable/);
  assert.equal(failed.stored.get("admins/staff").name, "Old Name");
  assert.equal(failed.stored.get("dentists/linked").name, "Old Name");
  assert.equal(failed.authUpdates.length, 0);
});

test("dentists and receptionists can update themselves without changing email, role, or MFA", async () => {
  for (const actorRole of ["dentist", "receptionist"]) {
    const h = harness({ actorRole, actorUid: "staff", targetRole: actorRole, ownAccount: true, existingPhoto: "data:image/jpeg;base64,/9j/4P/Z" });
    await h.update();
    const saved = h.stored.get("admins/staff");
    assert.equal(saved.role, actorRole);
    assert.equal(saved.email, "staff@example.com");
    assert.equal(saved.mfaEnabled, true);
    assert.equal(saved.phone, "09123456789");
    assert.equal(saved.profileSetupCompleted, true);
    assert.equal(saved.profileSetupCompletedBy, "staff");
    assert.equal(saved.name, actorRole === "dentist" ? "Dra. Maria Reyes" : "Ms. Maria Reyes");
  }
});

test("administrators can edit their own personal details and keep their ADMIN title", async () => {
  const h = harness({ actorRole: "admin", actorUid: "staff", targetRole: "admin", ownAccount: true });
  await h.update();
  assert.equal(h.stored.get("admins/staff").name, "ADMIN Maria Reyes");
  assert.equal(h.stored.get("admins/staff").role, "admin");
});

test("staff email changes are rejected even when someone manually modifies a self-service request", async () => {
  for (const role of ["receptionist", "dentist"]) {
    const h = harness({ actorRole: role, actorUid: "staff", targetRole: role, ownAccount: true, includeEmail: true });
    await assert.rejects(h.update(), /Only an administrator can change/);
    assert.equal(h.stored.get("admins/staff").email, "staff@example.com");
    assert.equal(h.authUpdates.length, 0);
  }
});

test("staff and administrators can save a profile photo, keep it on unrelated edits, or remove it", async () => {
  const photo = "data:image/jpeg;base64,/9j/4P/Z";
  const self = harness({ actorRole: "dentist", actorUid: "staff", ownAccount: true, photo });
  assert.equal((await self.update()).profilePhoto, photo);
  assert.equal(self.stored.get("admins/staff").profilePhoto, photo);
  assert.equal(self.stored.get("dentists/linked").profilePhoto, undefined);
  const keep = harness({ existingPhoto: photo });
  await keep.update();
  assert.equal(keep.stored.get("admins/staff").profilePhoto, photo);
  const remove = harness({ existingPhoto: photo, photo: "" });
  await remove.update();
  assert.equal(remove.stored.get("admins/staff").profilePhoto, "");
  await assert.rejects(harness({ photo: "https://example.com/image.jpg" }).update(), /valid profile picture/);
  await assert.rejects(harness({ actorRole: "receptionist", photo }).update(), /own account/);
});

test("staff cannot complete setup or remove their own picture without leaving a valid photo on the profile", async () => {
  for (const role of ["dentist", "receptionist"]) {
    const options = { actorRole: role, actorUid: "staff", targetRole: role, ownAccount: true };
    await assert.rejects(harness(options).update(), /Upload a profile picture/);
    const remove = harness({ ...options, existingPhoto: "data:image/jpeg;base64,/9j/4P/Z", photo: "" });
    await assert.rejects(remove.update(), /Upload a profile picture/);
    assert.equal(remove.stored.get("admins/staff").profilePhoto, "data:image/jpeg;base64,/9j/4P/Z");
  }
});
