function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizePhone(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export const PLAN_FREQUENCIES = [
  { value: "Monthly", label: "Monthly" },
  { value: "Biweekly", label: "Every 2 Weeks" },
  { value: "Weekly", label: "Weekly" },
];

export const PLAN_FREQUENCY_DISCOUNTS = {
  Monthly: 0,
  Biweekly: 0.025,
  Weekly: 0.03,
};

export function formatCurrency(value) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(toNumber(value));
}

export function computeInstallmentAmount({
  totalCost = 0,
  downPaymentExpected = 0,
  planCycles = 0,
  planFrequency = "Monthly",
}) {
  const normalizedTotal = toNumber(totalCost);
  const normalizedDownPayment = toNumber(downPaymentExpected);
  const normalizedCycles = Math.max(0, Math.round(toNumber(planCycles)));
  const remainingBalance = Math.max(0, normalizedTotal - normalizedDownPayment);
  const installmentCount = getInstallmentCount(normalizedCycles, planFrequency);
  const discountRate = getDiscountRate(planFrequency);
  const discountedRemainingBalance = remainingBalance * (1 - discountRate);

  if (!installmentCount) {
    return 0;
  }

  return discountedRemainingBalance / installmentCount;
}

export function normalizePlanFrequency(value) {
  const match = PLAN_FREQUENCIES.find((entry) => entry.value === value);
  return match?.value || "Monthly";
}

export function getInstallmentLabel(planFrequency = "Monthly") {
  const normalized = normalizePlanFrequency(planFrequency);
  if (normalized === "Weekly") return "Weekly payment";
  if (normalized === "Biweekly") return "Biweekly payment";
  return "Monthly payment";
}

export function getCycleCountLabel(planFrequency = "Monthly") {
  return "Plan duration in months";
}

export function getDiscountRate(planFrequency = "Monthly") {
  return PLAN_FREQUENCY_DISCOUNTS[normalizePlanFrequency(planFrequency)] || 0;
}

export function getInstallmentCount(planMonths = 0, planFrequency = "Monthly") {
  const normalizedMonths = Math.max(0, Math.round(toNumber(planMonths)));
  const normalized = normalizePlanFrequency(planFrequency);

  if (normalized === "Weekly") return normalizedMonths * 4;
  if (normalized === "Biweekly") return normalizedMonths * 2;
  return normalizedMonths;
}

export function addPlanCycles(startDate, cycles = 0, planFrequency = "Monthly") {
  if (!startDate) return null;

  const start = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;

  const nextDate = new Date(start);
  const normalized = normalizePlanFrequency(planFrequency);

  if (normalized === "Weekly") {
    nextDate.setDate(nextDate.getDate() + cycles * 7);
    return nextDate;
  }

  if (normalized === "Biweekly") {
    nextDate.setDate(nextDate.getDate() + cycles * 14);
    return nextDate;
  }

  nextDate.setMonth(nextDate.getMonth() + cycles);
  return nextDate;
}

export function getElapsedPaymentCycles(startDate, planFrequency = "Monthly", now = new Date()) {
  if (!startDate) return 0;

  const start = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || start > now) return 0;

  const normalized = normalizePlanFrequency(planFrequency);

  if (normalized === "Weekly" || normalized === "Biweekly") {
    const diffMs = now.getTime() - start.getTime();
    const cycleDays = normalized === "Weekly" ? 7 : 14;
    return Math.max(0, Math.floor(diffMs / (cycleDays * 24 * 60 * 60 * 1000)));
  }

  let months =
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth());

  if (now.getDate() < start.getDate()) {
    months -= 1;
  }

  return Math.max(0, months);
}

export function buildBracesAccount(account = {}, payments = [], now = new Date()) {
  const totalCost = toNumber(account.totalCost);
  const downPaymentExpected = toNumber(account.downPaymentExpected);
  const planFrequency = normalizePlanFrequency(account.planFrequency || account.paymentSchedule);
  const installmentAmount = toNumber(account.installmentAmount || account.monthlyAmount);
  const planCycles = Math.max(0, Math.round(toNumber(account.planCycles || account.planMonths)));
  const installmentCount = getInstallmentCount(planCycles, planFrequency);
  const discountRate = getDiscountRate(planFrequency);
  const discountedTotalInstallments = Math.max(0, totalCost - downPaymentExpected) * (1 - discountRate);
  const normalizedPayments = payments
    .map((payment) => ({
      ...payment,
      amount: toNumber(payment.amount),
    }))
    .sort((a, b) => {
      const aTime = String(a.paymentDate || a.createdAt?.seconds || "");
      const bTime = String(b.paymentDate || b.createdAt?.seconds || "");
      return aTime < bTime ? 1 : -1;
    });
  const storedAmountPaid = toNumber(account.amountPaid);
  const hasLedgerPayments = normalizedPayments.length > 0;
  const amountPaid = hasLedgerPayments
    ? normalizedPayments.reduce((sum, payment) => sum + payment.amount, 0)
    : storedAmountPaid;
  const remainingBalance = hasLedgerPayments
    ? Math.max(0, totalCost - amountPaid)
    : Math.max(0, toNumber(account.remainingBalance) || Math.max(0, totalCost - amountPaid));
  const cyclesElapsed = getElapsedPaymentCycles(account.startDate, planFrequency, now);
  const computedExpectedPaidByNow = Math.min(
    totalCost,
    downPaymentExpected + cyclesElapsed * installmentAmount
  );
  const expectedPaidByNow = hasLedgerPayments
    ? computedExpectedPaidByNow
    : Math.max(toNumber(account.expectedPaidByNow), computedExpectedPaidByNow);
  const overdueAmount = hasLedgerPayments
    ? Math.max(0, expectedPaidByNow - amountPaid)
    : Math.max(0, toNumber(account.overdueAmount) || Math.max(0, expectedPaidByNow - amountPaid));
  const coveredInstallmentValue = Math.max(0, amountPaid - downPaymentExpected);
  const coveredCycles =
    installmentAmount > 0 ? Math.max(0, Math.floor(coveredInstallmentValue / installmentAmount)) : 0;
  let nextDueDate = "";

  if (remainingBalance > 0) {
    if (amountPaid < downPaymentExpected) {
      nextDueDate = account.startDate || "";
    } else {
      const nextDue = addPlanCycles(account.startDate, coveredCycles + 1, planFrequency);
      nextDueDate = nextDue ? nextDue.toISOString().slice(0, 10) : "";
    }
  }

  let paymentState = "Payment Plan Ready";
  if (remainingBalance <= 0 && totalCost > 0) {
    paymentState = "Fully Paid";
  } else if (amountPaid <= 0) {
    paymentState = "No Payment Yet";
  } else if (amountPaid >= expectedPaidByNow) {
    paymentState = "On Track";
  } else {
    paymentState = "Overdue";
  }
  if (!hasLedgerPayments && account.paymentState) {
    paymentState = account.paymentState;
  }

  const progressPercent = hasLedgerPayments
    ? totalCost > 0
      ? Math.min(100, Math.round((amountPaid / totalCost) * 100))
      : 0
    : toNumber(account.progressPercent) || (totalCost > 0 ? Math.min(100, Math.round((amountPaid / totalCost) * 100)) : 0);

  return {
    ...account,
    totalCost,
    downPaymentExpected,
    monthlyAmount: installmentAmount,
    installmentAmount,
    planFrequency,
    planMonths: planCycles,
    planCycles,
    installmentCount,
    discountRate,
    discountedTotalInstallments,
    payments: normalizedPayments,
    paymentCount: normalizedPayments.length,
    amountPaid,
    remainingBalance,
    monthsElapsed: cyclesElapsed,
    cyclesElapsed,
    expectedPaidByNow,
    overdueAmount,
    paymentState,
    progressPercent,
    lastPayment: normalizedPayments[0] || (account.lastPaymentAt ? { paymentDate: account.lastPaymentAt } : null),
    isOverdue: paymentState === "Overdue",
    nextDueDate,
  };
}

export function doesBracesAccountMatchPatient(account = {}, patient = {}) {
  if (!account || !patient) return false;

  const accountId = normalizeText(account.id || account.patientId);
  const patientId = normalizeText(patient.id);
  if (accountId && patientId && accountId === patientId) {
    return true;
  }

  const accountUid = normalizeText(account.uid);
  const patientUid = normalizeText(patient.uid);
  if (accountUid && patientUid && accountUid === patientUid) {
    return true;
  }

  const accountEmail = normalizeText(account.patientEmail || account.email);
  const patientEmail = normalizeText(patient.email);
  if (accountEmail && patientEmail && accountEmail === patientEmail) {
    return true;
  }

  const accountPhone = normalizePhone(account.patientPhone || account.phone);
  const patientPhone = normalizePhone(patient.phone);
  if (accountPhone && patientPhone && accountPhone === patientPhone) {
    return true;
  }

  const accountName = normalizeText(account.patientName || account.name);
  const patientName = normalizeText(patient.name);
  return Boolean(accountName && patientName && accountName === patientName);
}

export function getBracesAccountForPatient(accounts = [], patient = {}) {
  return accounts.find((account) => doesBracesAccountMatchPatient(account, patient)) || null;
}

export function getBracesPaymentsForPatient(payments = [], patient = {}, account = null) {
  return payments.filter((payment) => {
    const paymentPatientId = normalizeText(payment.patientId);
    const patientId = normalizeText(patient.id);
    if (paymentPatientId && patientId && paymentPatientId === patientId) {
      return true;
    }

    const paymentUid = normalizeText(payment.uid);
    const patientUid = normalizeText(patient.uid);
    if (paymentUid && patientUid && paymentUid === patientUid) {
      return true;
    }

    const accountId = normalizeText(account?.id || account?.patientId);
    const paymentAccountId = normalizeText(payment.accountId);
    if (accountId && paymentAccountId && accountId === paymentAccountId) {
      return true;
    }

    return false;
  });
}
