const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

admin.initializeApp();

const db = admin.firestore();
const auth = admin.auth();
const gmailEmail = defineSecret("GMAIL_EMAIL");
const gmailAppPassword = defineSecret("GMAIL_APP_PASSWORD");

const ALLOWED_ROLES = ["receptionist", "dentist"];
const BOOKING_AVAILABILITY_MIN_INTERVAL_MS = 2000;
const BOOKING_AVAILABILITY_WINDOW_MS = 60 * 1000;
const BOOKING_AVAILABILITY_MAX_CALLS = 20;
const BOOKING_CREATE_MIN_INTERVAL_MS = 4000;
const BOOKING_CREATE_WINDOW_MS = 60 * 1000;
const BOOKING_CREATE_MAX_CALLS = 6;
const STAFF_MFA_CODE_TTL_MS = 5 * 60 * 1000;
const STAFF_MFA_VERIFIED_MS = 12 * 60 * 60 * 1000;
const STAFF_MFA_REQUEST_MIN_INTERVAL_MS = 60 * 1000;
const STAFF_MFA_REQUEST_WINDOW_MS = 15 * 60 * 1000;
const STAFF_MFA_REQUEST_MAX_CALLS = 5;
const STAFF_MFA_VERIFY_MIN_INTERVAL_MS = 1000;
const STAFF_MFA_VERIFY_WINDOW_MS = 15 * 60 * 1000;
const STAFF_MFA_VERIFY_MAX_CALLS = 10;
const DEFAULT_CLINIC_SERVICES = [
  {
    name: "Cleaning",
    description: "Gentle scaling and polishing.",
    durationMinutes: 60,
    startingRate: "PHP 800 starting",
    active: true,
  },
  {
    name: "Fillings",
    description: "Tooth-colored restoration service.",
    durationMinutes: 60,
    startingRate: "PHP 800 starting",
    active: true,
  },
  {
    name: "Extraction",
    description: "Safe and comfortable tooth removal.",
    durationMinutes: 60,
    startingRate: "PHP 800 starting",
    active: true,
  },
  {
    name: "Braces Consultation",
    description: "Orthodontic evaluation and care planning.",
    durationMinutes: 45,
    startingRate: "Consultation pricing available at clinic",
    active: true,
  },
  {
    name: "Root Canal",
    description: "Tooth-saving endodontic treatment.",
    durationMinutes: 90,
    startingRate: "PHP 8,000 per canal",
    active: true,
  },
  {
    name: "Whitening",
    description: "Brightening treatment for your smile.",
    durationMinutes: 60,
    startingRate: "PHP 8,000",
    active: true,
  },
];
const DAY_ORDER = [
  { key: "monday", label: "Monday" },
  { key: "tuesday", label: "Tuesday" },
  { key: "wednesday", label: "Wednesday" },
  { key: "thursday", label: "Thursday" },
  { key: "friday", label: "Friday" },
  { key: "saturday", label: "Saturday" },
  { key: "sunday", label: "Sunday" },
];

async function writeAuditLog({
  actorUid = "",
  actorName = "",
  actorEmail = "",
  actorRole = "",
  action,
  targetType,
  targetId = "",
  targetLabel = "",
  details = {},
}) {
  if (!action || !targetType) return;

  await db.collection("auditLogs").add({
    actorUid,
    actorName,
    actorEmail,
    actorRole,
    action,
    targetType,
    targetId,
    targetLabel,
    details,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

function serializeAdminDoc(id, data = {}) {
  function serializeTimestamp(value) {
    try {
      if (value && typeof value.toDate === "function") {
        return value.toDate().toISOString();
      }
    } catch (error) {
      console.warn(`Could not serialize timestamp for admin ${id}:`, error);
    }

    return null;
  }

  return {
    id,
    name: data.name || "",
    email: data.email || "",
    role: data.role || "",
    disabled: Boolean(data.disabled),
    archiveStatus: data.archiveStatus || "",
    mfaEnabled: data.mfaEnabled === true,
    mfaMethod: data.mfaMethod || "",
    createdBy: data.createdBy || "",
    createdAt: serializeTimestamp(data.createdAt),
    mfaVerifiedUntil: serializeTimestamp(data.mfaVerifiedUntil),
    mfaLastVerifiedAt: serializeTimestamp(data.mfaLastVerifiedAt),
  };
}

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isArchivedValueForServer(value) {
  const normalized = normalizeText(value);
  return normalized === "archived" || normalized === "archive";
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function timeToMinutes(timeStr = "") {
  const [hourText = "0", minuteText = "0"] = String(timeStr).split(":");
  return Number(hourText) * 60 + Number(minuteText);
}

function minutesToTime(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${pad(hours)}:${pad(minutes)}`;
}

function createManilaAppointmentDate(dateStr, timeStr) {
  const [year, month, day] = String(dateStr).split("-").map(Number);
  const [hour, minute] = String(timeStr).split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute, 0, 0));
}

function formatTimeLabel(timeStr) {
  if (!timeStr) return "Not set";
  const [hourText = "0", minuteText = "00"] = String(timeStr).split(":");
  const date = new Date();
  date.setHours(Number(hourText), Number(minuteText), 0, 0);
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function generateSlots() {
  const slots = [];
  for (let hour = 9; hour <= 17; hour += 1) {
    slots.push(`${pad(hour)}:00`);
    slots.push(`${pad(hour)}:30`);
  }
  return slots;
}

function doIntervalsOverlap(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

function createDefaultSchedule() {
  return {
    monday: { active: true, start: "09:00", end: "18:00" },
    tuesday: { active: true, start: "09:00", end: "18:00" },
    wednesday: { active: true, start: "09:00", end: "18:00" },
    thursday: { active: true, start: "09:00", end: "18:00" },
    friday: { active: true, start: "09:00", end: "18:00" },
    saturday: { active: true, start: "09:00", end: "18:00" },
    sunday: { active: false, start: "09:00", end: "18:00" },
  };
}

function normalizeSchedule(schedule) {
  const defaults = createDefaultSchedule();

  return DAY_ORDER.reduce((acc, day) => {
    acc[day.key] = {
      ...defaults[day.key],
      ...(schedule?.[day.key] || {}),
    };
    return acc;
  }, {});
}

function normalizeScheduleExceptions(exceptions = []) {
  return (Array.isArray(exceptions) ? exceptions : [])
    .map((entry) => ({
      id: entry.id || `${entry.date || ""}-${entry.label || ""}`,
      date: String(entry.date || "").trim(),
      label: String(entry.label || "").trim(),
      type: String(entry.type || "exception").trim(),
      active: entry.active !== false,
      start: String(entry.start || "09:00"),
      end: String(entry.end || "18:00"),
    }))
    .filter((entry) => entry.date);
}

function getDayKeyFromDate(dateStr) {
  if (!dateStr) return "";
  const dayIndex = new Date(`${dateStr}T00:00:00`).getDay();
  return DAY_ORDER[(dayIndex + 6) % 7].key;
}

function getDentistDaySchedule(dentist, dateStr) {
  const exception = normalizeScheduleExceptions(dentist?.scheduleExceptions).find(
    (entry) => entry.date === dateStr
  );

  if (exception) {
    return {
      active: Boolean(exception.active),
      start: exception.start,
      end: exception.end,
      label: exception.label,
      type: exception.type,
      source: "exception",
    };
  }

  const schedule = normalizeSchedule(dentist?.schedule);
  const dayKey = getDayKeyFromDate(dateStr);
  return {
    ...(schedule[dayKey] || { active: false, start: "09:00", end: "18:00" }),
    source: "weekly",
  };
}

function normalizeClinicService(service = {}) {
  return {
    name: String(service.name || "").trim(),
    description: String(service.description || "").trim(),
    durationMinutes: Number(service.durationMinutes || 60),
    startingRate: String(service.startingRate || "").trim(),
    active: service.active !== false,
  };
}

function getBookingServiceOptions(services = []) {
  const merged = new Map();

  DEFAULT_CLINIC_SERVICES
    .map(normalizeClinicService)
    .filter((service) => service.active && service.name)
    .forEach((service) => {
      merged.set(normalizeText(service.name), service);
    });

  (Array.isArray(services) ? services : [])
    .map(normalizeClinicService)
    .filter((service) => service.active && service.name)
    .forEach((service) => {
      merged.set(normalizeText(service.name), service);
    });

  return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeClosure(closure = {}) {
  return {
    id: closure.id || "",
    date: String(closure.date || "").trim(),
    label: String(closure.label || "Clinic Closed").trim(),
    type: String(closure.type || "holiday").trim(),
    notes: String(closure.notes || "").trim(),
    active: closure.active !== false,
  };
}

function getActiveClosureForDate(closures = [], date) {
  return closures
    .map(normalizeClosure)
    .find((closure) => closure.active && closure.date === date) || null;
}

function isActiveBooking(booking = {}) {
  return booking.archiveStatus !== "Archived" && booking.status !== "cancelled";
}

function getBookingServices(booking = {}) {
  if (Array.isArray(booking.services) && booking.services.length) {
    return booking.services.map((entry) => String(entry || "").trim()).filter(Boolean);
  }

  return String(booking.service || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getBookingDurationMinutes(booking = {}, serviceOptions = []) {
  if (Number(booking.estimatedDurationMinutes) > 0) {
    return Number(booking.estimatedDurationMinutes);
  }

  const inferredDuration = getBookingServices(booking).reduce((total, serviceName) => {
    const serviceRecord = serviceOptions.find((entry) => entry.name === serviceName);
    return total + Number(serviceRecord?.durationMinutes || 0);
  }, 0);

  return inferredDuration || 60;
}

function getManilaNowContext() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date());
  const getPart = (type) => parts.find((entry) => entry.type === type)?.value || "00";

  return {
    date: `${getPart("year")}-${getPart("month")}-${getPart("day")}`,
    minutes: Number(getPart("hour")) * 60 + Number(getPart("minute")),
  };
}

function getSlotLockIds({ dentistId, date, startMinutes, endMinutes }) {
  const lockIds = [];
  for (let cursor = startMinutes; cursor < endMinutes; cursor += 30) {
    lockIds.push(`${dentistId}_${date}_${minutesToTime(cursor).replace(":", "")}`);
  }
  return lockIds;
}

function buildPersonName({ firstName = "", middleName = "", lastName = "", fallback = "" } = {}) {
  return [firstName, middleName, lastName]
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .join(" ") || String(fallback || "").trim();
}

function getStoredBookingDurationMinutes(booking = {}) {
  const duration = Number(booking.estimatedDurationMinutes || 0);
  return duration > 0 ? duration : 60;
}

function getStoredBookingWindow(booking = {}, overrides = {}) {
  const date = String(overrides.date || booking.date || "").trim();
  const time = String(overrides.time || booking.time || "").trim();
  const dentistId = String(overrides.dentistId || booking.dentistId || "").trim();
  const startMinutes = timeToMinutes(time);
  const durationMinutes = Number(overrides.durationMinutes || getStoredBookingDurationMinutes(booking));
  const endMinutes = startMinutes + durationMinutes;

  return {
    dentistId,
    date,
    time,
    startMinutes,
    endMinutes,
    durationMinutes,
  };
}

function getStoredBookingLockIds(booking = {}, overrides = {}) {
  const window = getStoredBookingWindow(booking, overrides);
  if (!window.dentistId || !window.date || !window.time) return [];

  return getSlotLockIds({
    dentistId: window.dentistId,
    date: window.date,
    startMinutes: window.startMinutes,
    endMinutes: window.endMinutes,
  });
}

function getBookingTargetLabel(booking = {}) {
  return booking.fullName || booking.email || booking.patientKey || "Booking";
}

function isStoredBookingInPast(booking = {}) {
  const window = getStoredBookingWindow(booking);
  const manilaNow = getManilaNowContext();
  if (!window.date || !window.time) return true;
  if (window.date < manilaNow.date) return true;
  return window.date === manilaNow.date && window.startMinutes < manilaNow.minutes;
}

async function getStaffContextFromRequest(request, allowedRoles = []) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Please sign in with a staff account.");
  }

  const uid = request.auth.uid;
  const staffSnap = await db.collection("admins").doc(uid).get();
  if (!staffSnap.exists) {
    throw new HttpsError("permission-denied", "Only staff accounts can do this.");
  }

  const staff = staffSnap.data() || {};
  const role = String(staff.role || "").trim().toLowerCase();
  if (staff.disabled) {
    throw new HttpsError("permission-denied", "This staff account is disabled.");
  }

  if (allowedRoles.length && !allowedRoles.includes(role)) {
    throw new HttpsError("permission-denied", "Your staff role cannot do this.");
  }

  return {
    uid,
    role,
    name: staff.name || request.auth.token.email || "Staff",
    email: staff.email || request.auth.token.email || "",
  };
}

async function writeStaffAuditLog(staff, audit) {
  await writeAuditLog({
    actorUid: staff.uid,
    actorName: staff.name,
    actorEmail: staff.email,
    actorRole: staff.role,
    ...audit,
  });
}

function sanitizeAuditDetailsForServer(details = {}) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return {};

  return Object.fromEntries(
    Object.entries(details)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [String(key).slice(0, 80), value])
  );
}

function hashMfaCode(code, salt) {
  return crypto
    .createHash("sha256")
    .update(`${salt}:${code}`)
    .digest("hex");
}

function createStaffMfaEmailHtml({ staffName, code }) {
  return createEmailShell({
    eyebrow: "TopDent Staff Security",
    title: "Your admin verification code",
    intro: `Hello ${staffName || "Staff"}, use this one-time code to finish signing in to the TopDent admin area:`,
    detailsHtml: `
      <p style="margin: 0; color: #0f172a; font-size: 32px; font-weight: 800; letter-spacing: 0.18em; text-align: center;">
        ${code}
      </p>
      <p style="margin: 12px 0 0; color: #475569; font-size: 13px; text-align: center;">
        This code expires in 5 minutes.
      </p>
    `,
    closing: "If you did not request this code, change your staff password and contact the administrator immediately.",
  });
}

function createStaffMfaEmailText({ staffName, code }) {
  return `
Hello ${staffName || "Staff"},

Your TopDent admin verification code is: ${code}

This code expires in 5 minutes. If you did not request it, contact the administrator immediately.
  `.trim();
}

async function syncPatientRecordFromBookingServer(bookingData = {}) {
  const patientsSnap = await db.collection("patients").get();
  const match = patientsSnap.docs.find((patientDoc) => {
    const patient = patientDoc.data() || {};
    if (bookingData.uid && patient.uid === bookingData.uid) return true;
    return normalizeText(patient.name) === normalizeText(bookingData.fullName || bookingData.patientKey);
  });

  const firstName = String(bookingData.firstName || "").trim();
  const middleName = String(bookingData.middleName || "").trim();
  const lastName = String(bookingData.lastName || "").trim();
  const payload = {
    uid: bookingData.uid || "",
    firstName,
    middleName,
    lastName,
    name: buildPersonName({
      firstName,
      middleName,
      lastName,
      fallback: bookingData.fullName || "Unnamed Patient",
    }),
    age: bookingData.age || "",
    phone: bookingData.phone || "",
    email: bookingData.email || "",
    patientType: bookingData.patientType || "Regular Patient",
    preferredDentist: bookingData.selectedDentist || "",
    latestService: bookingData.service || "",
    latestBookedAt: bookingData.createdAt || null,
    lastApprovedAt: bookingData.approvedAt || bookingData.appointmentAt || null,
    lastAppointmentDate: bookingData.date || "",
    lastAppointmentTime: bookingData.time || "",
    lastCheckedInAt: bookingData.checkedInAt || null,
    status: "Active",
  };

  if (match) {
    await match.ref.set(payload, { merge: true });
    return;
  }

  await db.collection("patients").add({
    ...payload,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function getLockSnapshots(transaction, booking, overrides = {}) {
  const lockRefs = getStoredBookingLockIds(booking, overrides)
    .map((lockId) => db.collection("bookingSlotLocks").doc(lockId));
  const lockSnaps = await Promise.all(lockRefs.map((lockRef) => transaction.get(lockRef)));

  return { lockRefs, lockSnaps };
}

function deleteOwnedLocks(transaction, lockRefs, lockSnaps, bookingId) {
  lockRefs.forEach((lockRef, index) => {
    const lockSnap = lockSnaps[index];
    if (!lockSnap.exists) return;
    if (String(lockSnap.data()?.bookingId || "") !== bookingId) return;
    transaction.delete(lockRef);
  });
}

async function validateStaffBookingSlot(transaction, {
  bookingId,
  booking,
  nextDate,
  nextTime,
}) {
  const dentistId = String(booking.dentistId || "").trim();
  if (!dentistId) {
    throw new HttpsError("failed-precondition", "This booking is missing a dentist ID.");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) {
    throw new HttpsError("invalid-argument", "Date must use YYYY-MM-DD format.");
  }

  if (!/^\d{2}:\d{2}$/.test(nextTime)) {
    throw new HttpsError("invalid-argument", "Time must use HH:mm format.");
  }

  const dentistRef = db.collection("dentists").doc(dentistId);
  const closuresQuery = db.collection("clinicClosures").where("date", "==", nextDate);
  const bookingsQuery = db.collection("bookings").where("date", "==", nextDate);

  const dentistSnap = await transaction.get(dentistRef);
  const closuresSnap = await transaction.get(closuresQuery);
  const bookingsSnap = await transaction.get(bookingsQuery);

  if (!dentistSnap.exists) {
    throw new HttpsError("not-found", "Selected dentist could not be found.");
  }

  const dentist = { id: dentistSnap.id, ...dentistSnap.data() };
  if (dentist.archiveStatus === "Archived") {
    throw new HttpsError("failed-precondition", "Selected dentist is no longer active.");
  }

  const closure = getActiveClosureForDate(
    closuresSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() })),
    nextDate
  );
  if (closure) {
    throw new HttpsError("failed-precondition", `${closure.label} blocks booking on this date.`);
  }

  const schedule = getDentistDaySchedule(dentist, nextDate);
  if (!schedule.active) {
    throw new HttpsError("failed-precondition", "That dentist is inactive on the selected day.");
  }

  const window = getStoredBookingWindow(booking, {
    dentistId,
    date: nextDate,
    time: nextTime,
  });
  const scheduleStart = timeToMinutes(schedule.start);
  const scheduleEnd = timeToMinutes(schedule.end);
  const manilaNow = getManilaNowContext();

  if (window.startMinutes < scheduleStart || window.endMinutes > scheduleEnd) {
    throw new HttpsError("failed-precondition", "That time is outside the dentist's schedule.");
  }

  if (nextDate === manilaNow.date && window.startMinutes < manilaNow.minutes) {
    throw new HttpsError("failed-precondition", "That time already passed. Choose a later time.");
  }

  const bookings = bookingsSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
  const conflictingBooking = bookings.find((entry) => {
    if (entry.id === bookingId) return false;
    if (!isActiveBooking(entry)) return false;

    const bookingDentistId = String(entry.dentistId || "").trim();
    const sameDentist = bookingDentistId
      ? bookingDentistId === dentist.id
      : normalizeText(entry.selectedDentist) === normalizeText(dentist.name);
    if (!sameDentist) return false;

    const otherWindow = getStoredBookingWindow(entry);
    return doIntervalsOverlap(
      window.startMinutes,
      window.endMinutes,
      otherWindow.startMinutes,
      otherWindow.endMinutes
    );
  });

  if (conflictingBooking) {
    throw new HttpsError("already-exists", "That appointment slot is already taken.");
  }

  const { lockRefs, lockSnaps } = await getLockSnapshots(transaction, booking, {
    dentistId,
    date: nextDate,
    time: nextTime,
  });
  const lockedBookingIds = Array.from(
    new Set(
      lockSnaps
        .filter((lockSnap) => lockSnap.exists)
        .map((lockSnap) => String(lockSnap.data()?.bookingId || "").trim())
        .filter((lockBookingId) => lockBookingId && lockBookingId !== bookingId)
    )
  );
  const lockedBookingRefs = lockedBookingIds.map((lockedBookingId) =>
    db.collection("bookings").doc(lockedBookingId)
  );
  const lockedBookingSnaps = await Promise.all(
    lockedBookingRefs.map((lockedBookingRef) => transaction.get(lockedBookingRef))
  );
  const activeLockedBooking = lockedBookingSnaps.some((lockBookingSnap) =>
    lockBookingSnap.exists && isActiveBooking(lockBookingSnap.data() || {})
  );

  if (activeLockedBooking) {
    throw new HttpsError("already-exists", "That appointment slot is already taken.");
  }

  return {
    dentist,
    window,
    lockRefs,
    lockSnaps,
    appointmentAt: admin.firestore.Timestamp.fromDate(
      createManilaAppointmentDate(nextDate, nextTime)
    ),
    estimatedEndTime: minutesToTime(window.endMinutes),
  };
}

function buildAvailabilityResponse({
  dentist,
  date,
  selectedServices,
  serviceOptions,
  bookings,
  duplicateWarning,
  closure,
}) {
  const schedule = getDentistDaySchedule(dentist, date);
  const durationMinutes = selectedServices.reduce((total, serviceName) => {
    const serviceRecord = serviceOptions.find((entry) => entry.name === serviceName);
    return total + Number(serviceRecord?.durationMinutes || 0);
  }, 0) || 60;

  if (closure || !schedule.active) {
    return {
      availableSlots: [],
      slotOptions: [],
      blockedRanges: [],
      duplicateWarning,
      schedule: {
        active: false,
        start: schedule.start,
        end: schedule.end,
        label: closure?.label || schedule.label || "Unavailable",
        type: closure ? closure.type : schedule.type || schedule.source,
      },
      selectedDentist: {
        id: dentist.id || "",
        name: dentist.name || "",
      },
      appointmentDurationMinutes: durationMinutes,
    };
  }

  const scheduleStart = timeToMinutes(schedule.start);
  const scheduleEnd = timeToMinutes(schedule.end);
  const manilaNow = getManilaNowContext();
  const normalizedDentistBookings = bookings
    .filter((booking) => {
      if (!isActiveBooking(booking)) return false;
      const bookingDentistId = String(booking.dentistId || "").trim();
      if (bookingDentistId) return bookingDentistId === dentist.id;
      return normalizeText(booking.selectedDentist) === normalizeText(dentist.name);
    })
    .map((booking) => {
      const start = timeToMinutes(booking.time);
      const end = start + getBookingDurationMinutes(booking, serviceOptions);
      return {
        id: booking.id || "",
        start,
        end,
      };
    });

  const slotOptions = generateSlots()
    .filter((slot) => {
      const slotStart = timeToMinutes(slot);
      return slotStart >= scheduleStart && slotStart < scheduleEnd;
    })
    .map((slot) => {
      const slotStart = timeToMinutes(slot);
      const slotEnd = slotStart + durationMinutes;
      const conflict = normalizedDentistBookings.find((booking) =>
        doIntervalsOverlap(slotStart, slotEnd, booking.start, booking.end)
      );
      const isPast = date === manilaNow.date && slotStart < manilaNow.minutes;
      const exceedsSchedule = slotEnd > scheduleEnd;

      let disabledReason = "";
      if (isPast) {
        disabledReason = "Time passed";
      } else if (exceedsSchedule) {
        disabledReason = `Needs until ${formatTimeLabel(minutesToTime(slotEnd))}`;
      } else if (conflict) {
        disabledReason = `Booked ${formatTimeLabel(minutesToTime(conflict.start))}-${formatTimeLabel(minutesToTime(conflict.end))}`;
      }

      return {
        value: slot,
        label: `${formatTimeLabel(slot)} - ${formatTimeLabel(minutesToTime(slotEnd))}`,
        disabled: Boolean(disabledReason),
        disabledReason,
        end: minutesToTime(slotEnd),
      };
    });

  return {
    availableSlots: slotOptions.filter((slot) => !slot.disabled).map((slot) => slot.value),
    slotOptions,
    blockedRanges: normalizedDentistBookings.map((booking) => ({
      start: minutesToTime(booking.start),
      end: minutesToTime(booking.end),
      reason: "occupied",
    })),
    duplicateWarning,
    schedule: {
      active: true,
      start: schedule.start,
      end: schedule.end,
      label: schedule.label || "",
      type: schedule.type || schedule.source,
    },
    selectedDentist: {
      id: dentist.id || "",
      name: dentist.name || "",
    },
    appointmentDurationMinutes: durationMinutes,
  };
}

async function assertRateLimit({
  uid,
  scope,
  minIntervalMs,
  windowMs,
  maxCalls,
}) {
  const limiterRef = db.collection("rateLimits").doc(`${scope}_${uid}`);
  const limiterSnap = await limiterRef.get();
  const now = Date.now();

  if (!limiterSnap.exists) {
    await limiterRef.set({
      scope,
      uid,
      count: 1,
      windowStartedAt: admin.firestore.Timestamp.fromMillis(now),
      lastCalledAt: admin.firestore.Timestamp.fromMillis(now),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return;
  }

  const data = limiterSnap.data() || {};
  const lastCalledAt = data.lastCalledAt?.toMillis ? data.lastCalledAt.toMillis() : 0;
  const windowStartedAt = data.windowStartedAt?.toMillis ? data.windowStartedAt.toMillis() : now;

  if (now - lastCalledAt < minIntervalMs) {
    throw new HttpsError(
      "resource-exhausted",
      "Too many availability checks. Please wait a moment before trying again."
    );
  }

  const sameWindow = now - windowStartedAt < windowMs;
  const nextCount = sameWindow ? Number(data.count || 0) + 1 : 1;

  if (sameWindow && nextCount > maxCalls) {
    throw new HttpsError(
      "resource-exhausted",
      "Too many availability checks in a short time. Please wait a moment and try again."
    );
  }

  await limiterRef.set(
    {
      scope,
      uid,
      count: nextCount,
      windowStartedAt: admin.firestore.Timestamp.fromMillis(sameWindow ? windowStartedAt : now),
      lastCalledAt: admin.firestore.Timestamp.fromMillis(now),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

function formatScheduleLabel(booking) {
  const date = booking.date ? String(booking.date) : "To be confirmed";
  const time = booking.time ? String(booking.time) : "To be confirmed";
  return `${date} at ${time}`;
}

function createEmailShell({ eyebrow, title, intro, detailsHtml, closing }) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; background: linear-gradient(180deg, #ecfeff 0%, #f8fafc 100%);">
      <div style="background: white; border-radius: 20px; padding: 34px; border: 1px solid #dbeafe; box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);">
        <div style="margin-bottom: 22px; text-align: center;">
          <p style="margin: 0 0 8px; color: #0f766e; font-size: 12px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;">
            ${eyebrow}
          </p>
          <h1 style="margin: 0; color: #0f172a; font-size: 30px; line-height: 1.2;">
            ${title}
          </h1>
        </div>

        <p style="margin: 0 0 22px; color: #334155; font-size: 15px; line-height: 1.8;">
          ${intro}
        </p>

        <div style="border-radius: 16px; padding: 18px 20px; background: linear-gradient(180deg, #f8fafc, #eff6ff); border: 1px solid #cbd5e1; margin-bottom: 22px;">
          ${detailsHtml}
        </div>

        <p style="margin: 0; color: #334155; font-size: 15px; line-height: 1.8;">
          ${closing}
        </p>
      </div>
    </div>
  `;
}

function createBookingDetailsHtml(booking, statusLabel) {
  const service = booking.service || "Dental appointment";
  const dentist = booking.selectedDentist || "Assigned dentist";
  const schedule = formatScheduleLabel(booking);

  return `
    <p style="margin: 0 0 10px; color: #475569;"><strong>Service:</strong> ${service}</p>
    <p style="margin: 0 0 10px; color: #475569;"><strong>Schedule:</strong> ${schedule}</p>
    <p style="margin: 0 0 10px; color: #475569;"><strong>Dentist:</strong> ${dentist}</p>
    <p style="margin: 0; color: #475569;"><strong>Status:</strong> ${statusLabel}</p>
  `;
}

function createApprovalEmailHtml(booking) {
  const patientName = booking.fullName || "Patient";

  return createEmailShell({
    eyebrow: "TopDent Dental Clinic",
    title: "Your booking has been approved",
    intro: `Hello ${patientName}, your appointment request has been accepted by TopDent Dental Clinic. Here are your confirmed booking details:`,
    detailsHtml: createBookingDetailsHtml(booking, "Approved"),
    closing: "If you need to make changes to your booking, please contact the clinic as soon as possible.<br /><br /><strong>Thank you,<br />TopDent Dental Clinic</strong>",
  });
}

function createSubmittedEmailHtml(booking) {
  const patientName = booking.fullName || "Patient";

  return createEmailShell({
    eyebrow: "TopDent Dental Clinic",
    title: "We received your booking request",
    intro: `Hello ${patientName}, thank you for booking with TopDent Dental Clinic. Your request has been received and is now waiting for clinic approval.`,
    detailsHtml: createBookingDetailsHtml(booking, "Pending review"),
    closing: "We will review your request and send another email once it has been approved. Please wait for confirmation before assuming the appointment is final.<br /><br /><strong>Warm regards,<br />TopDent Dental Clinic</strong>",
  });
}

function createApprovalEmailText(booking) {
  const patientName = booking.fullName || "Patient";
  const service = booking.service || "Dental appointment";
  const dentist = booking.selectedDentist || "Assigned dentist";
  const schedule = formatScheduleLabel(booking);

  return `
Hello ${patientName},

Your appointment request at TopDent Dental Clinic has been approved.

Booking details:
- Service: ${service}
- Schedule: ${schedule}
- Dentist: ${dentist}
- Status: Approved

If you need to make changes to your booking, please contact the clinic as soon as possible.

Thank you,
TopDent Dental Clinic
  `.trim();
}

function createSubmittedEmailText(booking) {
  const patientName = booking.fullName || "Patient";
  const service = booking.service || "Dental appointment";
  const dentist = booking.selectedDentist || "Assigned dentist";
  const schedule = formatScheduleLabel(booking);

  return `
Hello ${patientName},

We received your booking request at TopDent Dental Clinic.

Booking details:
- Service: ${service}
- Schedule: ${schedule}
- Dentist: ${dentist}
- Status: Pending review

We will send another email once your booking has been approved.

Thank you,
TopDent Dental Clinic
  `.trim();
}

function createReminderEmailHtml(booking, reminderLabel) {
  const patientName = booking.fullName || "Patient";

  return createEmailShell({
    eyebrow: "TopDent Appointment Reminder",
    title: `${reminderLabel} reminder`,
    intro: `Hello ${patientName}, this is your ${reminderLabel.toLowerCase()} reminder for your approved appointment at TopDent Dental Clinic.`,
    detailsHtml: createBookingDetailsHtml(booking, "Approved"),
    closing: "Please arrive a little early for your appointment. If you need to reschedule, contact the clinic as soon as possible.<br /><br /><strong>See you soon,<br />TopDent Dental Clinic</strong>",
  });
}

function createReminderEmailText(booking, reminderLabel) {
  const patientName = booking.fullName || "Patient";
  const service = booking.service || "Dental appointment";
  const dentist = booking.selectedDentist || "Assigned dentist";
  const schedule = formatScheduleLabel(booking);

  return `
Hello ${patientName},

This is your ${reminderLabel.toLowerCase()} reminder for your approved appointment at TopDent Dental Clinic.

Booking details:
- Service: ${service}
- Schedule: ${schedule}
- Dentist: ${dentist}
- Status: Approved

Please arrive a little early for your appointment. If you need to reschedule, contact the clinic as soon as possible.

See you soon,
TopDent Dental Clinic
  `.trim();
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeBracesPlanFrequency(value) {
  if (value === "Weekly" || value === "Biweekly" || value === "Monthly") {
    return value;
  }

  return "Monthly";
}

function getBracesDiscountRate(planFrequency = "Monthly") {
  const normalized = normalizeBracesPlanFrequency(planFrequency);
  if (normalized === "Weekly") return 0.03;
  if (normalized === "Biweekly") return 0.025;
  return 0;
}

function getBracesInstallmentCount(planMonths = 0, planFrequency = "Monthly") {
  const normalizedMonths = Math.max(0, Math.round(toNumber(planMonths)));
  const normalized = normalizeBracesPlanFrequency(planFrequency);

  if (normalized === "Weekly") return normalizedMonths * 4;
  if (normalized === "Biweekly") return normalizedMonths * 2;
  return normalizedMonths;
}

function getElapsedBracesCycles(startDate, planFrequency = "Monthly", now = new Date()) {
  if (!startDate) return 0;

  const start = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || start > now) return 0;

  const normalized = normalizeBracesPlanFrequency(planFrequency);
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

function addBracesCycles(startDate, cycles = 0, planFrequency = "Monthly") {
  if (!startDate) return null;

  const start = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;

  const nextDate = new Date(start);
  const normalized = normalizeBracesPlanFrequency(planFrequency);

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

function summarizeBracesAccount(account = {}, payments = [], now = new Date()) {
  const totalCost = toNumber(account.totalCost);
  const downPaymentExpected = toNumber(account.downPaymentExpected);
  const planFrequency = normalizeBracesPlanFrequency(account.planFrequency || account.paymentSchedule);
  const planMonths = Math.max(0, Math.round(toNumber(account.planCycles || account.planMonths)));
  const installmentCount = getBracesInstallmentCount(planMonths, planFrequency);
  const discountRate = getBracesDiscountRate(planFrequency);
  const discountedInstallmentBase = Math.max(0, totalCost - downPaymentExpected) * (1 - discountRate);
  const installmentAmount =
    installmentCount > 0
      ? discountedInstallmentBase / installmentCount
      : toNumber(account.installmentAmount || account.monthlyAmount);
  const amountPaid = payments.reduce((sum, payment) => sum + toNumber(payment.amount), 0);
  const remainingBalance = Math.max(0, totalCost - amountPaid);
  const cyclesElapsed = getElapsedBracesCycles(account.startDate, planFrequency, now);
  const expectedPaidByNow = Math.min(totalCost, downPaymentExpected + cyclesElapsed * installmentAmount);
  const overdueAmount = Math.max(0, expectedPaidByNow - amountPaid);
  const coveredInstallmentValue = Math.max(0, amountPaid - downPaymentExpected);
  const coveredCycles =
    installmentAmount > 0 ? Math.max(0, Math.floor(coveredInstallmentValue / installmentAmount)) : 0;

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

  let nextDueDate = "";
  if (remainingBalance > 0) {
    if (amountPaid < downPaymentExpected) {
      nextDueDate = account.startDate || "";
    } else {
      const nextDue = addBracesCycles(account.startDate, coveredCycles + 1, planFrequency);
      nextDueDate = nextDue ? nextDue.toISOString().slice(0, 10) : "";
    }
  }

  return {
    amountPaid,
    remainingBalance,
    expectedPaidByNow,
    overdueAmount,
    planFrequency,
    installmentAmount,
    discountRate,
    installmentCount,
    cyclesElapsed,
    paymentState,
    nextDueDate,
  };
}

function createBracesAdjustmentDetailsHtml(adjustment, statusLabel) {
  return `
    <p style="margin: 0 0 10px; color: #475569;"><strong>Adjustment date:</strong> ${adjustment.adjustmentDate || "To be confirmed"}</p>
    <p style="margin: 0 0 10px; color: #475569;"><strong>Adjustment time:</strong> ${adjustment.adjustmentTime || "To be confirmed"}</p>
    <p style="margin: 0 0 10px; color: #475569;"><strong>Dentist:</strong> ${adjustment.dentist || "Assigned dentist"}</p>
    <p style="margin: 0 0 10px; color: #475569;"><strong>Visit note:</strong> ${adjustment.notes || "Braces follow-up adjustment"}</p>
    <p style="margin: 0; color: #475569;"><strong>Status:</strong> ${statusLabel}</p>
  `;
}

function createBracesAdjustmentReminderHtml(adjustment, reminderLabel) {
  const patientName = adjustment.patientName || "Patient";

  return createEmailShell({
    eyebrow: "TopDent Braces Adjustment Reminder",
    title: `${reminderLabel} braces adjustment reminder`,
    intro: `Hello ${patientName}, this is your ${reminderLabel.toLowerCase()} reminder for your braces adjustment visit at TopDent Dental Clinic.`,
    detailsHtml: createBracesAdjustmentDetailsHtml(adjustment, "Scheduled"),
    closing: "Please arrive a little early for your braces adjustment. If you need to reschedule, contact the clinic as soon as possible.<br /><br /><strong>See you soon,<br />TopDent Dental Clinic</strong>",
  });
}

function createBracesAdjustmentReminderText(adjustment, reminderLabel) {
  const patientName = adjustment.patientName || "Patient";

  return `
Hello ${patientName},

This is your ${reminderLabel.toLowerCase()} reminder for your braces adjustment visit at TopDent Dental Clinic.

Adjustment details:
- Date: ${adjustment.adjustmentDate || "To be confirmed"}
- Time: ${adjustment.adjustmentTime || "To be confirmed"}
- Dentist: ${adjustment.dentist || "Assigned dentist"}
- Note: ${adjustment.notes || "Braces follow-up adjustment"}
- Status: Scheduled

Please arrive a little early for your appointment. If you need to reschedule, contact the clinic as soon as possible.

See you soon,
TopDent Dental Clinic
  `.trim();
}

function createBracesPaymentReminderHtml(account, summary) {
  const patientName = account.patientName || "Patient";

  return createEmailShell({
    eyebrow: "TopDent Braces Payment Reminder",
    title: "Your braces payment is overdue",
    intro: `Hello ${patientName}, this is a reminder that your braces payment plan is currently overdue based on the clinic schedule on file.`,
    detailsHtml: `
      <p style="margin: 0 0 10px; color: #475569;"><strong>Payment schedule:</strong> ${summary.planFrequency}</p>
      <p style="margin: 0 0 10px; color: #475569;"><strong>Expected paid by now:</strong> PHP ${summary.expectedPaidByNow.toFixed(2)}</p>
      <p style="margin: 0 0 10px; color: #475569;"><strong>Actual amount paid:</strong> PHP ${summary.amountPaid.toFixed(2)}</p>
      <p style="margin: 0 0 10px; color: #475569;"><strong>Overdue amount:</strong> PHP ${summary.overdueAmount.toFixed(2)}</p>
      <p style="margin: 0; color: #475569;"><strong>Next expected payment date:</strong> ${summary.nextDueDate || "Please contact the clinic"}</p>
    `,
    closing: "Please settle your due amount or contact the clinic if you need help reviewing your braces payment schedule.<br /><br /><strong>Thank you,<br />TopDent Dental Clinic</strong>",
  });
}

function createBracesPaymentReminderText(account, summary) {
  const patientName = account.patientName || "Patient";

  return `
Hello ${patientName},

This is a reminder that your braces payment plan at TopDent Dental Clinic is currently overdue.

Payment details:
- Schedule: ${summary.planFrequency}
- Expected paid by now: PHP ${summary.expectedPaidByNow.toFixed(2)}
- Actual amount paid: PHP ${summary.amountPaid.toFixed(2)}
- Overdue amount: PHP ${summary.overdueAmount.toFixed(2)}
- Next expected payment date: ${summary.nextDueDate || "Please contact the clinic"}

Please settle your due amount or contact the clinic if you need help reviewing your braces payment schedule.

Thank you,
TopDent Dental Clinic
  `.trim();
}

function createTransporter() {
  const senderEmail = gmailEmail.value();
  const senderPassword = gmailAppPassword.value();

  if (!senderEmail || !senderPassword) {
    throw new Error("Missing GMAIL_EMAIL or GMAIL_APP_PASSWORD for booking email.");
  }

  return {
    senderEmail,
    transporter: nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: senderEmail,
        pass: senderPassword,
      },
    }),
  };
}

async function sendReminderWindowEmail({
  booking,
  reminderType,
  reminderLabel,
  sentField,
}) {
  const recipientEmail = String(booking.email || "").trim().toLowerCase();
  if (!recipientEmail) return;
  if (booking.archiveStatus === "Archived") return;
  if (String(booking.status || "").toLowerCase() !== "approved") return;
  if (booking[sentField]) return;

  let mailer;
  try {
    mailer = createTransporter();
  } catch (error) {
    console.error(error.message);
    return;
  }

  await mailer.transporter.sendMail({
    from: mailer.senderEmail,
    to: recipientEmail,
    subject: `TopDent Appointment Reminder: ${reminderLabel}`,
    text: createReminderEmailText(booking, reminderLabel),
    html: createReminderEmailHtml(booking, reminderLabel),
  });

  await db.collection("bookings").doc(booking.id).set(
    {
      [sentField]: admin.firestore.FieldValue.serverTimestamp(),
      latestReminderType: reminderType,
    },
    { merge: true }
  );
}

async function processReminderWindow({
  lowerMinutesAhead,
  upperMinutesAhead,
  sentField,
  reminderType,
  reminderLabel,
}) {
  const now = Date.now();
  const lowerBound = admin.firestore.Timestamp.fromDate(
    new Date(now + lowerMinutesAhead * 60 * 1000)
  );
  const upperBound = admin.firestore.Timestamp.fromDate(
    new Date(now + upperMinutesAhead * 60 * 1000)
  );

  const snapshot = await db
    .collection("bookings")
    .where("status", "==", "approved")
    .where("appointmentAt", ">=", lowerBound)
    .where("appointmentAt", "<=", upperBound)
    .get();

  for (const docSnap of snapshot.docs) {
    await sendReminderWindowEmail({
      booking: { id: docSnap.id, ...docSnap.data() },
      reminderType,
      reminderLabel,
      sentField,
    });
  }
}

async function sendBracesAdjustmentReminderEmail({
  adjustment,
  reminderType,
  reminderLabel,
  sentField,
}) {
  const recipientEmail = String(adjustment.patientEmail || "").trim().toLowerCase();
  const status = String(adjustment.status || "").trim().toLowerCase();
  if (!recipientEmail) return;
  if (status !== "scheduled") return;
  if (adjustment[sentField]) return;

  let mailer;
  try {
    mailer = createTransporter();
  } catch (error) {
    console.error(error.message);
    return;
  }

  await mailer.transporter.sendMail({
    from: mailer.senderEmail,
    to: recipientEmail,
    subject: `TopDent Braces Adjustment Reminder: ${reminderLabel}`,
    text: createBracesAdjustmentReminderText(adjustment, reminderLabel),
    html: createBracesAdjustmentReminderHtml(adjustment, reminderLabel),
  });

  await db.collection("bracesAdjustments").doc(adjustment.id).set(
    {
      [sentField]: admin.firestore.FieldValue.serverTimestamp(),
      latestReminderType: reminderType,
    },
    { merge: true }
  );
}

async function processBracesAdjustmentReminderWindow({
  lowerMinutesAhead,
  upperMinutesAhead,
  sentField,
  reminderType,
  reminderLabel,
}) {
  const now = Date.now();
  const lowerBound = admin.firestore.Timestamp.fromDate(
    new Date(now + lowerMinutesAhead * 60 * 1000)
  );
  const upperBound = admin.firestore.Timestamp.fromDate(
    new Date(now + upperMinutesAhead * 60 * 1000)
  );

  const snapshot = await db
    .collection("bracesAdjustments")
    .where("status", "==", "Scheduled")
    .where("adjustmentAt", ">=", lowerBound)
    .where("adjustmentAt", "<=", upperBound)
    .get();

  for (const docSnap of snapshot.docs) {
    await sendBracesAdjustmentReminderEmail({
      adjustment: { id: docSnap.id, ...docSnap.data() },
      reminderType,
      reminderLabel,
      sentField,
    });
  }
}

async function processOverdueBracesPaymentReminders() {
  const snapshot = await db
    .collection("bracesAccounts")
    .where("planState", "==", "Active")
    .get();

  for (const docSnap of snapshot.docs) {
    const account = { id: docSnap.id, ...docSnap.data() };
    const recipientEmail = String(account.patientEmail || "").trim().toLowerCase();
    if (!recipientEmail) continue;

    const paymentsSnap = await db
      .collection("bracesPayments")
      .where("patientId", "==", account.patientId || docSnap.id)
      .get();

    const payments = paymentsSnap.docs.map((entry) => entry.data());
    const summary = summarizeBracesAccount(account, payments);

    await docSnap.ref.set(
      {
        amountPaid: summary.amountPaid,
        remainingBalance: summary.remainingBalance,
        expectedPaidByNow: summary.expectedPaidByNow,
        overdueAmount: summary.overdueAmount,
        paymentState: summary.paymentState,
        nextDueDate: summary.nextDueDate,
        lastComputedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    if (summary.paymentState !== "Overdue") continue;
    if (account.lastOverdueReminderCycle === summary.cyclesElapsed) continue;

    let mailer;
    try {
      mailer = createTransporter();
    } catch (error) {
      console.error(error.message);
      return;
    }

    await mailer.transporter.sendMail({
      from: mailer.senderEmail,
      to: recipientEmail,
      subject: "TopDent Braces Payment Overdue",
      text: createBracesPaymentReminderText(account, summary),
      html: createBracesPaymentReminderHtml(account, summary),
    });

    await docSnap.ref.set(
      {
        paymentOverdueReminderSentAt: admin.firestore.FieldValue.serverTimestamp(),
        lastOverdueReminderCycle: summary.cyclesElapsed,
      },
      { merge: true }
    );
  }
}

exports.createStaffAccount = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const callerUid = request.auth.uid;
  const callerSnap = await db.collection("admins").doc(callerUid).get();

  if (!callerSnap.exists) {
    throw new HttpsError("permission-denied", "Only admin accounts can create staff.");
  }

  const callerRole = String(callerSnap.data()?.role || "").trim().toLowerCase();
  if (callerRole !== "admin") {
    throw new HttpsError("permission-denied", "Only administrator accounts can create staff.");
  }

  const payload = request.data || {};
  const name = String(payload.name || "").trim();
  const email = String(payload.email || "").trim().toLowerCase();
  const password = String(payload.password || "");
  const role = String(payload.role || "").trim().toLowerCase();

  if (!name) {
    throw new HttpsError("invalid-argument", "Full name is required.");
  }

  if (!email) {
    throw new HttpsError("invalid-argument", "Email is required.");
  }

  if (password.length < 6) {
    throw new HttpsError("invalid-argument", "Password must be at least 6 characters.");
  }

  if (!ALLOWED_ROLES.includes(role)) {
    throw new HttpsError("invalid-argument", "Invalid role.");
  }

  let userRecord;
  try {
    userRecord = await auth.createUser({
      email,
      password,
      displayName: name,
      disabled: false,
    });
  } catch (error) {
    throw new HttpsError("already-exists", error.message || "Could not create auth user.");
  }

  await db.collection("admins").doc(userRecord.uid).set({
    name,
    email,
    role,
    mfaEnabled: true,
    mfaMethod: "email",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: callerUid,
  });

  await writeAuditLog({
    actorUid: callerUid,
    actorName: callerSnap.data()?.name || request.auth.token.email || "Administrator",
    actorEmail: request.auth.token.email || "",
    actorRole: callerRole,
    action: "create_staff_account",
    targetType: "admin_account",
    targetId: userRecord.uid,
    targetLabel: email,
    details: {
      createdRole: role,
      createdName: name,
    },
  });

  return {
    uid: userRecord.uid,
    email,
    role,
    name,
  };
});

exports.getStaffAccounts = onCall(async (request) => {
  try {
    await getAdminActorContext(request, "view staff accounts");

    const snapshot = await db.collection("admins").get();
    const accounts = snapshot.docs
      .map((entry) => serializeAdminDoc(entry.id, entry.data()))
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

    console.log(`getStaffAccounts returning ${accounts.length} accounts`);
    return accounts;
  } catch (error) {
    console.error("getStaffAccounts failed:", error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError(
      "internal",
      `Could not load staff accounts: ${error?.message || "Unknown backend error."}`
    );
  }
});

exports.setStaffAccountDisabled = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const callerUid = request.auth.uid;
  const callerSnap = await db.collection("admins").doc(callerUid).get();
  if (!callerSnap.exists) {
    throw new HttpsError("permission-denied", "Only admin accounts can manage staff accounts.");
  }

  const callerRole = String(callerSnap.data()?.role || "").trim().toLowerCase();
  if (callerRole !== "admin") {
    throw new HttpsError("permission-denied", "Only administrator accounts can manage staff accounts.");
  }

  const payload = request.data || {};
  const targetUid = String(payload.uid || "").trim();
  const disabled = Boolean(payload.disabled);

  if (!targetUid) {
    throw new HttpsError("invalid-argument", "Target staff UID is required.");
  }

  await auth.updateUser(targetUid, { disabled });
  await db.collection("admins").doc(targetUid).set({ disabled }, { merge: true });

  const targetSnap = await db.collection("admins").doc(targetUid).get();
  const targetData = targetSnap.exists ? targetSnap.data() : {};

  await writeAuditLog({
    actorUid: callerUid,
    actorName: callerSnap.data()?.name || request.auth.token.email || "Administrator",
    actorEmail: request.auth.token.email || "",
    actorRole: callerRole,
    action: "toggle_staff_account",
    targetType: "admin_account",
    targetId: targetUid,
    targetLabel: targetData?.email || targetData?.name || "Staff account",
    details: {
      disabled,
      role: targetData?.role || "",
    },
  });

  return {
    success: true,
    uid: targetUid,
    disabled,
  };
});

async function getAdminActorContext(request, actionLabel = "manage staff accounts") {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const callerUid = request.auth.uid;
  const callerSnap = await db.collection("admins").doc(callerUid).get();
  if (!callerSnap.exists) {
    throw new HttpsError("permission-denied", `Only admin accounts can ${actionLabel}.`);
  }

  const caller = callerSnap.data() || {};
  const callerRole = String(caller.role || "").trim().toLowerCase();
  if (callerRole !== "admin") {
    throw new HttpsError("permission-denied", `Only administrator accounts can ${actionLabel}.`);
  }

  return {
    uid: callerUid,
    role: callerRole,
    name: caller.name || request.auth.token.email || "Administrator",
    email: caller.email || request.auth.token.email || "",
  };
}

async function getManageableStaffTarget(targetUid) {
  const targetSnap = await db.collection("admins").doc(targetUid).get();
  if (!targetSnap.exists) {
    throw new HttpsError("not-found", "Staff account could not be found.");
  }

  const target = targetSnap.data() || {};
  const targetRole = String(target.role || "").trim().toLowerCase();
  if (!ALLOWED_ROLES.includes(targetRole)) {
    throw new HttpsError("failed-precondition", "Only receptionist and dentist staff accounts can be managed here.");
  }

  return { id: targetUid, ...target, role: targetRole };
}

exports.archiveStaffAccount = onCall(async (request) => {
  const actor = await getAdminActorContext(request, "archive staff accounts");
  const targetUid = String(request.data?.uid || "").trim();
  if (!targetUid) {
    throw new HttpsError("invalid-argument", "Target staff UID is required.");
  }

  const target = await getManageableStaffTarget(targetUid);
  if (!target.disabled) {
    throw new HttpsError("failed-precondition", "Disable the staff account before archiving it.");
  }

  await db.collection("admins").doc(targetUid).set(
    {
      archiveStatus: "Archived",
      archivedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await writeAuditLog({
    actorUid: actor.uid,
    actorName: actor.name,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: "archive_staff_account",
    targetType: "admin_account",
    targetId: targetUid,
    targetLabel: target.email || target.name || "Staff account",
  });

  return { success: true, uid: targetUid };
});

exports.restoreStaffAccount = onCall(async (request) => {
  const actor = await getAdminActorContext(request, "restore staff accounts");
  const targetUid = String(request.data?.uid || "").trim();
  if (!targetUid) {
    throw new HttpsError("invalid-argument", "Target staff UID is required.");
  }

  const target = await getManageableStaffTarget(targetUid);
  await db.collection("admins").doc(targetUid).set(
    {
      archiveStatus: "Active",
      restoredAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await writeAuditLog({
    actorUid: actor.uid,
    actorName: actor.name,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: "restore_staff_account",
    targetType: "admin_account",
    targetId: targetUid,
    targetLabel: target.email || target.name || "Staff account",
  });

  return { success: true, uid: targetUid };
});

exports.deleteArchivedStaffAccount = onCall(async (request) => {
  const actor = await getAdminActorContext(request, "delete archived staff accounts");
  const targetUid = String(request.data?.uid || "").trim();
  if (!targetUid) {
    throw new HttpsError("invalid-argument", "Target staff UID is required.");
  }

  const target = await getManageableStaffTarget(targetUid);
  if (!isArchivedValueForServer(target.archiveStatus)) {
    throw new HttpsError("failed-precondition", "Only archived staff accounts can be deleted here.");
  }

  try {
    await auth.deleteUser(targetUid);
  } catch (error) {
    if (error?.code !== "auth/user-not-found") {
      throw new HttpsError("internal", error?.message || "Could not delete the Firebase Auth user.");
    }
  }

  await db.collection("admins").doc(targetUid).delete();
  await writeAuditLog({
    actorUid: actor.uid,
    actorName: actor.name,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: "delete_archived_record",
    targetType: "admin_account",
    targetId: targetUid,
    targetLabel: target.email || target.name || "Staff account",
  });

  return { success: true, uid: targetUid };
});

exports.setStaffMfaRequired = onCall(async (request) => {
  const actor = await getAdminActorContext(request, "manage staff MFA");
  const targetUid = String(request.data?.uid || "").trim();
  const mfaEnabled = request.data?.mfaEnabled === true;
  if (!targetUid) {
    throw new HttpsError("invalid-argument", "Target staff UID is required.");
  }

  const targetSnap = await db.collection("admins").doc(targetUid).get();
  if (!targetSnap.exists) {
    throw new HttpsError("not-found", "Staff account could not be found.");
  }

  const target = { id: targetUid, ...targetSnap.data() };
  const targetRole = String(target.role || "").trim().toLowerCase();
  if (![...ALLOWED_ROLES, "admin"].includes(targetRole)) {
    throw new HttpsError("failed-precondition", "Only admin, receptionist, and dentist accounts can use MFA.");
  }
  if (targetRole === "admin" && !mfaEnabled) {
    throw new HttpsError("failed-precondition", "Administrator MFA is mandatory and cannot be turned off.");
  }

  await db.collection("admins").doc(targetUid).set(
    {
      mfaEnabled,
      mfaMethod: "email",
      mfaVerifiedUntil: null,
      mfaLastVerifiedAt: null,
      mfaUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await writeAuditLog({
    actorUid: actor.uid,
    actorName: actor.name,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: "set_staff_mfa_required",
    targetType: "admin_account",
    targetId: targetUid,
    targetLabel: target.email || target.name || "Staff account",
    details: { mfaEnabled, role: targetRole },
  });

  return { success: true, uid: targetUid, mfaEnabled };
});

exports.getBookingAvailability = onCall(
  {
    // App Check is required here so live availability cannot be spammed from
    // clients that are not running the configured Firebase web app.
    enforceAppCheck: true,
  },
  async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Please sign in first to load live appointment availability.");
  }

  await assertRateLimit({
    uid: request.auth.uid,
    scope: "booking_availability",
    minIntervalMs: BOOKING_AVAILABILITY_MIN_INTERVAL_MS,
    windowMs: BOOKING_AVAILABILITY_WINDOW_MS,
    maxCalls: BOOKING_AVAILABILITY_MAX_CALLS,
  });

  const payload = request.data || {};
  const dentistId = String(payload.dentistId || "").trim();
  const date = String(payload.date || "").trim();
  const selectedServices = Array.isArray(payload.selectedServices)
    ? payload.selectedServices.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];

  if (!dentistId) {
    throw new HttpsError("invalid-argument", "Dentist ID is required.");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new HttpsError("invalid-argument", "Date must use YYYY-MM-DD format.");
  }

  if (!selectedServices.length) {
    throw new HttpsError("invalid-argument", "At least one service is required.");
  }

  if (selectedServices.length > 8) {
    throw new HttpsError("invalid-argument", "Too many services were requested at once.");
  }

  const dentistSnap = await db.collection("dentists").doc(dentistId).get();
  if (!dentistSnap.exists) {
    throw new HttpsError("not-found", "Selected dentist could not be found.");
  }

  const dentist = {
    id: dentistSnap.id,
    ...dentistSnap.data(),
  };

  if (dentist.archiveStatus === "Archived") {
    throw new HttpsError("failed-precondition", "Selected dentist is no longer active.");
  }

  const [clinicServicesSnap, clinicClosuresSnap, bookingsSnap] = await Promise.all([
    db.collection("clinicServices").get(),
    db.collection("clinicClosures").where("date", "==", date).get(),
    db.collection("bookings").where("date", "==", date).get(),
  ]);

  const serviceOptions = getBookingServiceOptions(
    clinicServicesSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() }))
  );

  const unknownServices = selectedServices.filter(
    (serviceName) => !serviceOptions.some((entry) => entry.name === serviceName)
  );
  if (unknownServices.length) {
    throw new HttpsError(
      "invalid-argument",
      `Unknown service selection: ${unknownServices.join(", ")}.`
    );
  }

  const closures = clinicClosuresSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
  const closure = getActiveClosureForDate(closures, date);
  const bookings = bookingsSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
  const selectedServiceKeys = selectedServices.map((serviceName) => normalizeText(serviceName));
  const duplicateWarning = bookings.some((booking) => {
    if (!isActiveBooking(booking)) return false;
    if (normalizeText(booking.uid) !== normalizeText(request.auth.uid)) return false;

    return getBookingServices(booking).some((serviceName) =>
      selectedServiceKeys.includes(normalizeText(serviceName))
    );
  });

  return buildAvailabilityResponse({
    dentist,
    date,
    selectedServices,
    serviceOptions,
    bookings,
    duplicateWarning,
    closure,
  });
});

exports.createBooking = onCall(
  {
    enforceAppCheck: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Please sign in first to submit a booking.");
    }

    await assertRateLimit({
      uid: request.auth.uid,
      scope: "booking_create",
      minIntervalMs: BOOKING_CREATE_MIN_INTERVAL_MS,
      windowMs: BOOKING_CREATE_WINDOW_MS,
      maxCalls: BOOKING_CREATE_MAX_CALLS,
    });

    const payload = request.data || {};
    const uid = request.auth.uid;
    const dentistId = String(payload.dentistId || "").trim();
    const date = String(payload.date || "").trim();
    const time = String(payload.time || "").trim();
    const selectedServices = Array.isArray(payload.selectedServices)
      ? payload.selectedServices.map((entry) => String(entry || "").trim()).filter(Boolean)
      : [];
    const notes = String(payload.notes || "").trim().slice(0, 1000);
    const privacyConsentAccepted = payload.privacyConsentAccepted === true;

    if (!dentistId) {
      throw new HttpsError("invalid-argument", "Dentist ID is required.");
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new HttpsError("invalid-argument", "Date must use YYYY-MM-DD format.");
    }

    if (!/^\d{2}:\d{2}$/.test(time)) {
      throw new HttpsError("invalid-argument", "Time must use HH:mm format.");
    }

    if (!selectedServices.length) {
      throw new HttpsError("invalid-argument", "At least one service is required.");
    }

    if (selectedServices.length > 8) {
      throw new HttpsError("invalid-argument", "Too many services were requested at once.");
    }

    if (!privacyConsentAccepted) {
      throw new HttpsError("failed-precondition", "Privacy consent is required before booking.");
    }

    const bookingResult = await db.runTransaction(async (transaction) => {
      const patientRef = db.collection("patientProfiles").doc(uid);
      const dentistRef = db.collection("dentists").doc(dentistId);
      const servicesQuery = db.collection("clinicServices");
      const closuresQuery = db.collection("clinicClosures").where("date", "==", date);
      const bookingsQuery = db.collection("bookings").where("date", "==", date);

      const patientSnap = await transaction.get(patientRef);
      if (!patientSnap.exists) {
        throw new HttpsError("failed-precondition", "Please complete your patient profile before booking.");
      }

      const dentistSnap = await transaction.get(dentistRef);
      if (!dentistSnap.exists) {
        throw new HttpsError("not-found", "Selected dentist could not be found.");
      }

      const servicesSnap = await transaction.get(servicesQuery);
      const closuresSnap = await transaction.get(closuresQuery);
      const bookingsSnap = await transaction.get(bookingsQuery);

      const patientProfile = patientSnap.data() || {};
      const dentist = {
        id: dentistSnap.id,
        ...dentistSnap.data(),
      };
      const parsedName = {
        firstName: String(patientProfile.firstName || "").trim(),
        middleName: String(patientProfile.middleName || "").trim(),
        lastName: String(patientProfile.lastName || "").trim(),
      };
      const fullName = String(patientProfile.fullName || "").trim()
        || [parsedName.firstName, parsedName.middleName, parsedName.lastName].filter(Boolean).join(" ");
      const patientAge = String(patientProfile.age || "").trim();
      const patientPhone = String(patientProfile.phone || "").trim();

      if (!parsedName.firstName || !parsedName.lastName || !patientAge || !patientPhone) {
        throw new HttpsError("failed-precondition", "Please complete your patient profile before booking.");
      }

      if (dentist.archiveStatus === "Archived") {
        throw new HttpsError("failed-precondition", "Selected dentist is no longer active.");
      }

      const serviceOptions = getBookingServiceOptions(
        servicesSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() }))
      );

      const unknownServices = selectedServices.filter(
        (serviceName) => !serviceOptions.some((entry) => entry.name === serviceName)
      );
      if (unknownServices.length) {
        throw new HttpsError(
          "invalid-argument",
          `Unknown service selection: ${unknownServices.join(", ")}.`
        );
      }

      const closures = closuresSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      const closure = getActiveClosureForDate(closures, date);
      if (closure) {
        throw new HttpsError("failed-precondition", `${closure.label} blocks booking on this date.`);
      }

      const schedule = getDentistDaySchedule(dentist, date);
      if (!schedule.active) {
        throw new HttpsError("failed-precondition", "That dentist is inactive on the selected day.");
      }

      const durationMinutes = selectedServices.reduce((total, serviceName) => {
        const serviceRecord = serviceOptions.find((entry) => entry.name === serviceName);
        return total + Number(serviceRecord?.durationMinutes || 0);
      }, 0) || 60;
      const startMinutes = timeToMinutes(time);
      const endMinutes = startMinutes + durationMinutes;
      const scheduleStart = timeToMinutes(schedule.start);
      const scheduleEnd = timeToMinutes(schedule.end);
      const manilaNow = getManilaNowContext();

      if (startMinutes < scheduleStart || endMinutes > scheduleEnd) {
        throw new HttpsError("failed-precondition", "That time is outside the dentist's schedule.");
      }

      if (date === manilaNow.date && startMinutes < manilaNow.minutes) {
        throw new HttpsError("failed-precondition", "That time already passed. Choose a later time.");
      }

      const bookings = bookingsSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      const selectedServiceKeys = selectedServices.map((serviceName) => normalizeText(serviceName));
      const duplicateSameDayService = bookings.find((booking) => {
        if (!isActiveBooking(booking)) return false;
        if (normalizeText(booking.uid) !== normalizeText(uid)) return false;

        return getBookingServices(booking).some((serviceName) =>
          selectedServiceKeys.includes(normalizeText(serviceName))
        );
      });

      if (duplicateSameDayService) {
        throw new HttpsError(
          "already-exists",
          "You already have an active booking for one of these services on this date."
        );
      }

      const conflictingBooking = bookings.find((booking) => {
        if (!isActiveBooking(booking)) return false;
        const bookingDentistId = String(booking.dentistId || "").trim();
        const sameDentist = bookingDentistId
          ? bookingDentistId === dentist.id
          : normalizeText(booking.selectedDentist) === normalizeText(dentist.name);
        if (!sameDentist) return false;

        const bookingStart = timeToMinutes(booking.time);
        const bookingEnd = bookingStart + getBookingDurationMinutes(booking, serviceOptions);
        return doIntervalsOverlap(startMinutes, endMinutes, bookingStart, bookingEnd);
      });

      if (conflictingBooking) {
        throw new HttpsError("already-exists", "That appointment slot was just taken. Please choose another time.");
      }

      const lockIds = getSlotLockIds({
        dentistId: dentist.id,
        date,
        startMinutes,
        endMinutes,
      });
      const lockRefs = lockIds.map((lockId) => db.collection("bookingSlotLocks").doc(lockId));
      const lockSnaps = await Promise.all(lockRefs.map((lockRef) => transaction.get(lockRef)));
      const lockBookingIds = Array.from(
        new Set(
          lockSnaps
            .filter((lockSnap) => lockSnap.exists)
            .map((lockSnap) => String(lockSnap.data()?.bookingId || "").trim())
            .filter(Boolean)
        )
      );
      const lockBookingRefs = lockBookingIds.map((bookingId) => db.collection("bookings").doc(bookingId));
      const lockBookingSnaps = await Promise.all(
        lockBookingRefs.map((bookingRef) => transaction.get(bookingRef))
      );

      const activeLockedBooking = lockBookingSnaps.some((lockBookingSnap) =>
        lockBookingSnap.exists && isActiveBooking(lockBookingSnap.data() || {})
      );
      if (activeLockedBooking) {
        throw new HttpsError("already-exists", "That appointment slot was just taken. Please choose another time.");
      }

      const patientType = String(patientProfile.patientType || "New Patient").trim();
      const patientEmail = String(patientProfile.email || request.auth.token.email || "").trim();
      const selectedDentist = String(dentist.name || "").trim();
      const service = selectedServices.join(", ");
      const appointmentAt = admin.firestore.Timestamp.fromDate(createManilaAppointmentDate(date, time));
      const bookingRef = db.collection("bookings").doc();
      const createdAt = admin.firestore.FieldValue.serverTimestamp();

      const bookingData = {
        uid,
        patientProfileId: uid,
        email: patientEmail,
        firstName: parsedName.firstName,
        middleName: parsedName.middleName,
        lastName: parsedName.lastName,
        fullName,
        patientKey: fullName.toLowerCase(),
        age: patientAge,
        phone: patientPhone,
        patientType,
        selectedDentist,
        dentistId: dentist.id,
        service,
        services: selectedServices,
        serviceCount: selectedServices.length,
        estimatedDurationMinutes: durationMinutes,
        estimatedEndTime: minutesToTime(endMinutes),
        date,
        time,
        notes,
        privacyConsentAccepted: true,
        privacyConsentText:
          "I agree that my personal and medical information will be kept confidential and used for dental and clinic purposes only.",
        status: "pending",
        checkedInAt: null,
        appointmentAt,
        createdAt,
      };

      transaction.set(bookingRef, bookingData);
      lockRefs.forEach((lockRef) => {
        transaction.set(lockRef, {
          bookingId: bookingRef.id,
          dentistId: dentist.id,
          date,
          time,
          startMinutes,
          endMinutes,
          uid,
          createdAt,
        });
      });

      return {
        bookingId: bookingRef.id,
        selectedDentist,
        service,
        date,
        time,
        estimatedEndTime: bookingData.estimatedEndTime,
        estimatedDurationMinutes: durationMinutes,
      };
    });

    return bookingResult;
  }
);

exports.setBookingStatus = onCall(
  {},
  async (request) => {
    const staff = await getStaffContextFromRequest(request, ["admin", "receptionist"]);
    const bookingId = String(request.data?.bookingId || "").trim();
    const nextStatus = String(request.data?.status || "").trim().toLowerCase();

    if (!bookingId) {
      throw new HttpsError("invalid-argument", "Booking ID is required.");
    }

    if (!["pending", "approved", "cancelled"].includes(nextStatus)) {
      throw new HttpsError("invalid-argument", "Unsupported booking status.");
    }

    let updatedBooking = null;
    const now = admin.firestore.FieldValue.serverTimestamp();

    await db.runTransaction(async (transaction) => {
      const bookingRef = db.collection("bookings").doc(bookingId);
      const bookingSnap = await transaction.get(bookingRef);
      if (!bookingSnap.exists) {
        throw new HttpsError("not-found", "Booking could not be found.");
      }

      const booking = { id: bookingSnap.id, ...bookingSnap.data() };
      const updatePayload = {
        status: nextStatus,
        statusUpdatedAt: now,
      };

      if (nextStatus === "approved") {
        updatePayload.approvedAt = now;
      }

      if (nextStatus === "cancelled") {
        const { lockRefs, lockSnaps } = await getLockSnapshots(transaction, booking);
        deleteOwnedLocks(transaction, lockRefs, lockSnaps, bookingId);
      } else {
        const slot = await validateStaffBookingSlot(transaction, {
          bookingId,
          booking,
          nextDate: booking.date,
          nextTime: booking.time,
        });

        slot.lockRefs.forEach((lockRef) => {
          transaction.set(lockRef, {
            bookingId,
            dentistId: slot.window.dentistId,
            date: slot.window.date,
            time: slot.window.time,
            startMinutes: slot.window.startMinutes,
            endMinutes: slot.window.endMinutes,
            uid: booking.uid || "",
            updatedAt: now,
          });
        });
      }

      transaction.update(bookingRef, updatePayload);
      updatedBooking = {
        ...booking,
        ...updatePayload,
        status: nextStatus,
        approvedAt: nextStatus === "approved" ? admin.firestore.Timestamp.now() : booking.approvedAt || null,
      };
    });

    await writeStaffAuditLog(staff, {
      action: "update_booking_status",
      targetType: "booking",
      targetId: bookingId,
      targetLabel: getBookingTargetLabel(updatedBooking),
      details: {
        status: nextStatus,
        service: updatedBooking?.service || "",
        date: updatedBooking?.date || "",
        time: updatedBooking?.time || "",
      },
    });

    if (nextStatus === "approved" && updatedBooking) {
      await syncPatientRecordFromBookingServer(updatedBooking);
    }

    return { success: true, bookingId, status: nextStatus };
  }
);

exports.toggleBookingCheckIn = onCall(
  {},
  async (request) => {
    const staff = await getStaffContextFromRequest(request, ["admin", "receptionist"]);
    const bookingId = String(request.data?.bookingId || "").trim();

    if (!bookingId) {
      throw new HttpsError("invalid-argument", "Booking ID is required.");
    }

    let updatedBooking = null;
    let checkedIn = false;

    await db.runTransaction(async (transaction) => {
      const bookingRef = db.collection("bookings").doc(bookingId);
      const bookingSnap = await transaction.get(bookingRef);
      if (!bookingSnap.exists) {
        throw new HttpsError("not-found", "Booking could not be found.");
      }

      const booking = { id: bookingSnap.id, ...bookingSnap.data() };
      checkedIn = !booking.checkedInAt;
      const nextCheckedInAt = checkedIn ? admin.firestore.Timestamp.now() : null;

      transaction.update(bookingRef, {
        checkedInAt: nextCheckedInAt,
        statusUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      updatedBooking = {
        ...booking,
        checkedInAt: nextCheckedInAt,
      };
    });

    await writeStaffAuditLog(staff, {
      action: checkedIn ? "mark_booking_check_in" : "clear_booking_check_in",
      targetType: "booking",
      targetId: bookingId,
      targetLabel: getBookingTargetLabel(updatedBooking),
      details: {
        date: updatedBooking?.date || "",
        time: updatedBooking?.time || "",
      },
    });

    if (updatedBooking?.status === "approved") {
      await syncPatientRecordFromBookingServer(updatedBooking);
    }

    return { success: true, bookingId, checkedIn };
  }
);

exports.archiveBooking = onCall(
  {},
  async (request) => {
    const staff = await getStaffContextFromRequest(request, ["admin", "receptionist"]);
    const bookingId = String(request.data?.bookingId || "").trim();

    if (!bookingId) {
      throw new HttpsError("invalid-argument", "Booking ID is required.");
    }

    let booking = null;

    await db.runTransaction(async (transaction) => {
      const bookingRef = db.collection("bookings").doc(bookingId);
      const bookingSnap = await transaction.get(bookingRef);
      if (!bookingSnap.exists) {
        throw new HttpsError("not-found", "Booking could not be found.");
      }

      booking = { id: bookingSnap.id, ...bookingSnap.data() };
      const { lockRefs, lockSnaps } = await getLockSnapshots(transaction, booking);
      deleteOwnedLocks(transaction, lockRefs, lockSnaps, bookingId);

      transaction.update(bookingRef, {
        archiveStatus: "Archived",
        archivedAt: admin.firestore.FieldValue.serverTimestamp(),
        statusUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    await writeStaffAuditLog(staff, {
      action: "archive_booking",
      targetType: "booking",
      targetId: bookingId,
      targetLabel: getBookingTargetLabel(booking),
      details: {
        service: booking?.service || "",
        date: booking?.date || "",
      },
    });

    return { success: true, bookingId };
  }
);

exports.restoreBooking = onCall(
  {},
  async (request) => {
    const staff = await getStaffContextFromRequest(request, ["admin", "receptionist"]);
    const bookingId = String(request.data?.bookingId || "").trim();

    if (!bookingId) {
      throw new HttpsError("invalid-argument", "Booking ID is required.");
    }

    let booking = null;

    await db.runTransaction(async (transaction) => {
      const bookingRef = db.collection("bookings").doc(bookingId);
      const bookingSnap = await transaction.get(bookingRef);
      if (!bookingSnap.exists) {
        throw new HttpsError("not-found", "Booking could not be found.");
      }

      booking = { id: bookingSnap.id, ...bookingSnap.data() };
      const shouldRestoreLocks = isActiveBooking({
        ...booking,
        archiveStatus: "Active",
      }) && !isStoredBookingInPast(booking);

      if (shouldRestoreLocks) {
        const slot = await validateStaffBookingSlot(transaction, {
          bookingId,
          booking,
          nextDate: booking.date,
          nextTime: booking.time,
        });

        slot.lockRefs.forEach((lockRef) => {
          transaction.set(lockRef, {
            bookingId,
            dentistId: slot.window.dentistId,
            date: slot.window.date,
            time: slot.window.time,
            startMinutes: slot.window.startMinutes,
            endMinutes: slot.window.endMinutes,
            uid: booking.uid || "",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        });
      }

      transaction.update(bookingRef, {
        archiveStatus: "Active",
        restoredAt: admin.firestore.FieldValue.serverTimestamp(),
        statusUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    await writeStaffAuditLog(staff, {
      action: "restore_booking",
      targetType: "booking",
      targetId: bookingId,
      targetLabel: getBookingTargetLabel(booking),
      details: {
        service: booking?.service || "",
        date: booking?.date || "",
      },
    });

    return { success: true, bookingId };
  }
);

exports.deleteArchivedBooking = onCall(
  {},
  async (request) => {
    const staff = await getStaffContextFromRequest(request, ["admin", "receptionist"]);
    const bookingId = String(request.data?.bookingId || "").trim();

    if (!bookingId) {
      throw new HttpsError("invalid-argument", "Booking ID is required.");
    }

    let booking = null;

    await db.runTransaction(async (transaction) => {
      const bookingRef = db.collection("bookings").doc(bookingId);
      const bookingSnap = await transaction.get(bookingRef);
      if (!bookingSnap.exists) {
        throw new HttpsError("not-found", "Booking could not be found.");
      }

      booking = { id: bookingSnap.id, ...bookingSnap.data() };
      const archived = isArchivedValueForServer(booking.archiveStatus) || isArchivedValueForServer(booking.status);
      if (!archived) {
        throw new HttpsError("failed-precondition", "Only archived booking records can be deleted here.");
      }

      const { lockRefs, lockSnaps } = await getLockSnapshots(transaction, booking);
      deleteOwnedLocks(transaction, lockRefs, lockSnaps, bookingId);
      transaction.delete(bookingRef);
    });

    await writeStaffAuditLog(staff, {
      action: "delete_archived_record",
      targetType: "booking",
      targetId: bookingId,
      targetLabel: getBookingTargetLabel(booking),
      details: {
        service: booking?.service || "",
        date: booking?.date || "",
      },
    });

    return { success: true, bookingId };
  }
);

exports.recordAdminAuditLog = onCall(
  {},
  async (request) => {
    const staff = await getStaffContextFromRequest(request);
    const payload = request.data || {};
    const action = String(payload.action || "").trim().slice(0, 120);
    const targetType = String(payload.targetType || "").trim().slice(0, 80);
    const targetId = String(payload.targetId || "").trim().slice(0, 160);
    const targetLabel = String(payload.targetLabel || "").trim().slice(0, 240);

    if (!action || !targetType) {
      throw new HttpsError("invalid-argument", "Audit action and target type are required.");
    }

    await writeStaffAuditLog(staff, {
      action,
      targetType,
      targetId,
      targetLabel,
      details: sanitizeAuditDetailsForServer(payload.details),
    });

    return { success: true };
  }
);

exports.requestStaffMfaCode = onCall(
  {
    secrets: [gmailEmail, gmailAppPassword],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Please sign in first.");
    }

    await assertRateLimit({
      uid: request.auth.uid,
      scope: "staff_mfa_request",
      minIntervalMs: STAFF_MFA_REQUEST_MIN_INTERVAL_MS,
      windowMs: STAFF_MFA_REQUEST_WINDOW_MS,
      maxCalls: STAFF_MFA_REQUEST_MAX_CALLS,
    });

    const staffSnap = await db.collection("admins").doc(request.auth.uid).get();
    if (!staffSnap.exists) {
      throw new HttpsError("permission-denied", "Only staff accounts can request MFA.");
    }

    const staff = staffSnap.data() || {};
    if (staff.disabled) {
      throw new HttpsError("permission-denied", "This staff account is disabled.");
    }

    const staffRole = String(staff.role || "").trim().toLowerCase();
    const mfaEnabled = staffRole === "admin" || staff.mfaEnabled === true || staff.mfaRequired === true;
    if (!mfaEnabled) {
      return { required: false };
    }

    const recipientEmail = String(staff.email || request.auth.token.email || "").trim().toLowerCase();
    if (!recipientEmail) {
      throw new HttpsError("failed-precondition", "This staff account has no email address for MFA.");
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const salt = crypto.randomBytes(16).toString("hex");
    const codeHash = hashMfaCode(code, salt);
    const now = Date.now();
    const challengeRef = db.collection("staffMfaChallenges").doc();

    await challengeRef.set({
      uid: request.auth.uid,
      email: recipientEmail,
      codeHash,
      salt,
      expiresAt: admin.firestore.Timestamp.fromMillis(now + STAFF_MFA_CODE_TTL_MS),
      usedAt: null,
      attemptCount: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const mailer = createTransporter();
    await mailer.transporter.sendMail({
      from: mailer.senderEmail,
      to: recipientEmail,
      subject: "TopDent staff verification code",
      text: createStaffMfaEmailText({
        staffName: staff.name || request.auth.token.email || "Staff",
        code,
      }),
      html: createStaffMfaEmailHtml({
        staffName: staff.name || request.auth.token.email || "Staff",
        code,
      }),
    });

    await writeAuditLog({
      actorUid: request.auth.uid,
      actorName: staff.name || request.auth.token.email || "Staff",
      actorEmail: recipientEmail,
      actorRole: staff.role || "",
      action: "request_staff_mfa_code",
      targetType: "admin_account",
      targetId: request.auth.uid,
      targetLabel: recipientEmail,
    });

    return {
      required: true,
      challengeId: challengeRef.id,
      expiresInSeconds: Math.floor(STAFF_MFA_CODE_TTL_MS / 1000),
      emailHint: recipientEmail.replace(/^(.{2}).*(@.*)$/, "$1***$2"),
    };
  }
);

exports.verifyStaffMfaCode = onCall(
  {},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Please sign in first.");
    }

    await assertRateLimit({
      uid: request.auth.uid,
      scope: "staff_mfa_verify",
      minIntervalMs: STAFF_MFA_VERIFY_MIN_INTERVAL_MS,
      windowMs: STAFF_MFA_VERIFY_WINDOW_MS,
      maxCalls: STAFF_MFA_VERIFY_MAX_CALLS,
    });

    const challengeId = String(request.data?.challengeId || "").trim();
    const code = String(request.data?.code || "").trim();

    if (!challengeId || !/^\d{6}$/.test(code)) {
      throw new HttpsError("invalid-argument", "Enter the 6-digit verification code.");
    }

    const verifiedUntil = admin.firestore.Timestamp.fromMillis(Date.now() + STAFF_MFA_VERIFIED_MS);

    const verificationResult = await db.runTransaction(async (transaction) => {
      const staffRef = db.collection("admins").doc(request.auth.uid);
      const challengeRef = db.collection("staffMfaChallenges").doc(challengeId);
      const staffSnap = await transaction.get(staffRef);
      const challengeSnap = await transaction.get(challengeRef);

      if (!staffSnap.exists) {
        throw new HttpsError("permission-denied", "Only staff accounts can verify MFA.");
      }

      const staff = staffSnap.data() || {};
      if (staff.disabled) {
        throw new HttpsError("permission-denied", "This staff account is disabled.");
      }

      if (!challengeSnap.exists) {
        throw new HttpsError("not-found", "Verification code was not found.");
      }

      const challenge = challengeSnap.data() || {};
      if (challenge.uid !== request.auth.uid) {
        throw new HttpsError("permission-denied", "This verification code belongs to another account.");
      }

      if (challenge.usedAt) {
        throw new HttpsError("failed-precondition", "This verification code was already used.");
      }

      if (challenge.expiresAt?.toMillis && challenge.expiresAt.toMillis() < Date.now()) {
        throw new HttpsError("deadline-exceeded", "This verification code expired.");
      }

      if (Number(challenge.attemptCount || 0) >= 5) {
        throw new HttpsError("resource-exhausted", "Too many wrong attempts. Request a new code.");
      }

      const expectedHash = hashMfaCode(code, challenge.salt || "");
      if (expectedHash !== challenge.codeHash) {
        transaction.update(challengeRef, {
          attemptCount: admin.firestore.FieldValue.increment(1),
          lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { success: false };
      }

      transaction.update(challengeRef, {
        usedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      transaction.set(
        staffRef,
        {
          mfaLastVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
          mfaVerifiedUntil: verifiedUntil,
        },
        { merge: true }
      );

      return { success: true };
    });

    if (!verificationResult.success) {
      throw new HttpsError("invalid-argument", "Verification code is incorrect.");
    }

    return {
      success: true,
      verifiedUntil: verifiedUntil.toDate().toISOString(),
    };
  }
);

exports.approveReschedule = onCall(
  {},
  async (request) => {
    const staff = await getStaffContextFromRequest(request, ["admin", "receptionist"]);
    const bookingId = String(request.data?.bookingId || "").trim();

    if (!bookingId) {
      throw new HttpsError("invalid-argument", "Booking ID is required.");
    }

    let updatedBooking = null;
    let rescheduleRequest = null;

    await db.runTransaction(async (transaction) => {
      const bookingRef = db.collection("bookings").doc(bookingId);
      const bookingSnap = await transaction.get(bookingRef);
      if (!bookingSnap.exists) {
        throw new HttpsError("not-found", "Booking could not be found.");
      }

      const booking = { id: bookingSnap.id, ...bookingSnap.data() };
      rescheduleRequest = booking.rescheduleRequest || null;
      const requestedDate = String(rescheduleRequest?.requestedDate || "").trim();
      const requestedTime = String(rescheduleRequest?.requestedTime || "").trim();

      if (!requestedDate || !requestedTime || rescheduleRequest?.status !== "pending") {
        throw new HttpsError("failed-precondition", "This booking has no pending reschedule request.");
      }

      const oldLocks = await getLockSnapshots(transaction, booking);
      const slot = await validateStaffBookingSlot(transaction, {
        bookingId,
        booking,
        nextDate: requestedDate,
        nextTime: requestedTime,
      });
      const now = admin.firestore.FieldValue.serverTimestamp();

      deleteOwnedLocks(transaction, oldLocks.lockRefs, oldLocks.lockSnaps, bookingId);
      slot.lockRefs.forEach((lockRef) => {
        transaction.set(lockRef, {
          bookingId,
          dentistId: slot.window.dentistId,
          date: slot.window.date,
          time: slot.window.time,
          startMinutes: slot.window.startMinutes,
          endMinutes: slot.window.endMinutes,
          uid: booking.uid || "",
          updatedAt: now,
        });
      });

      const approvedRequest = {
        ...rescheduleRequest,
        status: "approved",
        reviewedAt: now,
        reviewedBy: staff.uid,
      };
      const updatePayload = {
        date: requestedDate,
        time: requestedTime,
        estimatedEndTime: slot.estimatedEndTime,
        appointmentAt: slot.appointmentAt,
        rescheduleRequest: approvedRequest,
        statusUpdatedAt: now,
      };

      transaction.update(bookingRef, updatePayload);
      updatedBooking = {
        ...booking,
        ...updatePayload,
        rescheduleRequest: approvedRequest,
      };
    });

    await writeStaffAuditLog(staff, {
      action: "approve_reschedule_request",
      targetType: "booking",
      targetId: bookingId,
      targetLabel: getBookingTargetLabel(updatedBooking),
      details: {
        requestedDate: rescheduleRequest?.requestedDate || "",
        requestedTime: rescheduleRequest?.requestedTime || "",
      },
    });

    if (updatedBooking?.status === "approved") {
      await syncPatientRecordFromBookingServer(updatedBooking);
    }

    return { success: true, bookingId };
  }
);

exports.declineReschedule = onCall(
  {},
  async (request) => {
    const staff = await getStaffContextFromRequest(request, ["admin", "receptionist"]);
    const bookingId = String(request.data?.bookingId || "").trim();

    if (!bookingId) {
      throw new HttpsError("invalid-argument", "Booking ID is required.");
    }

    let booking = null;
    let rescheduleRequest = null;

    await db.runTransaction(async (transaction) => {
      const bookingRef = db.collection("bookings").doc(bookingId);
      const bookingSnap = await transaction.get(bookingRef);
      if (!bookingSnap.exists) {
        throw new HttpsError("not-found", "Booking could not be found.");
      }

      booking = { id: bookingSnap.id, ...bookingSnap.data() };
      rescheduleRequest = booking.rescheduleRequest || null;
      if (!rescheduleRequest || rescheduleRequest.status !== "pending") {
        throw new HttpsError("failed-precondition", "This booking has no pending reschedule request.");
      }

      transaction.update(bookingRef, {
        rescheduleRequest: {
          ...rescheduleRequest,
          status: "declined",
          reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
          reviewedBy: staff.uid,
        },
      });
    });

    await writeStaffAuditLog(staff, {
      action: "decline_reschedule_request",
      targetType: "booking",
      targetId: bookingId,
      targetLabel: getBookingTargetLabel(booking),
      details: {
        requestedDate: rescheduleRequest?.requestedDate || "",
        requestedTime: rescheduleRequest?.requestedTime || "",
      },
    });

    return { success: true, bookingId };
  }
);

exports.sendApprovedBookingEmail = onDocumentUpdated(
  {
    document: "bookings/{bookingId}",
    secrets: [gmailEmail, gmailAppPassword],
  },
  async (event) => {
    const beforeData = event.data.before.data();
    const afterData = event.data.after.data();

    if (!afterData) return;

    const beforeStatus = String(beforeData?.status || "");
    const afterStatus = String(afterData.status || "");
    const recipientEmail = String(afterData.email || "").trim().toLowerCase();

    if (afterStatus !== "approved" || beforeStatus === "approved") {
      return;
    }

    if (!recipientEmail) {
      console.warn(`Booking ${event.params.bookingId} approved without patient email.`);
      return;
    }

    let mailer;
    try {
      mailer = createTransporter();
    } catch (error) {
      console.error(error.message);
      return;
    }

    await mailer.transporter.sendMail({
      from: mailer.senderEmail,
      to: recipientEmail,
      subject: "TopDent Booking Approved",
      text: createApprovalEmailText(afterData),
      html: createApprovalEmailHtml(afterData),
    });

    await event.data.after.ref.set(
      {
        approvedEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
);

exports.sendSubmittedBookingEmail = onDocumentCreated(
  {
    document: "bookings/{bookingId}",
    secrets: [gmailEmail, gmailAppPassword],
  },
  async (event) => {
    const booking = event.data.data();
    if (!booking) return;

    const recipientEmail = String(booking.email || "").trim().toLowerCase();
    if (!recipientEmail) {
      console.warn(`Booking ${event.params.bookingId} submitted without patient email.`);
      return;
    }

    let mailer;
    try {
      mailer = createTransporter();
    } catch (error) {
      console.error(error.message);
      return;
    }

    await mailer.transporter.sendMail({
      from: mailer.senderEmail,
      to: recipientEmail,
      subject: "TopDent Booking Received",
      text: createSubmittedEmailText(booking),
      html: createSubmittedEmailHtml(booking),
    });

    await event.data.ref.set(
      {
        submittedEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
);

exports.sendDayBeforeBookingReminders = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "Asia/Manila",
    secrets: [gmailEmail, gmailAppPassword],
  },
  async () => {
    await processReminderWindow({
      lowerMinutesAhead: 1425,
      upperMinutesAhead: 1455,
      sentField: "dayBeforeReminderSentAt",
      reminderType: "day_before",
      reminderLabel: "1 day before",
    });
  }
);

exports.sendHourBeforeBookingReminders = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "Asia/Manila",
    secrets: [gmailEmail, gmailAppPassword],
  },
  async () => {
    await processReminderWindow({
      lowerMinutesAhead: 45,
      upperMinutesAhead: 75,
      sentField: "hourBeforeReminderSentAt",
      reminderType: "hour_before",
      reminderLabel: "1 hour before",
    });
  }
);

exports.sendDayBeforeBracesAdjustmentReminders = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "Asia/Manila",
    secrets: [gmailEmail, gmailAppPassword],
  },
  async () => {
    await processBracesAdjustmentReminderWindow({
      lowerMinutesAhead: 1425,
      upperMinutesAhead: 1455,
      sentField: "dayBeforeReminderSentAt",
      reminderType: "day_before",
      reminderLabel: "1 day before",
    });
  }
);

exports.sendHourBeforeBracesAdjustmentReminders = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "Asia/Manila",
    secrets: [gmailEmail, gmailAppPassword],
  },
  async () => {
    await processBracesAdjustmentReminderWindow({
      lowerMinutesAhead: 45,
      upperMinutesAhead: 75,
      sentField: "hourBeforeReminderSentAt",
      reminderType: "hour_before",
      reminderLabel: "1 hour before",
    });
  }
);

exports.sendOverdueBracesPaymentReminders = onSchedule(
  {
    schedule: "every 12 hours",
    timeZone: "Asia/Manila",
    secrets: [gmailEmail, gmailAppPassword],
  },
  async () => {
    await processOverdueBracesPaymentReminders();
  }
);
