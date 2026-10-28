import { useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, useParams, useSearchParams } from "react-router-dom";
import {
  Timestamp,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../firebase";
import ConfirmDialog from "../../components/ConfirmDialog";
import EmptyState from "../../components/EmptyState";
import { SkeletonList } from "../../components/LoadingSkeleton";
import { formatDateLabel, formatTimeLabel, formatTimestamp } from "../../utils/schedule";

const SET_BOOKING_STATUS = httpsCallable(functions, "setBookingStatus");
const TOGGLE_BOOKING_CHECK_IN = httpsCallable(functions, "toggleBookingCheckIn");
const REASSIGN_BOOKING_DENTIST = httpsCallable(functions, "reassignBookingDentist");

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
  cancelled: {
    label: "Cancelled",
    emptyText: "No cancelled bookings.",
  },
  "no-show": { label: "No-show", emptyText: "No no-show appointments recorded." },
};

const BOOKING_STATUS_FILTERS = ["calendar", "pending", "approved", "cancelled"];
const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const BOOKING_SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "appointment-asc", label: "Earliest appointment" },
  { value: "appointment-desc", label: "Latest appointment" },
];

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
        <span className={`bookingTableStatus bookingTableStatus-${booking.status || "pending"}`}>
          {booking.status || "pending"}
        </span>
        {booking.status === "approved" && booking.checkedInAt ? (
          <span className="bookingTableStatus bookingTableStatus-approved">Checked in</span>
        ) : null}
        {reschedule?.status === "pending" ? (
          <span className="bookingTableStatus bookingTableStatus-pending">reschedule</span>
        ) : null}
      </td>
    </tr>
  );
}

function BookingDetailDrawer({
  open,
  booking,
  onClose,
  onApprove,
  onCheckIn,
  onCancel,
  onReschedule,
  onReassign,
  actionError,
}) {
  const reschedule = booking?.rescheduleRequest;
  const status = booking?.status || "pending";
  const [paymentDetails, setPaymentDetails] = useState(null);
  const currentPaymentDetails = paymentDetails?.bookingId === booking?.id ? paymentDetails : null;
  const paymentSummaries = currentPaymentDetails?.summaries || [];
  const paymentError = currentPaymentDetails?.error || "";
  const paymentLoading = open && status === "completed" && !currentPaymentDetails;

  useEffect(() => {
    if (!open || status !== "completed" || !booking?.id) return undefined;
    const summariesQuery = query(
      collection(db, "paymentTreatmentSummaries"),
      where("appointmentId", "==", booking.id)
    );
    return onSnapshot(summariesQuery, (snapshot) => {
      setPaymentDetails({
        bookingId: booking.id,
        summaries: snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })),
        error: "",
      });
    }, (error) => {
      console.error("Appointment payment details could not load:", error);
      setPaymentDetails({
        bookingId: booking.id,
        summaries: [],
        error: "Payment details are unavailable right now.",
      });
    });
  }, [booking?.id, open, status]);

  return (
    <>
      <div className={`patientDrawerOverlay ${open ? "open" : ""}`} onClick={onClose} />
      <div className={`patientDrawer bookingDetailsModal ${open ? "open" : ""}`} role="dialog" aria-modal="true">
        {booking ? (
          <div className="patientDrawerInner">
            <div className="patientDrawerHeader bookingDetailsHeader">
              <div className="bookingDetailsHeading">
                <span className="heroEyebrow">Booking details</span>
                <div className="bookingDetailsTitleRow">
                  <h3>{booking.fullName || "No name"}</h3>
                  <span className="bookingDetailsStatus">
                    {status.replace(/_/g, " ")}
                  </span>
                </div>
              </div>
              <button type="button" className="patientDrawerCloseBtn" onClick={onClose} aria-label="Close">
                ×
              </button>
            </div>

            <div className="patientDrawerBody">
              {actionError ? <div className="formError" role="alert">{actionError}</div> : null}
              <dl className="detailList">
                <div className="detailRow">
                  <dt>Appointment</dt>
                  <dd>{booking.date ? formatDateLabel(booking.date) : "Not set"}</dd>
                </div>
                <div className="detailRow">
                  <dt>Time</dt>
                  <dd>{getBookingTimeRange(booking)}</dd>
                </div>
                <div className="detailRow">
                  <dt>Service</dt>
                  <dd>{getBookingServices(booking)}</dd>
                </div>
                <div className="detailRow">
                  <dt>Dentist</dt>
                  <dd>{booking.selectedDentist || "Not selected"}</dd>
                </div>
                <div className="detailRow">
                  <dt>Patient</dt>
                  <dd>{booking.fullName || "No name"}</dd>
                </div>
                <div className="detailRow">
                  <dt>Age</dt>
                  <dd>{booking.age || "-"}</dd>
                </div>
                <div className="detailRow">
                  <dt>Type of Patient</dt>
                  <dd>{booking.patientType || "Regular Patient"}</dd>
                </div>
                <div className="detailRow">
                  <dt>Phone</dt>
                  <dd>{booking.phone || "No phone"}</dd>
                </div>
                <div className="detailRow">
                  <dt>Email</dt>
                  <dd>{booking.email || "No email"}</dd>
                </div>
                <div className="detailRow">
                  <dt>Address</dt>
                  <dd>{booking.address || "Not provided"}</dd>
                </div>
                <div className="detailRow">
                  <dt>Booked at</dt>
                  <dd>{formatTimestamp(booking.createdAt)}</dd>
                </div>
                <div className="detailRow">
                  <dt>Arrival</dt>
                  <dd>{booking.checkedInAt ? `Checked in · ${formatTimestamp(booking.checkedInAt)}` : "Not checked in"}</dd>
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

              {status === "completed" ? (
                <div className="drawerNote">
                  <span className="drawerNoteLabel">Payment details</span>
                  {paymentLoading ? <p>Loading payment details…</p> : null}
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
                  {!paymentLoading && !paymentError && !paymentSummaries.length ? <p>No linked payment details.</p> : null}
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
                    Status: <strong>{reschedule.status || "pending"}</strong>
                    {reschedule.reason ? ` • ${reschedule.reason}` : ""}
                  </p>

                </div>
              ) : null}
            </div>

            {["pending", "approved"].includes(status) ? (
              <div className="actionColumn actionColumnFriendly">
                {status === "pending" ? (
                  <>
                    <button className="btn btnShine patientActionBtn" type="button" onClick={onApprove}>
                      Approve
                    </button>
                    <button className="btn danger patientActionBtn" type="button" onClick={onCancel}>
                      Cancel
                    </button>
                  </>
                ) : null}

                {status === "approved" ? (
                  booking.checkedInAt ? (
                    <div className="bookingCheckInIndicator" role="status">Checked in</div>
                  ) : (
                    <>
                      <button className="btn btnShine patientActionBtn" type="button" onClick={onCheckIn}>
                        Mark as Check-in
                      </button>
                      <button className="btn secondary btnSoft patientActionBtn" type="button" onClick={onReschedule}>
                        Reschedule
                      </button>
                      <button className="btn danger patientActionBtn" type="button" onClick={onCancel}>
                        Cancel
                      </button>
                    </>
                  )
                ) : null}

                {!booking.checkedInAt ? (
                  <button className="btn secondary btnSoft patientActionBtn" type="button" onClick={onReassign}>
                    Reassign dentist
                  </button>
                ) : null}
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

  async function submit() {
    if (!newDate || !newTime) {
      setFormError("Choose both a date and a time.");
      return;
    }
    if (newDate < todayStr) {
      setFormError("The new date can't be in the past.");
      return;
    }
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
                {saving ? "Saving..." : "Save new schedule"}
              </button>
              <button className="btn secondary btnSoft patientActionBtn" type="button" onClick={onClose} disabled={saving}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </div>
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
                {saving ? "Saving..." : "Reassign appointment"}
              </button>
              <button className="btn secondary btnSoft patientActionBtn" type="button" onClick={onClose} disabled={saving}>Cancel</button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

export default function Bookings() {
  const [bookings, setBookings] = useState([]);
  const [dentists, setDentists] = useState([]);
  const [loadingBookings, setLoadingBookings] = useState(true);
  const [confirmState, setConfirmState] = useState(null);
  const [actionError, setActionError] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("newest");
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
  const { status = "pending" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedBookingId = searchParams.get("bookingId");
  const requestedHighlightIds = searchParams.getAll("highlightId");
  const requestedHighlightKey = requestedHighlightIds.join("\u0000");
  const requestedDate = searchParams.get("date") || "";
  const [highlightedBookingIds, setHighlightedBookingIds] = useState([]);

  useEffect(() => {
    const q = query(collection(db, "bookings"), orderBy("appointmentAt", "asc"));

    const unsub = onSnapshot(q, (snap) => {
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
  }

  async function saveReschedule(booking, date, time) {
    const duration = Number(booking.estimatedDurationMinutes || 60);
    const start = timeToMinutes(time);
    const end = start + duration;

    const conflict = bookings.find((b) => {
      if (b.id === booking.id || b.date !== date || b.archiveStatus === "Archived") return false;
      if (!["pending", "approved"].includes(b.status || "pending")) return false;
      if (booking.selectedDentist && b.selectedDentist !== booking.selectedDentist) return false;
      const bStart = timeToMinutes(b.time);
      const bEnd = bStart + Number(b.estimatedDurationMinutes || 60);
      return start < bEnd && bStart < end;
    });
    if (conflict) {
      throw new Error(`That time overlaps ${conflict.fullName || "another booking"} (${getBookingTimeRange(conflict)}).`);
    }

    await updateDoc(doc(db, "bookings", booking.id), {
      date,
      time,
      estimatedEndTime: minutesToTime(end),
      appointmentAt: Timestamp.fromDate(new Date(`${date}T${time}:00`)),
      status: booking.status === "cancelled" ? "approved" : booking.status || "pending",
      checkedInAt: null,
      rescheduledAt: serverTimestamp(),
    });
    closeReschedule();
  }

  // Close popup with Escape (must stay above the early return below)
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  async function runBookingAction(action) {
    setActionError("");
    try {
      await action();
    } catch (error) {
      console.error(error);
      setActionError(error?.message || "The booking action could not be completed.");
    }
  }

  async function setStatus(id, nextStatus) {
    await SET_BOOKING_STATUS({ bookingId: id, status: nextStatus });
  }

  async function toggleCheckIn(booking) {
    await TOGGLE_BOOKING_CHECK_IN({ bookingId: booking.id });
  }

  const activeConfig = BOOKING_FILTERS[status] || BOOKING_FILTERS.calendar;
  const searchTerm = search.trim().toLocaleLowerCase();
  const activeItems = useMemo(
    () => activeBookings
      .filter((booking) => {
        if (status !== "calendar" && (booking.status || "pending") !== status) return false;
        if (selectedDate && booking.date !== selectedDate) return false;
        if (!searchTerm) return true;
        return [booking.fullName, booking.id, booking.uid, booking.patientProfileId, booking.service]
          .some((value) => String(value || "").toLocaleLowerCase().includes(searchTerm));
      })
      .sort((left, right) => compareBookings(left, right, sortBy)),
    [activeBookings, searchTerm, selectedDate, sortBy, status]
  );
  const selectedDateCount = selectedDate ? calendarCounts.get(selectedDate) || 0 : 0;

  useEffect(() => {
    if (!highlightedBookingIds.length) return undefined;

    document.getElementById(`booking-row-${highlightedBookingIds[0]}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    const timeoutId = window.setTimeout(() => setHighlightedBookingIds([]), 7000);
    return () => window.clearTimeout(timeoutId);
  }, [activeItems, highlightedBookingIds]);

  if (!BOOKING_FILTERS[status]) {
    return <Navigate to="/admin/bookings/pending" replace />;
  }

  function openConfirm(config) {
    setConfirmState(config);
  }

  async function handleConfirmAction() {
    if (!confirmState?.action) return;
    const action = confirmState.action;
    setConfirmState(null);
    await runBookingAction(action);
  }

  return (
    <div className="container adminSurface bookingManagementPage">
      {actionError ? (
        <div className="formError bookingActionError" role="alert">
          {actionError}
        </div>
      ) : null}

      <div className="bookingManagementGrid">
        <section className="bookingListPanel" aria-label="Appointment list">
          <div className="bookingToolbar">
            <label className="bookingSearch adminSearchField">
              <svg className="adminSearchIcon" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                className="input"
                type="text"
                aria-label="Search appointments by patient name, patient ID, appointment ID, or service"
                placeholder="Search patient, ID, or service"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {search ? (
                <button type="button" className="bookingClearSearch" onClick={() => setSearch("")}>
                  Clear
                </button>
              ) : null}
            </label>
            <label className="bookingSortControl">
              <span aria-hidden="true">
                {BOOKING_SORT_OPTIONS.find((option) => option.value === sortBy)?.label}
              </span>
              <select
                aria-label="Sort bookings"
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value)}
              >
                {BOOKING_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="m4 6 4 4 4-4" />
              </svg>
            </label>
          </div>

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

          {selectedDate ? (
            <div className="bookingDateFilter" role="status">
              <span>Showing appointments for <strong>{formatDateLabel(selectedDate)}</strong></span>
              <button type="button" onClick={() => setSelectedDate("")}>Clear date</button>
            </div>
          ) : null}

          {loadingBookings ? (
            <SkeletonList count={4} />
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
                  {activeItems.map((booking) => (
                    <BookingRow
                      key={booking.id}
                      booking={booking}
                      onOpen={openBooking}
                      highlighted={highlightedBookingIds.includes(booking.id)}
                    />
                  ))}
                </tbody>
              </table>
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
            <h2>{calendarMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h2>
            <div className="bookingMonthControls">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => setCalendarMonth((month) => new Date(month.getFullYear(), month.getMonth() - 1, 1))}
              >
                ‹
              </button>
              <button
                type="button"
                aria-label="Next month"
                onClick={() => setCalendarMonth((month) => new Date(month.getFullYear(), month.getMonth() + 1, 1))}
              >
                ›
              </button>
            </div>
          </div>
          <div className="bookingMonthGrid" role="group" aria-label="Select an appointment date">
            {WEEKDAY_LABELS.map((weekday) => (
              <span key={weekday} className="bookingWeekday">{weekday}</span>
            ))}
            {calendarDays.map((date, index) => {
              if (!date) return <span key={`blank-${index}`} className="bookingDayBlank" aria-hidden="true" />;
              const dateKey = getLocalDateKey(date);
              const count = calendarCounts.get(dateKey) || 0;
              const isToday = dateKey === getLocalDateKey(new Date());
              const isSelected = dateKey === selectedDate;
              return (
                <button
                  key={dateKey}
                  type="button"
                  aria-label={`${date.toLocaleDateString(undefined, { dateStyle: "full" })}, ${count} appointment${count === 1 ? "" : "s"}`}
                  aria-pressed={isSelected}
                  className={`bookingMonthDay${isToday ? " today" : ""}${isSelected ? " selected" : ""}${count ? " hasAppointments" : ""}`}
                  onClick={() => setSelectedDate(isSelected ? "" : dateKey)}
                >
                  <span>{date.getDate()}</span>
                  {count ? <i aria-hidden="true" /> : null}
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
        onClose={closeDrawer}
        onApprove={() =>
          selectedBooking &&
          runBookingAction(async () => {
            await setStatus(selectedBooking.id, "approved");
            closeDrawer();
          })
        }
        onReschedule={() => selectedBooking && openReschedule(selectedBooking.id)}
        onReassign={() => selectedBooking && openReassign(selectedBooking.id)}
        onCheckIn={() => {
          const b = selectedBooking;
          if (!b || b.checkedInAt) return;
          runBookingAction(() => toggleCheckIn(b));
        }}
        onCancel={() => {
          const b = selectedBooking;
          if (!b) return;
          closeDrawer();
          openConfirm({
            title: "Cancel this booking?",
            message: "This booking will remain in your records and appear in the Cancelled tab.",
            confirmLabel: "Cancel",
            tone: "danger",
            action: () => setStatus(b.id, "cancelled"),
          });
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
