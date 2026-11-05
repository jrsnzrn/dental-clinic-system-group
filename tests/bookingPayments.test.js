import test from "node:test";
import assert from "node:assert/strict";
import { getUnchargedPaymentServices, groupBookingPaymentRows, allocateBookingPayment, groupBookingReceipts } from "../src/utils/bookingPayments.js";
import { calculateCharges } from "../src/utils/paymentPricing.js";

const row = (treatmentId, extra = {}) => ({ id: treatmentId, patientId: "patient", appointmentId: "booking", source: "Appointment", treatmentId,
  treatmentName: treatmentId, totalCost: 1000, amountPaid: 0, paymentReady: true, paymentDate: "", ...extra });

test("walk-in and scheduled services group by booking, keeping other appointments and braces accounts separate", () => {
  const grouped = groupBookingPaymentRows([row("Cleaning"), row("Braces"), row("Cleaning", { appointmentId: "next" }),
    row("account", { source: "Ortho", appointmentId: "" })]);
  assert.equal(grouped.length, 3);
  assert.equal(grouped[0].treatmentName, "Cleaning, Braces");
  assert.equal(grouped[0].totalCost, 2000);
  assert.equal(grouped[0].balance, 2000);
  assert.equal(grouped[0].treatments.length, 2);
});

test("multiple payment transactions do not multiply a service's fee or paid total", () => {
  const grouped = groupBookingPaymentRows([row("Cleaning", { amountPaid: 1000 }), row("Cleaning", { amountPaid: 1000 }), row("Braces", { totalCost: 0 })])[0];
  assert.equal(grouped.totalCost, 1000);
  assert.equal(grouped.amountPaid, 1000);
  assert.equal(grouped.allPriced, false);
  assert.equal(grouped.treatments.length, 2);
});

test("a fully paid service and an unpaid service remain one booking with an outstanding balance", () => {
  const grouped = groupBookingPaymentRows([row("Cleaning", { amountPaid: 1000 }), row("Braces")])[0];
  assert.equal(grouped.allPriced, true);
  assert.equal(grouped.balance, 1000);
});

test("one payment allocates to service ledgers and caps a fixed promo once per booking", () => {
  const promo = { id: "promo", discountType: "fixed", discountValue: 500, services: ["Cleaning", "Braces"] };
  const breakdown = { ...calculateCharges([{ name: "Cleaning", amount: 1000 }, { name: "Braces", amount: 2000 }], promo), eligibleServiceNames: promo.services };
  const allocated = allocateBookingPayment([row("Cleaning"), row("Braces")], breakdown, 1500);
  assert.equal(allocated.reduce((sum, entry) => sum + entry.amount, 0), 1500);
  assert.equal(allocated.reduce((sum, entry) => sum + entry.chargeBreakdown.discountAmount, 0), 500);
  assert.equal(allocated.reduce((sum, entry) => sum + entry.totalCost, 0), 2500);
});

test("percentage discount affects only eligible services and preserves existing payments", () => {
  const promo = { id: "promo", discountType: "percentage", discountValue: 20, services: ["Cleaning"] };
  const breakdown = { ...calculateCharges([{ name: "Cleaning", amount: 1000 }, { name: "Braces", amount: 2000 }], promo), eligibleServiceNames: promo.services };
  const allocated = allocateBookingPayment([row("Cleaning", { amountPaid: 300 }), row("Braces")], breakdown, 2500);
  assert.deepEqual(allocated.map(entry => entry.amount), [500, 2000]);
  assert.deepEqual(allocated.map(entry => entry.totalCost), [800, 2000]);
  assert.throws(() => allocateBookingPayment([row("Cleaning", { amountPaid: 300 }), row("Braces")], breakdown, 2501), /exceeds/);
});

test("unpriced services and fees below existing payments are rejected", () => {
  const unpriced = calculateCharges([{ name: "Cleaning", amount: 0 }, { name: "Braces", amount: 1000 }]);
  assert.throws(() => allocateBookingPayment([row("Cleaning"), row("Braces")], unpriced, 0), /Enter a charge/);
  assert.throws(() => allocateBookingPayment([row("Cleaning", { amountPaid: 500 })], calculateCharges([{ name: "Cleaning", amount: 100 }]), 0), /lower than/);
});

test("receipt allocations appear as one payment; separate payments and bookings retain separate receipts", () => {
  const payments = [
    { id: "p1", paymentGroupId: "group", appointmentId: "booking", amount: 800, treatmentName: "Cleaning" },
    { id: "p2", paymentGroupId: "group", appointmentId: "booking", amount: 2000, treatmentName: "Braces" },
    { id: "old", appointmentId: "booking", amount: 300 },
    { id: "next", paymentGroupId: "group", appointmentId: "next", amount: 100 },
  ];
  const receipts = groupBookingReceipts(payments);
  assert.equal(receipts.length, 3);
  assert.equal(receipts[0].amount, 2800);
  assert.equal(receipts[0].treatmentName, "Cleaning, Braces");
  assert.equal(groupBookingReceipts(receipts).length, 3);
});

test("payment add-ons exclude services already on the charge list", () => {
  const services = ["Cleaning", "Braces", "Emax Crown", "Veneers"].map((name) => ({ name }));
  assert.deepEqual(getUnchargedPaymentServices(services, [" cleaning ", "BRACES", "Crowns"]), [{ name: "Veneers" }]);
  assert.deepEqual(getUnchargedPaymentServices(services, ["Emax Crown"]), [services[0], services[1], services[3]]);
});
