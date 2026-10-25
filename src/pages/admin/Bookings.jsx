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
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../firebase";
import ConfirmDialog from "../../components/ConfirmDialog";
import EmptyState from "../../components/EmptyState";
import { SkeletonList } from "../../components/LoadingSkeleton";
import { formatDateLabel, formatTimeLabel, formatTimestamp } from "../../utils/schedule";

const SET_BOOKING_STATUS = httpsCallable(functions, "setBookingStatus");
const TOGGLE_BOOKING_CHECK_IN = httpsCallable(functions, "toggleBookingCheckIn");
const ARCHIVE_BOOKING = httpsCallable(functions, "archiveBooking");
const APPROVE_RESCHEDULE = httpsCallable(functions, "approveReschedule");
const DECLINE_RESCHEDULE = httpsCallable(functions, "declineReschedule");
const ADJUST_BOOKING_END_TIME = httpsCallable(functions, "adjustBookingEndTime");

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
  completed: { label: "Completed", emptyText: "No completed appointments recorded." },
  "no-show": { label: "No-show", emptyText: "No no-show appointments recorded." },
};

const BOOKING_STATUS_FILTERS = ["calendar", "pending", "approved", "completed", "cancelled"];
const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const BOOKING_SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "name-asc", label: "A–Z" },
  { value: "name-desc", label: "Z–A" },
  { value: "date-asc", label: "Earliest" },
  { value: "date-desc", label: "Latest" },
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

function compareOptionalValues(left, right, direction = 1) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return (left < right ? -1 : left > right ? 1 : 0) * direction;
}

function compareBookings(left, right, sortBy) {
  let comparison = 0;
  if (sortBy === "newest" || sortBy === "oldest") {
    comparison = compareOptionalValues(
      timestampMillis(left.createdAt),
      timestampMillis(right.createdAt),
      sortBy === "newest" ? -1 : 1
    );
  } else if (sortBy === "name-asc" || sortBy === "name-desc") {
    const leftName = String(left.fullName || "").trim().toLocaleLowerCase();
    const rightName = String(right.fullName || "").trim().toLocaleLowerCase();
    comparison = compareOptionalValues(
      leftName || null,
      rightName || null,
      sortBy === "name-asc" ? 1 : -1
    );
  } else {
    comparison = compareOptionalValues(
      String(left.date || "") || null,
      String(right.date || "") || null,
      sortBy === "date-asc" ? 1 : -1
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

function BookingRow({ booking, onOpen }) {
  const reschedule = booking.rescheduleRequest;

  return (
    <tr
      className="bookingRow clickable"
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
        <small>{booking.id}</small>
      </td>
      <td data-label="Service">{booking.service || "Not set"}</td>
      <td data-label="Dentist">{booking.selectedDentist || "Not assigned"}</td>
      <td data-label="Date & time">
        <strong>{booking.date ? formatDateLabel(booking.date) : "Not set"}</strong>
        <small>{formatTimeLabel(booking.time)}</small>
      </td>
      <td data-label="Status">
        <span className={`statusPill ${booking.status || "pending"}`}>{booking.status || "pending"}</span>
        {reschedule?.status === "pending" ? <span className="statusPill attention">reschedule</span> : null}
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
  onComplete,
  onArchive,
  onApproveReschedule,
  onDeclineReschedule,
  onReschedule,
  onAdjustEndTime,
}) {
  const reschedule = booking?.rescheduleRequest;
  const status = booking?.status || "pending";

  return (
    <>
      <div className={`patientDrawerOverlay ${open ? "open" : ""}`} onClick={onClose} />
      <div className={`patientDrawer bookingDetailsModal ${open ? "open" : ""}`} role="dialog" aria-modal="true">
        {booking ? (
          <div className="patientDrawerInner">
            <div className="patientDrawerHeader">
              <div>
                <span className="heroEyebrow">Booking details</span>
                <h3>{booking.fullName || "No name"}</h3>
                <div className="patientRecordPeek">
                  <span>{booking.service || "No service"}</span>
                  <span className={`statusPill ${booking.status || "pending"}`}>{booking.status || "pending"}</span>
                </div>
              </div>
              <button type="button" className="patientDrawerCloseBtn" onClick={onClose} aria-label="Close">
                ×
              </button>
            </div>

            <div className="patientDrawerBody">
              <dl className="detailList">
                <div className="detailRow">
                  <dt>Appointment</dt>
                  <dd>{getBookingDateTimeLabel(booking)}</dd>
                </div>
                <div className="detailRow">
                  <dt>Time</dt>
                  <dd>{getBookingTimeRange(booking)}</dd>
                </div>
                <div className="detailRow">
                  <dt>Dentist</dt>
                  <dd>{booking.selectedDentist || "Not selected"}</dd>
                </div>
                <div className="detailRow">
                  <dt>Patient</dt>
                  <dd>{booking.age || "-"} • {booking.patientType || "Regular Patient"}</dd>
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
                  <dt>Checked in</dt>
                  <dd>{formatTimestamp(booking.checkedInAt)}</dd>
                </div>
              </dl>

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

                  {reschedule.status === "pending" ? (
                    <div className="inlineActionRow">
                      <button className="btn btnShine" type="button" onClick={onApproveReschedule}>
                        Approve Reschedule
                      </button>
                      <button className="btn secondary btnSoft" type="button" onClick={onDeclineReschedule}>
                        Decline Request
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="actionColumn actionColumnFriendly">
          
              {status === "pending" ? (
                <>
                  <button className="btn secondary btnSoft patientActionBtn" type="button" onClick={onAdjustEndTime}>
                    Extend appointment
                  </button>
                  <button className="btn btnShine patientActionBtn" type="button" onClick={onApprove}>
                    Approve
                  </button>
                  <button className="btn danger patientActionBtn" type="button" onClick={onCancel}>
                    Cancel Booking
                  </button>
                </>
              ) : null}

              {status === "approved" ? (
                <>
                  <button className="btn secondary btnSoft patientActionBtn" type="button" onClick={onAdjustEndTime}>
                    Extend appointment
                  </button>
                  <button className="btn btnShine patientActionBtn" type="button" onClick={onCheckIn}>
                    {booking.checkedInAt ? "Clear Check-in" : "Mark Check-in"}
                  </button>
                  <button className="btn secondary btnSoft patientActionBtn" type="button" onClick={onReschedule}>
                    Reschedule
                  </button>
                  <button className="btn btnShine patientActionBtn" type="button" onClick={onComplete}>Mark Completed</button>
                </>
              ) : null}

              {status === "cancelled" ? (
                <>
                  <button className="btn btnShine patientActionBtn" type="button" onClick={onReschedule}>
                    Reschedule
                  </button>
                  <button className="btn archiveButton patientActionBtn" type="button" onClick={onArchive}>
                    Move to Archive
                  </button>
                </>
              ) : null}
            </div>
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

function AdjustBookingEndTimeModal({ open, booking, onClose, onSave }) {
  const currentEndTime = booking?.estimatedEndTime
    || minutesToTime(timeToMinutes(booking?.time) + Number(booking?.estimatedDurationMinutes || 60));
  const [endTime, setEndTime] = useState(currentEndTime);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function submit() {
    if (!endTime || timeToMinutes(endTime) <= timeToMinutes(currentEndTime)) {
      setFormError("Choose an end time later than the current appointment end.");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      await onSave(booking, endTime);
    } catch (error) {
      console.error(error);
      setFormError(error?.message || "The appointment end time could not be extended.");
      setSaving(false);
    }
  }

  return (
    <>
      <div className={`patientDrawerOverlay rescheduleOverlay ${open ? "open" : ""}`} onClick={onClose} />
      <div className={`patientDrawer rescheduleModal ${open ? "open" : ""}`} role="dialog" aria-modal="true" aria-labelledby="adjust-end-time-title">
        {booking ? (
          <div className="patientDrawerInner">
            <div className="patientDrawerHeader">
              <div>
                <span className="heroEyebrow">Appointment timing</span>
                <h3 id="adjust-end-time-title">Extend appointment</h3>
                <div className="patientRecordPeek">
                  <span>{booking.fullName || "No name"}</span>
                  <span>Current end: {formatTimeLabel(currentEndTime)}</span>
                </div>
              </div>
              <button type="button" className="patientDrawerCloseBtn" onClick={onClose} aria-label="Close">
                ×
              </button>
            </div>

            <div className="rescheduleFields">
              <label>
                New end time
                <input
                  type="time"
                  step="900"
                  min={currentEndTime}
                  value={endTime}
                  onChange={(event) => setEndTime(event.target.value)}
                />
              </label>
            </div>
            <p className="rescheduleHint">
              The appointment date and start time will not change. The new end time must fit the dentist&apos;s schedule and not overlap another appointment.
            </p>

            {formError ? <div className="formError" role="alert">{formError}</div> : null}

            <div className="actionColumn actionColumnFriendly">
              <button className="btn btnShine patientActionBtn" type="button" onClick={submit} disabled={saving}>
                {saving ? "Saving..." : "Save end time"}
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

export default function Bookings() {
  const [bookings, setBookings] = useState([]);
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
  const [endTimeBookingId, setEndTimeBookingId] = useState(null);
  const [endTimeModalOpen, setEndTimeModalOpen] = useState(false);
  const { status = "pending" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedBookingId = searchParams.get("bookingId");

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

  useEffect(() => {
    if (!requestedBookingId || loadingBookings) return;

    const target = bookings.find(
      (booking) => booking.id === requestedBookingId && booking.archiveStatus !== "Archived"
    );
    if (target) {
      setActionError("");
      setSelectedBookingId(target.id);
      setDrawerOpen(true);
    } else {
      setActionError("That appointment could not be found or is no longer available.");
    }

    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("bookingId");
      return next;
    }, { replace: true });
  }, [bookings, loadingBookings, requestedBookingId, setSearchParams]);

  const activeBookings = useMemo(
    () => bookings.filter((booking) => booking.archiveStatus !== "Archived"),
    [bookings]
  );

  const groupedBookings = useMemo(
    () => ({
      pending: activeBookings.filter((booking) => (booking.status || "pending") === "pending"),
      approved: activeBookings.filter((booking) => booking.status === "approved"),
      cancelled: activeBookings.filter((booking) => booking.status === "cancelled"),
      completed: activeBookings.filter((booking) => booking.status === "completed"),
      "no-show": activeBookings.filter((booking) => booking.status === "no-show"),
    }),
    [activeBookings]
  );

  const calendarDays = useMemo(() => getMonthCalendarDays(calendarMonth), [calendarMonth]);
  const calendarCounts = useMemo(
    () => activeBookings.reduce((counts, booking) => {
      if (booking.date) counts.set(booking.date, (counts.get(booking.date) || 0) + 1);
      return counts;
    }, new Map()),
    [activeBookings]
  );
  const bookingCounts = useMemo(
    () => ({
      calendar: activeBookings.length,
      pending: groupedBookings.pending.length,
      approved: groupedBookings.approved.length,
      completed: groupedBookings.completed.length,
      cancelled: groupedBookings.cancelled.length,
      "no-show": groupedBookings["no-show"].length,
    }),
    [activeBookings.length, groupedBookings]
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
  const endTimeBooking = useMemo(
    () => bookings.find((booking) => booking.id === endTimeBookingId) || null,
    [bookings, endTimeBookingId]
  );

  function openReschedule(id) {
    setDrawerOpen(false);
    setRescheduleId(id);
    setRescheduleOpen(true);
  }
  function closeReschedule() {
    setRescheduleOpen(false);
  }

  function openEndTimeModal(id) {
    setDrawerOpen(false);
    setEndTimeBookingId(id);
    setEndTimeModalOpen(true);
  }

  function closeEndTimeModal() {
    setEndTimeModalOpen(false);
  }

  async function saveEndTime(booking, endTime) {
    await ADJUST_BOOKING_END_TIME({ bookingId: booking.id, endTime });
    closeEndTimeModal();
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

  async function toggleArchive(id) {
    await ARCHIVE_BOOKING({ bookingId: id });
  }

  async function toggleCheckIn(booking) {
    await TOGGLE_BOOKING_CHECK_IN({ bookingId: booking.id });
  }

  async function declineReschedule(booking) {
    await DECLINE_RESCHEDULE({ bookingId: booking.id });
  }

  async function approveReschedule(booking) {
    await APPROVE_RESCHEDULE({ bookingId: booking.id });
  }

  const activeConfig = BOOKING_FILTERS[status];
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
      <header className="adminPageHeader bookingManagementHeader">
        <div>
          <h1>Bookings</h1>
          <p>Manage clinic appointments, schedules, and patient check-ins.</p>
        </div>
      </header>

      {actionError ? (
        <div className="formError bookingActionError" role="alert">
          {actionError}
        </div>
      ) : null}

      <div className="bookingManagementGrid">
        <section className="bookingListPanel" aria-label="Appointment list">
          <div className="bookingToolbar">
            <label className="bookingSearch">
              <input
                className="input"
                type="text"
                aria-label="Search appointments by patient name, patient ID, appointment ID, or service"
                placeholder="Search patient, patient ID, appointment ID, or service"
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
                <span className="bookingFilterCount">{bookingCounts[filter]}</span>
              </NavLink>
            ))}
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
                    <BookingRow key={booking.id} booking={booking} onOpen={openBooking} />
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
          {!loadingBookings ? (
            <p className="bookingResultCount" role="status">
              {activeItems.length} appointment{activeItems.length === 1 ? "" : "s"}
            </p>
          ) : null}
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
                <span className="bookingMonthTotal">{activeBookings.length} total</span>
              </>
            )}
          </div>
        </aside>
      </div>

      <BookingDetailDrawer
        open={drawerOpen}
        booking={selectedBooking}
        onClose={closeDrawer}
        onApprove={() =>
          selectedBooking &&
          runBookingAction(async () => {
            await setStatus(selectedBooking.id, "approved");
            closeDrawer();
          })
        }
        onReschedule={() => selectedBooking && openReschedule(selectedBooking.id)}
        onAdjustEndTime={() => selectedBooking && openEndTimeModal(selectedBooking.id)}
        onApproveReschedule={() =>
          selectedBooking && runBookingAction(() => approveReschedule(selectedBooking))
        }
        onDeclineReschedule={() =>
          selectedBooking && runBookingAction(() => declineReschedule(selectedBooking))
        }
        onCheckIn={() => {
          const b = selectedBooking;
          if (!b) return;
          closeDrawer();
          openConfirm({
            title: b.checkedInAt ? "Clear check-in?" : "Mark patient as checked in?",
            message: b.checkedInAt
              ? "This will remove the current check-in timestamp from the booking."
              : "This will mark the patient as checked in for this appointment.",
            confirmLabel: b.checkedInAt ? "Clear Check-in" : "Mark Check-in",
            action: () => toggleCheckIn(b),
          });
        }}
        onCancel={() => {
          const b = selectedBooking;
          if (!b) return;
          closeDrawer();
          openConfirm({
            title: "Cancel this booking?",
            message: "This booking will move to the cancelled section and no longer appear as active.",
            confirmLabel: "Cancel Booking",
            tone: "danger",
            action: () => setStatus(b.id, "cancelled"),
          });
        }}
        onComplete={() => selectedBooking && runBookingAction(async () => { await setStatus(selectedBooking.id, "completed"); closeDrawer(); })}
        onArchive={() => {
          const b = selectedBooking;
          if (!b) return;
          closeDrawer();
          openConfirm({
            title: "Move this booking to archive?",
            message: "Archived bookings are removed from the active booking board but can still be restored later.",
            confirmLabel: "Move to Archive",
            tone: "archive",
            action: () => toggleArchive(b.id),
          });
        }}
      />

      {endTimeModalOpen ? (
        <AdjustBookingEndTimeModal
          open={endTimeModalOpen}
          booking={endTimeBooking}
          onClose={closeEndTimeModal}
          onSave={saveEndTime}
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
