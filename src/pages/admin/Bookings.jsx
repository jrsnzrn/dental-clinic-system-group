import { useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, useParams } from "react-router-dom";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
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

function BookingCard({
  booking,
  onApprove,
  onPending,
  onCheckIn,
  onCancel,
  onArchive,
  onApproveReschedule,
  onDeclineReschedule,
}) {
  const reschedule = booking.rescheduleRequest;
  const appointmentTimeRange = getBookingTimeRange(booking);

  return (
    <li className="item detailedItem bookingShowcase">
      <div className="detailContent">
        <div className="detailTopRow">
          <div>
            <strong className="detailTitle">{booking.fullName || "No name"}</strong>
            <p className="detailSubtitle">
              Age {booking.age || "-"} • {booking.patientType || "Regular Patient"} • {booking.phone || "No phone"} • {booking.email || "No email"}
            </p>
          </div>
          <div className="statusStack">
            <span className={`statusPill ${booking.status || "pending"}`}>{booking.status || "pending"}</span>
            <span className={`statusPill ${booking.checkedInAt ? "approved" : "active"}`}>
              {booking.checkedInAt ? "checked in" : "visit pending"}
            </span>
          </div>
        </div>

        <div className="detailGrid">
          <div className="detailBox luxeBox">
            <span className="detailLabel">Preferred dentist</span>
            <strong>{booking.selectedDentist || "Not selected"}</strong>
          </div>
          <div className="detailBox luxeBox">
            <span className="detailLabel">Service</span>
            <strong>{booking.service || "Not set"}</strong>
          </div>
          <div className="detailBox luxeBox">
            <span className="detailLabel">Appointment day</span>
            <strong>{formatDateLabel(booking.date)}</strong>
          </div>
          <div className="detailBox luxeBox">
            <span className="detailLabel">Appointment time</span>
            <strong>{appointmentTimeRange}</strong>
          </div>
          <div className="detailBox luxeBox">
            <span className="detailLabel">Booked at</span>
            <strong>{formatTimestamp(booking.createdAt)}</strong>
          </div>
          <div className="detailBox luxeBox">
            <span className="detailLabel">Checked in at</span>
            <strong>{formatTimestamp(booking.checkedInAt)}</strong>
          </div>
        </div>

        {booking.notes ? (
          <div className="detailNote noteRibbon">
            <span className="detailLabel">Patient notes</span>
            <p>{booking.notes}</p>
          </div>
        ) : null}

        {reschedule ? (
          <div className={`detailNote historyPanel reschedulePanel ${reschedule.status === "pending" ? "attention" : ""}`}>
            <span className="detailLabel">Reschedule request</span>
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

      <div className="actionColumn">
        <button className="btn btnShine actionApprove" onClick={onApprove}>
          Approve
        </button>
        <button className="btn secondary btnSoft actionPending" onClick={onPending}>
          Set Pending
        </button>
        <button className="btn secondary btnSoft actionCheckin" onClick={onCheckIn}>
          {booking.checkedInAt ? "Clear Check-in" : "Mark Check-in"}
        </button>
        <button className="btn danger actionCancel" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn archiveButton actionArchive" onClick={onArchive}>
          Move to Archive
        </button>
      </div>
    </li>
  );
}

export default function Bookings() {
  const [bookings, setBookings] = useState([]);
  const [loadingBookings, setLoadingBookings] = useState(true);
  const [confirmState, setConfirmState] = useState(null);
  const [selectedCalendarCell, setSelectedCalendarCell] = useState(null);
  const [actionError, setActionError] = useState("");
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
    }),
    [activeBookings]
  );

  const bookingStats = useMemo(() => buildBookingAnalytics(activeBookings), [activeBookings]);
  const calendarCells = useMemo(() => buildCalendarCells(bookings, 21), [bookings]);

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
      <div className="hero adminHero bookingsHero">
        <div className="adminHeroGlow" />
        <div className="adminHeroContent">
          <span className="heroEyebrow">Appointment Command Center</span>
          <h1>Bookings</h1>
          <p>The booking board now includes clearer patient details, reschedule requests, and quick analytics so the team can scan the day faster.</p>
        </div>
      </div>

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
          <ul className="list detailedList">
            {activeItems.map((booking) => (
              <BookingCard
                key={booking.id}
                booking={booking}
                onApprove={() => runBookingAction(() => setStatus(booking.id, "approved"))}
                onPending={() => runBookingAction(() => setStatus(booking.id, "pending"))}
                onCheckIn={() =>
                  openConfirm({
                    title: booking.checkedInAt ? "Clear check-in?" : "Mark patient as checked in?",
                    message: booking.checkedInAt
                      ? "This will remove the current check-in timestamp from the booking."
                      : "This will mark the patient as checked in for this appointment.",
                    confirmLabel: booking.checkedInAt ? "Clear Check-in" : "Mark Check-in",
                    action: () => toggleCheckIn(booking),
                  })
                }
                onCancel={() =>
                  openConfirm({
                    title: "Cancel this booking?",
                    message: "This booking will move to the cancelled section and no longer appear as active.",
                    confirmLabel: "Cancel Booking",
                    tone: "danger",
                    action: () => setStatus(booking.id, "cancelled"),
                  })
                }
                onArchive={() =>
                  openConfirm({
                    title: "Move this booking to archive?",
                    message: "Archived bookings are removed from the active booking board but can still be restored later.",
                    confirmLabel: "Move to Archive",
                    tone: "archive",
                    action: () => toggleArchive(booking.id),
                  })
                }
                onApproveReschedule={() => runBookingAction(() => approveReschedule(booking))}
                onDeclineReschedule={() => runBookingAction(() => declineReschedule(booking))}
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            title={activeConfig.title}
            message={activeConfig.emptyText}
          />
        )}
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
