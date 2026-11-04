import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
const body = source.slice(source.indexOf("exports.setBookingPromotion ="), source.indexOf("exports.getBookingPaymentPromotion ="));
const offer = { title: "Cleaning offer", status: "active", discountType: "percentage", discountValue: 20,
  services: ["Cleaning"], startDate: "2026-11-01", endDate: "2026-11-30", usageCount: 0 };

function harness({ booking = {}, promotion = {}, summaries = [], payments = [], role = "receptionist" } = {}) {
  const records = new Map([
    ["bookings/booking", { date: "2026-11-04", services: ["Cleaning"], status: "approved", ...booking }],
    ["promotions/promo", { ...offer, ...promotion }],
  ]);
  const audits = [];
  const collection = name => ({
    doc: id => ({ path: `${name}/${id}`, id }),
    where: () => ({ collection: name, limit() { return this; } }),
  });
  const snapshot = ref => ({ ref, id: ref.id, exists: records.has(ref.path), data: () => records.get(ref.path) });
  const db = { collection, runTransaction: async callback => {
    const writes = [];
    await callback({
      get: async ref => ref.collection
        ? { empty: !(ref.collection === "payments" ? payments : summaries).length,
          docs: (ref.collection === "payments" ? payments : summaries).map(data => ({ data: () => data })) }
        : snapshot(ref),
      update: (ref, data) => writes.push([ref, data]),
    });
    for (const [ref, data] of writes) records.set(ref.path, { ...records.get(ref.path), ...data });
  } };
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const call = new Function("exports", "onCall", "getStaffContextFromRequest", "HttpsError", "db", "getBookingServices", "normalizeText", "admin", "writeStaffAuditLog", `${body}; return exports.setBookingPromotion;`)(
    {}, (_options, callback) => callback,
    async (_request, roles) => { if (!roles.includes(role)) throw new HttpsError("permission-denied", "Staff only"); return { uid: "staff" }; },
    HttpsError, db, booking => booking.services || [], value => String(value).trim().toLowerCase(),
    { firestore: { FieldValue: { serverTimestamp: () => "timestamp" } } }, async (_staff, audit) => audits.push(audit),
  );
  return { call, records, audits };
}

test("receptionist assigns an eligible promo and stores its service and discount snapshot", async () => {
  const { call, records, audits } = harness();
  await call({ data: { bookingId: "booking", promotionId: "promo" } });
  const saved = records.get("bookings/booking");
  assert.equal(saved.promotionDiscountValue, 20);
  assert.deepEqual(saved.promotionServices, ["Cleaning"]);
  assert.equal(saved.promotionAssignedBy, "staff");
  assert.equal(records.get("promotions/promo").usageCount, 1);
  assert.equal(audits.length, 1);
});

test("wrong service, date, or inactive promotions are rejected without changing the booking", async () => {
  for (const overrides of [{ services: ["Crowns"] }, { endDate: "2026-11-01" }, { status: "draft" }]) {
    const { call, records } = harness({ promotion: overrides });
    await assert.rejects(call({ data: { bookingId: "booking", promotionId: "promo" } }), /does not apply/);
    assert.equal(records.get("bookings/booking").promotionId, undefined);
  }
});

test("saved charges or recorded payments lock promo selection", async () => {
  for (const data of [{ summaries: [{ chargeBreakdown: { grossTotal: 1000 } }] }, { payments: [{ amount: 100 }] }]) {
    const { call } = harness(data);
    await assert.rejects(call({ data: { bookingId: "booking", promotionId: "promo" } }), /before saving charges/);
  }
});

test("patients cannot assign promos and completed bookings cannot be changed", async () => {
  await assert.rejects(harness({ role: "patient" }).call({ data: { bookingId: "booking", promotionId: "promo" } }), /Staff only/);
  await assert.rejects(harness({ booking: { status: "completed" } }).call({ data: { bookingId: "booking", promotionId: "promo" } }), /active bookings/);
});

test("staff can remove a promo before charges are saved", async () => {
  const { call, records } = harness({ booking: { promotionId: "promo" }, promotion: { usageCount: 1 } });
  await call({ data: { bookingId: "booking", promotionId: "" } });
  assert.equal(records.get("bookings/booking").promotionId, "");
  assert.deepEqual(records.get("bookings/booking").promotionServices, []);
  assert.equal(records.get("promotions/promo").usageCount, 0);
});
