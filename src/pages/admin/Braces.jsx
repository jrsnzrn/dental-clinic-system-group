import { useEffect, useMemo, useRef, useState } from "react";
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
import { auth, db } from "../../firebase";
import { normalizeName } from "../../utils/appointments";
import {
  BRACES_TYPES,
  DEFAULT_BRACES_REFERENCE_PRICES,
  normalizeBracesReferencePrices,
  normalizeBracesType,
} from "../../utils/bracesPricing";
import {
  buildBracesAccount,
  computeInstallmentAmount,
  formatCurrency,
  getCycleCountLabel,
  getBracesAccountForPatient,
  getBracesPaymentsForPatient,
  getInstallmentCount,
  getInstallmentLabel,
  PLAN_FREQUENCIES,
} from "../../utils/braces";
import { logAdminAction } from "../../utils/audit";
import { recordBracesPayment } from "../../utils/paymentTransactions";
import { ROLES } from "../../utils/rbac";
import { formatDateLabel, formatTimeLabel } from "../../utils/schedule";

function getEmptyAccountDraft() {
  return {
    totalCost: "",
    discountAmount: "",
    bracesType: "Metal",
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

function getPaymentPillClass(account) {
  if (!account) return "pending";
  if (account.isOverdue || account.paymentState === "Overdue") return "cancelled";
  if (account.paymentState === "Fully Paid") return "approved";
  return "active";
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
  const paymentSubmissionLock = useRef(false);
  const [paymentError, setPaymentError] = useState("");
  const [savingAdjustment, setSavingAdjustment] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [referencePrices, setReferencePrices] = useState(DEFAULT_BRACES_REFERENCE_PRICES);
  const [referencePriceDraft, setReferencePriceDraft] = useState(DEFAULT_BRACES_REFERENCE_PRICES);
  const [referencePriceError, setReferencePriceError] = useState("");
  const [savingReferencePrices, setSavingReferencePrices] = useState(false);

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

  useEffect(() => {
    let active = true;
    async function loadPriceReferences() {
      const currentUser = auth.currentUser;
      if (!currentUser) return;
      try {
        const [adminSnapshot, referenceSnapshot] = await Promise.all([
          getDoc(doc(db, "admins", currentUser.uid)),
          getDoc(doc(db, "bracesPricing", "reference")),
        ]);
        if (!active) return;
        const role = String(adminSnapshot.data()?.role || "").trim().toLowerCase();
        setIsAdmin(adminSnapshot.exists() && role === ROLES.ADMIN);
        if (referenceSnapshot.exists()) {
          const next = normalizeBracesReferencePrices(referenceSnapshot.data().prices || {});
          setReferencePrices(next);
          setReferencePriceDraft(next);
        }
      } catch (error) {
        console.error("Braces reference prices could not be loaded:", error);
        if (active) setReferencePriceError("Reference prices could not be loaded. Check your access and try again.");
      }
    }
    loadPriceReferences();
    return () => {
      active = false;
    };
  }, []);

  const selectedReferencePrice = referencePrices[normalizeBracesType(accountDraft.bracesType)];

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
        discountAmount: accountDraft.discountAmount,
      }),
    [accountDraft.downPaymentExpected, accountDraft.discountAmount, accountDraft.planCycles, accountDraft.planFrequency, accountDraft.totalCost]
  );
  const computedDiscountRate = Number(accountDraft.totalCost) > 0
    ? Math.min(100, Number(accountDraft.discountAmount || 0) / Number(accountDraft.totalCost))
    : 0;
  const computedInstallmentCount = useMemo(
    () => getInstallmentCount(accountDraft.planCycles, accountDraft.planFrequency),
    [accountDraft.planCycles, accountDraft.planFrequency]
  );

  useEffect(() => {
    if (!selectedPatient) {
      setAccountDraft(getEmptyAccountDraft());
      setPaymentDraft(getEmptyPaymentDraft());
      setAdjustmentDraft(getEmptyAdjustmentDraft());
      return;
    }

    if (selectedPatient.bracesAccount) {
      setAccountDraft({
        totalCost: String(selectedPatient.bracesAccount.listedCost || selectedPatient.bracesAccount.totalCost || ""),
        discountAmount: String(selectedPatient.bracesAccount.discountAmount || ""),
        bracesType: normalizeBracesType(selectedPatient.bracesAccount.bracesType),
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

  // Close the workspace overlay with Escape and lock page scroll while it is open
  useEffect(() => {
    if (!bracesWorkspaceOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape" && !confirmState) setBracesWorkspaceOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [bracesWorkspaceOpen, confirmState]);

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

    const listedCost = Number(accountDraft.totalCost || 0);
    const discountAmount = Number(accountDraft.discountAmount || 0);
    const downPaymentExpected = Number(accountDraft.downPaymentExpected || 0);
    if (!Number.isFinite(listedCost) || listedCost <= 0) {
      setPaymentError("Enter the agreed braces treatment cost.");
      return;
    }
    if (!Number.isFinite(discountAmount) || discountAmount < 0 || discountAmount > listedCost) {
      setPaymentError("The discount must be between zero and the agreed treatment cost.");
      return;
    }
    if (!Number.isFinite(downPaymentExpected) || downPaymentExpected < 0 || downPaymentExpected > listedCost - discountAmount) {
      setPaymentError("The down payment cannot exceed the agreed treatment cost after discount.");
      return;
    }

    setPaymentError("");
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
        listedCost,
        discountAmount,
        totalCost: listedCost - discountAmount,
        bracesType: normalizeBracesType(accountDraft.bracesType),
        downPaymentExpected,
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
          discountRate: computed.discountRate,
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
    } catch (error) {
      console.error("Braces treatment price could not be saved:", error);
      setPaymentError(error.message || "Braces treatment price could not be saved. Check your access and try again.");
    } finally {
      setSavingAccount(false);
    }
  }

  async function saveReferencePrices(event) {
    event.preventDefault();
    setReferencePriceError("");
    const nextPrices = normalizeBracesReferencePrices(referencePriceDraft);
    const invalidPrices = BRACES_TYPES.some((type) => {
      const price = nextPrices[type];
      return price.downPayment < 0 || price.totalMin <= 0 ||
        price.totalMax < price.totalMin || price.downPayment > price.totalMax;
    });
    if (invalidPrices) {
      setReferencePriceError("Each reference down payment must be non-negative, and the total range must be valid.");
      return;
    }

    setSavingReferencePrices(true);
    try {
      await setDoc(doc(db, "bracesPricing", "reference"), {
        prices: nextPrices,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setReferencePrices(nextPrices);
      setReferencePriceDraft(nextPrices);
      await logAdminAction({
        action: "update_braces_reference_prices",
        targetType: "braces_pricing",
        targetId: "reference",
        targetLabel: "Braces reference price list",
        details: { prices: nextPrices },
      });
    } catch (error) {
      console.error("Braces reference prices could not be saved:", error);
      setReferencePriceError("Reference prices could not be saved. Check your access and try again.");
    } finally {
      setSavingReferencePrices(false);
    }
  }

  function updateReferencePrice(type, field, value) {
    setReferencePriceDraft((current) => ({
      ...current,
      [type]: {
        ...current[type],
        [field]: value === "" ? "" : Number(value),
      },
    }));
  }

  async function logPayment() {
    if (!selectedPatient?.bracesAccount) return;
    if (!Number(paymentDraft.amount || 0)) return;
    if (paymentSubmissionLock.current) return;

    setPaymentError("");
    paymentSubmissionLock.current = true;
    setSavingPayment(true);
    try {
      const paymentId = await recordBracesPayment({
        patient: selectedPatient,
        accountId: selectedPatient.bracesAccount.id || selectedPatient.id,
        amount: Number(paymentDraft.amount || 0),
        paymentDate: paymentDraft.paymentDate || "",
        method: paymentDraft.method || "Cash",
        notes: paymentDraft.notes.trim(),
      });

      await logAdminAction({
        action: "log_braces_payment",
        targetType: "braces_payment",
        targetId: paymentId,
        targetLabel: selectedPatient.name || selectedPatient.email || "Braces payment",
        details: {
          amount: Number(paymentDraft.amount || 0),
          paymentDate: paymentDraft.paymentDate || "",
          method: paymentDraft.method || "Cash",
        },
      });

      setPaymentDraft(getEmptyPaymentDraft());
      await load();
    } catch (error) {
      console.error("Braces payment could not be saved:", error);
      setPaymentError(error.message || "Braces payment could not be saved. Check your access and try again.");
    } finally {
      paymentSubmissionLock.current = false;
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

  function openWorkspace(patientId) {
    setSelectedPatientId(patientId);
    setBracesWorkspaceOpen(true);
  }

  function closeWorkspace() {
    setBracesWorkspaceOpen(false);
  }

  return (
    <div className="container adminSurface">
      <section className="bracesReferenceCard" aria-labelledby="bracesReferenceTitle">
        <div className="bracesReferenceHeader">
          <div>
            <h2 id="bracesReferenceTitle">Braces reference prices</h2>
            <p>Reference amounts only. Set each patient&apos;s agreed price in their treatment plan.</p>
          </div>
          {isAdmin ? <span className="badge">Administrator editable</span> : null}
        </div>
        {referencePriceError ? <div className="formError" role="alert">{referencePriceError}</div> : null}
        {isAdmin ? (
          <form className="bracesReferenceGrid" onSubmit={saveReferencePrices}>
            {BRACES_TYPES.map((type) => (
              <fieldset className="bracesReferenceItem" key={type}>
                <legend>{type}</legend>
                <label>
                  <span>Reference down payment (PHP)</span>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={referencePriceDraft[type].downPayment}
                    onChange={(event) => updateReferencePrice(type, "downPayment", event.target.value)}
                  />
                </label>
                <div className="bracesReferenceRange">
                  <label>
                    <span>Reference total min (PHP)</span>
                    <input
                      className="input"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={referencePriceDraft[type].totalMin}
                      onChange={(event) => updateReferencePrice(type, "totalMin", event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Reference total max (PHP)</span>
                    <input
                      className="input"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={referencePriceDraft[type].totalMax}
                      onChange={(event) => updateReferencePrice(type, "totalMax", event.target.value)}
                    />
                  </label>
                </div>
              </fieldset>
            ))}
            <div className="bracesReferenceActions">
              <button type="submit" className="btn btnPrimary" disabled={savingReferencePrices}>
                {savingReferencePrices ? "Saving reference prices..." : "Save reference prices"}
              </button>
            </div>
          </form>
        ) : (
          <div className="bracesReferenceGrid">
            {BRACES_TYPES.map((type) => {
              const price = referencePrices[type];
              return (
                <article className="bracesReferenceItem" key={type}>
                  <h3>{type}</h3>
                  <p>Down payment: <strong>{formatCurrency(price.downPayment)}</strong></p>
                  <p>Total range: <strong>{formatCurrency(price.totalMin)}–{formatCurrency(price.totalMax)}</strong></p>
                </article>
              );
            })}
          </div>
        )}
      </section>

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

      <section className="panel">
        <div className="panelHead">
          <div>
            <h2 className="panelTitle">Braces Payments</h2>
            <p className="panelSub">Select a patient to open their braces workspace.</p>
          </div>
          <span className="countLabel">{filteredPatients.length} records</span>
        </div>

        <div className="patientToolbar">
          <div className="topSearchBar adminSearchField">
            <svg
              className="topSearchIcon adminSearchIcon"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              className="input topSearchInput"
              placeholder="Search patient name"
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
          <div className="patientTableWrap">
            <table className="patientTable">
              <thead>
                <tr>
                  <th>Full name</th>
                  <th>Amount paid</th>
                  <th>Balance</th>
                  <th>Payment status</th>
                </tr>
              </thead>
              <tbody>
                {filteredPatients.map((patient) => {
                  const bracesAccount = patient.bracesAccount;

                  return (
                    <tr
                      key={patient.id}
                      className="patientRow"
                      tabIndex={0}
                      onClick={() => openWorkspace(patient.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openWorkspace(patient.id);
                        }
                      }}
                    >
                      <td data-label="Full name">
                        <span className="patientName">{patient.name}</span>
                      </td>
                      <td data-label="Amount paid">
                        {bracesAccount ? formatCurrency(bracesAccount.amountPaid) : "-"}
                      </td>
                      <td data-label="Balance">
                        {bracesAccount ? formatCurrency(bracesAccount.remainingBalance) : "-"}
                      </td>
                      <td data-label="Payment status">
                        <span className={`statusPill ${getPaymentPillClass(bracesAccount)}`}>
                          {bracesAccount?.paymentState || "No plan"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No matching patients"
            message="Try another name or clear the search to view all active patient records."
          />
        )}
      </section>

      {bracesWorkspaceOpen && selectedPatient ? (
        <>
          <div className="patientDrawerOverlay open" onClick={closeWorkspace} />
          <div className="patientDrawer bracesWorkspaceModal open" role="dialog" aria-modal="true" aria-label="Braces workspace">
            <div className="patientDrawerInner">
              <div className="patientDrawerHeader">
                <div>
                  <span className="detailLabel">Braces workspace</span>
                  <h3>{selectedPatient.name}</h3>
                  <p className="detailSubtitle">
                    {selectedPatient.patientType || "Regular Patient"} • {selectedPatient.phone || "No phone"} • {selectedPatient.email || "No email"}
                  </p>
                  <div className="workspaceStatusRow">
                    <span className={`statusPill ${getPaymentPillClass(selectedPatient.bracesAccount)}`}>
                      {selectedPatient.bracesAccount?.paymentState || "No braces plan yet"}
                    </span>
                  </div>
                </div>
                <button type="button" className="patientDrawerCloseBtn" onClick={closeWorkspace} aria-label="Close">
                  ×
                </button>
              </div>

              <div className="patientDrawerBody">
                <form className="form" onSubmit={saveAccount}>
                  <div className="bookingFlowGrid">
                    <label className="bookingFieldCard">
                      <span className="detailLabel">Agreed total treatment cost (PHP)</span>
                      <input
                        className="input bookingInputSpecial"
                        type="number"
                        min="0.01"
                        step="0.01"
                        placeholder="e.g. 45000"
                        value={accountDraft.totalCost}
                        onChange={(e) => setAccountDraft((current) => ({ ...current, totalCost: e.target.value }))}
                      />
                    </label>
                    <label className="bookingFieldCard">
                      <span className="detailLabel">Agreed down payment (PHP)</span>
                      <input
                        className="input bookingInputSpecial"
                        type="number"
                        min="0"
                        max={Math.max(0, Number(accountDraft.totalCost || 0) - Number(accountDraft.discountAmount || 0))}
                        step="0.01"
                        placeholder="e.g. 5000"
                        value={accountDraft.downPaymentExpected}
                        onChange={(e) => setAccountDraft((current) => ({ ...current, downPaymentExpected: e.target.value }))}
                      />
                    </label>
                    <label className="bookingFieldCard">
                      <span className="detailLabel">Braces type</span>
                      <select className="input bookingInputSpecial" value={normalizeBracesType(accountDraft.bracesType)} onChange={(e) => setAccountDraft((current) => ({ ...current, bracesType: e.target.value }))}>
                        {BRACES_TYPES.map((type) => <option key={type}>{type}</option>)}
                      </select>
                    </label>
                    <label className="bookingFieldCard">
                      <span className="detailLabel">Manual discount (PHP)</span>
                      <input className="input bookingInputSpecial" type="number" min="0" max={accountDraft.totalCost || undefined} placeholder="0" value={accountDraft.discountAmount} onChange={(e) => setAccountDraft((current) => ({ ...current, discountAmount: e.target.value }))} />
                    </label>
                  </div>

                  <div className="bracesReferenceHint" role="status">
                    <strong>{normalizeBracesType(accountDraft.bracesType)} reference:</strong>
                    <span>Down payment {formatCurrency(selectedReferencePrice.downPayment)} · total {formatCurrency(selectedReferencePrice.totalMin)}–{formatCurrency(selectedReferencePrice.totalMax)}</span>
                    <small>Guidance only. Enter the final agreed amounts for this patient; later reference updates will not change this treatment plan.</small>
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

                  <div className="detailGrid bracesSummaryGrid">
                    <div className="detailBox luxeBox">
                      <span className="detailLabel">Discount applied</span>
                      <strong>{formatCurrency(accountDraft.discountAmount || 0)} ({(computedDiscountRate * 100).toFixed(computedDiscountRate % 1 ? 1 : 0)}%)</strong>
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

                  {paymentError ? <div className="formError" role="alert">{paymentError}</div> : null}
                  <button className="btn btnShine bookingPrimaryBtn" disabled={savingAccount}>
                    {savingAccount ? "Saving braces plan..." : selectedPatient.bracesAccount ? "Update Braces Plan" : "Create Braces Plan"}
                  </button>
                </form>

                {selectedPatient.bracesAccount ? (
                  <>
                    <div className="detailGrid bracesSummaryGrid">
                      <div className="detailBox luxeBox">
                        <span className="detailLabel">Braces type</span>
                        <strong>{selectedPatient.bracesAccount.bracesType || "Not specified"}</strong>
                      </div>
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

                      {paymentError ? <div className="formError" role="alert">{paymentError}</div> : null}
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

                    <div className="card adminRecordsCard">
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

                    <div className="card adminRecordsCard">
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
                  <div className="emptyEditorState clinicalInfoEmpty">
                    <strong>No braces account yet</strong>
                    <p>Create the installment plan first, then you can start logging down payments, scheduled braces payments, and adjustment visits here.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      ) : null}

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
