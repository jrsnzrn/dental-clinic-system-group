import {
  buildBracesAccount,
  getBracesAccountForPatient,
  getBracesPaymentsForPatient,
} from "./braces";

const MANILA_TIME_ZONE = "Asia/Manila";

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
  if (value instanceof Date) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toManilaDateKey(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  const date = toDate(value);
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const getPart = (type) => parts.find((entry) => entry.type === type)?.value || "";
  return `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
}

export function getManilaToday() {
  return toManilaDateKey(new Date());
}

function shiftDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function monthEnd(year, month) {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

export function getReportDateRange({ period, dailyDate, weekDate, month, year, startDate, endDate }) {
  if (period === "daily") {
    return dailyDate ? { start: dailyDate, end: dailyDate } : null;
  }
  if (period === "weekly") {
    if (!weekDate) return null;
    const weekday = new Date(`${weekDate}T00:00:00Z`).getUTCDay();
    const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
    const start = shiftDateKey(weekDate, mondayOffset);
    return { start, end: shiftDateKey(start, 6) };
  }
  if (period === "monthly") {
    if (!/^\d{4}-\d{2}$/.test(month || "")) return null;
    const [monthYear, monthNumber] = month.split("-").map(Number);
    if (monthNumber < 1 || monthNumber > 12) return null;
    return {
      start: `${month}-01`,
      end: monthEnd(monthYear, monthNumber),
    };
  }
  if (period === "yearly") {
    const selectedYear = Number(year);
    if (!Number.isInteger(selectedYear) || selectedYear < 1900 || selectedYear > 9999) return null;
    return { start: `${selectedYear}-01-01`, end: `${selectedYear}-12-31` };
  }
  if (period === "custom" && startDate && endDate && startDate <= endDate) {
    return { start: startDate, end: endDate };
  }
  return null;
}

export function formatReportDate(value) {
  const dateKey = toManilaDateKey(value);
  if (!dateKey) return "—";
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: MANILA_TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day, 4)));
}

export function formatReportTime(value) {
  if (!value) return "—";
  const match = String(value).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return String(value);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return String(value);
  return new Intl.DateTimeFormat("en-PH", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: MANILA_TIME_ZONE,
  }).format(new Date(Date.UTC(2020, 0, 1, hour - 8, minute)));
}

export function formatReportPeriod(range) {
  if (!range) return "Select a valid reporting period";
  if (range.start === range.end) return formatReportDate(range.start);
  return `${formatReportDate(range.start)} – ${formatReportDate(range.end)}`;
}

function isInRange(value, range) {
  const key = toManilaDateKey(value);
  return Boolean(key && range && key >= range.start && key <= range.end);
}

function bookingDate(booking) {
  return booking.date || booking.appointmentAt || "";
}

function treatmentCompletionDate(booking) {
  return booking.treatmentCompletedAt || booking.completedAt || booking.date || "";
}

export function isTreatmentComplete(booking) {
  const status = normalizeText(booking.status).replace(/[\s-]+/g, "_");
  return status === "completed" ||
    (status === "pending_payment" && Boolean(booking.treatmentCompletedAt));
}

function bookingStatusLabel(booking) {
  const status = normalizeText(booking.status).replace(/[\s-]+/g, "_");
  if (status === "approved" && booking.checkedInAt) return "Checked-in";
  if (status === "pending_payment" && booking.treatmentCompletedAt) return "Treatment complete · Pending payment";
  if (status === "pending_payment") return "Pending payment";
  if (status === "no_show") return "No-show";
  if (status === "checked_in") return "Checked-in";
  return status ? status.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Unknown";
}

function getBookingServices(booking) {
  const services = Array.isArray(booking.services) && booking.services.length
    ? booking.services
    : String(booking.service || "").split(",");
  const unique = new Map();
  services.forEach((value) => {
    const name = typeof value === "string" ? value.trim() : String(value?.name || "").trim();
    const key = normalizeText(name);
    if (key && !unique.has(key)) unique.set(key, name);
  });
  return [...unique.values()];
}

function appointmentPatientMatch(booking, patient) {
  const patientIds = [patient.id, patient.uid].filter(Boolean);
  const bookingIds = [
    booking.patientProfileId,
    booking.patientId,
    booking.uid,
  ].filter(Boolean);
  if (bookingIds.some((id) => patientIds.includes(id))) return true;
  if (
    booking.email && patient.email &&
    normalizeText(booking.email) === normalizeText(patient.email)
  ) return true;
  return Boolean(
    (booking.fullName || booking.patientKey) &&
    patient.name &&
    normalizeText(booking.fullName || booking.patientKey) === normalizeText(patient.name)
  );
}

function recordPatientMatch(record, patient) {
  const recordIds = [record.patientId, record.uid].filter(Boolean);
  const patientIds = [patient.id, patient.uid].filter(Boolean);
  if (recordIds.some((id) => patientIds.includes(id))) return true;
  const recordEmail = record.patientEmail || record.email;
  if (recordEmail && patient.email && normalizeText(recordEmail) === normalizeText(patient.email)) return true;
  const recordName = record.patientName || record.fullName || record.name;
  return Boolean(recordName && patient.name && normalizeText(recordName) === normalizeText(patient.name));
}

function patientType(patient, fallback = "") {
  return normalizeText(patient?.patientType || fallback).includes("ortho") ? "Ortho" : "Regular";
}

function getAppointmentStatusCounts(bookings) {
  return bookings.reduce((counts, booking) => {
    const status = normalizeText(booking.status).replace(/[\s-]+/g, "_");
    if (isTreatmentComplete(booking)) counts.completed += 1;
    else if (["pending", "approved"].includes(status)) counts.pending += 1;
    else if (status === "cancelled") counts.cancelled += 1;
    else if (status === "no_show") counts.noShow += 1;
    return counts;
  }, { completed: 0, pending: 0, cancelled: 0, noShow: 0 });
}

export function buildAppointmentsReport({
  bookings = [],
  patients = [],
  dentists = [],
  range,
}) {
  const activeBookings = bookings.filter((booking) => booking.archiveStatus !== "Archived");
  const entries = activeBookings.filter((booking) => isInRange(bookingDate(booking), range));
  const counts = getAppointmentStatusCounts(entries);
  const rows = entries.map((booking) => {
    const patient = patients.find((entry) => appointmentPatientMatch(booking, entry));
    const dentist = dentists.find((entry) =>
      (booking.dentistId && booking.dentistId === entry.id) ||
      (!booking.dentistId && booking.dentistStaffUid && booking.dentistStaffUid === entry.linkedStaffUid) ||
      (!booking.dentistId && !booking.dentistStaffUid &&
        normalizeText(booking.selectedDentist || booking.assignedDentistName || booking.dentistName) === normalizeText(entry.name))
    );
    return {
      id: booking.id,
      patientId: patient?.id || booking.patientProfileId || booking.patientId || booking.uid || "",
      date: toManilaDateKey(bookingDate(booking)),
      patientName: patient?.name || booking.fullName || "Patient",
      service: getBookingServices(booking).join(", ") || "—",
      dentist: dentist?.name || booking.selectedDentist || "—",
      time: booking.time || "—",
      status: bookingStatusLabel(booking),
      sortDate: toManilaDateKey(bookingDate(booking)),
    };
  });
  return {
    cards: [
      { label: "Total Appointments", value: entries.length },
      { label: "Completed", value: counts.completed },
      { label: "Pending", value: counts.pending },
      { label: "Cancelled", value: counts.cancelled },
      { label: "No-show", value: counts.noShow },
    ],
    columns: [
      { key: "date", label: "Date", sortKey: "sortDate", render: (row) => formatReportDate(row.date) },
      { key: "patientName", label: "Patient Name" },
      { key: "service", label: "Service" },
      { key: "dentist", label: "Dentist" },
      { key: "time", label: "Appointment Time", render: (row) => formatReportTime(row.time) },
      { key: "status", label: "Status" },
    ],
    rows,
  };
}

export function buildPatientsReport({
  bookings = [],
  patients = [],
  range,
  today = getManilaToday(),
}) {
  const activePatients = patients.filter((patient) => patient.status !== "Archived");
  const activeBookings = bookings.filter((booking) => booking.archiveStatus !== "Archived");
  const periodPatients = activePatients
    .filter((patient) => isInRange(patient.createdAt || patient.registeredAt, range))
    .map((patient) => {
      const history = activeBookings.filter((booking) => appointmentPatientMatch(booking, patient));
      const appointmentsInPeriod = history.filter((booking) => isInRange(bookingDate(booking), range));
      const completedVisits = history
        .filter((booking) => {
          const visitDate = toManilaDateKey(treatmentCompletionDate(booking));
          return isTreatmentComplete(booking) && visitDate && visitDate <= today;
        })
        .sort((left, right) =>
          toManilaDateKey(treatmentCompletionDate(right))
            .localeCompare(toManilaDateKey(treatmentCompletionDate(left)))
        );
      return {
        id: patient.id,
        patientId: patient.id,
        patientName: patient.name || "Patient",
        patientType: patientType(patient),
        phone: patient.phone || "",
        dateRegistered: toManilaDateKey(patient.createdAt || patient.registeredAt),
        totalAppointments: appointmentsInPeriod.length,
        lastVisit: completedVisits.length
          ? toManilaDateKey(treatmentCompletionDate(completedVisits[0]))
          : "",
      };
    });
  const regular = periodPatients.filter((patient) => patient.patientType === "Regular").length;
  const ortho = periodPatients.filter((patient) => patient.patientType === "Ortho").length;
  return {
    cards: [
      { label: "Total Patients", value: activePatients.length },
      { label: "New Patients", value: periodPatients.length },
      { label: "Regular Patients", value: regular },
      { label: "Ortho Patients", value: ortho },
    ],
    columns: [
      { key: "patientId", label: "Patient ID" },
      { key: "patientName", label: "Patient Name" },
      { key: "patientType", label: "Patient Type" },
      { key: "phone", label: "Contact Number" },
      { key: "dateRegistered", label: "Date Registered", render: (row) => formatReportDate(row.dateRegistered) },
      { key: "totalAppointments", label: "Total Appointments", type: "number" },
      { key: "lastVisit", label: "Last Visit", render: (row) => row.lastVisit ? formatReportDate(row.lastVisit) : "—" },
    ],
    rows: periodPatients,
  };
}

function paymentDate(payment) {
  return payment.paymentDate || payment.date || payment.paidAt || payment.createdAt || "";
}

function paymentAmount(payment) {
  const amount = Number(payment.amount ?? payment.paid);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function paymentTotal(payment) {
  const amount = Number(payment.totalCost ?? payment.cost ?? payment.total);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function paymentMatchesSummary(payment, summary) {
  if (payment.treatmentId !== summary.treatmentId) return false;
  const paymentIds = [payment.patientId, payment.uid].filter(Boolean);
  const summaryIds = [summary.patientId, summary.uid].filter(Boolean);
  return !paymentIds.length || !summaryIds.length || paymentIds.some((id) => summaryIds.includes(id));
}

function createPaymentRow({
  id,
  date,
  patientId,
  patientName,
  dentist,
  patientType: type,
  treatment,
  amount,
  amountPaid,
  collectedInPeriod,
  remainingBalance,
  method,
  status,
  source,
}) {
  return {
    id,
    date,
    patientId: patientId || "",
    patientName: patientName || "Patient",
    dentist: dentist || "",
    patientType: type,
    treatment: treatment || "Dental treatment",
    amount: Number(amount) || 0,
    amountPaid: Number(amountPaid) || 0,
    collectedInPeriod: Number(collectedInPeriod) || 0,
    remainingBalance: Number(remainingBalance) || 0,
    method: method || "—",
    status,
    source,
  };
}

function paymentStatus(total, paid) {
  if (total > 0 && paid + 0.005 >= total) return "Paid";
  if (paid > 0) return "Partially Paid";
  return "Pending";
}

function paymentRowSortDate(row) {
  return row.date || "";
}

function resolveBracesAccountPayments(account, patients, bracesPayments) {
  const patient = patients.find((entry) => getBracesAccountForPatient([account], entry)) || {
    id: account.patientId || account.id,
    uid: account.uid || "",
    name: account.patientName || "",
    phone: account.patientPhone || account.phone || "",
  };
  const payments = bracesPayments.filter((payment) => (
    payment.accountId
      ? payment.accountId === account.id
      : getBracesPaymentsForPatient([payment], patient, account).length > 0
  ));
  return {
    patient,
    payments,
  };
}

export function buildPaymentsReport({
  payments = [],
  summaries = [],
  bracesAccounts = [],
  bracesPayments = [],
  patients = [],
  bookings = [],
  range,
}) {
  const rows = [];
  const matchedRegularTransactionIds = new Set();

  summaries.forEach((summary) => {
    const booking = bookings.find((entry) => entry.id === summary.appointmentId);
    const paymentReady = !summary.appointmentId || !booking ||
      (["pending_payment", "completed"].includes(normalizeText(booking.status)) &&
        Boolean(String(summary.treatmentName || summary.procedureName || "").trim()));
    if (!paymentReady) return;

    const linkedPayments = payments.filter((payment) => paymentMatchesSummary(payment, summary));
    linkedPayments.forEach((payment) => matchedRegularTransactionIds.add(payment.id));
    const paidFromLedger = linkedPayments.reduce((total, payment) => total + paymentAmount(payment), 0);
    const total = Number(summary.totalCost) > 0 ? Number(summary.totalCost) : 0;
    const paid = Math.max(Number(summary.amountPaid) || 0, paidFromLedger);
    const balance = Math.max(0, total - paid);
    const periodPayments = linkedPayments.filter((payment) => isInRange(paymentDate(payment), range));
    const attributionDate = booking?.date || summary.appointmentDate || summary.createdAt || "";
    if (!isInRange(attributionDate, range) && !periodPayments.length) return;

    const patient = patients.find((entry) => recordPatientMatch(summary, entry)) ||
      (booking && patients.find((entry) => appointmentPatientMatch(booking, entry)));
    const latestPeriodPayment = [...periodPayments].sort((left, right) =>
      toManilaDateKey(paymentDate(right)).localeCompare(toManilaDateKey(paymentDate(left)))
    )[0];
    const row = createPaymentRow({
      id: `regular-${summary.id}`,
      date: latestPeriodPayment ? paymentDate(latestPeriodPayment) : attributionDate,
      patientId: patient?.id || summary.patientId || summary.uid,
      patientName: patient?.name || summary.patientName || booking?.fullName,
      dentist: booking?.selectedDentist || summary.selectedDentist,
      patientType: patientType(patient, summary.patientType),
      treatment: summary.treatmentName || summary.procedureName ||
        getBookingServices(booking || {}).join(", "),
      amount: total,
      amountPaid: paid,
      collectedInPeriod: periodPayments.reduce((sum, payment) => sum + paymentAmount(payment), 0),
      remainingBalance: balance,
      method: latestPeriodPayment?.method || latestPeriodPayment?.paymentMethod,
      status: paymentStatus(total, paid),
      source: "Regular treatment",
    });
    rows.push(row);
  });

  const orphanRegularGroups = new Map();
  payments.filter((payment) => !matchedRegularTransactionIds.has(payment.id)).forEach((payment) => {
    const patient = patients.find((entry) => recordPatientMatch(payment, entry));
    const key = `${payment.treatmentId || payment.appointmentId || payment.id}:${payment.patientId || payment.uid || patient?.id || ""}`;
    const group = orphanRegularGroups.get(key) || {
      id: key,
      patient,
      payments: [],
    };
    group.payments.push(payment);
    orphanRegularGroups.set(key, group);
  });
  orphanRegularGroups.forEach((group) => {
    const periodPayments = group.payments.filter((payment) => isInRange(paymentDate(payment), range));
    if (!periodPayments.length) return;
    const total = group.payments.reduce((maximum, payment) => Math.max(maximum, paymentTotal(payment)), 0);
    const paid = group.payments.reduce((sum, payment) => sum + paymentAmount(payment), 0);
    const latest = [...periodPayments].sort((left, right) =>
      toManilaDateKey(paymentDate(right)).localeCompare(toManilaDateKey(paymentDate(left)))
    )[0];
    rows.push(createPaymentRow({
      id: `legacy-regular-${group.id}`,
      date: paymentDate(latest),
      patientId: group.patient?.id || latest.patientId || latest.uid,
      patientName: group.patient?.name || latest.patientName || latest.fullName,
      dentist: latest.selectedDentist,
      patientType: patientType(group.patient, latest.patientType),
      treatment: latest.treatmentName || latest.service || "Dental treatment",
      amount: total,
      amountPaid: paid,
      collectedInPeriod: periodPayments.reduce((sum, payment) => sum + paymentAmount(payment), 0),
      remainingBalance: Math.max(0, total - paid),
      method: latest.method || latest.paymentMethod,
      status: paymentStatus(total, paid),
      source: "Regular treatment",
    }));
  });

  const matchedBracesPaymentIds = new Set();
  bracesAccounts.forEach((account) => {
    const { patient, payments: accountPayments } = resolveBracesAccountPayments(
      account,
      patients,
      bracesPayments
    );
    const uniquePayments = accountPayments.filter((payment) => !matchedBracesPaymentIds.has(payment.id));
    uniquePayments.forEach((payment) => matchedBracesPaymentIds.add(payment.id));
    const summary = buildBracesAccount(account, uniquePayments);
    const periodPayments = uniquePayments.filter((payment) => isInRange(paymentDate(payment), range));
    const latestPayment = [...periodPayments].sort((left, right) =>
      toManilaDateKey(paymentDate(right)).localeCompare(toManilaDateKey(paymentDate(left)))
    )[0];
    const attributionDate = account.startDate || account.createdAt || "";
    if (!isInRange(attributionDate, range) && !periodPayments.length) return;
    rows.push(createPaymentRow({
      id: `braces-${account.id}`,
      date: latestPayment ? paymentDate(latestPayment) : attributionDate,
      patientId: patient?.id || account.patientId || account.id,
      patientName: patient?.name || account.patientName,
      patientType: "Ortho",
      treatment: [account.bracesType, "Braces treatment"].filter(Boolean).join(" · "),
      amount: summary.totalCost,
      amountPaid: summary.amountPaid,
      collectedInPeriod: periodPayments.reduce((sum, payment) => sum + paymentAmount(payment), 0),
      remainingBalance: summary.remainingBalance,
      method: latestPayment?.method || latestPayment?.paymentMethod,
      status: paymentStatus(summary.totalCost, summary.amountPaid),
      source: "Orthodontic account",
    }));
  });

  const orphanBracesGroups = new Map();
  bracesPayments.filter((payment) => !matchedBracesPaymentIds.has(payment.id)).forEach((payment) => {
    const key = payment.accountId || payment.patientId || payment.uid || payment.id;
    const group = orphanBracesGroups.get(key) || { id: key, payments: [] };
    group.payments.push(payment);
    orphanBracesGroups.set(key, group);
  });
  orphanBracesGroups.forEach((group) => {
    const periodPayments = group.payments.filter((payment) => isInRange(paymentDate(payment), range));
    if (!periodPayments.length) return;
    const latest = [...periodPayments].sort((left, right) =>
      toManilaDateKey(paymentDate(right)).localeCompare(toManilaDateKey(paymentDate(left)))
    )[0];
    const paid = group.payments.reduce((total, payment) => total + paymentAmount(payment), 0);
    const total = group.payments.reduce((maximum, payment) => Math.max(maximum, paymentTotal(payment)), 0);
    const patient = patients.find((entry) => recordPatientMatch(latest, entry));
    rows.push(createPaymentRow({
      id: `legacy-braces-${group.id}`,
      date: paymentDate(latest),
      patientId: patient?.id || latest.patientId || latest.uid,
      patientName: patient?.name || latest.patientName,
      patientType: "Ortho",
      treatment: "Braces treatment",
      amount: total,
      amountPaid: paid,
      collectedInPeriod: periodPayments.reduce((sum, payment) => sum + paymentAmount(payment), 0),
      remainingBalance: Math.max(0, total - paid),
      method: latest.method || latest.paymentMethod,
      status: paymentStatus(total, paid),
      source: "Orthodontic account",
    }));
  });

  const collections = [...payments, ...bracesPayments]
    .filter((payment) => isInRange(paymentDate(payment), range))
    .reduce((sum, payment) => sum + paymentAmount(payment), 0);
  const ongoingOrthoPayments = rows.filter((row) =>
    row.source === "Orthodontic account" && row.remainingBalance > 0.005
  ).length;
  const completedPayments = rows.filter((row) => row.status === "Paid").length;
  const pendingPayments = rows.filter((row) => row.status === "Pending").length;

  return {
    cards: [
      { label: "Total Collections", value: collections, format: "currency" },
      { label: "Pending Payments", value: pendingPayments },
      { label: "Ongoing Ortho Payments", value: ongoingOrthoPayments },
      { label: "Completed Payments", value: completedPayments },
    ],
    columns: [
      { key: "date", label: "Date", sortKey: "sortDate", render: (row) => formatReportDate(row.date) },
      { key: "patientName", label: "Patient Name" },
      { key: "source", label: "Payment Type" },
      { key: "treatment", label: "Treatment / Particulars" },
      { key: "amount", label: "Amount", type: "currency" },
      { key: "amountPaid", label: "Amount Paid", type: "currency" },
      { key: "collectedInPeriod", label: "Collected in Period", type: "currency" },
      { key: "remainingBalance", label: "Remaining Balance", type: "currency" },
      { key: "method", label: "Payment Method" },
      { key: "status", label: "Payment Status" },
    ],
    rows: rows.map((row) => ({ ...row, sortDate: paymentRowSortDate(row) })),
  };
}

function bookingIsCancelled(booking) {
  return normalizeText(booking.status).replace(/[\s-]+/g, "_") === "cancelled";
}

function bookingAssignedDentist(booking, dentists) {
  if (booking.dentistId) return dentists.find((dentist) => dentist.id === booking.dentistId) || null;
  if (booking.dentistStaffUid) {
    return dentists.find((dentist) => dentist.linkedStaffUid === booking.dentistStaffUid) || null;
  }
  const selectedName = normalizeText(
    booking.selectedDentist || booking.assignedDentistName || booking.dentistName
  );
  return selectedName ? dentists.find((dentist) => normalizeText(dentist.name) === selectedName) || null : null;
}

function bookingIsPending(booking) {
  const status = normalizeText(booking.status).replace(/[\s-]+/g, "_");
  return status === "pending" || status === "approved";
}

export function buildServicesReport({
  bookings = [],
  services = [],
  range,
}) {
  const serviceMap = new Map();
  services.forEach((service) => {
    const name = String(service.name || "").trim();
    const key = normalizeText(name);
    if (key) serviceMap.set(key, {
      id: service.id || key,
      name,
      active: service.active !== false,
      bookings: 0,
      completedTreatments: 0,
    });
  });

  bookings
    .filter((booking) => isInRange(bookingDate(booking), range) && !bookingIsCancelled(booking))
    .forEach((booking) => {
      const bookedServices = getBookingServices(booking);
      bookedServices.forEach((name) => {
        const key = normalizeText(name);
        const entry = serviceMap.get(key) || {
          id: key,
          name,
          active: false,
          bookings: 0,
          completedTreatments: 0,
        };
        entry.bookings += 1;
        serviceMap.set(key, entry);
      });

      if (!isTreatmentComplete(booking) || !isInRange(treatmentCompletionDate(booking), range)) return;
      const performed = Array.isArray(booking.completedProcedures) && booking.completedProcedures.length
        ? booking.completedProcedures.map((procedure) => String(procedure?.name || "").trim()).filter(Boolean)
        : bookedServices;
      performed.forEach((name) => {
        const entry = serviceMap.get(normalizeText(name));
        if (entry) entry.completedTreatments += 1;
      });
    });

  const allRows = [...serviceMap.values()]
    .map((service) => ({ ...service }))
    .sort((left, right) => right.bookings - left.bookings || left.name.localeCompare(right.name));
  const totalServiceSelections = allRows.reduce((total, service) => total + service.bookings, 0);
  const rows = allRows.map((service, index) => ({
    ...service,
    rank: index + 1,
    percentage: totalServiceSelections
      ? (service.bookings / totalServiceSelections) * 100
      : 0,
  }));
  const mostRequested = rows[0]?.bookings ? rows[0].name : "—";
  return {
    cards: [
      { label: "Total Services", value: services.length },
      { label: "Most Requested Service", value: mostRequested },
      { label: "Total Treatments", value: rows.reduce((total, service) => total + service.completedTreatments, 0) },
      { label: "Service Distribution", value: rows.filter((service) => service.bookings > 0).length },
    ],
    chart: rows.filter((service) => service.bookings > 0).slice(0, 8),
    columns: [
      { key: "rank", label: "Rank", type: "number" },
      { key: "name", label: "Service Name" },
      { key: "bookings", label: "Bookings", type: "number" },
      { key: "completedTreatments", label: "Completed Treatments", type: "number" },
      { key: "percentage", label: "Share of Total", type: "percentage", render: (row) => `${row.percentage.toFixed(1)}%` },
    ],
    rows,
  };
}

function completionInRange(booking, range) {
  return isTreatmentComplete(booking) && isInRange(treatmentCompletionDate(booking), range);
}

export function buildDentistsReport({
  bookings = [],
  dentists = [],
  range,
}) {
  const activeDentists = dentists.filter((dentist) =>
    dentist.archiveStatus !== "Archived" && dentist.active !== false
  );
  const rows = activeDentists.map((dentist) => {
    const assignedBookings = bookings.filter((booking) =>
      booking.archiveStatus !== "Archived" &&
      bookingAssignedDentist(booking, dentists)?.id === dentist.id
    );
    const appointments = assignedBookings.filter((booking) => isInRange(bookingDate(booking), range));
    const completedTreatments = assignedBookings.filter((booking) => completionInRange(booking, range)).length;
    const pendingAppointments = appointments.filter((booking) => bookingIsPending(booking)).length;
    const cancelledAppointments = appointments.filter((booking) => bookingIsCancelled(booking)).length;
    const assignedPatients = new Set(appointments.map((booking) =>
      booking.patientProfileId || booking.patientId || booking.uid || booking.email || booking.fullName
    ).filter(Boolean)).size;
    return {
      id: dentist.id,
      dentistId: dentist.id,
      name: dentist.name || "Dentist",
      totalAppointments: appointments.length,
      assignedPatients,
      completedTreatments,
      pendingAppointments,
      cancelledAppointments,
      activeTreatments: pendingAppointments,
      otherAppointments: Math.max(
        0,
        appointments.length - completedTreatments - pendingAppointments - cancelledAppointments
      ),
    };
  });
  const assignedPatientIds = new Set(bookings
    .filter((booking) =>
      booking.archiveStatus !== "Archived" &&
      isInRange(bookingDate(booking), range) &&
      activeDentists.some((dentist) => bookingAssignedDentist(booking, dentists)?.id === dentist.id)
    )
    .map((booking) => booking.patientProfileId || booking.patientId || booking.uid || booking.email || booking.fullName)
    .filter(Boolean));
  return {
    cards: [
      { label: "Total Dentists", value: activeDentists.length },
      { label: "Assigned Patients", value: assignedPatientIds.size },
      { label: "Completed Treatments", value: rows.reduce((total, dentist) => total + dentist.completedTreatments, 0) },
      { label: "Active Treatments", value: rows.reduce((total, dentist) => total + dentist.activeTreatments, 0) },
    ],
    columns: [
      { key: "name", label: "Dentist Name" },
      { key: "assignedPatients", label: "Assigned Patients", type: "number" },
      { key: "completedTreatments", label: "Completed Treatments", type: "number" },
      { key: "activeTreatments", label: "Active Treatments", type: "number" },
    ],
    rows,
  };
}

export function buildReportData(category, data = {}, range) {
  const reportData = {
    bookings: data.bookings ?? [],
    patients: data.patients ?? [],
    dentists: data.dentists ?? [],
    payments: data.payments ?? [],
    summaries: data.summaries ?? data.paymentTreatmentSummaries ?? [],
    bracesAccounts: data.bracesAccounts ?? [],
    bracesPayments: data.bracesPayments ?? [],
    services: data.services ?? data.clinicServices ?? [],
    range,
  };

  if (category === "Appointments") return buildAppointmentsReport(reportData);
  if (category === "Patients") return buildPatientsReport(reportData);
  if (category === "Payments") return buildPaymentsReport(reportData);
  if (category === "Services") return buildServicesReport(reportData);
  return buildDentistsReport(reportData);
}

export function isReportDateInRange(value, range) {
  return isInRange(value, range);
}

export function formatReportCurrency(value) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}
