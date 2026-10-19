import { useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, useParams } from "react-router-dom";
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
import { buildBookingAnalytics } from "../../utils/appointments";
import { buildCalendarCells, getBookingCalendarTone, getCalendarItemLabel } from "../../utils/calendar";
import { formatDateLabel, formatTimeLabel, formatTimestamp } from "../../utils/schedule";

const SET_BOOKING_STATUS = httpsCallable(functions, "setBookingStatus");
const TOGGLE_BOOKING_CHECK_IN = httpsCallable(functions, "toggleBookingCheckIn");
const ARCHIVE_BOOKING = httpsCallable(functions, "archiveBooking");
const APPROVE_RESCHEDULE = httpsCallable(functions, "approveReschedule");
const DECLINE_RESCHEDULE = httpsCallable(functions, "declineReschedule");

const BOOKING_FILTERS = {
  calendar: {
    title: "Booking Calendar",
    subtitle: "Scan the appointment load by day, then open any date to see every patient booked there.",
    emptyText: "No booking days available right now.",
  },
  pending: {
    title: "Pending Bookings",
    subtitle: "New requests stay here until the clinic approves, cancels, or reviews a reschedule request.",
    emptyText: "No pending bookings right now.",
  },
  approved: {
    title: "Approved Bookings",
    subtitle: "Confirmed appointments stay here so the team can monitor check-ins and active reschedule requests.",
    emptyText: "No approved bookings yet.",
  },
  cancelled: {
    title: "Cancelled Bookings",
    subtitle: "Cancelled appointments move here automatically so the active board stays easier to read.",
    emptyText: "No cancelled bookings.",
  },
  completed: { title: "Completed Appointments", subtitle: "Appointments marked complete by the clinic.", emptyText: "No completed appointments recorded." },
  "no-show": { title: "No-show Appointments", subtitle: "Appointments where the patient did not attend.", emptyText: "No no-show appointments recorded." },
};

function pad(n) {
  return String(n).padStart(2, "0");
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
      <td className="bookingNameCell">{booking.fullName || "No name"}</td>
      <td>{booking.service || "Not set"}</td>
      <td>{booking.phone || "No phone"}</td>
      <td className="bookingAddressCell">{booking.address || "Not provided"}</td>
      <td>{booking.email || "No email"}</td>
      <td>{getBookingDateTimeLabel(booking)}</td>
      <td>
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
  onNoShow,
  onArchive,
  onApproveReschedule,
  onDeclineReschedule,
  onReschedule,
}) {
  const reschedule = booking?.rescheduleRequest;
  const status = booking?.status || "pending";

  return (
    <>
      <div className={`patientDrawerOverlay ${open ? "open" : ""}`} onClick={onClose} />
      <div className={`patientDrawer ${open ? "open" : ""}`} role="dialog" aria-modal="true">
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
                  <button className="btn btnShine patientActionBtn" type="button" onClick={onCheckIn}>
                    {booking.checkedInAt ? "Clear Check-in" : "Mark Check-in"}
                  </button>
                  <button className="btn secondary btnSoft patientActionBtn" type="button" onClick={onReschedule}>
                    Reschedule
                  </button>
                  <button className="btn btnShine patientActionBtn" type="button" onClick={onComplete}>Mark Completed</button>
                  <button className="btn secondary btnSoft patientActionBtn" type="button" onClick={onNoShow}>Mark No-show</button>
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

export default function Bookings() {
  const [bookings, setBookings] = useState([]);
  const [loadingBookings, setLoadingBookings] = useState(true);
  const [confirmState, setConfirmState] = useState(null);
  const [selectedCalendarCell, setSelectedCalendarCell] = useState(null);
  const [actionError, setActionError] = useState("");
  const [selectedBookingId, setSelectedBookingId] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [rescheduleId, setRescheduleId] = useState(null);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const { status = "pending" } = useParams();

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
    });

    return () => unsub();
  }, []);

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

  const bookingStats = useMemo(() => buildBookingAnalytics(activeBookings), [activeBookings]);
  const calendarCells = useMemo(() => buildCalendarCells(bookings, 21), [bookings]);

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

  function openReschedule(id) {
    setDrawerOpen(false);
    setRescheduleId(id);
    setRescheduleOpen(true);
  }
  function closeReschedule() {
    setRescheduleOpen(false);
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

  if (!BOOKING_FILTERS[status]) {
    return <Navigate to="/admin/bookings/pending" replace />;
  }

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
  const activeItems = groupedBookings[status];

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
    <div className="container adminSurface">
      <div className="statsGrid adminStats">
        <div className="statCard accentTeal">
          <span className="statLabel">Active bookings</span>
          <strong className="statValue">{bookingStats.total}</strong>
        </div>
        <div className="statCard accentBlue">
          <span className="statLabel">Pending</span>
          <strong className="statValue">{bookingStats.pending}</strong>
        </div>
        <div className="statCard accentGold">
          <span className="statLabel">Approved</span>
          <strong className="statValue">{bookingStats.approved}</strong>
        </div>
        <div className="statCard accentRose">
          <span className="statLabel">Cancelled</span>
          <strong className="statValue">{bookingStats.cancelled}</strong>
        </div>
        <div className="statCard accentGold">
          <span className="statLabel">Checked in</span>
          <strong className="statValue">{bookingStats.checkedIn}</strong>
        </div>
      </div>

      <div className="adminSubnav stickySubnav">
        <NavLink to="/admin/bookings/calendar" className={({ isActive }) => `subnavItem ${isActive ? "active" : ""}`}>
          Calendar
        </NavLink>
        <NavLink to="/admin/bookings/pending" className={({ isActive }) => `subnavItem ${isActive ? "active" : ""}`}>
          Pending
        </NavLink>
        <NavLink to="/admin/bookings/approved" className={({ isActive }) => `subnavItem ${isActive ? "active" : ""}`}>
          Approved
        </NavLink>
        <NavLink to="/admin/bookings/cancelled" className={({ isActive }) => `subnavItem ${isActive ? "active" : ""}`}>
          Cancelled
        </NavLink>
        <NavLink to="/admin/bookings/completed" className={({ isActive }) => `subnavItem ${isActive ? "active" : ""}`}>Completed</NavLink>
        <NavLink to="/admin/bookings/no-show" className={({ isActive }) => `subnavItem ${isActive ? "active" : ""}`}>No-show</NavLink>
      </div>

      <div className="card adminRecordsCard bookingSectionCard">
        <div className="cardHeader">
          <div>
            <h3 className="title">{activeConfig.title}</h3>
            <p className="sub">{activeConfig.subtitle}</p>
          </div>
          <span className="badge">{status === "calendar" ? `${calendarCells.length} days` : `${activeItems.length} records`}</span>
        </div>

        {actionError ? (
          <div className="formError" role="alert">
            {actionError}
          </div>
        ) : null}

        {status === "calendar" ? (
          <>
            <div className="calendarLegend">
              <div className="calendarLegendItem">
                <span className="calendarLegendSwatch pending" />
                <span>Pending</span>
              </div>
              <div className="calendarLegendItem">
                <span className="calendarLegendSwatch approved" />
                <span>Approved</span>
              </div>
              <div className="calendarLegendItem">
                <span className="calendarLegendSwatch completed" />
                <span>Completed</span>
              </div>
              <div className="calendarLegendItem">
                <span className="calendarLegendSwatch cancelled" />
                <span>Cancelled</span>
              </div>
              <div className="calendarLegendItem">
                <span className="calendarLegendSwatch archived" />
                <span>Archived</span>
              </div>
            </div>
            <div className="calendarGrid">
              {calendarCells.map((cell) => (
                <button
                  key={cell.date}
                  type="button"
                  className={`calendarCell ${cell.items.length ? "interactive" : ""}`}
                  onClick={() => setSelectedCalendarCell(cell)}
                >
                  <div className="calendarCellHeader">
                    <div>
                      <strong>{cell.label}</strong>
                      <small>{new Date(`${cell.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long" })}</small>
                    </div>
                    <span className="calendarCellCount">{cell.items.length} bookings</span>
                  </div>
                  {cell.items.length ? (
                    <div className="calendarItemStack">
                      {cell.items.slice(0, 4).map((booking) => (
                        <div key={booking.id} className={`calendarItem ${getBookingCalendarTone(booking)}`}>
                          {getCalendarItemLabel(booking)}
                        </div>
                      ))}
                      {cell.items.length > 4 ? (
                        <div className="calendarMoreHint">Tap to view all {cell.items.length} bookings</div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="calendarEmpty">No bookings</div>
                  )}
                </button>
              ))}
            </div>
          </>
        ) : loadingBookings ? (
          <SkeletonList count={3} cardClassName="bookingShowcase" />
        ) : activeItems.length ? (
          <div className="bookingsTableWrap">
            <table className="bookingsTable">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Service</th>
                  <th>Contact Number</th>
                  <th>Address</th>
                  <th>Email</th>
                  <th>Date &amp; Time</th>
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
            title={activeConfig.title}
            message={activeConfig.emptyText}
          />
        )}
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
        onNoShow={() => selectedBooking && runBookingAction(async () => { await setStatus(selectedBooking.id, "no-show"); closeDrawer(); })}
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

      {selectedCalendarCell ? (
        <div className="modalOverlay" onClick={() => setSelectedCalendarCell(null)}>
          <div className="modalCard bookingDayModal" onClick={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <div className="modalTitleGroup">
                <span className="heroEyebrow">Day Schedule</span>
                <h3>{selectedCalendarCell.label}</h3>
                <p>{selectedCalendarCell.items.length} booking{selectedCalendarCell.items.length === 1 ? "" : "s"} scheduled for this day.</p>
              </div>
              <button type="button" className="modalClose" onClick={() => setSelectedCalendarCell(null)}>
                ×
              </button>
            </div>

            <div className="bookingDayModalBody">
              {selectedCalendarCell.items.length ? (
                <div className="historyList">
                  {selectedCalendarCell.items.map((booking) => (
                    <div key={booking.id} className="historyRow bookingDayRow">
                      <div>
                        <strong>{booking.fullName || "No name"}</strong>
                        <p>
                          {booking.service || "No service"} • {getBookingTimeRange(booking)} • {booking.selectedDentist || "No dentist"}
                        </p>
                      </div>
                      <div className="historyMeta">
                        <span className={`statusPill ${booking.status || "pending"}`}>{booking.status || "pending"}</span>
                        <span>{booking.phone || booking.email || "No contact saved"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  compact
                  title="No bookings on this day"
                  message="This calendar day is still open with no scheduled patients."
                />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
