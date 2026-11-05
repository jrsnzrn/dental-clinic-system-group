import BookingCrownPicker from "../../components/BookingCrownPicker";
import { BRACES_PACKAGE_INCLUSIONS, isBracesPackageInclusion, isCrownTypeService, isOrthodonticService } from "../../../functions/bookingServices.mjs";
import { getBookingServiceOptions } from "../../utils/clinic";
import LoadingIndicator from "../../components/LoadingIndicator";
import SuccessDialog from "../../components/SuccessDialog";
import { getUnchargedPaymentServices, groupBookingPaymentRows, groupBookingReceipts } from "../../utils/bookingPayments";
import { recordBookingPayment } from "../../utils/recordBookingPayment";
import PaginatedRecords from "../../components/PaginatedRecords";
import RecordPagination from "../../components/RecordPagination";
import useRecordPagination from "../../hooks/useRecordPagination";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  onSnapshot,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import EmptyState from "../../components/EmptyState";
import BackArrow from "../../components/BackArrow";
import PaymentReceipts from "../../components/PaymentReceipts";
import PaymentChargeBreakdown from "../../components/PaymentChargeBreakdown";
import BookingPromotionSelect from "../../components/BookingPromotionSelect";
import { SkeletonList } from "../../components/LoadingSkeleton";
import { db, functions } from "../../firebase";
import { logAdminAction } from "../../utils/audit";
import { formatCurrency, getBracesPaymentsForPatient, buildBracesAccount } from "../../utils/braces";
import { normalizeName } from "../../utils/appointments";
import {
  recordBracesPayment,
  recordRegularPayment,
} from "../../utils/paymentTransactions";
import { formatDateLabel, formatTimeLabel, formatTimestamp } from "../../utils/schedule";
import { calculateCharges, getStartingCharge } from "../../utils/paymentPricing";
import { MAX_RECEIPT_PHOTOS, prepareReceiptPhoto } from "../../utils/receiptPhotos";

const DETAIL_PAYMENT_METHODS = ["Cash", "GCash", "Maya", "Bank Transfer", "Card"];
const COMPLETE_PAID_APPOINTMENT = httpsCallable(functions, "completePaidAppointment");
const GET_BOOKING_PAYMENT_PROMOTION = httpsCallable(functions, "getBookingPaymentPromotion");

function toAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function isBracesPackageExtra(service) {
  return !isOrthodonticService(service) && !isBracesPackageInclusion(service);
}

function formatPatientBracesType(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  const types = {
    metal: "Metal",
    metalbraces: "Metal",
    ceramic: "Ceramic",
    ceramicbraces: "Ceramic",
    selfligating: "Self-Ligating",
    selfligatingbraces: "Self-Ligating",
    sapphire: "Sapphire",
    sapphirebraces: "Sapphire",
    sapphireplastic: "Sapphire",
  };
  return types[normalized] || "";
}

function toDateValue(value) {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  if (typeof value.toDate === "function") return value.toDate().toISOString().slice(0, 10);
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000).toISOString().slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function paymentStatus(totalCost, amountPaid, pending = false) {
  if (totalCost > 0 && amountPaid >= totalCost) return "Paid";
  if (amountPaid > 0) return "Partially Paid";
  if (pending) return "Pending";
  return "Unpaid";
}

function isFullyPaid(row) {
  if (row.treatments && !row.allPriced) return false;
  return (row.totalCost > 0 || row.chargeBreakdown?.grossTotal > 0) && row.balance <= 0.005 && row.amountPaid + 0.005 >= row.totalCost;
}

function paymentStatusLabel(row, patientType = row?.patientType) {
  if (isFullyPaid(row || {})) return "Completed";
  if (row?.source === "Appointment" && row.paymentReady === false) {
    return row.paymentQueueLabel || "Awaiting treatment";
  }
  if (patientType !== "Ortho" && toAmount(row?.amountPaid) <= 0) return "Pending";
  return "Ongoing";
}

function patientForPayment(payment, patients) {
  return patients.find((patient) =>
    (payment.patientId && payment.patientId === patient.id) ||
    (payment.uid && payment.uid === patient.uid) ||
    (payment.patientEmail && payment.patientEmail === patient.email) ||
    (payment.email && payment.email === patient.email)
  );
}

function patientForPaymentIdentity(record, patients) {
  return patients.find((patient) =>
    (record.patientId && record.patientId === patient.id) ||
    (record.uid && record.uid === patient.uid)
  ) || null;
}

function bracesAccountForPatientIdentity(accounts, patient) {
  if (!patient) return null;
  return accounts.find((account) =>
    account.patientId === patient.id ||
    account.id === patient.id ||
    (patient.uid && account.uid === patient.uid)
  ) || null;
}

function recordMatchesPatient(record, patient) {
  if (!record || !patient) return false;
  if (
    (record.patientId && [patient.id, patient.uid].includes(record.patientId)) ||
    (record.uid && [patient.id, patient.uid].includes(record.uid))
  ) return true;
  if (record.patientEmail && patient.email && normalizeName(record.patientEmail) === normalizeName(patient.email)) {
    return true;
  }
  return false;
}

function paymentDateSortValue(payment) {
  return toDateValue(payment.paymentDate || payment.date || payment.paidAt || payment.createdAt);
}

function makeRegularPaymentRows(payments, patients, bookings, summaries) {
  const groups = new Map();
  payments.forEach((payment) => {
    const patient = patientForPayment(payment, patients);
    const treatmentId = payment.treatmentId || payment.appointmentId || payment.id;
    const patientId = patient?.id || payment.patientId || payment.uid || payment.patientEmail || payment.email ||
      normalizeName(payment.patientName || payment.fullName || payment.name) || payment.id;
    const key = `${patientId}:${treatmentId}`;
    const group = groups.get(key) || {
      id: key,
      patient,
      transactions: [],
      totalCost: 0,
      amountPaid: 0,
      treatmentId,
      appointmentId: payment.appointmentId || "",
      treatmentName: payment.treatmentName || payment.service || "",
      summary: summaries.find((summary) =>
        summary.treatmentId === treatmentId &&
        ((summary.patientId && [patient?.id, payment.patientId].includes(summary.patientId)) ||
          (summary.uid && [patient?.uid, payment.uid].includes(summary.uid)))
      ) || null,
    };
    group.transactions.push(payment);
    group.totalCost = Math.max(group.totalCost, toAmount(payment.totalCost ?? payment.cost ?? payment.total));
    group.amountPaid += toAmount(payment.amount ?? payment.paid);
    group.appointmentId ||= payment.appointmentId || "";
    group.treatmentName ||= payment.treatmentName || payment.service || "";
    groups.set(key, group);
  });

  const rows = [];
  groups.forEach((group) => {
    if (group.summary) {
      group.totalCost = toAmount(group.summary.totalCost);
      group.amountPaid = Math.max(group.amountPaid, toAmount(group.summary.amountPaid));
    }
    const booking = bookings.find((entry) => entry.id === group.appointmentId);
    const treatmentName = group.treatmentName || (booking?.services || [booking?.service]).filter(Boolean).join(", ") || "Dental treatment";
    const type = String(group.patient?.patientType || group.transactions[0]?.patientType || "").toLowerCase().includes("ortho") ? "Ortho" : "Regular";
    const balance = Math.max(0, group.totalCost - group.amountPaid);
    group.transactions.forEach((transaction) => {
      rows.push({
        id: `regular-${transaction.id}`,
        sourceId: transaction.id,
        source: group.appointmentId ? "Appointment" : "Regular",
        hasTransaction: true,
        patientId: group.patient?.id || transaction.patientId || transaction.uid ||
          transaction.patientEmail || transaction.email ||
          normalizeName(transaction.patientName || transaction.fullName || transaction.name) || transaction.id,
        patientRecord: group.patient || null,
        patientName: group.patient?.name || transaction.patientName || transaction.fullName || transaction.name || "Patient",
        patientType: type,
        patientEmail: group.patient?.email || transaction.patientEmail || transaction.email || "",
        treatmentName,
        appointmentId: group.appointmentId,
        appointmentDate: booking?.date || group.summary?.appointmentDate || transaction.appointmentDate || "",
        appointmentTime: booking?.time || group.summary?.appointmentTime || transaction.appointmentTime || "",
        selectedDentist: booking?.selectedDentist || group.summary?.selectedDentist || transaction.selectedDentist || "",
        totalCost: group.totalCost,
        chargeBreakdown: group.summary?.chargeBreakdown || transaction.chargeBreakdown,
        amountPaid: group.amountPaid,
        balance,
        status: paymentStatus(
          group.totalCost,
          group.amountPaid,
          Boolean(group.appointmentId && group.amountPaid === 0)
        ),
        amount: toAmount(transaction.amount ?? transaction.paid),
        paymentDate: paymentDateSortValue(transaction),
        method: transaction.method || transaction.paymentMethod || "",
        additionalServices: transaction.additionalServices || group.summary?.additionalServices || [],
        notes: transaction.notes || "",
        treatmentId: group.treatmentId,
        paymentReady: !group.appointmentId || ["pending_payment", "completed"].includes(String(booking?.status || "").toLowerCase()),
        paymentQueueLabel: booking?.status === "pending_payment" ? "Treatment details missing" : "Awaiting treatment",
      });
    });
  });
  return rows;
}

function makeBracesPaymentRows(payments, accounts, patients) {
  const rows = [];
  const matchedPaymentIds = new Set();
  accounts.forEach((account) => {
    const patient = patients.find((entry) =>
      entry.id === account.patientId ||
      entry.id === account.id ||
      (account.uid && entry.uid === account.uid)
    ) || null;
    const paymentPatient = patient || {
      id: account.patientId || account.id,
      uid: account.uid || "",
      email: account.patientEmail || "",
      name: account.patientName || "",
    };
    const accountPayments = payments.filter((payment) =>
      !matchedPaymentIds.has(payment.id) && (payment.accountId
        ? payment.accountId === account.id
        : getBracesPaymentsForPatient([payment], paymentPatient, account).length > 0)
    );
    accountPayments.forEach((payment) => matchedPaymentIds.add(payment.id));
    const summary = buildBracesAccount(account, accountPayments);
    const latestPayment = [...accountPayments].sort((left, right) =>
      paymentDateSortValue(right).localeCompare(paymentDateSortValue(left))
    )[0];
    rows.push({
      id: `braces-account-${account.id}`,
      sourceId: account.id,
      source: "Ortho",
      hasTransaction: accountPayments.length > 0,
      patientId: patient?.id || account.patientId || account.id,
      patientRecord: patient || null,
      patientName: patient?.name || account.patientName || "Patient",
      patientType: "Ortho",
      patientEmail: patient?.email || account.patientEmail || "",
      treatmentName: "Braces treatment",
      bracesType: String(patient?.patientType || "").toLowerCase().includes("ortho")
        ? patient.bracesType || ""
        : "",
      planLabel: [
        account.planCycles || account.planMonths
          ? `${account.planCycles || account.planMonths} months`
          : "",
        account.planFrequency || account.paymentSchedule || "",
      ].filter(Boolean).join(" · ") || "—",
      startDate: account.startDate || "",
      appointmentId: "",
      totalCost: summary.totalCost,
      amountPaid: summary.amountPaid,
      balance: summary.remainingBalance,
      status: paymentStatus(summary.totalCost, summary.amountPaid),
      amount: toAmount(latestPayment?.amount),
      paymentDate: paymentDateSortValue(latestPayment || {}) || toDateValue(account.lastPaymentAt),
      method: latestPayment?.method || latestPayment?.paymentMethod || "",
      additionalServices: account.additionalServices || latestPayment?.additionalServices || [],
      notes: "",
      treatmentId: account.id,
      account,
    });
  });

  const orphanPaymentGroups = new Map();
  payments.forEach((payment) => {
    if (matchedPaymentIds.has(payment.id)) return;
    const patient = patientForPaymentIdentity(payment, patients);
    const key = payment.accountId || payment.patientId || payment.uid || payment.patientEmail ||
      normalizeName(payment.patientName) || payment.id;
    const group = orphanPaymentGroups.get(key) || {
      patient,
      transactions: [],
      totalCost: 0,
      amountPaid: 0,
      id: payment.accountId || payment.patientId || payment.uid || payment.id,
    };
    group.transactions.push(payment);
    group.totalCost = Math.max(group.totalCost, toAmount(payment.totalCost));
    group.amountPaid += toAmount(payment.amount);
    orphanPaymentGroups.set(key, group);
  });
  orphanPaymentGroups.forEach((group) => {
    const latestPayment = [...group.transactions].sort((left, right) =>
      paymentDateSortValue(right).localeCompare(paymentDateSortValue(left))
    )[0];
    rows.push({
      id: `braces-orphan-${group.id}`,
      sourceId: group.id,
      source: "Ortho",
      hasTransaction: true,
      patientId: group.patient?.id || latestPayment.patientId || latestPayment.uid || group.id,
      patientRecord: group.patient,
      patientName: group.patient?.name || latestPayment.patientName || "Patient",
      patientType: "Ortho",
      patientEmail: group.patient?.email || latestPayment.patientEmail || "",
      treatmentName: "Braces treatment",
      bracesType: String(group.patient?.patientType || "").toLowerCase().includes("ortho")
        ? group.patient.bracesType || ""
        : "",
      planLabel: "—",
      startDate: "",
      totalCost: group.totalCost,
      amountPaid: group.amountPaid,
      balance: Math.max(0, group.totalCost - group.amountPaid),
      status: paymentStatus(group.totalCost, group.amountPaid),
      amount: toAmount(latestPayment.amount),
      paymentDate: paymentDateSortValue(latestPayment),
      method: latestPayment.method || latestPayment.paymentMethod || "",
      additionalServices: latestPayment.additionalServices || [],
      notes: "",
      treatmentId: group.id,
      account: null,
    });
  });
  return rows;
}

function makeUnpaidRegularRows(summaries, payments, patients, bookings) {
  return summaries
    .filter((summary) => {
      if (!summary.appointmentId) return true;
      const booking = bookings.find((entry) => entry.id === summary.appointmentId);
      // Appointment treatments enter this queue when the assigned dentist
      // marks treatment complete and sends the appointment to Payments.
      // Keep legacy treatment rows with no matching booking visible for reconciliation.
      return !booking || ["pending_payment", "completed"].includes(String(booking.status || "").toLowerCase());
    })
    .filter((summary) => !payments.some((payment) =>
      payment.treatmentId === summary.treatmentId &&
      ((payment.patientId && payment.patientId === summary.patientId) ||
        (payment.uid && payment.uid === summary.uid))
    ))
    .map((summary) => {
      const patient = patients.find((entry) =>
        entry.id === summary.patientId ||
        (summary.uid && entry.uid === summary.uid)
      );
      const booking = bookings.find((entry) => entry.id === summary.appointmentId);
      const totalCost = toAmount(summary.totalCost);
      const amountPaid = toAmount(summary.amountPaid);
      return {
        id: `regular-treatment-${summary.id}`,
        sourceId: summary.id,
        source: "Appointment",
        hasTransaction: false,
        patientId: patient?.id || summary.patientId || summary.uid || summary.id,
        patientRecord: patient || null,
        patientName: patient?.name || summary.patientName || "Patient",
        patientType: summary.patientType === "Ortho" ? "Ortho" : "Regular",
        patientEmail: patient?.email || summary.patientEmail || "",
        treatmentName: summary.treatmentName ||
          (booking?.services || [booking?.service]).filter(Boolean).join(", ") ||
          "Dental treatment",
        appointmentId: summary.appointmentId || "",
        appointmentDate: booking?.date || summary.appointmentDate || "",
        appointmentTime: booking?.time || summary.appointmentTime || "",
        selectedDentist: booking?.selectedDentist || summary.selectedDentist || "",
        totalCost,
        chargeBreakdown: summary.chargeBreakdown,
        amountPaid,
        balance: Math.max(0, totalCost - amountPaid),
        status: paymentStatus(totalCost, amountPaid, Boolean(summary.appointmentId && amountPaid === 0)),
        amount: 0,
        paymentDate: "",
        method: "",
        additionalServices: summary.additionalServices || [],
        notes: "",
        treatmentId: summary.treatmentId,
        paymentReady: !summary.appointmentId || (
          Boolean(booking?.checkedInAt) &&
          ["pending_payment", "completed"].includes(String(booking?.status || "").toLowerCase()) &&
          Boolean(String(summary.treatmentName || "").trim())
        ),
        paymentQueueLabel: booking?.status === "pending_payment" ? "Awaiting charges" : "Awaiting treatment",
      };
    });
}

function makeApprovedAppointmentRows(bookings, payments, summaries, patients) {
  const appointmentsWithPaymentDetails = new Set([
    ...summaries.map((summary) => summary.appointmentId).filter(Boolean),
    ...payments.map((payment) => payment.appointmentId).filter(Boolean),
  ]);

  return bookings
    .filter((booking) =>
      String(booking.status || "").toLowerCase() === "pending_payment" &&
      booking.archiveStatus !== "Archived" &&
      !appointmentsWithPaymentDetails.has(booking.id)
    )
    .map((booking) => {
      const patient = patients.find((entry) =>
        (booking.patientProfileId && entry.id === booking.patientProfileId) ||
        (booking.uid && entry.uid === booking.uid)
      ) || null;
      const patientType = String(patient?.patientType || booking.patientType || "").toLowerCase().includes("ortho")
        ? "Ortho"
        : "Regular";
      const treatmentName = (booking.services || [booking.service]).filter(Boolean).join(", ") || "Dental treatment";
      return {
        id: `approved-appointment-${booking.id}`,
        sourceId: booking.id,
        source: "Appointment",
        hasTransaction: false,
        patientId: patient?.id || booking.patientProfileId || booking.uid || booking.id,
        patientRecord: patient || {
          id: booking.patientProfileId || booking.uid || booking.id,
          uid: booking.uid || "",
          name: booking.fullName || "Patient",
          email: booking.email || "",
          patientType,
        },
        patientName: patient?.name || booking.fullName || "Patient",
        patientType,
        patientEmail: patient?.email || booking.email || "",
        treatmentName,
        appointmentId: booking.id,
        appointmentDate: booking.date || "",
        appointmentTime: booking.time || "",
        selectedDentist: booking.selectedDentist || "",
        bracesType: patient?.bracesType || "",
        planLabel: "Appointment treatment",
        totalCost: 0,
        amountPaid: 0,
        balance: 0,
        status: "Awaiting treatment",
        paymentQueueLabel: String(booking.status || "").toLowerCase() === "pending_payment"
          ? "Treatment details missing"
          : "Awaiting treatment",
        paymentReady: false,
        amount: 0,
        paymentDate: "",
        method: "",
        notes: "",
        treatmentId: `appointment-${booking.id}`,
      };
    });
}

export default function Payments() {
  const [patients, setPatients] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [clinicServices, setClinicServices] = useState([]);
  const [regularPayments, setRegularPayments] = useState([]);
  const [regularTreatmentSummaries, setRegularTreatmentSummaries] = useState([]);
  const [bracesPayments, setBracesPayments] = useState([]);
  const [bracesAccounts, setBracesAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState({});
  const [search, setSearch] = useState("");
  const [paymentTab, setPaymentTab] = useState("Ortho");
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [selectedPatientFallback, setSelectedPatientFallback] = useState(null);
  const [selectedPaymentRowId, setSelectedPaymentRowId] = useState("");
  const [selectedTreatmentId, setSelectedTreatmentId] = useState("");
  const [detailDraft, setDetailDraft] = useState({
    treatmentName: "",
    totalCost: "",
    amount: "",
    paymentDate: new Date().toISOString().slice(0, 10),
    referenceNumber: "",
    additionalServices: [],
    serviceCharges: {},
    receiptPhotos: [],
    method: "Cash",
  });
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [receiptPhotoLoading, setReceiptPhotoLoading] = useState(false);
  const [promotionSaving, setPromotionSaving] = useState(false);
  const [paymentPromotion, setPaymentPromotion] = useState({ bookingId: "", promotion: null, error: "" });
  const unsubscribeRef = useRef([]);
  const submissionLockRef = useRef(false);
  const loadError = Object.values(loadErrors).join(" ");

  function load() {
    unsubscribeRef.current.forEach((unsubscribe) => unsubscribe());
    unsubscribeRef.current = [];
    setLoading(true);
    setLoadErrors({});
    const waitingFor = new Set([
      "patients",
      "bookings",
      "clinicServices",
      "payments",
      "paymentTreatmentSummaries",
      "bracesPayments",
      "bracesAccounts",
    ]);
    const listen = (name, setter) => {
      const unsubscribe = onSnapshot(
        collection(db, name),
        (snapshot) => {
          setter(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
          setLoadErrors((current) => {
            if (!current[name]) return current;
            const next = { ...current };
            delete next[name];
            return next;
          });
          waitingFor.delete(name);
          if (!waitingFor.size) setLoading(false);
        },
        (error) => {
          const errorCode = error?.code || "unknown";
          const errorMessage = error?.message || "No error message was provided.";
          console.error(`Payment module could not load "${name}" (${errorCode}): ${errorMessage}`, error);
          const details = import.meta.env.DEV
            ? `${name}: ${errorCode} — ${errorMessage}`
            : `${name}: unable to load payment information.`;
          setLoadErrors((current) => ({ ...current, [name]: details }));
          waitingFor.delete(name);
          if (!waitingFor.size) setLoading(false);
        }
      );
      unsubscribeRef.current.push(unsubscribe);
    };

    listen("patients", setPatients);
    listen("bookings", setBookings);
    listen("clinicServices", setClinicServices);
    listen("payments", setRegularPayments);
    listen("paymentTreatmentSummaries", setRegularTreatmentSummaries);
    listen("bracesPayments", setBracesPayments);
    listen("bracesAccounts", setBracesAccounts);
  }

  const closePatientDetails = useCallback(() => {
    if (submissionLockRef.current || receiptPhotoLoading) return;
    setSelectedPatientId("");
    setSelectedPatientFallback(null);
    setSelectedPaymentRowId("");
    setSelectedTreatmentId("");
    setDetailError("");
  }, [receiptPhotoLoading]);

  useEffect(() => {
    load();
    return () => unsubscribeRef.current.forEach((unsubscribe) => unsubscribe());
  }, []);

  useEffect(() => {
    if (!selectedPatientId) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        closePatientDetails();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedPatientId, closePatientDetails]);

  const regularRows = useMemo(
    () => [
      ...makeRegularPaymentRows(regularPayments, patients, bookings, regularTreatmentSummaries),
      ...makeUnpaidRegularRows(regularTreatmentSummaries, regularPayments, patients, bookings),
      ...makeApprovedAppointmentRows(bookings, regularPayments, regularTreatmentSummaries, patients),
    ],
    [regularPayments, regularTreatmentSummaries, patients, bookings]
  );
  const additionalServiceOptions = useMemo(
    () => getBookingServiceOptions(clinicServices),
    [clinicServices]
  );
  const appointmentTotals = useMemo(() => {
    const treatmentsByAppointment = new Map();
    regularTreatmentSummaries.forEach((summary) => {
      if (!summary.appointmentId || !summary.treatmentId) return;
      const treatments = treatmentsByAppointment.get(summary.appointmentId) || new Map();
      treatments.set(summary.treatmentId, toAmount(summary.totalCost));
      treatmentsByAppointment.set(summary.appointmentId, treatments);
    });
    return new Map([...treatmentsByAppointment].map(([appointmentId, treatments]) => [
      appointmentId,
      [...treatments.values()].reduce((sum, cost) => sum + cost, 0),
    ]));
  }, [regularTreatmentSummaries]);
  const allRows = useMemo(
    () => groupBookingPaymentRows([
      ...regularRows.map((row) => ({
        ...row,
        appointmentTotal: row.appointmentId
          ? appointmentTotals.get(row.appointmentId) || row.totalCost
          : 0,
      })),
      ...makeBracesPaymentRows(bracesPayments, bracesAccounts, patients),
    ]),
    [appointmentTotals, bracesAccounts, bracesPayments, patients, regularRows]
  );
  const selectedPatientRecord = useMemo(() => (
    patients.find((patient) => patient.id === selectedPatientId || patient.uid === selectedPatientId) ||
    allRows.find((row) =>
      row.patientRecord &&
      (row.patientRecord.id === selectedPatientId || row.patientRecord.uid === selectedPatientId)
    )?.patientRecord ||
    allRows.find((row) => row.patientId === selectedPatientId)?.patientRecord ||
    selectedPatientFallback
  ), [allRows, patients, selectedPatientFallback, selectedPatientId]);
  const patientHistory = useMemo(
    () => allRows.filter((row) =>
      row.patientId === selectedPatientId ||
      recordMatchesPatient(row.patientRecord || row, selectedPatientRecord)
    ),
    [allRows, selectedPatientId, selectedPatientRecord]
  );
  const selectedPaymentRow = useMemo(
    () => patientHistory.find((row) => row.id === selectedPaymentRowId) ||
      patientHistory.find((row) => row.treatmentId === selectedTreatmentId) ||
      patientHistory[0] ||
      null,
    [patientHistory, selectedPaymentRowId, selectedTreatmentId]
  );
  const selectedPatientType = selectedPaymentRow
    ? selectedPaymentRow.patientType === "Ortho" || selectedPaymentRow.source === "Ortho" ? "Ortho" : "Regular"
    : String(selectedPatientRecord?.patientType || "")
      .toLowerCase()
      .includes("ortho")
      ? "Ortho"
      : "Regular";
  const detailBracesAccount = useMemo(
    () => selectedPatientRecord
      ? bracesAccountForPatientIdentity(bracesAccounts, selectedPatientRecord)
      : null,
    [bracesAccounts, selectedPatientRecord]
  );
  const detailBracesSummary = useMemo(
    () => detailBracesAccount
      ? buildBracesAccount(
        detailBracesAccount,
        getBracesPaymentsForPatient(bracesPayments, selectedPatientRecord, detailBracesAccount)
      )
      : null,
    [bracesPayments, detailBracesAccount, selectedPatientRecord]
  );
  const isBracesInstallment = selectedPaymentRow?.source === "Ortho" && selectedPatientType === "Ortho";
  const selectedPaymentCompleted = isFullyPaid(selectedPaymentRow || {});
  const selectedBooking = bookings.find((booking) => booking.id === selectedPaymentRow?.appointmentId);
  const savedBracesExtras = isBracesInstallment ? (selectedPaymentRow.additionalServices || []) : [];
  const hasBracesPackage = isBracesInstallment || Boolean(selectedBooking?.bracesPackage);
  const allowedAdditionalServices = (detailDraft.additionalServices || []).filter((name) => !hasBracesPackage || isBracesPackageExtra({ name }));
  const chargedServiceNames = [
    ...(detailDraft.treatmentName || "Dental treatment").split(",").map((name) => name.trim()).filter(Boolean),
    ...(selectedPaymentRow?.chargeBreakdown?.serviceCharges || []).map((line) => line.name),
    ...savedBracesExtras,
  ];
  const eligibleAdditionalServices = additionalServiceOptions.filter((service) => hasBracesPackage
    ? isBracesPackageExtra(service)
    : service.name.toLowerCase() !== "dental x-ray");
  const visibleAdditionalServices = getUnchargedPaymentServices([
    ...eligibleAdditionalServices,
    ...allowedAdditionalServices.filter((name) => !eligibleAdditionalServices.some((service) => service.name === name)).map((name) => ({ name })),
  ], chargedServiceNames);
  const otherAdditionalServices = visibleAdditionalServices.filter((service) => !isCrownTypeService(service)).map((service) => service.name);
  const promotionId = selectedBooking?.promotionId || "";
  const promotionBookingId = selectedBooking?.id || "";
  useEffect(() => {
    if (!promotionId || !promotionBookingId) return;
    let active = true;
    GET_BOOKING_PAYMENT_PROMOTION({ bookingId: promotionBookingId }).then(result => {
      if (active) setPaymentPromotion({ bookingId: promotionBookingId, promotion: result.data.promotion, error: "" });
    }).catch(error => {
      if (active) setPaymentPromotion({ bookingId: promotionBookingId, promotion: null, error: error.message || "The booking promotion could not be loaded." });
    });
    return () => { active = false; };
  }, [promotionId, promotionBookingId]);
  const promotionLoading = Boolean(promotionId && paymentPromotion.bookingId !== promotionBookingId);
  const promotionError = promotionId && paymentPromotion.bookingId === promotionBookingId ? paymentPromotion.error : "";
  const promotion = promotionId && paymentPromotion.bookingId === promotionBookingId ? paymentPromotion.promotion : null;
  const serviceNames = [...new Set([
    ...chargedServiceNames,
    ...allowedAdditionalServices,
  ])];
  const previousDiscount = selectedPaymentRow?.treatments ? 0 : regularTreatmentSummaries.filter(summary =>
    summary.appointmentId === selectedBooking?.id && summary.treatmentId !== selectedPaymentRow?.treatmentId &&
    summary.chargeBreakdown?.promotionId === promotionId
  ).reduce((sum, summary) => sum + (Number(summary.chargeBreakdown?.discountAmount) || 0), 0);
  const chargeBreakdown = calculateCharges(serviceNames.map(name => ({ name, amount: detailDraft.serviceCharges?.[name] || 0 })), promotion, previousDiscount);
  const priorPaid = isBracesInstallment ? detailBracesSummary?.amountPaid || 0 : selectedPaymentRow?.amountPaid || 0;
  const newBracesExtras = isBracesInstallment ? getUnchargedPaymentServices(allowedAdditionalServices.map((name) => ({ name })), savedBracesExtras) : [];
  const bracesExtraCharges = calculateCharges(newBracesExtras.map(({ name }) => ({ name, amount: detailDraft.serviceCharges[name] })));
  const calculatedTotal = isBracesInstallment
    ? calculateCharges([{ name: "Existing plan", amount: detailDraft.totalCost }, ...bracesExtraCharges.serviceCharges]).totalCost
    : chargeBreakdown.totalCost;
  const paymentBalance = Math.max(0, calculatedTotal - priorPaid);
  const canEditAppointmentCharge = selectedPaymentRow?.source !== "Appointment" || selectedPaymentRow.paymentReady === true;
  const hasValidAppointmentCharge = selectedPaymentRow?.source !== "Appointment" ||
    (selectedPaymentRow.paymentReady === true && chargeBreakdown.grossTotal > 0);
  const canRecordSelectedPayment = selectedPaymentRow?.source !== "Appointment" || hasValidAppointmentCharge;
  const selectedPatientTransactions = useMemo(() => {
    if (!selectedPatientRecord) return [];
    return [
      ...regularPayments
        .filter((payment) => recordMatchesPatient(payment, selectedPatientRecord))
        .map((payment) => ({ ...payment, ledgerSource: "Payment" })),
      ...bracesPayments
        .filter((payment) => recordMatchesPatient(payment, selectedPatientRecord))
        .map((payment) => ({ ...payment, ledgerSource: "Braces installment" })),
    ].sort((a, b) => paymentDateSortValue(b).localeCompare(paymentDateSortValue(a)));
  }, [bracesPayments, regularPayments, selectedPatientRecord]);
  const selectedRecordTransactions = groupBookingReceipts(selectedPatientTransactions.filter((transaction) => {
    if (isBracesInstallment) {
      return transaction.ledgerSource === "Braces installment" && transaction.accountId === selectedPaymentRow?.treatmentId;
    }
    if (transaction.ledgerSource !== "Payment") return false;
    return selectedPaymentRow?.appointmentId
      ? transaction.appointmentId === selectedPaymentRow.appointmentId
      : Boolean(selectedTreatmentId) && transaction.treatmentId === selectedTreatmentId;
  }));
  const filteredRows = useMemo(() => {
    const term = normalizeName(search);
    return [...allRows]
      .filter((row) => {
        if (!term) return true;
        return normalizeName([
          row.patientName, row.patientId, row.patientEmail, row.patientType,
          row.treatmentName, row.appointmentId, row.method, row.status, row.source,
        ].join(" ")).includes(term);
      })
      .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate));
  }, [allRows, search]);

  const tabRows = useMemo(() => {
    const matchingRows = filteredRows.filter((row) => {
      if (paymentTab === "Completed") return isFullyPaid(row);
      if (isFullyPaid(row)) return false;
      if (row.patientType !== paymentTab) return false;
      if (paymentTab === "Ortho" && !["Ortho", "Appointment"].includes(row.source)) return false;
      return true;
    });
    const uniqueRows = new Map();
    matchingRows.forEach((row) => {
      const key = paymentTab === "Ortho"
        ? row.treatmentId
        : `${row.patientId}:${row.treatmentId}`;
      if (!uniqueRows.has(key)) uniqueRows.set(key, row);
    });
    return [...uniqueRows.values()];
  }, [filteredRows, paymentTab]);

  const paymentPage = useRecordPagination(tabRows, JSON.stringify([search, paymentTab]));
  function openPatientDetails(row) {
    const names = [...new Set((row.treatmentName || "Dental treatment").split(",").map(name => name.trim()).filter(Boolean))];
    const serviceCharges = row.chargeBreakdown?.serviceCharges
      ? Object.fromEntries(row.chargeBreakdown.serviceCharges.map(line => [line.name, String(line.amount)]))
      : Object.fromEntries(names.map((name, index) => [name, index === 0 ? String(row.totalCost || "") : ""]));
    const patientRecord = row.patientRecord || {
      id: row.patientId,
      name: row.patientName,
      email: row.patientEmail || "",
      patientType: row.patientType,
      uid: row.uid || "",
    };
    setSelectedPatientId(patientRecord.id || row.patientId);
    setSelectedPatientFallback(patientRecord);
    setSelectedPaymentRowId(row.id);
    setSelectedTreatmentId(row.treatmentId);
    setDetailDraft({
      treatmentName: row.treatmentName || "",
      totalCost: String(row.totalCost || ""),
      initialBracesTotal: row.source === "Ortho" ? row.totalCost : undefined,
      amount: "",
      paymentDate: new Date().toISOString().slice(0, 10),
      referenceNumber: "",
      additionalServices: row.source !== "Ortho" && Array.isArray(row.additionalServices) ? row.additionalServices : [],
      serviceCharges,
      receiptPhotos: [],
      method: DETAIL_PAYMENT_METHODS.includes(row.method) ? row.method : "Cash",
    });
    setDetailError("");
  }

  function toggleAdditionalService(name) {
    const option = visibleAdditionalServices.find((service) => service.name === name);
    if (!option || savingDetails) return;
    const suggestedCharge = isBracesInstallment ? getStartingCharge(option.startingRate) : 0;
    setDetailDraft((current) => {
      const selected = current.additionalServices.includes(name);
      return {
        ...current,
        additionalServices: selected ? current.additionalServices.filter((service) => service !== name) : [...current.additionalServices, name],
        serviceCharges: !selected && suggestedCharge && current.serviceCharges[name] === undefined
          ? { ...current.serviceCharges, [name]: String(suggestedCharge) }
          : current.serviceCharges,
      };
    });
  }

  async function importReceiptPhotos(event) {
    const files = [...event.target.files];
    event.target.value = "";
    if (detailDraft.receiptPhotos.length + files.length > MAX_RECEIPT_PHOTOS) {
      setDetailError("Attach up to three receipt photos for this payment.");
      return;
    }
    setReceiptPhotoLoading(true);
    setDetailError("");
    try {
      const photos = await Promise.all(files.map(prepareReceiptPhoto));
      setDetailDraft(current => ({ ...current, receiptPhotos: [...current.receiptPhotos, ...photos] }));
    } catch (error) {
      setDetailError(error.message);
    } finally {
      setReceiptPhotoLoading(false);
    }
  }

  async function saveSelectedPaymentDetails(event) {
    event.preventDefault();
    if (submissionLockRef.current || receiptPhotoLoading || promotionSaving || !selectedPatientRecord || selectedPaymentCompleted || promotionLoading || promotionError) return;
    setDetailError("");
    if (!canRecordSelectedPayment) {
      setDetailError("Payment can be recorded after the dentist marks the treatment as completed and sends it to Payments, and a valid charge is available.");
      return;
    }
    const totalCost = calculatedTotal;
    const amount = detailDraft.amount === "" ? 0 : Number(detailDraft.amount);
    if (isBracesInstallment && bracesExtraCharges.serviceCharges.some((line) => line.amount <= 0)) {
      setDetailError("Enter a charge greater than zero for each selected additional service.");
      return;
    }
    if (!Number.isFinite(totalCost) || (isBracesInstallment ? totalCost <= 0 : chargeBreakdown.grossTotal <= 0)) {
      setDetailError("Enter service charges greater than zero.");
      return;
    }
    if (!Number.isFinite(amount) || amount < 0 || !detailDraft.paymentDate) {
      setDetailError("Enter a valid payment amount and date.");
      return;
    }
    if (amount > paymentBalance) {
      setDetailError("Amount received cannot exceed the outstanding balance.");
      return;
    }
    if (detailDraft.method !== "Cash" && detailDraft.receiptPhotos.length && amount <= 0) {
      setDetailError("Enter the amount received before saving receipt photos.");
      return;
    }

    submissionLockRef.current = true;
    setSavingDetails(true);
    try {
      let savedId;
      let completionWarning = "";
      if (isBracesInstallment) {
        if (!detailBracesAccount?.id) {
          throw new Error("No existing braces account is linked to this patient.");
        }
        savedId = await recordBracesPayment({
          patient: selectedPatientRecord,
          accountId: detailBracesAccount.id,
          totalCost: Number(detailDraft.totalCost),
          expectedAccountTotal: detailDraft.initialBracesTotal,
          additionalServiceCharges: bracesExtraCharges.serviceCharges,
          amount,
          paymentDate: detailDraft.paymentDate,
          referenceNumber: detailDraft.referenceNumber,
          method: detailDraft.method,
          receiptPhotos: detailDraft.method === "Cash" ? [] : detailDraft.receiptPhotos,
        });
        setDetailDraft((current) => ({ ...current, totalCost: String(totalCost), initialBracesTotal: totalCost, additionalServices: [], serviceCharges: {} }));
        await logAdminAction({
          action: amount > 0 ? "log_braces_payment" : "update_braces_account",
          targetType: amount > 0 ? "braces_payment" : "braces_account",
          targetId: savedId,
          targetLabel: selectedPatientRecord.name || "Braces account",
          details: { accountId: detailBracesAccount.id, totalCost },
        });
      } else {
        if (!selectedPatientRecord.id || !selectedPaymentRow?.treatmentId) {
          throw new Error("No existing payment treatment is linked to this patient.");
        }
        const recordPayment = selectedPaymentRow.treatments ? recordBookingPayment : recordRegularPayment;
        savedId = await recordPayment({
          patientId: selectedPatientRecord.id,
          uid: selectedPatientRecord.uid || "",
          patientName: selectedPatientRecord.name || "",
          patientEmail: selectedPatientRecord.email || "",
          patientType: selectedPatientType,
          treatmentId: selectedPaymentRow.treatmentId,
          appointmentId: selectedPaymentRow.appointmentId || "",
          treatmentName: detailDraft.treatmentName.trim(),
          totalCost,
          amount,
          paymentDate: detailDraft.paymentDate,
          referenceNumber: detailDraft.referenceNumber,
          method: detailDraft.method,
          additionalServices: allowedAdditionalServices,
          chargeBreakdown: selectedPaymentRow.treatments
            ? { ...chargeBreakdown, eligibleServiceNames: promotion?.services || [] } : chargeBreakdown,
          receiptPhotos: detailDraft.method === "Cash" ? [] : detailDraft.receiptPhotos,
          allowZeroAmount: true,
        });
        if ((amount > 0 || totalCost === 0) && selectedPaymentRow.appointmentId) {
          try {
            await COMPLETE_PAID_APPOINTMENT({ bookingId: selectedPaymentRow.appointmentId });
          } catch (error) {
            console.error("Payment was saved, but appointment completion could not be checked:", error);
            completionWarning = "Payment was saved, but appointment completion could not be verified. Contact an administrator to retry the completion check.";
          }
        }
        await logAdminAction({
          action: amount > 0 ? "log_regular_payment" : "update_payment_treatment",
          targetType: amount > 0 ? "payment" : "payment_treatment",
          targetId: savedId,
          targetLabel: selectedPatientRecord.name || "Regular treatment",
          details: { treatmentId: selectedPaymentRow.treatmentId, totalCost },
        });
      }
      setDetailDraft((current) => ({ ...current, amount: "", receiptPhotos: [], referenceNumber: "" }));
      if (completionWarning) setDetailError(completionWarning);
      else setSuccessMessage(amount > 0 ? "Payment recorded successfully. The patient’s balance and receipt have been updated." : "Payment charges saved successfully.");
    } catch (error) {
      console.error("Patient payment details could not be saved:", error);
      setDetailError(error.message || "Payment details could not be saved. Check access and try again.");
    } finally {
      submissionLockRef.current = false;
      setSavingDetails(false);
    }
  }

  return (
    <div className="container adminSurface paymentsPage">
      <SuccessDialog message={successMessage} onConfirm={() => setSuccessMessage("")} />
      {loadError ? (
        <div className="formError" role="alert">
          Payment records could not be fully loaded. {loadError}
          <button type="button" className="paymentsRetry" onClick={load} disabled={loading}>
            {loading ? <LoadingIndicator>Reloading…</LoadingIndicator> : "Try again"}
          </button>
        </div>
      ) : null}

      {selectedPatientId && selectedPatientRecord ? (
        <section id="paymentsDetailsPanel" className="paymentsDetailsPage" aria-label="Patient payment details">
          <a
            href="/admin/payments"
            className="paymentsBackLink appBackAction topdentBackAction"
            aria-label="Go back"
            onClick={(event) => {
              event.preventDefault();
              closePatientDetails();
            }}
          >
            <BackArrow />
          </a>
          <header className="paymentsDetailsPageHeader">
            <div className="paymentsDetailsIdentity">
              <div className="paymentsDetailsNameLine">
                <h1>{selectedPatientRecord.name || "Patient payment details"}</h1>
                <span className={`paymentsDetailsPageStatus ${paymentStatusLabel(selectedPaymentRow, selectedPatientType).toLowerCase()}`}>
                  {paymentStatusLabel(selectedPaymentRow, selectedPatientType)}
                </span>
              </div>
              {selectedPatientType !== "Ortho" ? (
                <p>
                  {[
                    selectedPaymentRow?.treatmentName || "Regular treatment",
                    selectedPaymentRow?.appointmentDate
                      ? formatDateLabel(selectedPaymentRow.appointmentDate)
                      : "",
                  ].filter(Boolean).join(" · ")}
                </p>
              ) : null}
            </div>
            <div className="paymentsDetailsBalance">
              <span>Outstanding balance</span>
              <strong>{selectedPaymentRow?.totalCost > 0 ? formatCurrency(selectedPaymentRow.balance) : "—"}</strong>
            </div>
          </header>

          {loadError ? (
            <div className="formError" role="alert">
              Some payment details may be unavailable because a data source failed to load: {loadError}
              <button type="button" className="paymentsRetry" onClick={load} disabled={loading}>
                {loading ? <LoadingIndicator>Reloading…</LoadingIndicator> : "Retry loading"}
              </button>
            </div>
          ) : null}
          {detailError ? <div className="formError" role="alert">{detailError}</div> : null}
          {!selectedPaymentCompleted && !canRecordSelectedPayment ? (
            <p className="paymentsDetailNote" role="status">
              This appointment is in the payment queue, but payment entry is disabled until its treatment details and charge are ready.
            </p>
          ) : null}
          {!selectedPaymentCompleted && selectedPaymentRow?.source === "Appointment" && selectedPaymentRow.paymentReady && chargeBreakdown.grossTotal <= 0 ? (
            <p className="paymentsDetailNote" role="status">Treatment is ready. Enter a valid final charge before recording payment.</p>
          ) : null}

          <div className="paymentsDetailsContent">
            <section className="paymentsDetailsFormSection" aria-label="Record a payment">
              {selectedPaymentCompleted ? (
                <>
                  <h2>Completed payment details</h2>
                  <dl className="appointmentPaymentDetails">
                    {[
                      ["Booking ID", selectedPaymentRow?.appointmentId || "Not linked"],
                      ["Appointment", selectedBooking?.date ? formatDateLabel(selectedBooking.date) : selectedPaymentRow?.appointmentDate ? formatDateLabel(selectedPaymentRow.appointmentDate) : "Not recorded"],
                      ["Time", selectedBooking?.time ? `${formatTimeLabel(selectedBooking.time)}${selectedBooking.estimatedEndTime ? ` – ${formatTimeLabel(selectedBooking.estimatedEndTime)}` : ""}` : "Not recorded"],
                      ["Service", selectedPaymentRow?.treatmentName || "Not recorded"],
                      ["Dentist", selectedBooking?.selectedDentist || selectedPaymentRow?.selectedDentist || "Not recorded"],
                      ["Booked at", selectedBooking?.createdAt ? formatTimestamp(selectedBooking.createdAt) : "Not recorded"],
                      ["Total fee", formatCurrency(selectedPaymentRow.totalCost)],
                      ["Total paid", formatCurrency(selectedPaymentRow.amountPaid)],
                      ["Balance", formatCurrency(selectedPaymentRow.balance)],
                    ].map(([label, value]) => (
                      <div className="detailRow" key={label}><dt>{label}</dt><dd>{value}</dd></div>
                    ))}
                  </dl>
                  <PaymentChargeBreakdown breakdown={selectedPaymentRow.chargeBreakdown} paid={selectedPaymentRow.amountPaid} />
                </>
              ) : (
                <>
              <h2>Record a payment</h2>
              {selectedBooking ? <BookingPromotionSelect key={selectedBooking.id} booking={selectedBooking}
                disabled={savingDetails || selectedPatientTransactions.some(payment => payment.appointmentId === selectedBooking.id) ||
                  regularTreatmentSummaries.some(summary => summary.appointmentId === selectedBooking.id && summary.chargeBreakdown?.grossTotal > 0)}
                onBusyChange={setPromotionSaving}
                onChange={promotion => setPaymentPromotion({ bookingId: selectedBooking.id, promotion, error: "" })} /> : null}
              <form className="paymentsDetailsForm" onSubmit={saveSelectedPaymentDetails}>
                <div className="paymentsDetailsFields">
                  {isBracesInstallment ? (
                  <label className="paymentsField">
                    <span>Current plan total (₱)</span>
                    <input
                      className="input"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={detailDraft.totalCost}
                      disabled={!canEditAppointmentCharge}
                      onChange={(event) => setDetailDraft((current) => ({ ...current, totalCost: event.target.value }))}
                      required
                    />
                  </label>
                  ) : serviceNames.map(name => (
                    <label className="paymentsField" key={name}>
                      <span>{name} charge (₱)</span>
                      <input className="input" type="number" min="0" step="0.01" value={detailDraft.serviceCharges?.[name] ?? ""}
                        disabled={!canEditAppointmentCharge || savingDetails}
                        onChange={event => setDetailDraft(current => ({ ...current, serviceCharges: { ...current.serviceCharges, [name]: event.target.value } }))}
                        required />
                    </label>
                  ))}
                  {isBracesInstallment ? (
                    <section className="paymentsField paymentsFieldWide paymentsChargeBreakdown" aria-label="Braces installment summary">
                      <h3>Braces installment</h3>
                      <dl className="appointmentPaymentDetails">
                        <div className="detailRow"><dt>Additional charges</dt><dd>{formatCurrency(bracesExtraCharges.totalCost)}</dd></div>
                        <div className="detailRow"><dt>Updated total</dt><dd>{formatCurrency(calculatedTotal)}</dd></div>
                        <div className="detailRow"><dt>Previously paid</dt><dd>{formatCurrency(priorPaid)}</dd></div>
                        <div className="detailRow"><dt>Balance after this payment</dt><dd>{formatCurrency(Math.max(0, paymentBalance - (Number(detailDraft.amount) || 0)))}</dd></div>
                      </dl>
                    </section>
                  ) : <div className="paymentsField paymentsFieldWide">
                    {promotionLoading ? <p><LoadingIndicator>Loading booking promotion…</LoadingIndicator></p> : promotionError ? <p className="formError" role="alert">{promotionError}</p> : <PaymentChargeBreakdown breakdown={chargeBreakdown} paid={priorPaid} received={Number(detailDraft.amount) || 0} />}
                  </div>}
                  <label className="paymentsField">
                    <span>Amount received (₱)</span>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      step="0.01"
                      max={paymentBalance}
                      value={detailDraft.amount}
                      disabled={!canRecordSelectedPayment}
                      onChange={(event) => setDetailDraft((current) => ({ ...current, amount: event.target.value }))}
                    />
                  </label>
                  <label className="paymentsField">
                    <span>Date</span>
                    <input
                      className="input"
                      type="date"
                      value={detailDraft.paymentDate}
                      disabled={!canRecordSelectedPayment}
                      onChange={(event) => setDetailDraft((current) => ({ ...current, paymentDate: event.target.value }))}
                      required
                    />
                  </label>
                  <label className="paymentsField">
                    <span>Method</span>
                    <select
                      className="input"
                      value={detailDraft.method}
                      disabled={!canRecordSelectedPayment}
                      onChange={(event) => setDetailDraft((current) => ({ ...current, method: event.target.value }))}
                    >
                      {DETAIL_PAYMENT_METHODS.map((method) => <option key={method} value={method}>{method}</option>)}
                    </select>
                  </label>
                  <label className="paymentsField">
                    <span>Reference Number (optional)</span>
                    <input
                      className="input"
                      type="text"
                      maxLength={100}
                      value={detailDraft.referenceNumber}
                      disabled={!canRecordSelectedPayment}
                      onChange={(event) =>
                        setDetailDraft((current) => ({
                          ...current,
                          referenceNumber: event.target.value.slice(0, 100),
                        }))
                      }
                    />
                  </label>
                  {detailDraft.method !== "Cash" ? (
                    <div className="paymentsField paymentsFieldWide">
                      <label className="paymentsField">
                        <span>Receipt photos (optional, up to 3)</span>
                        <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={importReceiptPhotos}
                          disabled={receiptPhotoLoading || savingDetails || !canRecordSelectedPayment} />
                      </label>
                      {receiptPhotoLoading ? <p><LoadingIndicator>Preparing receipt photos…</LoadingIndicator></p> : null}
                      <div className="paymentsReceiptPhotos">
                        {detailDraft.receiptPhotos.map((photo, index) => (
                          <figure key={`${photo.name}-${index}`}>
                            <img src={photo.dataUrl} alt={`Receipt preview: ${photo.name}`} />
                            <figcaption>{photo.name}</figcaption>
                            <button type="button" className="btn secondary" disabled={savingDetails || receiptPhotoLoading}
                              onClick={() => setDetailDraft(current => ({ ...current, receiptPhotos: current.receiptPhotos.filter((_, photoIndex) => photoIndex !== index) }))}>Remove photo</button>
                          </figure>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="paymentsField paymentsFieldWide paymentsAdditionalServiceField">
                    {hasBracesPackage ? <div className="bookingBracesPackageDetails"><div><strong>Package Inclusions</strong><ul>{BRACES_PACKAGE_INCLUSIONS.map((inclusion) => <li key={inclusion}>{inclusion}</li>)}</ul></div></div> : null}
                    <span>Additional Services</span>
                    {savedBracesExtras.length ? <small>Previously listed on this account: {savedBracesExtras.join(", ")}</small> : null}
                    <div className="paymentsAdditionalServiceOptions" role="group" aria-label="Additional Service">
                      {otherAdditionalServices.length ? otherAdditionalServices.map((service) => (
                        <label className="paymentsAdditionalServiceOption" key={service}>
                          <input
                            type="checkbox"
                            value={service}
                            checked={detailDraft.additionalServices.includes(service)}
                            disabled={!canRecordSelectedPayment || savingDetails}
                            onChange={() => toggleAdditionalService(service)}
                          />
                          {service}
                        </label>
                      )) : !visibleAdditionalServices.length ? <span className="paymentsAdditionalServiceEmpty">No additional services available.</span> : null}
                    </div>
                    <BookingCrownPicker options={visibleAdditionalServices} selectedServices={allowedAdditionalServices} serviceLimit={Infinity}
                      disabled={!canRecordSelectedPayment || savingDetails} onToggle={(crown) => toggleAdditionalService(crown.name)} />
                  </div>
                  {newBracesExtras.map(({ name }) => (
                    <label className="paymentsField" key={name}>
                      <span>{name} charge (₱)</span>
                      <input className="input" type="number" min="0.01" step="0.01" required disabled={savingDetails}
                        value={detailDraft.serviceCharges[name] ?? ""}
                        onChange={(event) => setDetailDraft((current) => ({ ...current, serviceCharges: { ...current.serviceCharges, [name]: event.target.value } }))} />
                    </label>
                  ))}
                </div>
                <footer className="paymentsDetailsActions">
                  <button type="submit" className="btn btnPrimary" disabled={savingDetails || receiptPhotoLoading || promotionSaving || promotionLoading || Boolean(promotionError) || !canRecordSelectedPayment}>
                    {savingDetails ? <LoadingIndicator>Updating…</LoadingIndicator> : "Update"}
                  </button>
                  <button type="button" className="btn secondary" onClick={closePatientDetails} disabled={savingDetails || receiptPhotoLoading}>Cancel</button>
                </footer>
              </form>
                </>
              )}
            </section>

            <section className="paymentsDetailsHistory" aria-label="Payment history">
              <h2>Payment history</h2>
              <div className="paymentsInlineHistoryTableWrap">
                <table className="paymentsInlineHistoryTable">
                  <thead><tr><th>Date</th><th>Method</th><th>Reference</th><th>Amount</th></tr></thead>
                  <tbody>
                    <PaginatedRecords items={selectedRecordTransactions} tableColumns={4} resetKey={selectedPaymentRow?.appointmentId || selectedTreatmentId} label="payments">{(transaction) => (
                        <tr key={`${transaction.ledgerSource}:${transaction.id}`}>
                          <td>{paymentDateSortValue(transaction) ? formatDateLabel(paymentDateSortValue(transaction)) : "—"}</td>
                          <td>{transaction.method || transaction.paymentMethod || "—"}</td>
                          <td>{transaction.referenceNumber || "—"}</td>
                          <td>{formatCurrency(transaction.amount ?? transaction.paid)}</td>
                        </tr>
                      )}</PaginatedRecords>
                  </tbody>
                </table>
                {!selectedRecordTransactions.length ? (
                  <p className="paymentsDetailNote">No payment history is recorded for this booking or treatment.</p>
                ) : null}
              </div>
              <PaymentReceipts payments={selectedRecordTransactions} patientName={selectedPatientRecord.name} booking={selectedBooking} />
            </section>
          </div>
        </section>
      ) : (
      <section className="paymentsListCard" aria-label="Centralized payment records">
        <nav className="paymentsTabs" aria-label="Payment account type">
          {["Ortho", "Regular", "Completed"].map((tab) => (
            <button
              key={tab}
              type="button"
              className={`paymentsTab${paymentTab === tab ? " active" : ""}`}
              aria-current={paymentTab === tab ? "page" : undefined}
              onClick={() => setPaymentTab(tab)}
            >
              {tab}
            </button>
          ))}
        </nav>
        <div className="paymentsToolbar">
          <label className="paymentsSearch adminSearchField">
            <span className="srOnly">Search payments</span>
            <svg className="adminSearchIcon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              className="input"
              aria-label="Search payments by patient, treatment, appointment, or method"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search payment records"
            />
          </label>
        </div>

        {loading ? <SkeletonList count={4} label="Loading payments…" /> : loadError ? (
          <EmptyState title="Payment records are incomplete" message="One or more payment data sources failed to load. Use Try again to reload before relying on these totals." />
        ) : tabRows.length ? (
          <div className="paymentsTableWrap">
            <table className={`paymentsTable paymentsTable${paymentTab}`}>
              {paymentTab === "Ortho" ? (
                <thead>
                  <tr>
                    <th>Patient</th>
                    <th>Type of Braces</th>
                    <th>Balance</th>
                    <th>Method</th>
                    <th>Status</th>
                  </tr>
                </thead>
              ) : paymentTab === "Regular" ? (
                <thead>
                  <tr><th>Patient</th><th>Treatment</th><th>Balance</th><th>Method</th><th>Status</th></tr>
                </thead>
              ) : (
                <thead>
                  <tr><th>Patient</th><th>Type</th><th>Plan</th><th>Total Paid</th><th>Method</th><th>Status</th></tr>
                </thead>
              )}
              <tbody>
                {paymentPage.items.map((row) => (
                  <tr
                    key={row.id}
                    className="paymentsClickableRow"
                    tabIndex={0}
                    onClick={() => openPatientDetails(row)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openPatientDetails(row);
                      }
                    }}
                  >
                    <td data-label="Patient">
                      <button
                        type="button"
                        className="paymentsPatientLink"
                        aria-expanded={selectedPaymentRowId === row.id && Boolean(selectedPatientId)}
                        aria-controls="paymentsDetailsPanel"
                      >
                        {row.patientName}
                      </button>
                      {row.appointmentDate ? <small className="paymentsBookingDate">{formatDateLabel(row.appointmentDate)}</small> : null}
                    </td>
                    {paymentTab === "Ortho" ? (
                      <>
                        <td data-label="Type of Braces">
                          {formatPatientBracesType(row.patientRecord?.bracesType) ||
                            formatPatientBracesType(row.bracesType) ||
                            formatPatientBracesType(row.account?.bracesType) ||
                            "—"}
                        </td>
                        <td data-label="Balance">{row.totalCost > 0 ? formatCurrency(row.balance) : "—"}</td>
                        <td data-label="Method">{row.method || "—"}</td>
                        <td data-label="Status">{paymentStatusLabel(row, "Ortho")}</td>
                      </>
                    ) : paymentTab === "Regular" ? (
                      <>
                        <td data-label="Treatment">{row.treatmentName || "—"}{row.treatments && !row.allPriced ? <small className="paymentsBookingDate">Some service charges still need to be entered</small> : null}</td>
                        <td data-label="Balance">{row.totalCost > 0 ? formatCurrency(row.balance) : "—"}</td>
                        <td data-label="Method">{row.method || "—"}</td>
                        <td data-label="Status">{paymentStatusLabel(row, "Regular")}</td>
                      </>
                    ) : (
                      <>
                        <td data-label="Type">{row.patientType}</td>
                        <td data-label="Plan">
                          {row.patientType === "Ortho"
                            ? [row.bracesType, row.planLabel].filter((value) => value && value !== "—").join(" · ") || "—"
                            : row.treatmentName || "—"}
                        </td>
                        <td data-label="Total Paid">{formatCurrency(row.amountPaid)}</td>
                        <td data-label="Method">{row.method || "—"}</td>
                        <td data-label="Status">Completed</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
              <RecordPagination pagination={paymentPage} />
          </div>
        ) : (
          <EmptyState
            title={paymentTab === "Completed" ? "No completed accounts" : `No ${paymentTab.toLowerCase()} accounts`}
            message={allRows.length ? "Adjust your search to see payment records." : "Recorded regular payments and braces installments will appear here."}
          />
        )}
      </section>
      )}

    </div>
  );
}
