import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
} from "firebase/firestore";
import ConfirmDialog from "../../components/ConfirmDialog";
import EmptyState from "../../components/EmptyState";
import { SkeletonList } from "../../components/LoadingSkeleton";
import { db } from "../../firebase";
import { normalizeName } from "../../utils/appointments";
import {
  buildBracesAccount,
  computeInstallmentAmount,
  formatCurrency,
  getCycleCountLabel,
  getBracesAccountForPatient,
  getBracesPaymentsForPatient,
  getDiscountRate,
  getInstallmentCount,
  getInstallmentLabel,
  PLAN_FREQUENCIES,
} from "../../utils/braces";
import { logAdminAction } from "../../utils/audit";
import { formatDateLabel, formatTimeLabel } from "../../utils/schedule";

function getEmptyAccountDraft() {
  return {
    totalCost: "",
    downPaymentExpected: "",
    planCycles: "",
    planFrequency: "Monthly",
    startDate: "",
    planState: "Active",
    notes: "",
  };
}

function getEmptyPaymentDraft() {
  return {
    amount: "",
    paymentDate: new Date().toISOString().slice(0, 10),
    method: "Cash",
    notes: "",
  };
}

function getEmptyAdjustmentDraft() {
  return {
    adjustmentDate: new Date().toISOString().slice(0, 10),
    adjustmentTime: "09:00",
    dentist: "",
    status: "Scheduled",
    notes: "",
  };
}

export default function Braces() {
  const [patients, setPatients] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [payments, setPayments] = useState([]);
  const [adjustments, setAdjustments] = useState([]);
  const [search, setSearch] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [bracesWorkspaceOpen, setBracesWorkspaceOpen] = useState(false);
  const [accountDraft, setAccountDraft] = useState(getEmptyAccountDraft());
  const [paymentDraft, setPaymentDraft] = useState(getEmptyPaymentDraft());
  const [adjustmentDraft, setAdjustmentDraft] = useState(getEmptyAdjustmentDraft());
  const [loading, setLoading] = useState(true);
  const [savingAccount, setSavingAccount] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [savingAdjustment, setSavingAdjustment] = useState(false);
  const [confirmState, setConfirmState] = useState(null);

  async function load() {
    setLoading(true);

    const [patientsResult, accountsResult, paymentsResult, adjustmentsResult] = await Promise.allSettled([
      getDocs(collection(db, "patients")),
      getDocs(collection(db, "bracesAccounts")),
      getDocs(collection(db, "bracesPayments")),
      getDocs(collection(db, "bracesAdjustments")),
    ]);

    setPatients(
      patientsResult.status === "fulfilled"
        ? patientsResult.value.docs
            .map((entry) => ({ id: entry.id, ...entry.data() }))
            .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
        : []
    );
    setAccounts(
      accountsResult.status === "fulfilled"
        ? accountsResult.value.docs.map((entry) => ({ id: entry.id, ...entry.data() }))
        : []
    );
    setPayments(
      paymentsResult.status === "fulfilled"
        ? paymentsResult.value.docs.map((entry) => ({ id: entry.id, ...entry.data() }))
        : []
    );
    setAdjustments(
      adjustmentsResult.status === "fulfilled"
        ? adjustmentsResult.value.docs.map((entry) => ({ id: entry.id, ...entry.data() }))
        : []
    );

    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const patientCards = useMemo(() => {
    return patients
      .filter((patient) => patient.status !== "Archived")
      .map((patient) => {
        const rawAccount = getBracesAccountForPatient(accounts, patient);
        const accountPayments = getBracesPaymentsForPatient(payments, patient, rawAccount);
        const accountAdjustments = adjustments
          .filter((adjustment) => adjustment.patientId === patient.id)
          .sort((a, b) => {
            const aKey = `${a.adjustmentDate || ""} ${a.adjustmentTime || ""}`;
            const bKey = `${b.adjustmentDate || ""} ${b.adjustmentTime || ""}`;
            return aKey.localeCompare(bKey);
          });
        const summary = rawAccount ? buildBracesAccount(rawAccount, accountPayments) : null;

        return {
          ...patient,
          bracesAccount: summary,
          bracesPayments: summary?.payments || [],
          bracesAdjustments: accountAdjustments,
          nextAdjustment:
            accountAdjustments.find((entry) => String(entry.status || "").toLowerCase() === "scheduled") ||
            accountAdjustments[0] ||
            null,
        };
      });
  }, [accounts, adjustments, patients, payments]);

  const filteredPatients = useMemo(() => {
    const term = normalizeName(search);
    if (!term) return patientCards;
    return patientCards.filter((patient) => normalizeName(patient.name).includes(term));
  }, [patientCards, search]);

  const selectedPatient = useMemo(
    () => patientCards.find((patient) => patient.id === selectedPatientId) || null,
    [patientCards, selectedPatientId]
  );

  const computedInstallmentAmount = useMemo(
    () =>
      computeInstallmentAmount({
        totalCost: accountDraft.totalCost,
        downPaymentExpected: accountDraft.downPaymentExpected,
        planCycles: accountDraft.planCycles,
        planFrequency: accountDraft.planFrequency,
      }),
    [accountDraft.downPaymentExpected, accountDraft.planCycles, accountDraft.planFrequency, accountDraft.totalCost]
  );
  const computedDiscountRate = useMemo(
    () => getDiscountRate(accountDraft.planFrequency),
    [accountDraft.planFrequency]
  );
  const computedInstallmentCount = useMemo(
    () => getInstallmentCount(accountDraft.planCycles, accountDraft.planFrequency),
    [accountDraft.planCycles, accountDraft.planFrequency]
  );

  useEffect(() => {
    if (!selectedPatientId && patientCards.length) {
      setSelectedPatientId(patientCards[0].id);
    }
  }, [patientCards, selectedPatientId]);

  useEffect(() => {
    setBracesWorkspaceOpen(false);
  }, [selectedPatientId]);

  useEffect(() => {
    if (!selectedPatient) {
      setAccountDraft(getEmptyAccountDraft());
      setPaymentDraft(getEmptyPaymentDraft());
      setAdjustmentDraft(getEmptyAdjustmentDraft());
      return;
    }

    if (selectedPatient.bracesAccount) {
      setAccountDraft({
        totalCost: String(selectedPatient.bracesAccount.totalCost || ""),
        downPaymentExpected: String(selectedPatient.bracesAccount.downPaymentExpected || ""),
        planCycles: String(selectedPatient.bracesAccount.planCycles || selectedPatient.bracesAccount.planMonths || ""),
        planFrequency: selectedPatient.bracesAccount.planFrequency || "Monthly",
        startDate: selectedPatient.bracesAccount.startDate || "",
        planState: selectedPatient.bracesAccount.planState || "Active",
        notes: selectedPatient.bracesAccount.notes || "",
      });
    } else {
      setAccountDraft(getEmptyAccountDraft());
    }

    setPaymentDraft(getEmptyPaymentDraft());
    setAdjustmentDraft({
      ...getEmptyAdjustmentDraft(),
      dentist:
        selectedPatient.preferredDentist ||
        selectedPatient.bracesAccount?.preferredDentist ||
        "",
    });
  }, [selectedPatient]);

  const bracesStats = useMemo(() => {
    const liveAccounts = patientCards.filter((patient) => patient.bracesAccount);
    const overdue = liveAccounts.filter((patient) => patient.bracesAccount?.isOverdue).length;
    const paid = liveAccounts.filter((patient) => patient.bracesAccount?.paymentState === "Fully Paid").length;
    const totalCollected = liveAccounts.reduce(
      (sum, patient) => sum + (patient.bracesAccount?.amountPaid || 0),
      0
    );

    return {
      totalAccounts: liveAccounts.length,
      overdue,
      paid,
      totalCollected,
    };
  }, [patientCards]);

  async function saveAccount(e) {
    e.preventDefault();
    if (!selectedPatient) return;

    setSavingAccount(true);
    try {
      const docRef = doc(db, "bracesAccounts", selectedPatient.id);
      const existing = await getDoc(docRef);
      const payload = {
        patientId: selectedPatient.id,
        uid: selectedPatient.uid || "",
        patientName: selectedPatient.name || "",
        patientEmail: selectedPatient.email || "",
        patientPhone: selectedPatient.phone || "",
        totalCost: Number(accountDraft.totalCost || 0),
        downPaymentExpected: Number(accountDraft.downPaymentExpected || 0),
        installmentAmount: computedInstallmentAmount,
        monthlyAmount: computedInstallmentAmount,
        planCycles: Number(accountDraft.planCycles || 0),
        planMonths: Number(accountDraft.planCycles || 0),
        planFrequency: accountDraft.planFrequency || "Monthly",
        startDate: accountDraft.startDate || "",
        planState: accountDraft.planState || "Active",
        notes: accountDraft.notes.trim(),
        updatedAt: serverTimestamp(),
      };

      if (!existing.exists()) {
        payload.createdAt = serverTimestamp();
      }

      const computed = buildBracesAccount(payload, selectedPatient.bracesPayments || []);

      await setDoc(
        docRef,
        {
          ...payload,
          amountPaid: computed.amountPaid,
          remainingBalance: computed.remainingBalance,
          expectedPaidByNow: computed.expectedPaidByNow,
          paymentState: computed.paymentState,
          progressPercent: computed.progressPercent,
          lastPaymentAt: computed.lastPayment?.paymentDate || "",
        },
        { merge: true }
      );

      await logAdminAction({
        action: existing.exists() ? "update_braces_account" : "create_braces_account",
        targetType: "braces_account",
        targetId: selectedPatient.id,
        targetLabel: selectedPatient.name || selectedPatient.email || "Braces account",
        details: {
          totalCost: Number(accountDraft.totalCost || 0),
          installmentAmount: computedInstallmentAmount,
          planFrequency: accountDraft.planFrequency || "Monthly",
          planState: accountDraft.planState || "Active",
        },
      });

      await load();
    } finally {
      setSavingAccount(false);
    }
  }

  async function logPayment() {
    if (!selectedPatient?.bracesAccount) return;
    if (!Number(paymentDraft.amount || 0)) return;

    setSavingPayment(true);
    try {
      const paymentPayload = {
        accountId: selectedPatient.id,
        patientId: selectedPatient.id,
        uid: selectedPatient.uid || "",
        patientName: selectedPatient.name || "",
        amount: Number(paymentDraft.amount || 0),
        paymentDate: paymentDraft.paymentDate || "",
        method: paymentDraft.method || "Cash",
        notes: paymentDraft.notes.trim(),
        createdAt: serverTimestamp(),
      };

      await addDoc(collection(db, "bracesPayments"), paymentPayload);

      const nextPayments = [...(selectedPatient.bracesPayments || []), paymentPayload];
      const computed = buildBracesAccount(selectedPatient.bracesAccount, nextPayments);

      await setDoc(
        doc(db, "bracesAccounts", selectedPatient.id),
        {
          amountPaid: computed.amountPaid,
          remainingBalance: computed.remainingBalance,
          expectedPaidByNow: computed.expectedPaidByNow,
          paymentState: computed.paymentState,
          progressPercent: computed.progressPercent,
          lastPaymentAt: paymentDraft.paymentDate || "",
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      await logAdminAction({
        action: "log_braces_payment",
        targetType: "braces_payment",
        targetId: selectedPatient.id,
        targetLabel: selectedPatient.name || selectedPatient.email || "Braces payment",
        details: {
          amount: Number(paymentDraft.amount || 0),
          paymentDate: paymentDraft.paymentDate || "",
          method: paymentDraft.method || "Cash",
        },
      });

      setPaymentDraft(getEmptyPaymentDraft());
      await load();
    } finally {
      setSavingPayment(false);
    }
  }

  async function logAdjustment() {
    if (!selectedPatient) return;
    if (!adjustmentDraft.adjustmentDate || !adjustmentDraft.adjustmentTime) return;

    setSavingAdjustment(true);
    try {
      const adjustmentAt = Timestamp.fromDate(
        new Date(`${adjustmentDraft.adjustmentDate}T${adjustmentDraft.adjustmentTime}:00`)
      );

      const payload = {
        patientId: selectedPatient.id,
        uid: selectedPatient.uid || "",
        patientName: selectedPatient.name || "",
        patientEmail: selectedPatient.email || "",
        patientPhone: selectedPatient.phone || "",
        adjustmentDate: adjustmentDraft.adjustmentDate,
        adjustmentTime: adjustmentDraft.adjustmentTime,
        adjustmentAt,
        dentist:
          adjustmentDraft.dentist ||
          selectedPatient.preferredDentist ||
          "",
        status: adjustmentDraft.status || "Scheduled",
        notes: adjustmentDraft.notes.trim(),
        createdAt: serverTimestamp(),
      };

      await addDoc(collection(db, "bracesAdjustments"), payload);

      await logAdminAction({
        action: "schedule_braces_adjustment",
        targetType: "braces_adjustment",
        targetId: selectedPatient.id,
        targetLabel: selectedPatient.name || selectedPatient.email || "Braces adjustment",
        details: {
          adjustmentDate: adjustmentDraft.adjustmentDate,
          adjustmentTime: adjustmentDraft.adjustmentTime,
          dentist: payload.dentist || "",
          status: adjustmentDraft.status || "Scheduled",
        },
      });

      setAdjustmentDraft({
        ...getEmptyAdjustmentDraft(),
        dentist: payload.dentist || "",
      });
      await load();
    } finally {
      setSavingAdjustment(false);
    }
  }

  function openConfirm(config) {
    setConfirmState(config);
  }

  async function handleConfirmAction() {
    if (!confirmState?.action) return;
    const action = confirmState.action;
    setConfirmState(null);
    await action();
  }

  return (
    <div className="container adminSurface">
      <div className="hero adminHero bracesHero">
        <div className="adminHeroGlow" />
        <div className="adminHeroContent">
          <span className="heroEyebrow">Installment Tracking</span>
          <h1>Braces Payments</h1>
          <p>Track orthodontic installment plans without online payments, keep every payment logged manually, and monitor overdue balances in one place.</p>
        </div>
      </div>

      <div className="statsGrid adminStats">
        <div className="statCard accentTeal">
          <span className="statLabel">Active accounts</span>
          <strong className="statValue">{bracesStats.totalAccounts}</strong>
        </div>
        <div className="statCard accentRose">
          <span className="statLabel">Overdue</span>
          <strong className="statValue">{bracesStats.overdue}</strong>
        </div>
        <div className="statCard accentGold">
          <span className="statLabel">Fully paid</span>
          <strong className="statValue">{bracesStats.paid}</strong>
        </div>
        <div className="statCard accentBlue">
          <span className="statLabel">Collected</span>
          <strong className="statValue bracesCurrencyStat">{formatCurrency(bracesStats.totalCollected)}</strong>
        </div>
      </div>

      <div className={`adminPanelGrid ${bracesWorkspaceOpen ? "workspaceMode" : ""}`}>
        <div className="card adminEditorCard bracesEditorCard">
          <div className="cardHeader">
            <div>
              <h3 className="title">Braces Account Setup</h3>
              <p className="sub">Select a patient, create the installment plan, and log every payment manually from this workspace.</p>
            </div>
            <span className="badge">{selectedPatient ? "Patient selected" : "No patient selected"}</span>
          </div>

          {selectedPatient ? (
            <>
              {!bracesWorkspaceOpen ? (
                <div className="workspaceLaunchCard bracesWorkspaceLaunch">
                  <div className="bracesPatientHeader">
                    <div>
                      <span className="detailLabel">Selected braces patient</span>
                      <strong className="detailTitle">{selectedPatient.name}</strong>
                      <p className="detailSubtitle">
                        {selectedPatient.patientType || "Regular Patient"} • {selectedPatient.phone || "No phone"} • {selectedPatient.email || "No email"}
                      </p>
                    </div>
                    <span className={`statusPill ${selectedPatient.bracesAccount?.paymentState === "Overdue" ? "cancelled" : selectedPatient.bracesAccount?.paymentState === "Fully Paid" ? "approved" : "active"}`}>
                      {selectedPatient.bracesAccount?.paymentState || "No braces plan yet"}
                    </span>
                  </div>

                  <div className="detailGrid bracesSummaryGrid">
                    <div className="detailBox luxeBox">
                      <span className="detailLabel">Plan status</span>
                      <strong>{selectedPatient.bracesAccount?.planState || "Not started"}</strong>
                    </div>
                    <div className="detailBox luxeBox">
                      <span className="detailLabel">Amount paid</span>
                      <strong>{formatCurrency(selectedPatient.bracesAccount?.amountPaid || 0)}</strong>
                    </div>
                    <div className="detailBox luxeBox">
                      <span className="detailLabel">Balance left</span>
                      <strong>{formatCurrency(selectedPatient.bracesAccount?.remainingBalance || 0)}</strong>
                    </div>
                  </div>

                  <div className="workspaceLaunchActions">
                    <button
                      type="button"
                      className="btn btnShine patientActionBtn patientEditBtn"
                      onClick={() => setBracesWorkspaceOpen(true)}
                    >
                      Open Braces Workspace
                    </button>
                  </div>
                </div>
              ) : (
                <>
              <div className="workspaceTopBar">
                <button
                  type="button"
                  className="btn secondary workspaceBackBtn"
                  onClick={() => setBracesWorkspaceOpen(false)}
                >
                  Back to Patient List
                </button>
                <span className="badge">Workspace Open</span>
              </div>

              <div className="bracesPatientHeader">
                <div>
                  <span className="detailLabel">Current braces patient</span>
                  <strong className="detailTitle">{selectedPatient.name}</strong>
                  <p className="detailSubtitle">
                    {selectedPatient.patientType || "Regular Patient"} • {selectedPatient.phone || "No phone"} • {selectedPatient.email || "No email"}
                  </p>
                </div>
                <span className={`statusPill ${selectedPatient.bracesAccount?.paymentState === "Overdue" ? "cancelled" : selectedPatient.bracesAccount?.paymentState === "Fully Paid" ? "approved" : "active"}`}>
                  {selectedPatient.bracesAccount?.paymentState || "No braces plan yet"}
                </span>
              </div>

              <form className="form" onSubmit={saveAccount}>
                <div className="bookingFlowGrid">
                  <label className="bookingFieldCard">
                    <span className="detailLabel">Total treatment cost</span>
                    <input
                      className="input bookingInputSpecial"
                      type="number"
                      min="0"
                      placeholder="e.g. 45000"
                      value={accountDraft.totalCost}
                      onChange={(e) => setAccountDraft((current) => ({ ...current, totalCost: e.target.value }))}
                    />
                  </label>
                  <label className="bookingFieldCard">
                    <span className="detailLabel">Expected down payment</span>
                    <input
                      className="input bookingInputSpecial"
                      type="number"
                      min="0"
                      placeholder="e.g. 5000"
                      value={accountDraft.downPaymentExpected}
                      onChange={(e) => setAccountDraft((current) => ({ ...current, downPaymentExpected: e.target.value }))}
                    />
                  </label>
                </div>

                <div className="bookingFlowGrid">
                  <label className="bookingFieldCard">
                    <span className="detailLabel">Payment schedule</span>
                    <select
                      className="input bookingInputSpecial"
                      value={accountDraft.planFrequency}
                      onChange={(e) => setAccountDraft((current) => ({ ...current, planFrequency: e.target.value }))}
                    >
                      {PLAN_FREQUENCIES.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="bookingFieldCard">
                    <span className="detailLabel">{getInstallmentLabel(accountDraft.planFrequency)}</span>
                    <input
                      className="input bookingInputSpecial"
                      type="text"
                      readOnly
                      value={
                        Number(accountDraft.planCycles || 0) > 0
                          ? formatCurrency(computedInstallmentAmount)
                          : "Set the total cost, down payment, and plan duration first"
                      }
                    />
                  </label>
                </div>

                <div className="detailGrid bracesSummaryGrid" style={{ marginTop: 0 }}>
                  <div className="detailBox luxeBox">
                    <span className="detailLabel">Discount applied</span>
                    <strong>{(computedDiscountRate * 100).toFixed(computedDiscountRate ? 1 : 0)}%</strong>
                  </div>
                  <div className="detailBox luxeBox">
                    <span className="detailLabel">Installment count</span>
                    <strong>{computedInstallmentCount}</strong>
                  </div>
                </div>

                <div className="bookingFlowGrid">
                  <label className="bookingFieldCard">
                    <span className="detailLabel">{getCycleCountLabel(accountDraft.planFrequency)}</span>
                    <input
                      className="input bookingInputSpecial"
                      type="number"
                      min="0"
                      placeholder="e.g. 24"
                      value={accountDraft.planCycles}
                      onChange={(e) => setAccountDraft((current) => ({ ...current, planCycles: e.target.value }))}
                    />
                  </label>
                  <label className="bookingFieldCard">
                    <span className="detailLabel">Plan start date</span>
                    <input
                      className="input bookingInputSpecial"
                      type="date"
                      value={accountDraft.startDate}
                      onChange={(e) => setAccountDraft((current) => ({ ...current, startDate: e.target.value }))}
                    />
                  </label>
                  <label className="bookingFieldCard">
                    <span className="detailLabel">Plan state</span>
                    <select
                      className="input bookingInputSpecial"
                      value={accountDraft.planState}
                      onChange={(e) => setAccountDraft((current) => ({ ...current, planState: e.target.value }))}
                    >
                      <option>Active</option>
                      <option>Paused</option>
                      <option>Completed</option>
                    </select>
                  </label>
                </div>

                <textarea
                  className="input"
                  rows={4}
                  placeholder="Plan notes, agreement reminders, or special braces payment instructions"
                  value={accountDraft.notes}
                  onChange={(e) => setAccountDraft((current) => ({ ...current, notes: e.target.value }))}
                />

                <button className="btn btnShine bookingPrimaryBtn" disabled={savingAccount}>
                  {savingAccount ? "Saving braces plan..." : selectedPatient.bracesAccount ? "Update Braces Plan" : "Create Braces Plan"}
                </button>
              </form>

              {selectedPatient.bracesAccount ? (
                <>
                  <div className="detailGrid bracesSummaryGrid">
                    <div className="detailBox luxeBox">
                      <span className="detailLabel">Amount paid</span>
                      <strong>{formatCurrency(selectedPatient.bracesAccount.amountPaid)}</strong>
                    </div>
                    <div className="detailBox luxeBox">
                      <span className="detailLabel">Remaining balance</span>
                      <strong>{formatCurrency(selectedPatient.bracesAccount.remainingBalance)}</strong>
                    </div>
                    <div className="detailBox luxeBox">
                      <span className="detailLabel">Expected by now</span>
                      <strong>{formatCurrency(selectedPatient.bracesAccount.expectedPaidByNow)}</strong>
                    </div>
                    <div className="detailBox luxeBox">
                      <span className="detailLabel">Progress</span>
                      <strong>{selectedPatient.bracesAccount.progressPercent}% paid</strong>
                    </div>
                    <div className="detailBox luxeBox">
                      <span className="detailLabel">Payment schedule</span>
                      <strong>{selectedPatient.bracesAccount.planFrequency}</strong>
                    </div>
                    <div className="detailBox luxeBox">
                      <span className="detailLabel">{getInstallmentLabel(selectedPatient.bracesAccount.planFrequency)}</span>
                      <strong>{formatCurrency(selectedPatient.bracesAccount.installmentAmount || selectedPatient.bracesAccount.monthlyAmount)}</strong>
                    </div>
                    <div className="detailBox luxeBox">
                      <span className="detailLabel">Discount applied</span>
                      <strong>{((selectedPatient.bracesAccount.discountRate || 0) * 100).toFixed(selectedPatient.bracesAccount.discountRate ? 1 : 0)}%</strong>
                    </div>
                    <div className="detailBox luxeBox">
                      <span className="detailLabel">Overdue amount</span>
                      <strong>{formatCurrency(selectedPatient.bracesAccount.overdueAmount || 0)}</strong>
                    </div>
                    <div className="detailBox luxeBox">
                      <span className="detailLabel">Next expected payment</span>
                      <strong>{selectedPatient.bracesAccount.nextDueDate ? formatDateLabel(selectedPatient.bracesAccount.nextDueDate) : "No due date"}</strong>
                    </div>
                    <div className="detailBox luxeBox">
                      <span className="detailLabel">Plan length</span>
                      <strong>{selectedPatient.bracesAccount.planCycles || 0} month(s)</strong>
                    </div>
                    <div className="detailBox luxeBox">
                      <span className="detailLabel">Installment count</span>
                      <strong>{selectedPatient.bracesAccount.installmentCount || 0}</strong>
                    </div>
                  </div>

                  <div className="card bracesPaymentCard">
                    <div className="cardHeader">
                      <div>
                        <h3 className="title">Log Payment</h3>
                        <p className="sub">Enter cash, transfer, or e-wallet payments manually so the account balance updates right away and the overdue tracker stays accurate.</p>
                      </div>
                      <span className="badge">{selectedPatient.bracesPayments.length} payments</span>
                    </div>

                    <div className="bookingFlowGrid">
                      <label className="bookingFieldCard">
                        <span className="detailLabel">Amount received</span>
                        <input
                          className="input bookingInputSpecial"
                          type="number"
                          min="0"
                          placeholder="e.g. 1500"
                          value={paymentDraft.amount}
                          onChange={(e) => setPaymentDraft((current) => ({ ...current, amount: e.target.value }))}
                        />
                      </label>
                      <label className="bookingFieldCard">
                        <span className="detailLabel">Payment date</span>
                        <input
                          className="input bookingInputSpecial"
                          type="date"
                          value={paymentDraft.paymentDate}
                          onChange={(e) => setPaymentDraft((current) => ({ ...current, paymentDate: e.target.value }))}
                        />
                      </label>
                    </div>

                    <div className="bookingFlowGrid">
                      <label className="bookingFieldCard">
                        <span className="detailLabel">Payment method</span>
                        <select
                          className="input bookingInputSpecial"
                          value={paymentDraft.method}
                          onChange={(e) => setPaymentDraft((current) => ({ ...current, method: e.target.value }))}
                        >
                          <option>Cash</option>
                          <option>Bank Transfer</option>
                          <option>E-wallet</option>
                        </select>
                      </label>
                      <label className="bookingFieldCard">
                        <span className="detailLabel">Payment note</span>
                        <input
                          className="input bookingInputSpecial"
                          placeholder="Receipt, reference, or front-desk note"
                          value={paymentDraft.notes}
                          onChange={(e) => setPaymentDraft((current) => ({ ...current, notes: e.target.value }))}
                        />
                      </label>
                    </div>

                    <button
                      type="button"
                      className="btn btnShine bookingPrimaryBtn"
                      onClick={() =>
                        openConfirm({
                          title: "Log this braces payment?",
                          message: "This payment will be added to the patient ledger and the remaining balance will update immediately.",
                          confirmLabel: "Log Payment",
                          action: () => logPayment(),
                        })
                      }
                      disabled={savingPayment}
                    >
                      {savingPayment ? "Saving payment..." : "Add Payment to Ledger"}
                    </button>
                  </div>

                  <div className="card bracesPaymentCard">
                    <div className="cardHeader">
                      <div>
                        <h3 className="title">Adjustment Scheduler</h3>
                        <p className="sub">Schedule braces adjustment visits here so the clinic can track follow-up meetings and send reminder-ready dates from the same braces workspace.</p>
                      </div>
                      <span className="badge">{selectedPatient.bracesAdjustments.length} adjustments</span>
                    </div>

                    <div className="bookingFlowGrid">
                      <label className="bookingFieldCard">
                        <span className="detailLabel">Adjustment date</span>
                        <input
                          className="input bookingInputSpecial"
                          type="date"
                          value={adjustmentDraft.adjustmentDate}
                          onChange={(e) => setAdjustmentDraft((current) => ({ ...current, adjustmentDate: e.target.value }))}
                        />
                      </label>
                      <label className="bookingFieldCard">
                        <span className="detailLabel">Adjustment time</span>
                        <input
                          className="input bookingInputSpecial"
                          type="time"
                          value={adjustmentDraft.adjustmentTime}
                          onChange={(e) => setAdjustmentDraft((current) => ({ ...current, adjustmentTime: e.target.value }))}
                        />
                      </label>
                    </div>

                    <div className="bookingFlowGrid">
                      <label className="bookingFieldCard">
                        <span className="detailLabel">Dentist handling adjustment</span>
                        <input
                          className="input bookingInputSpecial"
                          placeholder="e.g. Jarred"
                          value={adjustmentDraft.dentist}
                          onChange={(e) => setAdjustmentDraft((current) => ({ ...current, dentist: e.target.value }))}
                        />
                      </label>
                      <label className="bookingFieldCard">
                        <span className="detailLabel">Adjustment status</span>
                        <select
                          className="input bookingInputSpecial"
                          value={adjustmentDraft.status}
                          onChange={(e) => setAdjustmentDraft((current) => ({ ...current, status: e.target.value }))}
                        >
                          <option>Scheduled</option>
                          <option>Completed</option>
                          <option>Cancelled</option>
                        </select>
                      </label>
                    </div>

                    <label className="bookingFieldCard">
                      <span className="detailLabel">Adjustment note</span>
                      <input
                        className="input bookingInputSpecial"
                        placeholder="Monthly adjustment, wire change, or follow-up note"
                        value={adjustmentDraft.notes}
                        onChange={(e) => setAdjustmentDraft((current) => ({ ...current, notes: e.target.value }))}
                      />
                    </label>

                    <button
                      type="button"
                      className="btn btnShine bookingPrimaryBtn"
                      onClick={() =>
                        openConfirm({
                          title: "Save this braces adjustment schedule?",
                          message: "This adjustment visit will be linked to the braces account so upcoming reminder emails can use the same schedule.",
                          confirmLabel: "Save Adjustment",
                          action: () => logAdjustment(),
                        })
                      }
                      disabled={savingAdjustment}
                    >
                      {savingAdjustment ? "Saving adjustment..." : "Add Adjustment Schedule"}
                    </button>
                  </div>

                  <div className="card adminRecordsCard" style={{ marginTop: 18 }}>
                    <div className="cardHeader">
                      <div>
                        <h3 className="title">Payment History</h3>
                        <p className="sub">Every logged braces payment stays in the ledger so the clinic can review the full installment trail anytime.</p>
                      </div>
                    </div>

                    {selectedPatient.bracesPayments.length ? (
                      <div className="historyList">
                        {selectedPatient.bracesPayments.map((payment) => (
                          <div key={payment.id || `${payment.paymentDate}-${payment.amount}`} className="historyRow bracesHistoryRow">
                            <div>
                              <strong>{formatCurrency(payment.amount)}</strong>
                              <p>{payment.method || "Manual payment"}{payment.notes ? ` • ${payment.notes}` : ""}</p>
                            </div>
                            <div className="historyMeta">
                              <span>{formatDateLabel(payment.paymentDate)}</span>
                              <span className="statusPill active">{payment.method || "Cash"}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        compact
                        title="No payments logged yet"
                        message="Once the clinic records a braces installment, it will appear here with the payment date and method."
                      />
                    )}
                  </div>

                  <div className="card adminRecordsCard" style={{ marginTop: 18 }}>
                    <div className="cardHeader">
                      <div>
                        <h3 className="title">Adjustment History</h3>
                        <p className="sub">Every braces checkup, wire adjustment, or follow-up meeting can stay in one connected schedule history.</p>
                      </div>
                    </div>

                    {selectedPatient.bracesAdjustments.length ? (
                      <div className="historyList">
                        {selectedPatient.bracesAdjustments.map((adjustment) => (
                          <div key={adjustment.id || `${adjustment.adjustmentDate}-${adjustment.adjustmentTime}`} className="historyRow bracesHistoryRow">
                            <div>
                              <strong>{adjustment.notes || "Braces adjustment visit"}</strong>
                              <p>
                                {adjustment.dentist || "No dentist"}
                                {adjustment.adjustmentTime ? ` • ${formatTimeLabel(adjustment.adjustmentTime)}` : ""}
                              </p>
                            </div>
                            <div className="historyMeta">
                              <span>{formatDateLabel(adjustment.adjustmentDate)}</span>
                              <span className={`statusPill ${String(adjustment.status || "").toLowerCase() === "cancelled" ? "cancelled" : String(adjustment.status || "").toLowerCase() === "completed" ? "approved" : "active"}`}>
                                {adjustment.status || "Scheduled"}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        compact
                        title="No adjustments scheduled yet"
                        message="Add a braces adjustment here so upcoming visits and reminder emails stay connected to the braces plan."
                      />
                    )}
                  </div>
                </>
              ) : (
                <div className="emptyEditorState clinicalInfoEmpty" style={{ marginTop: 18 }}>
                  <strong>No braces account yet</strong>
                  <p>Create the installment plan first, then you can start logging down payments, scheduled braces payments, and adjustment visits here.</p>
                </div>
              )}
                </>
              )}
            </>
          ) : (
            <EmptyState
              title="No patient selected"
              message="Choose a patient from the right panel to set up their braces installment plan and payment ledger."
            />
          )}
        </div>

        {!bracesWorkspaceOpen ? (
        <div className="card adminRecordsCard">
          <div className="cardHeader">
            <div>
              <h3 className="title">Patient Search</h3>
              <p className="sub">Find a patient first, then open their braces payment workspace.</p>
            </div>
            <span className="badge">{filteredPatients.length} patients</span>
          </div>

          <div className="patientSearchSpotlight">
            <div className="patientSearchHeader">
              <div>
                <span className="patientSearchEyebrow">Braces patient search</span>
                <p className="patientSearchHint">Search by patient name to jump to the braces account you want to manage.</p>
              </div>
              <span className="patientSearchCount">
                {search ? `${filteredPatients.length} match${filteredPatients.length === 1 ? "" : "es"}` : "Ready to search"}
              </span>
            </div>

            <div className="patientSearchRow">
              <input
                className="input searchInput patientSearchInput"
                placeholder="Enter patient name"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search ? (
                <button type="button" className="searchClearBtn" onClick={() => setSearch("")}>
                  Clear
                </button>
              ) : null}
            </div>
          </div>

          {loading ? (
            <SkeletonList count={4} cardClassName="patientShowcase" />
          ) : filteredPatients.length ? (
            <ul className="list detailedList">
              {filteredPatients.map((patient) => {
                const isSelected = patient.id === selectedPatientId;
                const bracesAccount = patient.bracesAccount;

                return (
                  <li key={patient.id} className={`item detailedItem patientShowcase bracesPatientCard ${isSelected ? "selectedRecord expanded" : "collapsed"}`}>
                    <button type="button" className="recordTapArea" onClick={() => { setSelectedPatientId(patient.id); setBracesWorkspaceOpen(false); }}>
                      <div className="detailContent">
                        <div className="detailTopRow">
                          <div>
                            <strong className="detailTitle">{patient.name}</strong>
                            <p className="detailSubtitle">
                              {patient.patientType || "Regular Patient"} • {patient.phone || "No phone"} • {patient.email || "No email"}
                            </p>
                          </div>
                          <div className="statusStack">
                            <span className={`statusPill ${bracesAccount ? (bracesAccount.isOverdue ? "cancelled" : bracesAccount.paymentState === "Fully Paid" ? "approved" : "active") : "pending"}`}>
                              {bracesAccount?.paymentState || "No plan"}
                            </span>
                          </div>
                        </div>

                        <div className="detailGrid">
                          <div className="detailBox luxeBox">
                            <span className="detailLabel">Plan status</span>
                            <strong>{bracesAccount?.planState || "Not started"}</strong>
                          </div>
                          <div className="detailBox luxeBox">
                            <span className="detailLabel">Amount paid</span>
                            <strong>{formatCurrency(bracesAccount?.amountPaid || 0)}</strong>
                          </div>
                          <div className="detailBox luxeBox">
                            <span className="detailLabel">Balance left</span>
                            <strong>{formatCurrency(bracesAccount?.remainingBalance || 0)}</strong>
                          </div>
                          <div className="detailBox luxeBox">
                            <span className="detailLabel">Next adjustment</span>
                            <strong>{patient.nextAdjustment?.adjustmentDate ? formatDateLabel(patient.nextAdjustment.adjustmentDate) : "Not scheduled"}</strong>
                          </div>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              title="No matching patients"
              message="Try another name or clear the search to view all active patient records."
            />
          )}
        </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={Boolean(confirmState)}
        title={confirmState?.title}
        message={confirmState?.message}
        confirmLabel={confirmState?.confirmLabel}
        tone={confirmState?.tone}
        onClose={() => setConfirmState(null)}
        onConfirm={handleConfirmAction}
      />
    </div>
  );
}
