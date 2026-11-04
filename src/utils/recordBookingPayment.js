import { collection, doc, getDocs, query, runTransaction, serverTimestamp, where } from "firebase/firestore";
import { db } from "../firebase";
import { allocateBookingPayment } from "./bookingPayments";
import { money } from "./paymentPricing";
import { validateReceiptPhotos } from "./receiptPhotos";

export async function recordBookingPayment(payment) {
  validateReceiptPhotos(payment.receiptPhotos || []);
  if (!payment.patientId || !payment.appointmentId || !payment.chargeBreakdown ||
    !Number.isFinite(Number(payment.amount)) || Number(payment.amount) < 0 || !payment.paymentDate ||
    String(payment.referenceNumber || "").trim().length > 100 ||
    Math.abs(Number(payment.totalCost) - payment.chargeBreakdown.totalCost) > 0.005) {
    throw new Error("A booking, patient, and valid service charges are required.");
  }
  const matches = data => data.patientId === payment.patientId || (payment.uid && data.uid === payment.uid);
  const [summaries, ledger] = await Promise.all([
    getDocs(query(collection(db, "paymentTreatmentSummaries"), where("appointmentId", "==", payment.appointmentId))),
    getDocs(query(collection(db, "payments"), where("appointmentId", "==", payment.appointmentId))),
  ]);
  const references = summaries.docs.filter(entry => matches(entry.data())).map(entry => entry.ref);
  const paymentReferences = ledger.docs.filter(entry => matches(entry.data())).map(entry => entry.ref);
  const groupId = doc(collection(db, "payments")).id;
  const generatedRefs = references.map(() => doc(collection(db, "payments")));
  if (!references.length) throw new Error("This booking has no treatment records. Refresh Payments before trying again.");
  await runTransaction(db, async transaction => {
    const booking = await transaction.get(doc(db, "bookings", payment.appointmentId));
    if (!booking.exists() || !["pending_payment", "completed"].includes(booking.data().status)) {
      throw new Error("The booking is not ready for payment. Refresh Payments.");
    }
    if ((booking.data().promotionId || "") !== (payment.chargeBreakdown.promotionId || "")) {
      throw new Error("The booking promotion changed. Reopen Payments before saving.");
    }
    const [currentSummaries, currentPayments] = await Promise.all([
      Promise.all(references.map(reference => transaction.get(reference))),
      Promise.all(paymentReferences.map(reference => transaction.get(reference))),
    ]);
    const treatments = currentSummaries.map(snapshot => {
      if (!snapshot.exists() || !matches(snapshot.data())) throw new Error("Treatment records changed. Refresh Payments.");
      const summary = snapshot.data();
      const paid = currentPayments.filter(entry => entry.exists() && entry.data().treatmentId === summary.treatmentId)
        .reduce((sum, entry) => sum + money(entry.data().amount), 0);
      return { ...summary, amountPaid: Math.max(money(summary.amountPaid), money(paid)) };
    });
    const allocations = allocateBookingPayment(treatments, payment.chargeBreakdown, payment.amount);
    const now = serverTimestamp();
    allocations.forEach((entry, index) => {
      const { eligibleServiceNames: _names, ...breakdown } = entry.chargeBreakdown;
      const common = {
        patientId: payment.patientId, uid: payment.uid || "", patientName: payment.patientName || "",
        patientEmail: payment.patientEmail || "", patientType: payment.patientType === "Ortho" ? "Ortho" : "Regular",
        appointmentId: payment.appointmentId, treatmentId: entry.treatmentId, treatmentName: entry.treatmentName,
        totalCost: entry.totalCost, chargeBreakdown: breakdown, additionalServices: payment.additionalServices || [],
      };
      if (entry.amount > 0) transaction.set(generatedRefs[index], {
        ...common, paymentGroupId: groupId, amount: entry.amount, paymentDate: payment.paymentDate,
        method: payment.method || "Cash", referenceNumber: String(payment.referenceNumber || "").trim(),
        receiptPhotos: payment.receiptPhotos || [], amountPaidBefore: entry.amountPaid,
        balanceAfterPayment: money(entry.totalCost - entry.amountPaid - entry.amount), createdAt: now,
      });
      transaction.set(references[index], {
        ...common, procedureName: entry.procedureName || entry.treatmentName,
        amountPaid: money(entry.amountPaid + entry.amount), remainingBalance: money(entry.totalCost - entry.amountPaid - entry.amount),
        createdAt: entry.createdAt || now, updatedAt: now,
      });
    });
  });
  return groupId;
}
