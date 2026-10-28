import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db } from "../firebase";
import { buildBracesAccount } from "./braces";

function toAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function makeRegularSummaryId(patientId, treatmentId) {
  return `${patientId.length}_${patientId}${treatmentId}`;
}

export async function createRegularTreatment(payment) {
  const patientId = String(payment.patientId || "");
  const totalCost = toAmount(payment.totalCost);
  const treatmentId = String(
    payment.treatmentId || doc(collection(db, "payments")).id
  );
  if (!patientId || !treatmentId || totalCost <= 0) {
    throw new Error("A patient, treatment, and positive total cost are required.");
  }

  const summaryRef = doc(
    db,
    "paymentTreatmentSummaries",
    makeRegularSummaryId(patientId, treatmentId)
  );
  await runTransaction(db, async (transaction) => {
    const summarySnapshot = await transaction.get(summaryRef);
    if (summarySnapshot.exists()) {
      throw new Error("This treatment already has a payment record. Select it to add a payment.");
    }
    transaction.set(summaryRef, {
      patientId,
      uid: payment.uid || "",
      patientName: payment.patientName || "",
      patientEmail: payment.patientEmail || "",
      patientType: payment.patientType === "Ortho" ? "Ortho" : "Regular",
      treatmentId,
      appointmentId: payment.appointmentId || "",
      treatmentName: payment.treatmentName || "",
      totalCost,
      amountPaid: 0,
      remainingBalance: totalCost,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
  return treatmentId;
}

export async function recordRegularPayment(payment) {
  const amount = toAmount(payment.amount);
  const requestedTotalCost = toAmount(payment.totalCost);
  const allowZeroAmount = payment.allowZeroAmount === true;
  const patientId = String(payment.patientId || "");
  const paymentRef = doc(collection(db, "payments"));
  const treatmentId = String(payment.treatmentId || paymentRef.id);
  const paymentData = { ...payment };
  delete paymentData.allowZeroAmount;

  if (
    !patientId ||
    !treatmentId ||
    (amount <= 0 && !allowZeroAmount) ||
    requestedTotalCost <= 0
  ) {
    throw new Error("A patient, treatment, positive total cost, and valid payment amount are required.");
  }

  const summaryRef = doc(
    db,
    "paymentTreatmentSummaries",
    makeRegularSummaryId(patientId, treatmentId)
  );
  const treatmentSummariesQuery = query(
    collection(db, "paymentTreatmentSummaries"),
    where("treatmentId", "==", treatmentId)
  );
  const treatmentPaymentsQuery = query(
    collection(db, "payments"),
    where("treatmentId", "==", treatmentId)
  );
  // The Web SDK transaction API accepts document references, not Query objects.
  // Discover candidate documents first, then re-read their references inside the
  // transaction so balance calculations use current document contents.
  const [summariesSnapshot, paymentsSnapshot] = await Promise.all([
    getDocs(treatmentSummariesQuery),
    getDocs(treatmentPaymentsQuery),
  ]);
  const matchingSummary = summariesSnapshot.docs.find((entry) => {
    const data = entry.data();
    return data.patientId === patientId || (payment.uid && data.uid === payment.uid);
  });
  const targetSummaryRef = matchingSummary?.ref || summaryRef;
  const relatedPaymentRefs = paymentsSnapshot.docs
    .filter((entry) => {
      const data = entry.data();
      return data.patientId === patientId || (payment.uid && data.uid === payment.uid);
    })
    .map((entry) => entry.ref);
  const summaryRefs = [...new Map([summaryRef, targetSummaryRef].map((ref) => [ref.path, ref])).values()];

  await runTransaction(db, async (transaction) => {
    const [summarySnapshots, paymentSnapshots] = await Promise.all([
      Promise.all(summaryRefs.map((ref) => transaction.get(ref))),
      Promise.all(relatedPaymentRefs.map((ref) => transaction.get(ref))),
    ]);
    const summaryByPath = new Map(summarySnapshots.map((snapshot) => [snapshot.ref.path, snapshot]));
    const summarySnapshot = summaryByPath.get(targetSummaryRef.path);
    const relatedPayments = paymentSnapshots.filter((snapshot) => {
      if (!snapshot.exists()) return false;
      const data = snapshot.data();
      return data.patientId === patientId || (payment.uid && data.uid === payment.uid);
    });
    const ledgerTotal = relatedPayments.reduce(
      (sum, entry) => sum + toAmount(entry.data().amount ?? entry.data().paid),
      0
    );
    const summary = summarySnapshot.exists() ? summarySnapshot.data() : null;
    const amountPaid = Math.max(ledgerTotal, toAmount(summary?.amountPaid));
    const totalCost = allowZeroAmount
      ? requestedTotalCost
      : toAmount(summary?.totalCost) ||
        relatedPayments.reduce(
          (maximum, entry) => Math.max(maximum, toAmount(entry.data().totalCost ?? entry.data().cost ?? entry.data().total)),
          requestedTotalCost
        );

    if (amount > Math.max(0, totalCost - amountPaid)) {
      throw new Error("Payment amount cannot exceed the outstanding balance.");
    }
    if (totalCost < amountPaid) {
      throw new Error("The treatment total cannot be lower than the amount already paid.");
    }

    const nextAmountPaid = amountPaid + amount;
    const now = serverTimestamp();
    const patientType = payment.patientType === "Ortho" ? "Ortho" : "Regular";
    if (amount > 0) {
      transaction.set(paymentRef, {
        ...paymentData,
        patientType,
        treatmentId,
        totalCost,
        amount,
        createdAt: now,
      });
    }
    transaction.set(targetSummaryRef, {
      patientId,
      uid: payment.uid || "",
      patientName: payment.patientName || summarySnapshot.data()?.patientName || "",
      patientEmail: payment.patientEmail || summarySnapshot.data()?.patientEmail || "",
      patientType,
      treatmentId,
      appointmentId: payment.appointmentId || summarySnapshot.data()?.appointmentId || "",
      treatmentName: payment.treatmentName || summarySnapshot.data()?.treatmentName || "",
      procedureName: summarySnapshot.data()?.procedureName || payment.treatmentName || "",
      totalCost,
      amountPaid: nextAmountPaid,
      remainingBalance: Math.max(0, totalCost - nextAmountPaid),
      updatedAt: now,
      ...(summarySnapshot.exists() ? {} : { createdAt: now }),
    });
  });

  return amount > 0 ? paymentRef.id : treatmentId;
}

export async function recordBracesPayment({
  patient,
  accountId,
  amount: rawAmount,
  totalCost: rawTotalCost,
  bracesType,
  paymentDate,
  method,
  notes,
}) {
  const amount = toAmount(rawAmount);
  if (!patient?.id || !accountId || Number(rawAmount) < 0 || !paymentDate) {
    throw new Error("A braces account, non-negative payment amount, and payment date are required.");
  }

  const accountRef = doc(db, "bracesAccounts", accountId);
  const paymentRef = doc(collection(db, "bracesPayments"));
  const paymentQueries = [
    query(collection(db, "bracesPayments"), where("accountId", "==", accountId)),
    query(collection(db, "bracesPayments"), where("patientId", "==", patient.id)),
  ];
  if (patient.uid) {
    paymentQueries.push(
      query(collection(db, "bracesPayments"), where("uid", "==", patient.uid))
    );
  }
  const paymentQuerySnapshots = await Promise.all(paymentQueries.map((paymentQuery) => getDocs(paymentQuery)));
  const paymentRefs = [...new Map(
    paymentQuerySnapshots.flatMap((snapshot) => snapshot.docs.map((entry) => [entry.ref.path, entry.ref]))
  ).values()];

  await runTransaction(db, async (transaction) => {
    const accountSnapshot = await transaction.get(accountRef);
    if (!accountSnapshot.exists()) {
      throw new Error("The braces account could not be found.");
    }

    const paymentSnapshots = await Promise.all(paymentRefs.map((ref) => transaction.get(ref)));
    const ledger = new Map();
    paymentSnapshots.forEach((snapshot) => {
      if (snapshot.exists()) ledger.set(snapshot.id, { id: snapshot.id, ...snapshot.data() });
    });
    const existingPayments = [...ledger.values()];
    const account = { id: accountSnapshot.id, ...accountSnapshot.data() };
    const ledgerTotal = existingPayments.reduce((sum, entry) => sum + toAmount(entry.amount), 0);
    const amountPaidBefore = Math.max(ledgerTotal, toAmount(account.amountPaid));
    const totalCost = toAmount(rawTotalCost) || toAmount(account.totalCost);

    if (amount > Math.max(0, totalCost - amountPaidBefore)) {
      throw new Error("Payment amount cannot exceed the outstanding braces balance.");
    }
    if (totalCost < amountPaidBefore) {
      throw new Error("The braces total cannot be lower than the amount already paid.");
    }

    const carryForward = Math.max(0, amountPaidBefore - ledgerTotal);
    const payment = amount > 0
      ? {
          accountId,
          patientId: patient.id,
          uid: patient.uid || "",
          patientName: patient.name || "",
          amount,
          paymentDate,
          method: method || "Cash",
          notes: String(notes || "").trim(),
          createdAt: serverTimestamp(),
        }
      : null;
    const discountAmount = toAmount(account.discountAmount);
    const updatedAccount = {
      ...account,
      totalCost,
      listedCost: account.listedCost ? totalCost + discountAmount : account.listedCost,
      bracesType: bracesType || account.bracesType || "",
    };
    const summaryPayments = carryForward > 0
      ? [...existingPayments, { amount: carryForward, paymentDate: account.lastPaymentAt || "" }, ...(payment ? [payment] : [])]
      : [...existingPayments, ...(payment ? [payment] : [])];
    const summary = buildBracesAccount(updatedAccount, summaryPayments);

    if (payment) transaction.set(paymentRef, payment);
    transaction.set(
      accountRef,
      {
        totalCost,
        ...(account.listedCost ? { listedCost: updatedAccount.listedCost } : {}),
        ...(bracesType ? { bracesType } : {}),
        amountPaid: summary.amountPaid,
        remainingBalance: summary.remainingBalance,
        expectedPaidByNow: summary.expectedPaidByNow,
        paymentState: summary.paymentState,
        progressPercent: summary.progressPercent,
        ...(payment ? { lastPaymentAt: paymentDate } : {}),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  });

  return amount > 0 ? paymentRef.id : accountId;
}
