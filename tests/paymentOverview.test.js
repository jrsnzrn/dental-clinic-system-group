import assert from "node:assert/strict";
import test from "node:test";
import { buildPaymentsReport, getPaymentOverview } from "../src/utils/reports.js";

test("overview separates money received from unpaid and partially paid treatment balances", () => {
  const totals = getPaymentOverview({
    summaries: [
      { id: "unpaid", treatmentId: "a", totalCost: 1200, amountPaid: 0 },
      { id: "partial", treatmentId: "b", totalCost: 3000, amountPaid: 750 },
      { id: "cancelled", treatmentId: "c", appointmentId: "cancelled", totalCost: 500 },
    ],
    bookings: [{ id: "cancelled", status: "cancelled" }],
    payments: [
      { id: "partial-1", treatmentId: "b", totalCost: 3000, amount: 400 },
      { id: "partial-2", treatmentId: "b", totalCost: 3000, amount: 350 },
      { id: "legacy", totalCost: 500, paid: 200 },
    ],
    bracesAccounts: [{ id: "ortho", totalCost: 9000, amountPaid: 3000 }],
    bracesPayments: [{ id: "installment", accountId: "ortho", amount: 1000 }],
  });

  assert.equal(totals.received, 1950);
  assert.equal(totals.outstanding, 11750);
  assert.equal(totals.received, totals.transactions.reduce((sum, payment) => sum + payment.amount, 0));
  assert.equal(totals.outstanding, totals.balances.reduce((sum, account) => sum + account.remainingBalance, 0));
});

test("payment reports still honor the selected dates", () => {
  const report = buildPaymentsReport({
    payments: [
      { id: "outside", paymentDate: "2026-10-01", amount: 800 },
      { id: "inside", paymentDate: "2026-11-03", amount: 250 },
    ],
    range: { start: "2026-11-01", end: "2026-11-30" },
  });

  assert.equal(report.cards[0].value, 250);
  assert.deepEqual(report.rows.map((row) => row.id), ["legacy-regular-inside:"]);
});
