import { isCrownTypeService } from "../../functions/bookingServices.mjs";
import { money } from "./paymentPricing.js";

const namesOf = value => String(value || "").split(",").map(name => name.trim()).filter(Boolean);

export function getUnchargedPaymentServices(services, chargedNames) {
  const key = (name) => name.trim().toLowerCase().replace(/\s+/g, " ");
  const charged = new Set(chargedNames.map(key));
  return services.filter((service) => !charged.has(key(service.name)) && !(charged.has("crowns") && isCrownTypeService(service)));
}

export function groupBookingPaymentRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.source === "Appointment" && row.appointmentId
      ? `booking:${row.appointmentId}` : `treatment:${row.patientId}:${row.treatmentId}`;
    const entries = groups.get(key) || [];
    entries.push(row);
    groups.set(key, entries);
  }
  return [...groups.values()].map(entries => {
    const treatments = [...new Map(entries.map(row => [row.treatmentId, row])).values()];
    const first = entries[0];
    if (first.source !== "Appointment" || !first.appointmentId) return [...entries].sort((a, b) => String(b.paymentDate || "").localeCompare(String(a.paymentDate || "")))[0];
    const totalCost = money(treatments.reduce((sum, row) => sum + row.totalCost, 0));
    const amountPaid = money(treatments.reduce((sum, row) => sum + row.amountPaid, 0));
    const serviceCharges = treatments.flatMap(row => row.chargeBreakdown?.serviceCharges ||
      namesOf(row.treatmentName).map((name, index) => ({ name, amount: index === 0 ? row.totalCost : 0 })));
    const grossTotal = money(treatments.reduce((sum, row) => sum + (row.chargeBreakdown?.grossTotal ?? row.totalCost), 0));
    const allPriced = treatments.every(row => row.totalCost > 0 || row.chargeBreakdown?.grossTotal > 0);
    const promo = treatments.find(row => row.chargeBreakdown?.promotionId)?.chargeBreakdown || {};
    return {
      ...first, id: `booking-payment-${first.appointmentId}`, treatments, allPriced,
      treatmentName: [...new Set(treatments.flatMap(row => namesOf(row.treatmentName)))].join(", "),
      totalCost, amountPaid, balance: money(totalCost - amountPaid),
      paymentReady: treatments.every(row => row.paymentReady),
      paymentDate: entries.map(row => row.paymentDate || "").sort().at(-1) || "",
      method: [...new Set(entries.map(row => row.method).filter(Boolean))].join(", "),
      additionalServices: [...new Set(treatments.flatMap(row => row.additionalServices || []))],
      chargeBreakdown: { ...promo, serviceCharges, grossTotal, totalCost,
        eligibleTotal: money(treatments.reduce((sum, row) => sum + (row.chargeBreakdown?.eligibleTotal || 0), 0)),
        discountAmount: money(treatments.reduce((sum, row) => sum + (row.chargeBreakdown?.discountAmount || 0), 0)) },
    };
  });
}

// Split one booking payment across its existing service ledgers, in centavos.
export function allocateBookingPayment(treatments, breakdown, received) {
  const allocations = treatments.map(treatment => ({ ...treatment, lines: [] }));
  if (!allocations.length) throw new Error("This booking has no service charges. Reopen Payments.");
  for (const line of breakdown.serviceCharges) {
    const name = line.name.trim().toLowerCase();
    const target = allocations.find(entry => namesOf(entry.treatmentName).some(service => service.toLowerCase() === name)) || allocations[0];
    target.lines.push(line);
  }
  let discountLeft = Math.round(breakdown.discountAmount * 100);
  // Discount allocation follows each service's original eligible amount.
  const eligibleNames = new Set((breakdown.eligibleServiceNames || []).map(name => name.trim().toLowerCase()));
  const eligible = allocations.map(entry => money(entry.lines.reduce((sum, line) => sum +
    (eligibleNames.has(line.name.toLowerCase()) ? line.amount : 0), 0)));
  const eligibleTotal = eligible.reduce((sum, amount) => sum + amount, 0);
  let receivedLeft = Math.round(money(received) * 100);
  const result = allocations.map((entry, index) => {
    const grossTotal = money(entry.lines.reduce((sum, line) => sum + line.amount, 0));
    const lastEligible = eligible.slice(index + 1).every(amount => amount === 0);
    const discount = eligible[index] > 0 ? Math.min(Math.round(eligible[index] * 100), discountLeft,
      lastEligible ? discountLeft : Math.round(breakdown.discountAmount * 100 * eligible[index] / eligibleTotal)) : 0;
    discountLeft -= discount;
    const totalCost = money(grossTotal - discount / 100);
    const paid = money(entry.amountPaid);
    if (totalCost < paid) throw new Error(`The charge for ${entry.treatmentName} cannot be lower than its recorded payments.`);
    if (grossTotal <= 0) throw new Error(`Enter a charge for ${entry.treatmentName}.`);
    const amount = Math.min(receivedLeft, Math.round((totalCost - paid) * 100));
    receivedLeft -= amount;
    const { eligibleServiceNames: _names, ...base } = breakdown;
    return { ...entry, amount: amount / 100, totalCost, amountPaid: paid,
      chargeBreakdown: { ...base, serviceCharges: entry.lines, grossTotal, eligibleTotal: eligible[index], discountAmount: discount / 100, totalCost } };
  });
  if (discountLeft || receivedLeft) throw new Error("The payment exceeds the booking balance or its discount is out of date. Reopen Payments.");
  return result;
}

export function groupBookingReceipts(payments) {
  const groups = new Map();
  for (const payment of payments) {
    const key = payment.paymentGroupId ? `${payment.appointmentId}:${payment.paymentGroupId}` : `single:${payment.ledgerSource || payment.receiptSource || ""}:${payment.id}`;
    const entries = groups.get(key) || [];
    entries.push(payment);
    groups.set(key, entries);
  }
  return [...groups.values()].map(entries => {
    if (entries.length === 1) return entries[0];
    const first = entries[0];
    return { ...first, id: first.paymentGroupId,
      amount: money(entries.reduce((sum, entry) => sum + entry.amount, 0)),
      treatmentName: [...new Set(entries.flatMap(entry => namesOf(entry.treatmentName)))].join(", "),
      amountPaidBefore: money(entries.reduce((sum, entry) => sum + (entry.amountPaidBefore || 0), 0)),
      chargeBreakdown: entries.every(entry => entry.chargeBreakdown) ? {
        ...first.chargeBreakdown,
        serviceCharges: entries.flatMap(entry => entry.chargeBreakdown.serviceCharges),
        grossTotal: money(entries.reduce((sum, entry) => sum + entry.chargeBreakdown.grossTotal, 0)),
        eligibleTotal: money(entries.reduce((sum, entry) => sum + entry.chargeBreakdown.eligibleTotal, 0)),
        discountAmount: money(entries.reduce((sum, entry) => sum + entry.chargeBreakdown.discountAmount, 0)),
        totalCost: money(entries.reduce((sum, entry) => sum + entry.chargeBreakdown.totalCost, 0)),
      } : undefined,
    };
  });
}
