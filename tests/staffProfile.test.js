import test from "node:test";
import assert from "node:assert/strict";
import { buildStaffProfile, formatStaffName, getStaffTitle, dentistNameFields, staffHeaderName } from "../functions/staffProfile.mjs";
import { staffProfileDraft } from "../src/utils/staffProfile.js";

const draft = { firstName: "  Maria  ", middleName: "Santos", lastName: "Dela Cruz", age: "32", gender: "female" };
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
  assert.equal(formatStaffName({ role: "dentist", name: "naz", title: "Dra." }), "Dra. naz");
  assert.equal(formatStaffName({ role: "dentist", name: "Dra. naz", title: "Dra." }), "Dra. naz");
  assert.equal(formatStaffName({ role: "dentist", firstName: "Naz", lastName: "Reyes", title: "Dr." }), "Dr. Naz Reyes");
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
  assert.equal(fields.name, "Dra. Maria Santos Dela Cruz");
  assert.equal(fields.linkedStaffName, fields.name);
  for (const key of ["age", "gender", "phone", "email", "mfaEnabled"]) assert.equal(Object.hasOwn(fields, key), false);
});
