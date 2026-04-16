import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot, orderBy, query, collection, updateDoc, serverTimestamp } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebase";
import { formatDateLabel, formatTimeLabel, formatTimestamp } from "../utils/schedule";
import { isArchivedBooking } from "../utils/appointments";

function AppointmentCard({ booking, onStartReschedule }) {
  const isCompleted = Boolean(booking.checkedInAt);
  const canReschedule =
    !isCompleted &&
    booking.status !== "cancelled" &&
    booking.archiveStatus !== "Archived";

  return (
    <li className="item detailedItem bookingShowcase">
      <div className="detailContent">
        <div className="detailTopRow">
          <div>
            <strong className="detailTitle">{booking.service || "Consultation"}</strong>
            <p className="detailSubtitle">
              {booking.selectedDentist || "Clinic dentist"} • {formatDateLabel(booking.date)} • {formatTimeLabel(booking.time)}
            </p>
          </div>
          <div className="statusStack">
            <span className={`statusPill ${isCompleted ? "approved" : booking.status || "pending"}`}>
              {isCompleted ? "completed" : booking.status || "pending"}
            </span>
          </div>
        </div>

        <div className="detailGrid">
          <div className="detailBox luxeBox">
            <span className="detailLabel">Booked at</span>
            <strong>{formatTimestamp(booking.createdAt)}</strong>
          </div>
          <div className="detailBox luxeBox">
            <span className="detailLabel">Appointment notes</span>
            <strong>{booking.notes || "No notes added"}</strong>
          </div>
          <div className="detailBox luxeBox">
            <span className="detailLabel">Check-in</span>
            <strong>{isCompleted ? formatTimestamp(booking.checkedInAt) : "Waiting for visit"}</strong>
          </div>
        </div>

        {booking.rescheduleRequest ? (
          <div className="detailNote historyPanel" style={{ marginTop: 14 }}>
            <span className="detailLabel">Reschedule request</span>
            <p>
              Requested for {formatDateLabel(booking.rescheduleRequest.requestedDate)} at{" "}
              {formatTimeLabel(booking.rescheduleRequest.requestedTime)}
            </p>
            <p>
              Status: <strong>{booking.rescheduleRequest.status || "pending"}</strong>
              {booking.rescheduleRequest.reason ? ` • ${booking.rescheduleRequest.reason}` : ""}
            </p>
          </div>
        ) : null}
      </div>

      {canReschedule ? (
        <div className="actionColumn actionColumnFriendly">
          <button className="btn btnShine patientActionBtn" onClick={() => onStartReschedule(booking)}>
            Request Reschedule
          </button>
        </div>
      ) : null}
    </li>
  );
}

function buildStatusGroups(bookings) {
  return {
    pending: bookings.filter((booking) => booking.status === "pending" && !booking.checkedInAt),
    approved: bookings.filter((booking) => booking.status === "approved" && !booking.checkedInAt),
    completed: bookings.filter((booking) => booking.checkedInAt),
    cancelled: bookings.filter((booking) => booking.status === "cancelled" && !booking.checkedInAt),
  };
}

export default function MyAppointments() {
  const [user, setUser] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editingBookingId, setEditingBookingId] = useState("");
  const [rescheduleDraft, setRescheduleDraft] = useState({
    requestedDate: "",
    requestedTime: "09:00",
    reason: "",
  });

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setError("");
      setSuccess("");
      setLoading(!nextUser);
    });

    return () => unsubAuth();
  }, []);

  useEffect(() => {
    if (!user) {
      setBookings([]);
      setLoading(false);
      return;
    }

    const bookingsQuery = query(collection(db, "bookings"), orderBy("appointmentAt", "desc"));
    const unsubBookings = onSnapshot(
      bookingsQuery,
      (snap) => {
        const nextBookings = snap.docs
          .map((entry) => ({ id: entry.id, ...entry.data() }))
          .filter((booking) => booking.uid === user.uid && !isArchivedBooking(booking));
        setBookings(nextBookings);
        setLoading(false);
      },
      (snapshotError) => {
        console.error(snapshotError);
        setError("Could not load your appointments right now.");
        setLoading(false);
      }
    );

    return () => unsubBookings();
  }, [user]);

  const groupedBookings = useMemo(() => buildStatusGroups(bookings), [bookings]);
  const nextAppointment = useMemo(
    () =>
      bookings.find(
        (booking) => booking.status !== "cancelled" && !booking.checkedInAt
      ) || null,
    [bookings]
  );

  function startReschedule(booking) {
    setEditingBookingId(booking.id);
    setRescheduleDraft({
      requestedDate: booking.date || "",
      requestedTime: booking.time || "09:00",
      reason: booking.rescheduleRequest?.reason || "",
    });
    setError("");
    setSuccess("");
  }

  async function submitRescheduleRequest(bookingId) {
    setError("");
    setSuccess("");

    if (!rescheduleDraft.requestedDate) {
      setError("Please choose a new date for the reschedule request.");
      return;
    }

    const requestDate = new Date(`${rescheduleDraft.requestedDate}T00:00:00`);
    if (requestDate.getDay() === 0) {
      setError("Sunday reschedule requests are not allowed. Please choose Monday to Saturday.");
      return;
    }

    try {
      await updateDoc(doc(db, "bookings", bookingId), {
        rescheduleRequest: {
          requestedDate: rescheduleDraft.requestedDate,
          requestedTime: rescheduleDraft.requestedTime,
          reason: rescheduleDraft.reason.trim(),
          status: "pending",
          requestedAt: serverTimestamp(),
        },
      });

      setEditingBookingId("");
      setSuccess("Your reschedule request was sent successfully. The clinic can now review the new schedule.");
    } catch (requestError) {
      console.error(requestError);
      setError("Could not send the reschedule request. Please try again.");
    }
  }

  if (!user) {
    return (
      <div className="container bookingPage">
        <div className="hero bookingHero">
          <div className="bookingHeroGlow" />
          <div className="bookingHeroGrid">
            <div>
              <span className="heroEyebrow">Appointments</span>
              <h1>My Appointments</h1>
              <p>Sign in first to view your appointment statuses and request a reschedule.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container bookingPage">
      <div className="hero bookingHero">
        <div className="bookingHeroGlow" />
        <div className="bookingHeroGrid">
          <div>
            <span className="heroEyebrow">Appointments Hub</span>
            <h1>My Appointments</h1>
            <p>Track every pending, approved, completed, and cancelled appointment in one place, then request a reschedule without making a duplicate booking.</p>
          </div>
          <div className="bookingHeroSummary">
            <div className="bookingSummaryCard">
              <span className="detailLabel">Pending</span>
              <strong>{groupedBookings.pending.length}</strong>
            </div>
            <div className="bookingSummaryCard">
              <span className="detailLabel">Approved</span>
              <strong>{groupedBookings.approved.length}</strong>
            </div>
            <div className="bookingSummaryCard">
              <span className="detailLabel">Next appointment</span>
              <strong>
                {nextAppointment
                  ? `${formatDateLabel(nextAppointment.date)} • ${formatTimeLabel(nextAppointment.time)}`
                  : "No upcoming visit"}
              </strong>
            </div>
          </div>
        </div>
      </div>

      {success ? (
        <div className="successBanner" style={{ marginTop: 18 }}>
          <strong>{success}</strong>
          <span>The clinic can review your request from the booking dashboard.</span>
        </div>
      ) : null}

      {error ? <div className="error" style={{ marginTop: 18 }}>{error}</div> : null}

      {editingBookingId ? (
        <div className="card adminEditorCard" style={{ marginTop: 18 }}>
          <div className="cardHeader">
            <div>
              <h3 className="title">Request a New Schedule</h3>
              <p className="sub">Send one clear reschedule request to the clinic instead of creating another booking.</p>
            </div>
            <button className="searchClearBtn" type="button" onClick={() => setEditingBookingId("")}>
              Close
            </button>
          </div>

          <div className="bookingFlowGrid">
            <label className="bookingFieldCard">
              <span className="detailLabel">Requested date</span>
              <input
                className="input bookingInputSpecial"
                type="date"
                value={rescheduleDraft.requestedDate}
                onChange={(e) =>
                  setRescheduleDraft((current) => ({ ...current, requestedDate: e.target.value }))
                }
              />
            </label>

            <label className="bookingFieldCard">
              <span className="detailLabel">Requested time</span>
              <input
                className="input bookingInputSpecial"
                type="time"
                value={rescheduleDraft.requestedTime}
                onChange={(e) =>
                  setRescheduleDraft((current) => ({ ...current, requestedTime: e.target.value }))
                }
              />
            </label>
          </div>

          <textarea
            className="input"
            rows={4}
            placeholder="Reason for reschedule (optional)"
            value={rescheduleDraft.reason}
            onChange={(e) =>
              setRescheduleDraft((current) => ({ ...current, reason: e.target.value }))
            }
            style={{ marginTop: 14 }}
          />

          <button
            className="btn btnShine bookingPrimaryBtn"
            type="button"
            style={{ marginTop: 14 }}
            onClick={() => submitRescheduleRequest(editingBookingId)}
          >
            Send Reschedule Request
          </button>
        </div>
      ) : null}

      <div className="adminPanelGrid" style={{ marginTop: 18 }}>
        {[
          ["Pending", groupedBookings.pending, "Appointments waiting for clinic approval."],
          ["Approved", groupedBookings.approved, "Confirmed appointments ready for your visit."],
          ["Completed", groupedBookings.completed, "Appointments already checked in and completed."],
          ["Cancelled", groupedBookings.cancelled, "Appointments cancelled by the clinic or patient flow."],
        ].map(([title, list, subtitle]) => (
          <div key={title} className="card adminRecordsCard">
            <div className="cardHeader">
              <div>
                <h3 className="title">{title}</h3>
                <p className="sub">{subtitle}</p>
              </div>
              <span className="badge">{list.length} records</span>
            </div>

            {loading ? (
              <div className="emptyEditorState">Loading your appointments...</div>
            ) : list.length ? (
              <ul className="list detailedList">
                {list.map((booking) => (
                  <AppointmentCard key={booking.id} booking={booking} onStartReschedule={startReschedule} />
                ))}
              </ul>
            ) : (
              <div className="emptyEditorState">No {String(title).toLowerCase()} appointments right now.</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
