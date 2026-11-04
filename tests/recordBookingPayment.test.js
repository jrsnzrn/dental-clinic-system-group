import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { allocateBookingPayment } from "../src/utils/bookingPayments.js";
import { calculateCharges, money } from "../src/utils/paymentPricing.js";
import { validateReceiptPhotos } from "../src/utils/receiptPhotos.js";

const source = fs.readFileSync(new URL("../src/utils/recordBookingPayment.js", import.meta.url), "utf8");
const body = source.slice(source.indexOf("export async function")).replace("export ", "");
const promo = { id: "promo", discountType: "percentage", discountValue: 20, services: ["Cleaning"] };
const breakdown = { ...calculateCharges([{ name: "Cleaning", amount: 1000 }, { name: "Braces", amount: 2000 }], promo), eligibleServiceNames: promo.services };
const payment = { patientId: "patient", appointmentId: "booking", treatmentName: "Cleaning, Braces", patientType: "Regular", totalCost: 2800,
  chargeBreakdown: breakdown, amount: 1000, paymentDate: "2026-11-05", method: "GCash", referenceNumber: "REF-1",
  receiptPhotos: [{ name: "receipt.jpg", dataUrl: "data:image/jpeg;base64,YWJj" }] };

function harness({ failWrite = false, initial = [] } = {}) {
  const stored = new Map([
    ["bookings/booking", { status: "pending_payment", promotionId: "promo" }],
    ...["Cleaning", "Braces"].map(name => [`paymentTreatmentSummaries/${name}`, {
      patientId: "patient", appointmentId: "booking", treatmentId: name, treatmentName: name, totalCost: 0, amountPaid: 0,
    }]), ...initial,
  ]);
  let sequence = 0;
  const ref = path => ({ path, id: path.split("/").at(-1) });
  const snapshot = path => ({ ref: ref(path), id: ref(path).id, exists: () => stored.has(path), data: () => stored.get(path) });
  const record = new Function("validateReceiptPhotos", "collection", "doc", "getDocs", "query", "where", "runTransaction", "serverTimestamp", "db", "money", "allocateBookingPayment", `${body}; return recordBookingPayment;`)(
    validateReceiptPhotos, (_db, name) => ({ name }),
    (...args) => args.length === 1 ? ref(`${args[0].name}/new-${++sequence}`) : ref(`${args[1]}/${args[2]}`),
    async query => ({ docs: [...stored].filter(([path, data]) => path.startsWith(`${query.collection.name}/`) && data[query.filter.field] === query.filter.value).map(([path]) => snapshot(path)) }),
    (collection, filter) => ({ collection, filter }), (field, _operator, value) => ({ field, value }),
    async (_db, callback) => {
      const pending = [];
      await callback({
        get: async reference => { assert.equal(pending.length, 0, "all reads must happen before writes"); return snapshot(reference.path); },
        set: (reference, data) => { pending.push([reference.path, data]); if (failWrite && pending.length === 2) throw new Error("Write failed"); },
      });
      pending.forEach(([path, data]) => stored.set(path, structuredClone(data)));
    }, () => "timestamp", {}, money, allocateBookingPayment,
  );
  return { stored, record };
}

test("one submitted payment updates every service atomically and shares one receipt group", async () => {
  const { stored, record } = harness();
  await record(payment);
  const ledger = [...stored].filter(([path]) => path.startsWith("payments/")).map(([, data]) => data);
  assert.equal(ledger.length, 2);
  assert.deepEqual(ledger.map(entry => entry.amount), [800, 200]);
  assert.equal(new Set(ledger.map(entry => entry.paymentGroupId)).size, 1);
  assert.deepEqual(ledger[0].receiptPhotos, payment.receiptPhotos);
  assert.equal(stored.get("paymentTreatmentSummaries/Cleaning").remainingBalance, 0);
  assert.equal(stored.get("paymentTreatmentSummaries/Braces").remainingBalance, 1800);
  await record({ ...payment, amount: 1800 });
  assert.equal(stored.get("paymentTreatmentSummaries/Braces").amountPaid, 2000);
  assert.equal(stored.get("paymentTreatmentSummaries/Braces").remainingBalance, 0);
  await assert.rejects(record({ ...payment, amount: 1 }), /exceeds/);
});

test("existing service payments remain credited when switching to a combined booking payment", async () => {
  const { stored, record } = harness({ initial: [["payments/legacy", { patientId: "patient", appointmentId: "booking", treatmentId: "Cleaning", amount: 300 }]] });
  await record({ ...payment, amount: 2500 });
  assert.equal(stored.get("paymentTreatmentSummaries/Cleaning").amountPaid, 800);
  assert.equal(stored.get("paymentTreatmentSummaries/Braces").amountPaid, 2000);
  assert.equal(stored.get("payments/legacy").amount, 300);
});

test("a failed write or changed promo creates no partial payment or summary updates", async () => {
  const failed = harness({ failWrite: true });
  const before = structuredClone([...failed.stored]);
  await assert.rejects(failed.record(payment), /Write failed/);
  assert.deepEqual([...failed.stored], before);
  const changed = harness({ initial: [["bookings/booking", { status: "pending_payment", promotionId: "different" }]] });
  await assert.rejects(changed.record(payment), /promotion changed/);
  assert.equal(changed.stored.size, 3);
});

test("a fully discounted booking writes settled service summaries without zero-value payments", async () => {
  const free = { ...promo, discountValue: 100, services: ["Cleaning", "Braces"] };
  const { stored, record } = harness();
  await record({ ...payment, totalCost: 0, amount: 0, chargeBreakdown: { ...calculateCharges(breakdown.serviceCharges, free), eligibleServiceNames: free.services } });
  assert.equal([...stored.keys()].filter(path => path.startsWith("payments/")).length, 0);
  for (const name of ["Cleaning", "Braces"]) {
    assert.equal(stored.get(`paymentTreatmentSummaries/${name}`).totalCost, 0);
    assert.equal(stored.get(`paymentTreatmentSummaries/${name}`).remainingBalance, 0);
  }
});
