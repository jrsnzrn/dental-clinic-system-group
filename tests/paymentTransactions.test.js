import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { calculateCharges } from "../src/utils/paymentPricing.js";
import { validateReceiptPhotos } from "../src/utils/receiptPhotos.js";

const source = fs.readFileSync(new URL("../src/utils/paymentTransactions.js", import.meta.url), "utf8");
const body = source.slice(source.indexOf("export async function recordRegularPayment"), source.indexOf("export async function recordBracesPayment")).replace("export ", "");

function harness(initial = []) {
  const stored = new Map([["bookings/booking", { promotionId: "promo" }], ...initial].map(([path, data]) => [path, structuredClone(data)]));
  const writes = [];
  let sequence = 0;
  const ref = path => ({ path, id: path.split("/").pop() });
  const snapshot = path => ({ ref: ref(path), exists: () => stored.has(path), data: () => stored.get(path) });
  const record = new Function("collection", "doc", "getDocs", "query", "where", "runTransaction", "serverTimestamp", "db", "toAmount", "makeRegularSummaryId", "validateReceiptPhotos", `${body}; return recordRegularPayment;`)(
    (_db, name) => ({ name }),
    (...args) => args.length === 1 ? ref(`${args[0].name}/new-${++sequence}`) : ref(`${args[1]}/${args[2]}`),
    async query => ({ docs: [...stored].filter(([path, data]) => path.startsWith(`${query.collection.name}/`) && data[query.filter.field] === query.filter.value).map(([path]) => snapshot(path)) }),
    (collection, filter) => ({ collection, filter }),
    (field, _operator, value) => ({ field, value }),
    async (_db, callback) => {
      const pending = [];
      await callback({ get: async reference => snapshot(reference.path), set: (reference, data) => pending.push([reference.path, data]) });
      for (const [path, data] of pending) { stored.set(path, data); writes.push({ path, data }); }
    },
    () => "timestamp", {}, value => Math.max(0, Number(value) || 0), (patientId, treatmentId) => `${patientId.length}_${patientId}${treatmentId}`, validateReceiptPhotos,
  );
  return { record, stored, writes };
}

const promotion = { id: "promo", title: "20% off", discountType: "percentage", discountValue: 20, services: ["Cleaning"] };
const breakdown = calculateCharges([{ name: "Cleaning", amount: 1000 }], promotion);
const payment = {
  patientId: "p", treatmentId: "t", appointmentId: "booking", patientType: "Regular",
  treatmentName: "Cleaning", totalCost: 800, amount: 300, allowZeroAmount: true,
  chargeBreakdown: breakdown, paymentDate: "2026-11-04", method: "GCash",
  referenceNumber: "BANK-12345", receiptPhotos: [{ name: "receipt.jpg", dataUrl: "data:image/jpeg;base64,YWJj" }],
};

test("partial payments preserve discounted totals, receipt photos, and the running balance", async () => {
  const { record, writes } = harness();
  await record(payment);
  assert.equal(writes[0].data.totalCost, 800);
  assert.equal(writes[0].data.amountPaidBefore, 0);
  assert.equal(writes[0].data.balanceAfterPayment, 500);
  assert.deepEqual(writes[0].data.receiptPhotos, payment.receiptPhotos);
  assert.deepEqual(writes[1].data.chargeBreakdown, breakdown);
  assert.equal(writes[1].data.remainingBalance, 500);
});

test("subsequent payment settles the same net charge without a second promo deduction", async () => {
  const { record, stored } = harness();
  await record(payment);
  await record({ ...payment, amount: 500 });
  const summary = stored.get("paymentTreatmentSummaries/1_pt");
  assert.equal(summary.totalCost, 800);
  assert.equal(summary.amountPaid, 800);
  assert.equal(summary.remainingBalance, 0);
});

test("overpayment and repricing below money already received are rejected atomically", async () => {
  const { record, writes } = harness();
  await record(payment);
  await assert.rejects(record({ ...payment, amount: 501 }), /outstanding balance/);
  await assert.rejects(record({ ...payment, amount: 0, totalCost: 200,
    chargeBreakdown: calculateCharges([{ name: "Cleaning", amount: 250 }], promotion),
  }), /lower than the amount already paid/);
  assert.equal(writes.length, 2);
});

test("100 percent discount writes a settled summary without creating a zero-value payment", async () => {
  const { record, writes } = harness();
  const free = calculateCharges([{ name: "Cleaning", amount: 1000 }], { ...promotion, discountValue: 100 });
  await record({ ...payment, totalCost: 0, amount: 0, chargeBreakdown: free, receiptPhotos: [] });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].data.totalCost, 0);
  assert.equal(writes[0].data.remainingBalance, 0);
});

test("fixed promo cannot exceed the booking allowance after another service uses it", async () => {
  const fixed = { ...promotion, discountType: "fixed", discountValue: 500 };
  const full = calculateCharges([{ name: "Cleaning", amount: 1000 }], fixed);
  const { record, writes } = harness([["paymentTreatmentSummaries/other", {
    patientId: "p", treatmentId: "other", appointmentId: "booking",
    chargeBreakdown: { discountAmount: 400 },
  }]]);
  await assert.rejects(record({ ...payment, totalCost: 500, amount: 100, chargeBreakdown: full }), /applied to another service/);
  assert.equal(writes.length, 0);
});

test("payment and summary fields match their Firestore allowlists", async () => {
  const rules = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  const { record, writes } = harness();
  await record(payment);
  for (const { path, data } of writes) {
    const collection = path.split("/")[0];
    const block = rules.slice(rules.indexOf(`match /${collection}/{id}`));
    const allowed = new Set([...block.match(/hasOnly\(\[([\s\S]*?)\]\)/)[1].matchAll(/"([^"]+)"/g)].map(match => match[1]));
    assert.deepEqual(Object.keys(data).filter(key => !allowed.has(key)), []);
  }
});

test("a staff promo change between opening the form and saving rejects stale totals", async () => {
  const { record, writes } = harness([["bookings/booking", { promotionId: "different-promo" }]]);
  await assert.rejects(record(payment), /promotion changed/);
  assert.equal(writes.length, 0);
});
