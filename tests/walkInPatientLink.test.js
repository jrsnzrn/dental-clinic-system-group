import assert from "node:assert/strict";
import test from "node:test";
import { getVerifiedWalkInEmail, linkWalkInPatient } from "../functions/walkInPatientLink.mjs";

const email = "patient@gmail.com";
const seed = [
  ["patients/walk-in", { email, firstName: "Pat", lastName: "Example", age: "28", phone: "09123456789", patientType: "Ortho", bracesType: "Metal" }],
  ["bookings/visit", { patientId: "walk-in", email, walkIn: true, dentistStaffUid: "dentist" }],
  ["bookings/other", { patientId: "someone-else", email, walkIn: true }],
  ["dentalCharts/walk-in", { patientTreatmentPlans: [{ name: "Cleaning" }] }],
  ["payments/receipt", { patientId: "walk-in", amount: 500 }],
  ["bracesPayments/installment", { patientId: "walk-in", amount: 1000 }],
  ["bracesAccounts/walk-in", { totalCost: 60000 }],
];

function run(records = seed) {
  const data = new Map(structuredClone(records));
  const ref = (path) => ({ path });
  const snap = (path) => ({
    id: path.split("/").at(-1),
    ref: ref(path),
    exists: data.has(path),
    data: () => data.get(path),
  });
  const db = {
    collection: (name) => ({
      doc: (id) => ref(`${name}/${id}`),
      where: (field, _operator, value) => {
        const query = { name, field, value };
        return { ...query, limit: (count) => ({ ...query, count }) };
      },
    }),
    runTransaction: async (callback) => {
      const writes = [];
      const result = await callback({
        get: async (reference) => {
          if (reference.path) return snap(reference.path);
          const docs = [...data.keys()].filter((path) => path.startsWith(`${reference.name}/`) &&
            data.get(path)[reference.field] === reference.value).slice(0, reference.count).map(snap);
          return { docs, size: docs.length };
        },
        set: (reference, value, options) => writes.push([reference.path, value, options?.merge]),
        update: (reference, value) => writes.push([reference.path, value, true]),
      });
      writes.forEach(([path, value, merge]) => data.set(path, merge ? { ...data.get(path), ...value } : value));
      return result;
    },
  };
  return { data, link: () => linkWalkInPatient({ db, uid: "online", email, timestamp: "now" }) };
}

test("only verified Gmail sign-ins supply an email for matching", () => {
  const token = { email: "Patient@Gmail.com", email_verified: true, firebase: { sign_in_provider: "google.com" } };
  assert.equal(getVerifiedWalkInEmail(token), email);
  assert.equal(getVerifiedWalkInEmail({ ...token, email_verified: false }), "");
  assert.equal(getVerifiedWalkInEmail({ ...token, firebase: { sign_in_provider: "password" } }), "");
  assert.equal(getVerifiedWalkInEmail({ ...token, email: "patient@example.com" }), "");
});

test("linking keeps the walk-in ID and exposes only its own booking, chart, and payment records", async () => {
  const { data, link } = run();
  assert.deepEqual(await link(), { status: "linked" });
  assert.equal(data.get("patients/walk-in").uid, "online");
  assert.equal(data.get("patientProfiles/online").patientType, "Ortho");
  assert.equal(data.get("patientProfiles/online").linkedWalkInPatientId, "walk-in");
  assert.equal(data.get("bookings/visit").patientId, "walk-in");
  for (const path of ["bookings/visit", "dentalCharts/online", "payments/receipt", "bracesPayments/installment", "bracesAccounts/walk-in"]) {
    assert.equal(data.get(path).uid, "online");
  }
  assert.equal(data.get("bookings/other").uid, undefined);
  assert.deepEqual(data.get("dentalCharts/online").patientTreatmentPlans, [{ name: "Cleaning" }]);
  assert.deepEqual(await link(), { status: "linked" });
});

test("duplicate records or an existing separate chart require clinic review without transferring ownership", async () => {
  for (const extra of [["patients/duplicate", { email }], ["dentalCharts/online", { patientTreatmentPlans: [] }]]) {
    const { data, link } = run([...seed, extra]);
    assert.deepEqual(await link(), { status: "review" });
    assert.equal(data.get("patients/walk-in").uid, undefined);
    assert.equal(data.get("bookings/visit").uid, undefined);
  }
});
