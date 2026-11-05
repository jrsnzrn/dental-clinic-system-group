import { BRACES_PACKAGE_INCLUSIONS, BRACES_TYPES, MAX_BOOKING_SERVICES, canBookService, isBracesPackage, isBracesPackageInclusion, isCrownTypeService, isGenericBracesPackage, selectBookingService } from "../../../functions/bookingServices.mjs";
import { getClinicDate } from "../../../functions/bookingWindow.mjs";
import { getBookingServiceOptions } from "../../utils/clinic";
import BookingCrownPicker from "../../components/BookingCrownPicker";
import SuccessDialog from "../../components/SuccessDialog";
import RecordPagination from "../../components/RecordPagination";
import useRecordPagination from "../../hooks/useRecordPagination";
import { useEffect, useMemo, useRef, useState } from "react";
import LoadingIndicator from "../../components/LoadingIndicator";
import { NavLink, Navigate, useParams, useSearchParams } from "react-router-dom";
import {
  Timestamp,
  collection,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../firebase";
import ConfirmDialog from "../../components/ConfirmDialog";
import PaymentReceipts from "../../components/PaymentReceipts";
import BookingPromotionSelect from "../../components/BookingPromotionSelect";
import EmptyState from "../../components/EmptyState";
import BookingToolbar from "../../components/BookingToolbar";
import { SkeletonList } from "../../components/LoadingSkeleton";
import { formatAppointmentStatusLabel, getAppointmentStatusClass, hasPendingCancellationRequest } from "../../utils/appointmentStatus";
import { formatDateLabel, formatTimeLabel, formatTimestamp } from "../../utils/schedule";

const SET_BOOKING_STATUS = httpsCallable(functions, "setBookingStatus");
const ARCHIVE_BOOKING = httpsCallable(functions, "archiveBooking");
const TOGGLE_BOOKING_CHECK_IN = httpsCallable(functions, "toggleBookingCheckIn");
const REASSIGN_BOOKING_DENTIST = httpsCallable(functions, "reassignBookingDentist");
const RESCHEDULE_BOOKING = httpsCallable(functions, "rescheduleBooking");
const CREATE_STAFF_WALK_IN_BOOKING = httpsCallable(functions, "createStaffWalkInBooking");
const GET_BOOKING_AVAILABILITY = httpsCallable(functions, "getBookingAvailability");
const WALK_IN_PATIENT_TYPES = ["Regular", "Ortho"];

function getEmptyWalkInDraft() {
  return {
    firstName: "", middleName: "", lastName: "", age: "", phone: "", email: "",
    patientType: "Regular", bracesType: "", dentistId: "", services: [], date: "", time: "",
  };
}

const BOOKING_FILTERS = {
  calendar: { label: "All", emptyText: "No appointments match the current filters." },
  pending: {
    label: "Pending",
    emptyText: "No pending bookings right now.",
  },
  approved: {
    label: "Approved",
    emptyText: "No approved bookings yet.",
  },
  "checked-in": {
    label: "Checked-in",
    emptyText: "No checked-in bookings yet.",
  },
  cancelled: {
    label: "Cancelled",
    emptyText: "No cancelled bookings.",
  },
  "no-show": { label: "No-show", emptyText: "No no-show appointments recorded." },
  completed: { label: "Completed", emptyText: "No completed treatments or appointments yet." },
};

const BOOKING_STATUS_FILTERS = ["calendar", "pending", "approved", "checked-in", "cancelled", "completed"];
const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
function timestampMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") {
    const milliseconds = value.toMillis();
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }
  if (typeof value.toDate === "function") {
    const milliseconds = value.toDate().getTime();
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "number") return value;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function formatPaymentAmount(value) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(value) || 0);
}

function compareOptionalValues(left, right, direction = 1) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return (left < right ? -1 : left > right ? 1 : 0) * direction;
}

function appointmentMillis(booking) {
  const appointmentTimestamp = timestampMillis(booking.appointmentAt);
  if (appointmentTimestamp != null) return appointmentTimestamp;

  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(booking.date || ""));
  const time = /^(\d{1,2}):(\d{2})$/.exec(String(booking.time || ""));
  if (!date || !time) return null;

  const [, year, month, day] = date.map(Number);
  const [, hour, minute] = time.map(Number);
  if (hour > 23 || minute > 59) return null;

  const appointmentDate = new Date(year, month - 1, day, hour, minute);
  if (
    appointmentDate.getFullYear() !== year ||
    appointmentDate.getMonth() !== month - 1 ||
    appointmentDate.getDate() !== day
  ) {
    return null;
  }
  return appointmentDate.getTime();
}

function compareBookings(left, right, sortBy) {
  let comparison = 0;
  if (sortBy === "newest" || sortBy === "oldest") {
    comparison = compareOptionalValues(
      timestampMillis(left.createdAt),
      timestampMillis(right.createdAt),
      sortBy === "newest" ? -1 : 1
    );
  } else {
    comparison = compareOptionalValues(
      appointmentMillis(left),
      appointmentMillis(right),
      sortBy === "appointment-asc" ? 1 : -1
    );
  }
  return comparison || String(left.id || "").localeCompare(String(right.id || ""));
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function getLocalDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getMonthCalendarDays(monthDate) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, index) => new Date(year, month, index + 1)),
  ];
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

function getBookingTimeRange(booking) {
  if (!booking?.time) return "Not set";
  const endTime = booking.estimatedEndTime
    || minutesToTime(timeToMinutes(booking.time) + Number(booking.estimatedDurationMinutes || 60));
  return `${formatTimeLabel(booking.time)} - ${formatTimeLabel(endTime)}`;
}

function getBookingDateTimeLabel(booking) {
  if (!booking?.date) return "Not set";
  return `${formatDateLabel(booking.date)} - ${formatTimeLabel(booking.time)}`;
}

function getBookingServices(booking) {
  const services = Array.isArray(booking?.services) && booking.services.length
    ? booking.services
    : String(booking?.service || "").split(",");
  return services.map((service) => String(service).trim()).filter(Boolean).join(", ") || "Not set";
}

function BookingRow({ booking, onOpen, highlighted }) {
  const reschedule = booking.rescheduleRequest;
  const displayStatus = booking.status === "approved" && booking.checkedInAt
    ? "checked_in"
    : booking.status || "pending";

  return (
    <tr
      id={`booking-row-${booking.id}`}
      className={`bookingRow clickable${highlighted ? " notificationHighlight" : ""}`}
      tabIndex={0}
      onClick={() => onOpen(booking.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(booking.id);
        }
      }}
    >
      <td className="bookingNameCell" data-label="Patient">
        <strong>{booking.fullName || "No name"}</strong>
      </td>
      <td data-label="Service">{booking.service || "Not set"}</td>
      <td data-label="Dentist">{booking.selectedDentist || "Not assigned"}</td>
      <td data-label="Date & time">
        <span>{booking.date ? formatDateLabel(booking.date) : "Not set"}</span>
        <small>{formatTimeLabel(booking.time)}</small>
      </td>
      <td data-label="Status">
        <span className={`bookingTableStatus bookingTableStatus-${getAppointmentStatusClass(displayStatus)}`}>
          {formatAppointmentStatusLabel(displayStatus)}
        </span>
        {reschedule?.status === "pending" ? (
          <span className="bookingTableStatus bookingTableStatus-pending">reschedule</span>
        ) : null}
        {hasPendingCancellationRequest(booking) ? (
          <span className="bookingTableStatus bookingTableStatus-cancelled">Cancellation requested</span>
        ) : null}
      </td>
    </tr>
  );
}

function BookingDetailValue({ value }) {
  const displayValue = value == null ? "" : String(value).trim();
  const isMissing = !displayValue || ["Not set", "Not available"].includes(displayValue);
  return (
    <span className={isMissing ? "bookingDetailsMissing" : undefined}>
      {isMissing ? "Not provided" : value}
    </span>
  );
}

function BookingDetailDrawer({
  open,
  booking,
  onClose,
  onApprove,
  onCheckIn,
  checkingIn,
  pendingAction,
  onCancel,
  onArchive,
  onReschedule,
  onReassign,
  actionError,
}) {
  const reschedule = booking?.rescheduleRequest;
  const cancellation = booking?.cancellationRequest;
  const cancellationPending = hasPendingCancellationRequest(booking);
  const busy = Boolean(pendingAction || checkingIn);
  const status = booking?.status || "pending";
  const headingStatus = booking?.checkedInAt ? "checked_in" : status;
  const headingClass = getAppointmentStatusClass(headingStatus);
  const headingLabel = status === "completed" ? "Complete" : formatAppointmentStatusLabel(headingStatus);
  const [paymentDetails, setPaymentDetails] = useState(null);
  const currentPaymentDetails = paymentDetails?.bookingId === booking?.id ? paymentDetails : null;
  const paymentSummaries = currentPaymentDetails?.summaries || [];
  const paymentReceipts = currentPaymentDetails?.receipts || [];
  const paymentError = currentPaymentDetails?.error || "";
  const paymentLoading = open && status === "completed" && !currentPaymentDetails;

  useEffect(() => {
    if (!open || status !== "completed" || !booking?.id) return undefined;
    const summariesQuery = query(
      collection(db, "paymentTreatmentSummaries"),
      where("appointmentId", "==", booking.id)
    );
    const receiptsQuery = query(collection(db, "payments"), where("appointmentId", "==", booking.id));
    const details = { bookingId: booking.id, summaries: [], receipts: [], error: "" };
    const pending = new Set(["summaries", "receipts"]);
    const errors = new Set();
    const publish = () => {
      if (!pending.size) setPaymentDetails({ ...details, error: errors.size ? "Some payment details could not be loaded. Please reopen this booking to retry." : "" });
    };
    const listen = (source, key) => onSnapshot(source, (snapshot) => {
      details[key] = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      pending.delete(key);
      errors.delete(key);
      publish();
    }, (error) => {
      console.error(`Appointment ${key} could not load:`, error);
      pending.delete(key);
      errors.add(key);
      publish();
    });
    const unsubscribeSummaries = listen(summariesQuery, "summaries");
    const unsubscribeReceipts = listen(receiptsQuery, "receipts");
    return () => {
      unsubscribeSummaries();
      unsubscribeReceipts();
    };
  }, [booking?.id, open, status]);

  return (
    <>
      <div className={`patientDrawerOverlay bookingDetailsOverlay ${open ? "open" : ""}`} onClick={onClose} />
      <div className={`patientDrawer bookingDetailsModal ${open ? "open" : ""}`} role="dialog" aria-modal="true">
        {booking ? (
          <div className="patientDrawerInner">
            <div className="patientDrawerHeader bookingDetailsHeader">
              <div className="bookingDetailsHeading">
                <span className={`bookingDetailsStatus bookingDetailsStatus-${headingClass}`}>
                  {headingLabel}
                </span>
              </div>
              <button type="button" className="patientDrawerCloseBtn" onClick={onClose} aria-label="Close" disabled={busy}>
                ×
              </button>
            </div>

            <div className="patientDrawerBody">
              {actionError ? <div className="formError" role="alert">{actionError}</div> : null}
              {cancellation ? (
                <section className={`bookingCancellationNotice${cancellationPending ? " attention" : ""}`} aria-label="Patient cancellation request">
                  <div className="bookingCancellationHeading">
                    <strong>Patient cancellation request</strong>
                    <span>{formatAppointmentStatusLabel(cancellation.status)}</span>
                  </div>
                  <p>{cancellation.reason || "No reason provided."}</p>
                  {cancellation.requestedAt ? <small>Requested {formatTimestamp(cancellation.requestedAt)}</small> : null}
                </section>
              ) : null}
              <dl className="detailList">
                <div className="detailRow bookingDetailsName">
                  <dt>Name</dt>
                  <dd><BookingDetailValue value={booking.fullName} /></dd>
                </div>
                <div className="detailRow">
                  <dt>Appointment</dt>
                  <dd><BookingDetailValue value={booking.date ? formatDateLabel(booking.date) : null} /></dd>
                </div>
                <div className="detailRow">
                  <dt>Time</dt>
                  <dd><BookingDetailValue value={booking.time ? getBookingTimeRange(booking) : null} /></dd>
                </div>
                <div className="detailRow">
                  <dt>Service</dt>
                  <dd><BookingDetailValue value={
                    (Array.isArray(booking.services) && booking.services.length) || booking.service
                      ? getBookingServices(booking)
                      : null
                  } /></dd>
                </div>
                <div className="detailRow">
                  <dt>Dentist</dt>
                  <dd><BookingDetailValue value={booking.selectedDentist} /></dd>
                </div>
                <div className="detailRow">
                  <dt>Age</dt>
                  <dd><BookingDetailValue value={booking.age} /></dd>
                </div>
                <div className="detailRow">
                  <dt>Type of Patient</dt>
                  <dd><BookingDetailValue value={booking.patientType} /></dd>
                  {booking.bracesPackage ? <><dt>Braces package</dt><dd>{booking.bracesPackage.type} · {booking.bracesPackage.inclusions.join(" · ")}</dd></> : null}
                  {booking.bracesFreeProcedure?.procedure ? <><dt>Free procedure used</dt><dd>{booking.bracesFreeProcedure.procedure}</dd></> : null}
                </div>
                <div className="detailRow">
                  <dt>Phone</dt>
                  <dd><BookingDetailValue value={booking.phone} /></dd>
                </div>
                <div className="detailRow">
                  <dt>Email</dt>
                  <dd><BookingDetailValue value={booking.email} /></dd>
                </div>
                <div className="detailRow">
                  <dt>Address</dt>
                  <dd><BookingDetailValue value={booking.address} /></dd>
                </div>
                <div className="detailRow">
                  <dt>Booked at</dt>
                  <dd><BookingDetailValue value={booking.createdAt ? formatTimestamp(booking.createdAt) : null} /></dd>
                </div>
                <div className="detailRow">
                  <dt>Arrival</dt>
                  <dd><BookingDetailValue value={
                    booking.checkedInAt ? `Checked in · ${formatTimestamp(booking.checkedInAt)}` : "Not checked in"
                  } /></dd>
                </div>
              </dl>

            {Array.isArray(booking.dentistAssignmentHistory) && booking.dentistAssignmentHistory.length ? (
              <div className="drawerNote">
                <span className="drawerNoteLabel">Dentist assignment history</span>
                {booking.dentistAssignmentHistory.map((entry, index) => (
                  <p key={`${entry.changedAt?.seconds || entry.changedByUid || "change"}-${index}`}>
                    {entry.fromDentistName || "Unassigned"} → {entry.toDentistName || "Unassigned"}
                    {entry.reason ? ` · ${entry.reason}` : ""}
                    {entry.changedByName ? ` · changed by ${entry.changedByName}` : ""}
                    {entry.changedAt ? ` · ${formatTimestamp(entry.changedAt)}` : ""}
                  </p>
                ))}
              </div>
            ) : null}

              {!["completed", "cancelled", "no-show"].includes(status) ? <BookingPromotionSelect key={booking.id} booking={booking} disabled={busy} /> : null}
              {status === "completed" ? (
                <div className="drawerNote bookingPaymentNote">
                  <span className="drawerNoteLabel">Payment details</span>
                  {paymentLoading ? <p><LoadingIndicator>Loading payment details…</LoadingIndicator></p> : null}
                  {paymentError ? <p role="status">{paymentError}</p> : null}
                  {!paymentLoading && !paymentError && paymentSummaries.length ? (
                    <dl className="appointmentPaymentDetails">
                      {paymentSummaries.map((summary) => {
                        const totalCost = Number(summary.totalCost) || 0;
                        const amountPaid = Number(summary.amountPaid) || 0;
                        return (
                          <div className="detailRow" key={summary.id}>
                            <dt>{summary.procedureName || summary.treatmentName || "Treatment"}</dt>
                            <dd>
                              {formatPaymentAmount(amountPaid)} paid of {formatPaymentAmount(totalCost)}
                              {" · "}{amountPaid >= totalCost ? "Fully paid" : "Balance due"}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  ) : null}
                  {!paymentLoading && !paymentError && !paymentSummaries.length && !paymentReceipts.length ? <p>No linked payment details. This booking has no saved payment summary or receipt.</p> : null}
                  {!paymentLoading && paymentReceipts.length ? (
                    <PaymentReceipts payments={paymentReceipts} patientName={booking.fullName || booking.name} booking={booking} />
                  ) : null}
                </div>
              ) : null}

              {booking.notes ? (
                <div className="drawerNote">
                  <span className="drawerNoteLabel">Patient notes</span>
                  <p>{booking.notes}</p>
                </div>
              ) : null}

              {reschedule ? (
                <div className={`drawerReschedule ${reschedule.status === "pending" ? "attention" : ""}`}>
                  <span className="drawerNoteLabel">Reschedule request</span>
                  <p>
                    Requested for <strong>{formatDateLabel(reschedule.requestedDate)}</strong> at{" "}
                    <strong>{formatTimeLabel(reschedule.requestedTime)}</strong>
                  </p>
                  <p>
                    Status: <strong>{formatAppointmentStatusLabel(reschedule.status || "pending")}</strong>
                    {reschedule.reason ? ` • ${reschedule.reason}` : ""}
                  </p>

                </div>
              ) : null}
            </div>

            {status === "completed" || status === "cancelled" ? (
              <div className="actionColumn actionColumnFriendly">
                <button className="btn secondary btnSoft patientActionBtn bookingArchiveButton" type="button" onClick={onArchive} disabled={busy}>
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M3.5 6.5h13v9.25a1.25 1.25 0 0 1-1.25 1.25h-10A1.25 1.25 0 0 1 4 15.75V6.5Z" />
                    <path d="M2.75 3.5h14.5v3H2.75zM8 10h4" />
                  </svg>
                  Archive
                </button>
              </div>
            ) : null}

            {status === "pending" || (status === "approved" && !booking.checkedInAt) || cancellationPending ? (
              <div className={`actionColumn actionColumnFriendly${cancellationPending ? " bookingCancellationActions" : ""}`}>
                {status === "pending" ? (
                  <button className="btn btnShine patientActionBtn" type="button" onClick={onApprove} disabled={busy} aria-busy={Boolean(pendingAction)}>
                    {pendingAction ? <LoadingIndicator>Approving…</LoadingIndicator> : cancellationPending ? "Approve booking" : "Approve"}
                  </button>
                ) : null}

                {status === "approved" && !booking.checkedInAt ? (
                  <>
                    <button
                      className="btn btnShine patientActionBtn"
                      type="button"
                      onClick={onCheckIn}
                      disabled={busy}
                      aria-busy={checkingIn}
                    >
                      {checkingIn ? <LoadingIndicator>Checking in…</LoadingIndicator> : "Mark as Check-in"}
                    </button>
                    <button className="btn secondary btnSoft patientActionBtn" type="button" onClick={onReschedule} disabled={busy}>
                      Reschedule
                    </button>
                    <button className="btn secondary btnSoft patientActionBtn" type="button" onClick={onReassign} disabled={busy}>
                      Reassign dentist
                    </button>
                  </>
                ) : null}
                <button className="btn danger patientActionBtn" type="button" onClick={onCancel} disabled={busy}>
                  {cancellationPending ? "Accept request" : "Cancel"}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}

function RescheduleModal({ open, booking, onClose, onSave }) {
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const isCancelled = booking?.status === "cancelled";

  // Prefill each time the popup opens
  useEffect(() => {
    if (!open || !booking) return;
    setNewDate(booking.date && booking.date >= todayStr ? booking.date : "");
    setNewTime(booking.time || "");
    setFormError("");
    setSaving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, booking?.id]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function submit() {
    if (!newDate || !newTime) {
      setFormError("Choose both a date and a time.");
      return;
    }
    if (newDate < todayStr) {
      setFormError("The new date can't be in the past.");
      return;
    }
    setFormError("");
    setConfirmOpen(true);
  }

  async function confirmReschedule() {
    setConfirmOpen(false);
    setSaving(true);
    setFormError("");
    try {
      await onSave(booking, newDate, newTime);
    } catch (error) {
      console.error(error);
      setFormError(error?.message || "The booking could not be rescheduled.");
      setSaving(false);
    }
  }

  return (
    <>
      <div className={`patientDrawerOverlay rescheduleOverlay ${open ? "open" : ""}`} onClick={onClose} />
      <div className={`patientDrawer rescheduleModal ${open ? "open" : ""}`} role="dialog" aria-modal="true">
        {booking ? (
          <div className="patientDrawerInner">
            <div className="patientDrawerHeader">
              <div>
                <span className="heroEyebrow">{isCancelled ? "Reschedule & restore" : "Reschedule"}</span>
                <h3>{booking.fullName || "No name"}</h3>
                <div className="patientRecordPeek">
                  <span>Current: {getBookingDateTimeLabel(booking)}</span>
                </div>
              </div>
              <button type="button" className="patientDrawerCloseBtn" onClick={onClose} aria-label="Close">
                ×
              </button>
            </div>

            <div className="rescheduleFields">
              <label>
                New date
                <input type="date" min={todayStr} value={newDate} onChange={(e) => setNewDate(e.target.value)} />
              </label>
              <label>
                New time
                <input type="time" step="900" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
              </label>
            </div>

            {isCancelled ? <p className="rescheduleHint">Saving will also restore this booking as approved.</p> : null}

            {formError ? (
              <div className="formError" role="alert">
                {formError}
              </div>
            ) : null}

            <div className="actionColumn actionColumnFriendly">
              <button className="btn btnShine patientActionBtn" type="button" onClick={submit} disabled={saving}>
                {saving ? <LoadingIndicator>Saving schedule…</LoadingIndicator> : "Save new schedule"}
              </button>
              <button className="btn secondary btnSoft patientActionBtn" type="button" onClick={onClose} disabled={saving}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="Confirm reschedule"
        message={`Reschedule ${booking?.fullName || "this patient"} to ${formatDateLabel(newDate)} at ${formatTimeLabel(newTime)}?`}
        confirmLabel="Confirm reschedule"
        onClose={() => setConfirmOpen(false)}
        onConfirm={confirmReschedule}
      />
    </>
  );
}

function ReassignDentistModal({ open, booking, dentists, onClose, onSave }) {
  const [dentistId, setDentistId] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const eligibleDentists = dentists.filter((dentist) => dentist.id !== booking?.dentistId && dentist.linkedStaffUid);

  async function submit() {
    if (!dentistId) return setFormError("Choose the covering dentist.");
    if (!reason.trim()) return setFormError("Enter why this appointment is being reassigned.");
    setSaving(true);
    setFormError("");
    try {
      await onSave(booking, dentistId, reason.trim());
    } catch (error) {
      setFormError(error?.message || "The appointment could not be reassigned.");
      setSaving(false);
    }
  }

  return (
    <>
      <div className={`patientDrawerOverlay rescheduleOverlay ${open ? "open" : ""}`} onClick={onClose} />
      <div className={`patientDrawer rescheduleModal ${open ? "open" : ""}`} role="dialog" aria-modal="true" aria-label="Reassign appointment dentist">
        {booking ? (
          <div className="patientDrawerInner">
            <div className="patientDrawerHeader">
              <div>
                <span className="heroEyebrow">Appointment coverage</span>
                <h3>{booking.fullName || "Patient appointment"}</h3>
                <div className="patientRecordPeek"><span>Currently assigned to {booking.selectedDentist || "no dentist"}</span></div>
              </div>
              <button type="button" className="patientDrawerCloseBtn" onClick={onClose} aria-label="Close">×</button>
            </div>
            <div className="rescheduleFields">
              <label>
                Covering dentist
                <select value={dentistId} onChange={(event) => setDentistId(event.target.value)}>
                  <option value="">Choose a dentist</option>
                  {eligibleDentists.map((dentist) => (
                    <option key={dentist.id} value={dentist.id}>{dentist.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Reason for reassignment
                <textarea value={reason} maxLength={500} rows={3} onChange={(event) => setReason(event.target.value)} placeholder="For example: original dentist unavailable" />
              </label>
            </div>
            <p className="rescheduleHint">The original assignment and this change will be kept in the appointment history.</p>
            {formError ? <div className="formError" role="alert">{formError}</div> : null}
            <div className="actionColumn actionColumnFriendly">
              <button className="btn btnShine patientActionBtn" type="button" onClick={submit} disabled={saving || !eligibleDentists.length}>
                {saving ? <LoadingIndicator>Reassigning…</LoadingIndicator> : "Reassign appointment"}
              </button>
              <button className="btn secondary btnSoft patientActionBtn" type="button" onClick={onClose} disabled={saving}>Cancel</button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

export default function Bookings({ search, onSearchChange, sortBy, onSortChange }) {
  const [bookings, setBookings] = useState([]);
  const [dentists, setDentists] = useState([]);
  const [clinicServices, setClinicServices] = useState([]);
  const [loadingServices, setLoadingServices] = useState(true);
  const [serviceLoadError, setServiceLoadError] = useState("");
  const [loadingBookings, setLoadingBookings] = useState(true);
  const [confirmState, setConfirmState] = useState(null);
  const [actionError, setActionError] = useState("");
  const [pendingAction, setPendingAction] = useState("");
  const actionInFlight = useRef(false);
  const [checkInPendingId, setCheckInPendingId] = useState(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [selectedBookingId, setSelectedBookingId] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [rescheduleId, setRescheduleId] = useState(null);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignId, setReassignId] = useState(null);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [walkInDraft, setWalkInDraft] = useState(getEmptyWalkInDraft());
  const [walkInSaving, setWalkInSaving] = useState(false);
  const [walkInError, setWalkInError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [walkInTimeOptions, setWalkInTimeOptions] = useState([]);
  const [loadingWalkInTimes, setLoadingWalkInTimes] = useState(false);
  const [walkInAvailabilityError, setWalkInAvailabilityError] = useState("");
  const { status = "pending" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedBookingId = searchParams.get("bookingId");
  const requestedHighlightIds = searchParams.getAll("highlightId");
  const requestedHighlightKey = requestedHighlightIds.join("\u0000");
  const requestedDate = searchParams.get("date") || "";
  const [highlightedBookingIds, setHighlightedBookingIds] = useState([]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "bookings"), (snap) => {
      setBookings(
        snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }))
      );
      setLoadingBookings(false);
    }, (readError) => {
      console.error("Bookings could not load appointment records:", readError);
      setActionError("Appointments could not be loaded. Please try again.");
      setLoadingBookings(false);
    });

    return () => unsub();
  }, []);

  useEffect(() => onSnapshot(collection(db, "dentists"), (snapshot) => {
    setDentists(snapshot.docs
      .map((entry) => ({ id: entry.id, ...entry.data() }))
      .filter((dentist) => dentist.archiveStatus !== "Archived" && dentist.active !== false)
      .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""))));
  }, (readError) => {
    console.error("Dentists could not load for appointment coverage:", readError);
    setActionError("The dentist list could not be loaded. Please try again.");
  }), []);

  useEffect(() => onSnapshot(collection(db, "clinicServices"), (snapshot) => {
    const options = getBookingServiceOptions(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    setClinicServices(options);
    setWalkInDraft((current) => {
      const services = current.services.filter((name) => options.some((option) => option.name === name && canBookService(option, current.patientType)));
      return services.length === current.services.length ? current : { ...current, services, time: "" };
    });
    setServiceLoadError("");
    setLoadingServices(false);
  }, (readError) => {
    console.error("Clinic services could not load for walk-in booking:", readError);
    setServiceLoadError("The clinic service list could not be loaded.");
    setLoadingServices(false);
  }), []);

  const walkInOptions = clinicServices.filter((service) => canBookService(service, walkInDraft.patientType));
  const walkInPackage = walkInOptions.find((service) => walkInDraft.services.includes(service.name) && isBracesPackage(service));
  const walkInNeedsBracesType = Boolean(walkInPackage && isGenericBracesPackage(walkInPackage));
  useEffect(() => {
    if (!walkInOpen || !walkInDraft.dentistId || !walkInDraft.date || !walkInDraft.services.length) {
      setWalkInTimeOptions([]);
      setWalkInAvailabilityError("");
      setLoadingWalkInTimes(false);
      return undefined;
    }

    let cancelled = false;
    setLoadingWalkInTimes(true);
    setWalkInAvailabilityError("");
    setWalkInTimeOptions([]);
    const requestTimer = window.setTimeout(() => {
      GET_BOOKING_AVAILABILITY({
        dentistId: walkInDraft.dentistId,
        date: walkInDraft.date,
        selectedServices: walkInDraft.services,
      })
        .then((response) => {
          if (cancelled) return;
          const options = (Array.isArray(response.data?.slotOptions) ? response.data.slotOptions : [])
            .filter((option) => !option.disabled)
            .map((option) => option.value);
          setWalkInTimeOptions(options);
          setWalkInDraft((current) => ({
            ...current,
            time: options.includes(current.time) ? current.time : options[0] || "",
          }));
        })
        .catch((error) => {
          if (cancelled) return;
          console.error("Walk-in appointment availability could not load:", error);
          setWalkInTimeOptions([]);
          setWalkInAvailabilityError(error?.message || "Could not load available times. Please try again.");
        })
        .finally(() => {
          if (!cancelled) setLoadingWalkInTimes(false);
        });
    }, 2100);

    return () => {
      cancelled = true;
      window.clearTimeout(requestTimer);
    };
  }, [walkInOpen, walkInDraft.date, walkInDraft.dentistId, walkInDraft.services]);

  useEffect(() => {
    if (!walkInOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !walkInSaving) setWalkInOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [walkInOpen, walkInSaving]);

  // Resolve deep-link state after the Firestore booking snapshot is available.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if ((!requestedBookingId && !requestedHighlightKey && !requestedDate) || loadingBookings) return;

    const activeIds = new Set(
      bookings
        .filter((booking) => booking.archiveStatus !== "Archived")
        .map((booking) => booking.id)
    );
    const highlightIds = requestedHighlightKey
      ? requestedHighlightKey.split("\u0000").filter((id) => activeIds.has(id))
      : requestedBookingId && activeIds.has(requestedBookingId)
        ? [requestedBookingId]
        : [];
    const target = requestedBookingId
      ? bookings.find((booking) => booking.id === requestedBookingId && activeIds.has(booking.id))
      : null;

    if (requestedDate) {
      setSelectedDate(/^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : "");
    }

    if (target) {
      setActionError("");
      setSelectedBookingId(target.id);
      setDrawerOpen(true);
    } else if ((requestedBookingId || requestedHighlightKey) && !highlightIds.length) {
      setActionError("The referenced appointments could not be found or are no longer available.");
    } else {
      setActionError("");
    }
    setHighlightedBookingIds(highlightIds);

    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("bookingId");
      next.delete("highlightId");
      next.delete("date");
      return next;
    }, { replace: true });
  }, [bookings, loadingBookings, requestedBookingId, requestedHighlightKey, requestedDate, setSearchParams]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const activeBookings = useMemo(
    () => bookings.filter((booking) => booking.archiveStatus !== "Archived"),
    [bookings]
  );

  const clinicToday = getClinicDate();
  const calendarDays = useMemo(() => getMonthCalendarDays(calendarMonth), [calendarMonth]);
  const calendarCounts = useMemo(
    () => activeBookings.reduce((counts, booking) => {
      if (booking.date) counts.set(booking.date, (counts.get(booking.date) || 0) + 1);
      return counts;
    }, new Map()),
    [activeBookings]
  );
  // Live version of the selected booking, so the popup updates after an action
  const selectedBooking = useMemo(
    () => bookings.find((b) => b.id === selectedBookingId) || null,
    [bookings, selectedBookingId]
  );

  function openBooking(id) {
    if (actionInFlight.current) return;
    setSelectedBookingId(id);
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false); // keep the id so the popup fades out smoothly
  }

  const rescheduleBooking = useMemo(
    () => bookings.find((b) => b.id === rescheduleId) || null,
    [bookings, rescheduleId]
  );
  const reassignBooking = useMemo(
    () => bookings.find((booking) => booking.id === reassignId) || null,
    [bookings, reassignId]
  );
  function openReschedule(id) {
    setDrawerOpen(false);
    setRescheduleId(id);
    setRescheduleOpen(true);
  }
  function closeReschedule() {
    setRescheduleOpen(false);
  }
  function openReassign(id) {
    setDrawerOpen(false);
    setReassignId(id);
    setReassignOpen(true);
  }
  function closeReassign() {
    setReassignOpen(false);
  }

  async function saveReassignment(booking, dentistId, reason) {
    await REASSIGN_BOOKING_DENTIST({ bookingId: booking.id, dentistId, reason });
    closeReassign();
    setActionSuccess("The appointment has been reassigned to the selected dentist.");
  }

  async function saveReschedule(booking, date, time) {
    await RESCHEDULE_BOOKING({ bookingId: booking.id, date, time });
    closeReschedule();
    setActionSuccess(`Appointment rescheduled to ${formatDateLabel(date)} at ${formatTimeLabel(time)}.`);
  }

  // Close popup with Escape (must stay above the early return below)
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape" && !actionInFlight.current) setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  async function runBookingAction(action, label = "Saving changes…", successMessage = "") {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setPendingAction(label);
    setActionError("");
    try {
      await action();
      if (successMessage) setActionSuccess(successMessage);
    } catch (error) {
      console.error(error);
      setActionError(error?.code === "functions/internal"
        ? "The server could not finish this action. Confirm the latest Cloud Functions are deployed; if it continues, check Firebase Functions logs."
        : error?.message || "The booking action could not be completed.");
    } finally {
      actionInFlight.current = false;
      setPendingAction("");
    }
  }

  async function setStatus(id, nextStatus) {
    await SET_BOOKING_STATUS({ bookingId: id, status: nextStatus });
  }

  async function archiveBooking(id) {
    await ARCHIVE_BOOKING({ bookingId: id });
  }

  function updateWalkInDraft(key, value) {
    setWalkInDraft((current) => ({
      ...current,
      [key]: value,
      ...(["date", "dentistId", "patientType"].includes(key) ? { time: "" } : {}),
      ...(key === "patientType" ? { services: current.services.filter((name) => clinicServices.some((service) => service.name === name && canBookService(service, value))) } : {}),
      ...(key === "patientType" && value !== "Ortho" ? { bracesType: "" } : {}),
    }));
    setWalkInError("");
  }

  function toggleWalkInService(service) {
    setWalkInDraft((current) => ({
      ...current,
      services: selectBookingService(current.services, service, walkInOptions),
      ...(isGenericBracesPackage(service) && current.services.includes(service.name) ? { bracesType: "" } : {}),
      time: "",
    }));
    setWalkInError("");
  }

  async function createWalkInBooking(event) {
    event.preventDefault();
    if (walkInSaving) return;
    if (!walkInDraft.services.length) {
      setWalkInError("Choose at least one service.");
      return;
    }
    if (!walkInTimeOptions.includes(walkInDraft.time)) {
      setWalkInError("Choose an available appointment time.");
      return;
    }

    setWalkInSaving(true);
    setWalkInError("");
    setActionSuccess("");
    const fullName = [walkInDraft.firstName, walkInDraft.middleName, walkInDraft.lastName]
      .map((value) => value.trim())
      .filter(Boolean)
      .join(" ");
    try {
      await CREATE_STAFF_WALK_IN_BOOKING({
        patient: {
          firstName: walkInDraft.firstName.trim(),
          middleName: walkInDraft.middleName.trim(),
          lastName: walkInDraft.lastName.trim(),
          age: String(walkInDraft.age).trim(),
          phone: walkInDraft.phone.trim(),
          email: walkInDraft.email.trim(),
          patientType: walkInDraft.patientType,
          bracesType: walkInNeedsBracesType ? walkInDraft.bracesType : "",
        },
        appointment: {
          dentistId: walkInDraft.dentistId,
          services: walkInDraft.services,
          date: walkInDraft.date,
          time: walkInDraft.time,
        },
      });
      setWalkInOpen(false);
      setWalkInDraft(getEmptyWalkInDraft());
      setWalkInTimeOptions([]);
      setActionSuccess(`Walk-in patient ${fullName} and appointment added to Bookings.`);
    } catch (error) {
      console.error("Walk-in appointment could not be created:", error);
      setWalkInError(
        error?.code === "functions/internal" || error?.code === "functions/unavailable"
          ? "The walk-in booking service is unavailable right now. Please try again later or contact the administrator."
          : error?.message || "Could not create the walk-in patient and appointment. Please try again."
      );
    } finally {
      setWalkInSaving(false);
    }
  }

  async function toggleCheckIn(booking) {
    const result = await TOGGLE_BOOKING_CHECK_IN({ bookingId: booking.id });
    const checkedInAtMillis = result.data?.checkedInAt;
    if (!Number.isFinite(checkedInAtMillis)) {
      throw new Error("Check-in succeeded, but its recorded timestamp could not be confirmed.");
    }
    return Timestamp.fromMillis(checkedInAtMillis);
  }

  const activeConfig = BOOKING_FILTERS[status] || BOOKING_FILTERS.calendar;
  const searchTerm = search.trim().toLocaleLowerCase();
  const activeItems = useMemo(
    () => activeBookings
      .filter((booking) => {
        if (status === "completed") {
          if (String(booking.status || "").toLowerCase() !== "completed") return false;
        } else if (status === "checked-in") {
          if (booking.status !== "approved" || !booking.checkedInAt) return false;
        } else if (status === "approved" && (booking.status !== "approved" || booking.checkedInAt)) {
          return false;
        } else if (status !== "calendar" && status !== "approved" && (booking.status || "pending") !== status) {
          return false;
        }
        if (selectedDate && booking.date !== selectedDate) return false;
        if (!searchTerm) return true;
        return [booking.fullName, booking.id, booking.uid, booking.patientProfileId, booking.service]
          .some((value) => String(value || "").toLocaleLowerCase().includes(searchTerm));
      })
      .sort((left, right) => compareBookings(left, right, sortBy)),
    [activeBookings, searchTerm, selectedDate, sortBy, status]
  );
  const bookingPage = useRecordPagination(activeItems, JSON.stringify([searchTerm, selectedDate, sortBy, status]));
  const setBookingPage = bookingPage.setPage;
  const selectedDateCount = selectedDate ? calendarCounts.get(selectedDate) || 0 : 0;

  useEffect(() => {
    if (!highlightedBookingIds.length) return;
    const index = activeItems.findIndex(booking => booking.id === highlightedBookingIds[0]);
    if (index >= 0) setBookingPage(Math.floor(index / 20) + 1);
  }, [activeItems, highlightedBookingIds, setBookingPage]);

  useEffect(() => {
    if (!highlightedBookingIds.length) return undefined;

    document.getElementById(`booking-row-${highlightedBookingIds[0]}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    const timeoutId = window.setTimeout(() => setHighlightedBookingIds([]), 7000);
    return () => window.clearTimeout(timeoutId);
  }, [activeItems, highlightedBookingIds, bookingPage.page]);

  if (!BOOKING_FILTERS[status]) {
    return <Navigate to="/admin/bookings/pending" replace />;
  }

  function openConfirm(config) {
    setConfirmState(config);
  }

  function requestArchiveBooking(booking) {
    if (!booking || !["completed", "cancelled"].includes(String(booking.status || "").toLowerCase())) return;
    openConfirm({
      title: "Archive this booking?",
      message: "The booking will move to Archive → Bookings. You can restore it later.",
      confirmLabel: "Archive booking",
      successMessage: "Booking moved to Archive. You can restore it from the Archive page.",
      action: () => archiveBooking(booking.id),
    });
  }

  async function handleConfirmAction() {
    if (!confirmState?.action || actionInFlight.current) return;
    const action = confirmState.action;
    setConfirmState(null);
    await runBookingAction(action, confirmState.tone === "archive" ? "Archiving booking…" : "Updating booking…", confirmState.successMessage);
  }

  return (
    <div className="container adminSurface bookingManagementPage">
      {pendingAction && !drawerOpen ? <div className="bookingActionProgress"><LoadingIndicator>{pendingAction}</LoadingIndicator></div> : null}
      {actionError ? (
        <div className="formError bookingActionError" role="alert">
          {actionError}
        </div>
      ) : null}
      <SuccessDialog message={actionSuccess} onConfirm={() => setActionSuccess("")} />

      <header className="bookingPageHeader">
        <div>
          <h1>Appointments</h1>
          <p>Manage appointments and walk-in patients.</p>
        </div>
        <button
          type="button"
          className="btn btnPrimary bookingWalkInButton"
          onClick={() => {
            setWalkInError("");
            setActionSuccess("");
            setWalkInOpen(true);
          }}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M10 4v12M4 10h12" />
          </svg>
          Add Patient
        </button>
      </header>

      <div className="bookingManagementGrid">
        <section className="bookingListPanel" aria-label="Appointment list">
          <nav className="bookingStatusFilters" aria-label="Filter appointments by status">
            {BOOKING_STATUS_FILTERS.map((filter) => (
              <NavLink
                key={filter}
                to={`/admin/bookings/${filter}`}
                end
                className={({ isActive }) => `bookingStatusFilter${isActive ? " active" : ""}`}
              >
                <span>{BOOKING_FILTERS[filter].label}</span>
              </NavLink>
            ))}
            {!loadingBookings ? (
              <span className="bookingStatusTotal" aria-label={`${activeItems.length} appointments`}>
                {activeItems.length}
              </span>
            ) : null}
          </nav>
          <BookingToolbar
            className="bookingPageToolbar"
            search={search}
            onSearchChange={onSearchChange}
            sortBy={sortBy}
            onSortChange={onSortChange}
          />

          {selectedDate ? (
            <div className="bookingDateFilter" role="status">
              <span>Showing appointments for <strong>{formatDateLabel(selectedDate)}</strong></span>
              <button type="button" onClick={() => setSelectedDate("")}>Clear date</button>
            </div>
          ) : null}

          {loadingBookings ? (
            <SkeletonList count={4} label="Loading bookings…" />
          ) : activeItems.length ? (
            <div className="bookingsTableWrap">
              <table className="bookingsTable">
                <thead>
                  <tr>
                    <th>Patient</th>
                    <th>Service</th>
                    <th>Dentist</th>
                    <th>Date &amp; time</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {bookingPage.items.map((booking) => (
                    <BookingRow
                      key={booking.id}
                      booking={booking}
                      onOpen={openBooking}
                      highlighted={highlightedBookingIds.includes(booking.id)}
                    />
                  ))}
                </tbody>
              </table>
              <RecordPagination pagination={bookingPage} />
            </div>
          ) : (
            <EmptyState
              title="No appointments found"
              message={activeConfig.emptyText}
            />
          )}
        </section>

        <aside className="bookingCalendarPanel" aria-label="Monthly appointment calendar">
          <div className="bookingMonthHeader">
            <button
              className="bookingMonthNav"
              type="button"
              aria-label="Previous month"
              onClick={() => setCalendarMonth((month) => new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.5 4.5-5.5 5.5 5.5 5.5" /></svg>
            </button>
            <h2>{calendarMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}{loadingBookings ? <> <LoadingIndicator>Loading appointments…</LoadingIndicator></> : null}</h2>
            <button
              className="bookingMonthNav"
              type="button"
              aria-label="Next month"
              onClick={() => setCalendarMonth((month) => new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7.5 4.5 5.5 5.5-5.5 5.5" /></svg>
            </button>
          </div>
          <div className="bookingMonthGrid" role="group" aria-label="Select an appointment date">
            {WEEKDAY_LABELS.map((weekday) => (
              <span key={weekday} className="bookingWeekday">{weekday}</span>
            ))}
            {calendarDays.map((date, index) => {
              if (!date) return <span key={`blank-${index}`} className="bookingDayBlank" aria-hidden="true" />;
              const dateKey = getLocalDateKey(date);
              const count = calendarCounts.get(dateKey) || 0;
              const isToday = dateKey === clinicToday;
              const isPast = dateKey < clinicToday;
              const isSelected = dateKey === selectedDate;
              const highlightToday = isToday && (!selectedDate || isSelected);
              return (
                <button
                  key={dateKey}
                  type="button"
                  aria-label={`${date.toLocaleDateString(undefined, { dateStyle: "full" })}, ${count} appointment${count === 1 ? "" : "s"}`}
                  aria-pressed={isSelected}
                  className={`bookingMonthDay${isPast ? " past" : ""}${highlightToday ? " today" : ""}${isSelected ? " selected" : ""}${count ? " hasAppointments" : ""}`}
                  onClick={() => setSelectedDate(isSelected ? "" : dateKey)}
                >
                  <span>{date.getDate()}</span>
                  {count && !isSelected ? <i aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
          <div className="bookingCalendarSummary">
            {selectedDate ? (
              <>
                <div>
                  <strong>{formatDateLabel(selectedDate)}</strong>
                  <span>{selectedDateCount} appointment{selectedDateCount === 1 ? "" : "s"} scheduled</span>
                </div>
                <button type="button" onClick={() => setSelectedDate("")}>All dates</button>
              </>
            ) : (
              <>
                <div>
                  <strong>All dates</strong>
                  <span>Select a day to filter appointments</span>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>

      <BookingDetailDrawer
        open={drawerOpen}
        booking={selectedBooking}
        actionError={actionError}
        checkingIn={selectedBooking?.id === checkInPendingId}
        pendingAction={pendingAction}
        onClose={() => { if (!actionInFlight.current) closeDrawer(); }}
        onApprove={() =>
          selectedBooking &&
          runBookingAction(async () => {
            await setStatus(selectedBooking.id, "approved");
            closeDrawer();
          }, "Approving appointment…", `Appointment for ${selectedBooking.fullName || "the patient"} approved successfully.`)
        }
        onReschedule={() => selectedBooking && openReschedule(selectedBooking.id)}
        onReassign={() => selectedBooking && openReassign(selectedBooking.id)}
        onCheckIn={() => {
          const b = selectedBooking;
          if (!b || b.checkedInAt || actionInFlight.current || checkInPendingId === b.id) return;
          setCheckInPendingId(b.id);
          runBookingAction(async () => {
            try {
              const checkedInAt = await toggleCheckIn(b);
              setBookings((current) =>
                current.map((booking) =>
                  booking.id === b.id ? { ...booking, checkedInAt } : booking
                )
              );
            } finally {
              setCheckInPendingId(null);
            }
          }, "Checking in patient…", `${b.fullName || "Patient"} checked in successfully.`);
        }}
        onCancel={() => {
          const b = selectedBooking;
          if (!b) return;
          const cancellationPending = hasPendingCancellationRequest(b);
          closeDrawer();
          openConfirm({
            title: cancellationPending ? "Accept this cancellation request?" : "Cancel this booking?",
            message: "This booking will remain in the Cancelled tab until you choose to archive it.",
            confirmLabel: cancellationPending ? "Accept and cancel booking" : "Cancel",
            showCancelButton: false,
            successMessage: "Appointment cancelled successfully. It is now in the Cancelled tab.",
            tone: "danger",
            action: () => setStatus(b.id, "cancelled"),
          });
        }}
        onArchive={() => {
          const booking = selectedBooking;
          if (!booking) return;
          closeDrawer();
          requestArchiveBooking(booking);
        }}
      />

      {reassignOpen ? (
        <ReassignDentistModal
          open={reassignOpen}
          booking={reassignBooking}
          dentists={dentists}
          onClose={closeReassign}
          onSave={saveReassignment}
        />
      ) : null}

      <RescheduleModal
        open={rescheduleOpen}
        booking={rescheduleBooking}
        onClose={closeReschedule}
        onSave={saveReschedule}
      />

      {walkInOpen ? (
        <div className="modalOverlay addPatientModalOverlay" onClick={() => { if (!walkInSaving) setWalkInOpen(false); }} role="presentation">
          <form
            className="modalCard addPatientModal walkInBookingModal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="walk-in-booking-title"
            onClick={(event) => event.stopPropagation()}
            onSubmit={createWalkInBooking}
          >
            <div className="modalHead">
              <h2 id="walk-in-booking-title" className="modalTitle">Add Walk-In Patient &amp; Appointment</h2>
              <button type="button" className="iconBtn" aria-label="Close" disabled={walkInSaving} onClick={() => setWalkInOpen(false)}>&times;</button>
            </div>
            <div className="modalBody addPatientModalBody">
              {walkInError ? <div className="formError walkInAppointmentError" role="alert">{walkInError}</div> : null}
              <h3 className="fieldGroupLabel walkInPatientHeading">Patient details</h3>
              <label className="field">
                <span className="fieldLabel">First name</span>
                <input className="input" required value={walkInDraft.firstName} onChange={(event) => updateWalkInDraft("firstName", event.target.value)} />
              </label>
              <label className="field">
                <span className="fieldLabel">Middle name</span>
                <input className="input" value={walkInDraft.middleName} onChange={(event) => updateWalkInDraft("middleName", event.target.value)} />
              </label>
              <label className="field">
                <span className="fieldLabel">Last name</span>
                <input className="input" required value={walkInDraft.lastName} onChange={(event) => updateWalkInDraft("lastName", event.target.value)} />
              </label>
              <label className="field">
                <span className="fieldLabel">Age</span>
                <input className="input" type="number" min="1" required value={walkInDraft.age} onChange={(event) => updateWalkInDraft("age", event.target.value)} />
              </label>
              <label className="field">
                <span className="fieldLabel">Contact number</span>
                <input className="input" type="tel" required value={walkInDraft.phone} onChange={(event) => updateWalkInDraft("phone", event.target.value)} />
              </label>
              <label className="field">
                <span className="fieldLabel">Email (optional)</span>
                <input className="input" type="email" value={walkInDraft.email} onChange={(event) => updateWalkInDraft("email", event.target.value)} aria-describedby="walk-in-email-hint" />
                <small id="walk-in-email-hint">Use the patient’s Gmail if they want to link this visit to their online account.</small>
              </label>
              <label className="field">
                <span className="fieldLabel">Type of patient</span>
                <select className="input" value={walkInDraft.patientType} onChange={(event) => updateWalkInDraft("patientType", event.target.value)}>
                  {WALK_IN_PATIENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </label>
              <h3 className="fieldGroupLabel">Appointment details</h3>
              <div className="field walkInServiceField" role="group" aria-labelledby="walk-in-services-label">
                <div className="walkInServiceHeading">
                  <span className="fieldLabel" id="walk-in-services-label">Services</span>
                  <span aria-live="polite">{walkInDraft.services.length} of {MAX_BOOKING_SERVICES} selected</span>
                </div>
                {loadingServices ? <LoadingIndicator>Loading services…</LoadingIndicator> : serviceLoadError ? <span role="alert">{serviceLoadError}</span> : walkInOptions.length ? (
                  <div className="walkInServiceOptions">
                    {walkInOptions.filter((service) => !isCrownTypeService(service) && (!walkInPackage || !isBracesPackageInclusion(service))).map((service) => (
                      <label className="walkInServiceOption" key={service.name}>
                        <input
                          type="checkbox"
                          checked={walkInDraft.services.includes(service.name)}
                          onChange={() => toggleWalkInService(service)}
                          disabled={walkInSaving || selectBookingService(walkInDraft.services, service, walkInOptions) === walkInDraft.services}
                        />
                        <span><strong>{isGenericBracesPackage(service) ? "Braces Package" : service.name}</strong>{service.startingRate ? <small>{service.startingRate}</small> : null}</span>
                      </label>
                    ))}
                  </div>
                ) : <span className="walkInAvailabilityError">No active services available.</span>}
                {walkInPackage ? (
                  <div className="bookingBracesPackageDetails">
                    {walkInNeedsBracesType ? (
                      <label className="bookingServiceTypeField">
                        <strong>Type of Braces</strong>
                        <select className="input" required value={walkInDraft.bracesType} onChange={(event) => updateWalkInDraft("bracesType", event.target.value)} disabled={walkInSaving}>
                          <option value="">Select a type</option>
                          {BRACES_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                        </select>
                      </label>
                    ) : null}
                    <div><strong>Package Inclusions</strong><ul>{BRACES_PACKAGE_INCLUSIONS.map((inclusion) => <li key={inclusion}>{inclusion}</li>)}</ul></div>
                  </div>
                ) : null}
                {!loadingServices && !serviceLoadError ? (
                  <BookingCrownPicker options={walkInOptions} selectedServices={walkInDraft.services} onToggle={toggleWalkInService} disabled={walkInSaving} />
                ) : null}
              </div>
              <div className="walkInScheduleFields">
                <label className="field">
                  <span className="fieldLabel">Dentist</span>
                  <select className="input" required value={walkInDraft.dentistId} onChange={(event) => updateWalkInDraft("dentistId", event.target.value)}>
                    <option value="">Select a dentist</option>
                    {dentists.map((dentist) => <option key={dentist.id} value={dentist.id}>{dentist.name}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span className="fieldLabel">Appointment date</span>
                  <input className="input" type="date" min={clinicToday} required value={walkInDraft.date} onChange={(event) => updateWalkInDraft("date", event.target.value)} />
                </label>
                <label className="field">
                  <span className="fieldLabel">Appointment time</span>
                  <select className="input" required value={walkInDraft.time} onChange={(event) => updateWalkInDraft("time", event.target.value)} disabled={loadingWalkInTimes || !walkInTimeOptions.length}>
                    <option value="">{loadingWalkInTimes ? "Checking availability…" : walkInTimeOptions.length ? "Select a time" : "Choose dentist, services, and date first"}</option>
                    {walkInTimeOptions.map((time) => <option key={time} value={time}>{formatTimeLabel(time)}</option>)}
                  </select>
                  {loadingWalkInTimes ? <LoadingIndicator>Checking available times…</LoadingIndicator> : null}
                  {walkInAvailabilityError ? <span className="walkInAvailabilityError">{walkInAvailabilityError}</span> : null}
                </label>
              </div>
            </div>
            <div className="modalFoot">
              <button type="button" className="btn btnSecondary" disabled={walkInSaving} onClick={() => setWalkInOpen(false)}>Cancel</button>
              <button className="btn btnSuccess" type="submit" disabled={walkInSaving || loadingWalkInTimes || !walkInTimeOptions.length}>
                {walkInSaving ? <LoadingIndicator>Saving appointment…</LoadingIndicator> : "Add Patient & Appointment"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(confirmState)}
        title={confirmState?.title}
        message={confirmState?.message}
        confirmLabel={confirmState?.confirmLabel}
        showCancelButton={confirmState?.showCancelButton}
        tone={confirmState?.tone}
        onClose={() => setConfirmState(null)}
        onConfirm={handleConfirmAction}
      />

    </div>
  );
}
