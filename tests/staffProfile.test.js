import test from "node:test";
import assert from "node:assert/strict";
import { buildStaffProfile, formatStaffName, formatStaffDisplayName, getStaffTitle, dentistNameFields, staffHeaderName, needsStaffProfileSetup } from "../functions/staffProfile.mjs";
import { staffProfileDraft } from "../src/utils/staffProfile.js";

const draft = { firstName: "  Maria  ", middleName: "Santos", lastName: "Dela Cruz", nickname: "Naz", age: "32", gender: "female" };
test("titles follow the requested role and gender mapping", () => {
  assert.equal(getStaffTitle("dentist", "male"), "Dr.");
  assert.equal(getStaffTitle("dentist", "female"), "Dra.");
  assert.equal(getStaffTitle("receptionist", "male"), "Mr.");
  assert.equal(getStaffTitle("receptionist", "female"), "Ms.");
  assert.equal(getStaffTitle("admin", "female"), "ADMIN");
});

test("the account header shows ADMIN or the titled staff name instead of the email", () => {
  assert.equal(staffHeaderName("admin", "", ""), "ADMIN");
  assert.equal(staffHeaderName("admin", "ADMIN James Reyes", "James"), "ADMIN");
  assert.equal(staffHeaderName("dentist", "Dra. Naz", "Naz"), "Dra. Naz");
  assert.equal(staffHeaderName("receptionist", "Mr. James Reyes", "James"), "Mr. James Reyes");
  assert.equal(staffHeaderName("dentist", "", "person@example.com"), "Staff");
});

test("public dentist profiles supply the title in the booking picker without duplicating it", () => {
  assert.equal(formatStaffDisplayName({ role: "dentist", name: "naz", title: "Dra." }), "Dra. naz");
  assert.equal(formatStaffDisplayName({ role: "dentist", name: "Dra. naz", title: "Dra." }), "Dra. naz");
  assert.equal(formatStaffDisplayName({ role: "dentist", nickname: "Naz", firstName: "Maria", lastName: "Reyes", title: "Dr." }), "Dr. Naz");
});

test("structured names preserve compound surnames and keep the title outside the legal name", () => {
  const profile = buildStaffProfile(draft, "dentist");
  assert.equal(profile.age, 32);
  assert.equal(profile.firstName, "Maria");
  assert.equal(profile.lastName, "Dela Cruz");
  assert.equal(profile.fullName, "Maria Santos Dela Cruz");
  assert.equal(profile.name, "Dra. Maria Santos Dela Cruz");
  assert.equal(formatStaffName({ ...profile, role: "dentist" }), profile.name);
  assert.equal(buildStaffProfile({ ...draft, middleName: "" }, "receptionist").name, "Ms. Maria Dela Cruz");
});

test("legacy names remain readable and editing does not invent age or gender", () => {
  assert.equal(formatStaffName({ name: "naz", role: "dentist" }), "naz");
  assert.equal(formatStaffName({ name: "Dr. Naz", role: "dentist" }), "Dr. Naz");
  assert.equal(formatStaffName({ name: "Naz", role: "admin" }), "ADMIN Naz");
  const converted = staffProfileDraft({ name: "Dr. James Reyes", role: "dentist" });
  assert.equal(converted.firstName, "James");
  assert.equal(converted.lastName, "Reyes");
  assert.equal(converted.age, "");
  assert.equal(converted.gender, "");
});

test("invalid ages, missing names, and unknown genders cannot be saved", () => {
  for (const age of ["", 17, 101, 24.5, "invalid"]) assert.throws(() => buildStaffProfile({ ...draft, age }, "dentist"), /age/);
  assert.throws(() => buildStaffProfile({ ...draft, gender: "" }, "dentist"), /gender/);
  assert.throws(() => buildStaffProfile({ ...draft, firstName: "" }, "dentist"), /first and last name/);
});

test("public dentist name fields do not expose age, gender, email, or security settings", () => {
  const fields = dentistNameFields({ ...buildStaffProfile(draft, "dentist"), role: "dentist", email: "private@example.com", mfaEnabled: true });
  assert.equal(fields.name, "Dra. Naz");
  assert.equal(fields.nickname, "Naz");
  assert.equal(fields.fullName, "");
  assert.equal(fields.lastName, "");
  assert.equal(fields.linkedStaffName, fields.name);
  for (const key of ["age", "gender", "phone", "email", "mfaEnabled"]) assert.equal(Object.hasOwn(fields, key), false);
});

test("new and admin-filled staff profiles require personal confirmation, while admins are exempt", () => {
  for (const role of ["dentist", "receptionist"]) {
    assert.equal(needsStaffProfileSetup({ role, name: "Legacy Name" }, "staff"), true);
    assert.equal(needsStaffProfileSetup({ ...buildStaffProfile(draft, role), role, createdBy: "admin" }, "staff"), true);
    assert.equal(needsStaffProfileSetup({ ...buildStaffProfile(draft, role), role, profileSetupCompleted: true, profileSetupCompletedBy: "someone-else" }, "staff"), true);
  }
  assert.equal(needsStaffProfileSetup({ role: "admin" }, "admin"), false);
});

test("a valid self-confirmed profile stays complete across logins and refreshes", () => {
  const profile = { ...buildStaffProfile(draft, "dentist"), role: "dentist", profileSetupCompleted: true, profileSetupCompletedBy: "staff" };
  assert.equal(needsStaffProfileSetup(profile, "staff"), false);
  assert.equal(needsStaffProfileSetup(structuredClone(profile), "staff"), false);
  assert.equal(needsStaffProfileSetup({ ...profile, age: "" }, "staff"), true);
  assert.equal(needsStaffProfileSetup({ ...profile, gender: "" }, "staff"), true);
  assert.equal(needsStaffProfileSetup({ ...profile, nickname: "" }, "staff"), true);
});

test("nickname is separate from the legal name and controls all public display labels", () => {
  const profile = { ...buildStaffProfile(draft, "dentist"), role: "dentist" };
  assert.equal(profile.fullName, "Maria Santos Dela Cruz");
  assert.equal(formatStaffDisplayName(profile), "Dra. Naz");
  assert.equal(formatStaffDisplayName({ ...profile, gender: "male" }), "Dr. Naz");
  assert.equal(formatStaffDisplayName({ ...profile, role: "receptionist" }), "Ms. Naz");
  assert.equal(formatStaffDisplayName({ ...profile, role: "admin" }), "ADMIN");
  assert.equal(staffHeaderName("dentist", formatStaffDisplayName(profile)), "Dra. Naz");
  assert.throws(() => buildStaffProfile({ ...draft, nickname: "" }, "dentist"), /nickname/);
  assert.throws(() => buildStaffProfile({ ...draft, nickname: "x".repeat(41) }, "receptionist"), /nickname/);
});

test("profiles already saved personally before setup was added do not force a second review", () => {
  const profile = { ...buildStaffProfile(draft, "receptionist"), role: "receptionist", updatedBy: "staff", updatedAt: "saved" };
  assert.equal(needsStaffProfileSetup(profile, "staff"), false);
  assert.equal(needsStaffProfileSetup({ ...profile, updatedBy: "admin" }, "staff"), true);
});
