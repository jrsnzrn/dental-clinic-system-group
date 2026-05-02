import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot, query, collection, updateDoc, serverTimestamp, where } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebase";
import { formatDateLabel, formatTimeLabel, formatTimestamp, getClinicAvailability } from "../utils/schedule";
import { isArchivedBooking, sortBookings } from "../utils/appointments";
import { getActiveClosureForDate } from "../utils/clinic";

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

function buildSlots() {
  const slots = [];
  for (let h = 9; h <= 17; h += 1) {
    slots.push(`${pad(h)}:00`);
    slots.push(`${pad(h)}:30`);
  }
  return slots;
}

function getNextBookableDates(count = 10) {
  const result = [];
  const cursor = new Date();
  while (result.length < count) {
    const iso = cursor.toISOString().slice(0, 10);
    if (new Date(`${iso}T00:00:00`).getDay() !== 0) result.push(iso);
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

function AppointmentCard({ booking, onStartReschedule, onStartCancellation }) {
  const isCompleted = Boolean(booking.checkedInAt);
  const appointmentTimeRange = getBookingTimeRange(booking);
  const canRequestChanges =
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
              {booking.selectedDentist || "Clinic dentist"} • {formatDateLabel(booking.date)} • {appointmentTimeRange}
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
            <span className="detailLabel">Time slot</span>
            <strong>{appointmentTimeRange}</strong>
          </div>
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

        {booking.cancellationRequest ? (
          <div className="detailNote historyPanel attention" style={{ marginTop: 14 }}>
            <span className="detailLabel">Cancellation request</span>
            <p>
              Status: <strong>{booking.cancellationRequest.status || "pending"}</strong>
            </p>
            <p>{booking.cancellationRequest.reason || "No reason provided."}</p>
          </div>
        ) : null}
      </div>

      {canRequestChanges ? (
        <div className="actionColumn actionColumnFriendly">
          <button className="btn btnShine patientActionBtn" onClick={() => onStartReschedule(booking)}>
            Request Reschedule
          </button>
          <button className="btn secondary patientActionBtn" type="button" onClick={() => onStartCancellation(booking)}>
            Request Cancellation
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
  const [requestMode, setRequestMode] = useState("reschedule");
  const [rescheduleDraft, setRescheduleDraft] = useState({
    requestedDate: "",
    requestedTime: "09:00",
    reason: "",
  });
  const [dentists, setDentists] = useState([]);
  const [clinicClosures, setClinicClosures] = useState([]);
  const slotOptions = useMemo(() => buildSlots(), []);

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

    const bookingsQuery = query(
      collection(db, "bookings"),
      where("uid", "==", user.uid)
    );
    const unsubBookings = onSnapshot(
      bookingsQuery,
      (snap) => {
        const nextBookings = sortBookings(
          snap.docs
          .map((entry) => ({ id: entry.id, ...entry.data() }))
          .filter((booking) => !isArchivedBooking(booking))
        );
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

  useEffect(() => {
    const unsubDentists = onSnapshot(collection(db, "dentists"), (snapshot) => {
      setDentists(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    });
    const unsubClosures = onSnapshot(collection(db, "clinicClosures"), (snapshot) => {
      setClinicClosures(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    });
    return () => {
      unsubDentists();
      unsubClosures();
    };
  }, []);

  const groupedBookings = useMemo(() => buildStatusGroups(bookings), [bookings]);
  const nextAppointment = useMemo(
    () =>
      bookings.find(
        (booking) => booking.status !== "cancelled" && !booking.checkedInAt
      ) || null,
    [bookings]
  );

  const rescheduleSuggestions = useMemo(() => {
    if (!editingBookingId) return [];
    const booking = bookings.find((entry) => entry.id === editingBookingId);
    if (!booking) return [];
    const dentist = dentists.find((entry) => entry.name === booking.selectedDentist);
    if (!dentist) return [];

    const suggestions = [];
    const dates = getNextBookableDates(14);

    for (const date of dates) {
      const closure = getActiveClosureForDate(clinicClosures, date);
      const availability = getClinicAvailability(dentist, date, clinicClosures);
      if (closure || !availability.available || !availability.schedule?.active) continue;

      for (const slot of slotOptions) {
        if (slot < availability.schedule.start || slot >= availability.schedule.end) continue;
        const conflict = bookings.some((entry) =>
          entry.id !== booking.id &&
          entry.archiveStatus !== "Archived" &&
          entry.status !== "cancelled" &&
          entry.selectedDentist === booking.selectedDentist &&
          entry.date === date &&
          entry.time === slot
        );
        if (!conflict) {
          suggestions.push({ date, time: slot });
        }
        if (suggestions.length >= 6) return suggestions;
      }
    }
    return suggestions;
  }, [bookings, clinicClosures, dentists, editingBookingId, slotOptions]);

  function startReschedule(booking) {
    setRequestMode("reschedule");
    setEditingBookingId(booking.id);
    setRescheduleDraft({
      requestedDate: booking.date || "",
      requestedTime: booking.time || "09:00",
      reason: booking.rescheduleRequest?.reason || "",
    });
    setError("");
    setSuccess("");
  }

  function startCancellation(booking) {
    setRequestMode("cancel");
    setEditingBookingId(booking.id);
    setRescheduleDraft({
      requestedDate: booking.date || "",
      requestedTime: booking.time || "09:00",
      reason: booking.cancellationRequest?.reason || "",
    });
    setError("");
    setSuccess("");
  }

  async function submitAppointmentRequest(bookingId) {
    setError("");
    setSuccess("");

    if (!rescheduleDraft.reason.trim()) {
      setError(
        requestMode === "cancel"
          ? "Please give a reason for the cancellation request."
          : "Please give a reason for the reschedule request."
      );
      return;
    }

    if (requestMode === "cancel") {
      try {
        await updateDoc(doc(db, "bookings", bookingId), {
          cancellationRequest: {
            reason: rescheduleDraft.reason.trim(),
            status: "pending",
            requestedAt: serverTimestamp(),
          },
        });

        setEditingBookingId("");
        setSuccess("Your cancellation request was sent successfully. The clinic can now review it.");
      } catch (requestError) {
        console.error(requestError);
        setError("Could not send the cancellation request. Please try again.");
      }
      return;
    }

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
              <p>Sign in first to view your appointment statuses and request a reschedule or cancellation.</p>
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
            <p>Track every pending, approved, completed, and cancelled appointment in one place, then request a reschedule or cancellation without making a duplicate booking.</p>
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
                  ? `${formatDateLabel(nextAppointment.date)} • ${getBookingTimeRange(nextAppointment)}`
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
              <h3 className="title">{requestMode === "cancel" ? "Request a Cancellation" : "Request a New Schedule"}</h3>
              <p className="sub">
                {requestMode === "cancel"
                  ? "Send one clear cancellation request to the clinic so they can review and confirm it."
                  : "Send one clear reschedule request to the clinic instead of creating another booking."}
              </p>
            </div>
            <button className="searchClearBtn" type="button" onClick={() => setEditingBookingId("")}>
              Close
            </button>
          </div>

          {requestMode === "reschedule" ? (
            <div className="bookingFlowGrid">
              <label className="bookingFieldCard" data-mascot-target="appointment-request-date">
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

              <label className="bookingFieldCard" data-mascot-target="appointment-request-time">
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
          ) : null}

          <textarea
            className="input"
            rows={4}
            placeholder={requestMode === "cancel" ? "Reason for cancellation (required)" : "Reason for reschedule (required)"}
            value={rescheduleDraft.reason}
            onChange={(e) =>
              setRescheduleDraft((current) => ({ ...current, reason: e.target.value }))
            }
            data-mascot-target="appointment-request-reason"
            style={{ marginTop: 14 }}
          />

          {requestMode === "reschedule" && rescheduleSuggestions.length ? (
            <div className="detailNote historyPanel" style={{ marginTop: 14 }}>
              <span className="detailLabel">Suggested reschedule slots</span>
              <div className="inlineActionRow">
                {rescheduleSuggestions.map((option) => (
                  <button
                    key={`${option.date}-${option.time}`}
                    className="btn secondary btnSoft"
                    type="button"
                    onClick={() =>
                      setRescheduleDraft((current) => ({
                        ...current,
                        requestedDate: option.date,
                        requestedTime: option.time,
                      }))
                    }
                  >
                    {formatDateLabel(option.date)} • {formatTimeLabel(option.time)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <button
            className="btn btnShine bookingPrimaryBtn"
            type="button"
            style={{ marginTop: 14 }}
            onClick={() => submitAppointmentRequest(editingBookingId)}
          >
            {requestMode === "cancel" ? "Send Cancellation Request" : "Send Reschedule Request"}
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
                  <AppointmentCard
                    key={booking.id}
                    booking={booking}
                    onStartReschedule={startReschedule}
                    onStartCancellation={startCancellation}
                  />
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
