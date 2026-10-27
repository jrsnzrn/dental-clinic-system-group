import { useEffect, useMemo, useState } from "react";
import {
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  collection,
  updateDoc,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebase";
import {
  formatDateLabel,
  formatTimeLabel,
  formatTimestamp,
  getClinicAvailability,
  getDentistDaySchedule,
} from "../utils/schedule";
import { isArchivedBooking, sortBookings } from "../utils/appointments";
import {
  getActiveClosureForDate,
  getBookingServiceOptions,
  getClinicServiceImage,
} from "../utils/clinic";

function pad(n) {
  return String(n).padStart(2, "0");
}

function toLocalISODate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isSunday(dateStr) {
  return new Date(`${dateStr}T00:00:00`).getDay() === 0;
}

function getMonthStart(dateStr) {
  const base = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
  return new Date(base.getFullYear(), base.getMonth(), 1);
}

function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
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

function getBookingServiceNames(booking) {
  if (!booking) return [];
  if (Array.isArray(booking.selectedServices) && booking.selectedServices.length) {
    return booking.selectedServices;
  }
  return String(booking.service || "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
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
    const iso = toLocalISODate(cursor);
    if (!isSunday(iso)) result.push(iso);
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

function AppointmentCard({ booking, isViewing, onViewSummary, onStartReschedule, onStartCancellation }) {
  const isCompleted = ["pending_payment", "completed"].includes(booking.status);
  const isCheckedIn = Boolean(booking.checkedInAt);
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
            <span className={`statusPill ${booking.status || "pending"}`}>
              {booking.status || "pending"}
            </span>
            {isCheckedIn ? <span className="statusPill approved">Checked in</span> : null}
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
            <strong>{isCheckedIn ? formatTimestamp(booking.checkedInAt) : "Waiting for visit"}</strong>
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

      <div className="actionColumn actionColumnFriendly">
        <button
          className="btn secondary btnSoft patientActionBtn"
          type="button"
          onClick={() => onViewSummary(booking)}
          disabled={isViewing}
        >
          {isViewing ? "Viewing Summary" : "View Summary"}
        </button>
        {canRequestChanges ? (
          <>
            <button className="btn btnShine patientActionBtn" type="button" onClick={() => onStartReschedule(booking)}>
              Request Reschedule
            </button>
            <button className="btn secondary patientActionBtn" type="button" onClick={() => onStartCancellation(booking)}>
              Request Cancellation
            </button>
          </>
        ) : null}
      </div>
    </li>
  );
}

function buildStatusGroups(bookings) {
  return {
    pending: bookings.filter((booking) => booking.status === "pending"),
    approved: bookings.filter((booking) => booking.status === "approved"),
    pendingPayment: bookings.filter((booking) => booking.status === "pending_payment"),
    completed: bookings.filter((booking) => booking.status === "completed"),
    cancelled: bookings.filter((booking) => booking.status === "cancelled"),
  };
}

export default function MyAppointments() {
  const [user, setUser] = useState(null);
  const [patientProfile, setPatientProfile] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editingBookingId, setEditingBookingId] = useState("");
  const [summaryBookingId, setSummaryBookingId] = useState("");
  const [requestMode, setRequestMode] = useState("reschedule");
  const [rescheduleDraft, setRescheduleDraft] = useState({
    requestedDate: "",
    requestedTime: "09:00",
    reason: "",
  });
  const [dentists, setDentists] = useState([]);
  const [clinicClosures, setClinicClosures] = useState([]);
  const [clinicServices, setClinicServices] = useState([]);
  const [servicePreviewIndex, setServicePreviewIndex] = useState(0);
  const [calendarMonth, setCalendarMonth] = useState(() => getMonthStart(toLocalISODate(new Date())));
  const slotOptions = useMemo(() => buildSlots(), []);
  const todayStr = toLocalISODate(new Date());

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
      setPatientProfile(null);
      return undefined;
    }

    let cancelled = false;
    getDoc(doc(db, "patientProfiles", user.uid))
      .then((snap) => {
        if (!cancelled) setPatientProfile(snap.exists() ? snap.data() : null);
      })
      .catch((profileError) => console.error(profileError));

    return () => {
      cancelled = true;
    };
  }, [user]);

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
    const unsubServices = onSnapshot(
      query(collection(db, "clinicServices"), orderBy("name", "asc")),
      (snapshot) => {
        setClinicServices(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
      }
    );
    return () => {
      unsubDentists();
      unsubClosures();
      unsubServices();
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

  /* ---------- Appointment Summary data ---------- */
  const summaryBooking = useMemo(
    () => bookings.find((entry) => entry.id === summaryBookingId) || nextAppointment || null,
    [bookings, nextAppointment, summaryBookingId]
  );
  const activeServiceOptions = useMemo(() => getBookingServiceOptions(clinicServices), [clinicServices]);
  const summaryServiceNames = useMemo(() => getBookingServiceNames(summaryBooking), [summaryBooking]);
  const summaryServiceRecords = useMemo(
    () => summaryServiceNames
      .map((name) => activeServiceOptions.find((entry) => entry.name === name))
      .filter(Boolean),
    [activeServiceOptions, summaryServiceNames]
  );
  const previewServiceRecord = summaryServiceRecords[servicePreviewIndex] || summaryServiceRecords[0] || null;
  const summaryDuration =
    Number(summaryBooking?.estimatedDurationMinutes) ||
    summaryServiceRecords.reduce((total, entry) => total + Number(entry.durationMinutes || 0), 0) ||
    60;
  const summaryDentist = useMemo(
    () => dentists.find((entry) => entry.name === summaryBooking?.selectedDentist) || null,
    [dentists, summaryBooking]
  );
  const summaryDaySchedule = summaryBooking
    ? getDentistDaySchedule(summaryDentist, summaryBooking.date)
    : null;
  const summaryStatus = summaryBooking?.status
    ? summaryBooking.status.charAt(0).toUpperCase() + summaryBooking.status.slice(1)
    : "Pending";
  const patientName =
    patientProfile?.fullName ||
    [patientProfile?.firstName, patientProfile?.lastName].filter(Boolean).join(" ") ||
    user?.displayName ||
    "-";

  useEffect(() => {
    if (summaryServiceRecords.length <= 1) {
      setServicePreviewIndex(0);
      return undefined;
    }

    const timer = setInterval(() => {
      setServicePreviewIndex((current) => (current + 1) % summaryServiceRecords.length);
    }, 2400);

    return () => clearInterval(timer);
  }, [summaryServiceRecords.length]);

  useEffect(() => {
    if (summaryBooking?.date) setCalendarMonth(getMonthStart(summaryBooking.date));
  }, [summaryBooking?.date]);

  const highlightedDate =
    editingBookingId && requestMode === "reschedule" && rescheduleDraft.requestedDate
      ? rescheduleDraft.requestedDate
      : summaryBooking?.date || "";
  const appointmentDates = useMemo(
    () => new Set(bookings.map((booking) => booking.date).filter(Boolean)),
    [bookings]
  );

  const calendarCells = useMemo(() => {
    const firstDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    const start = new Date(firstDay);
    start.setDate(firstDay.getDate() - firstDay.getDay());

    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      const iso = toLocalISODate(day);
      const isCurrentMonth = day.getMonth() === calendarMonth.getMonth();
      const closure = getActiveClosureForDate(clinicClosures, iso);
      const hasDentist = summaryDentist
        ? getClinicAvailability(summaryDentist, iso, clinicClosures).available
        : dentists.some(
            (dentist) =>
              dentist.archiveStatus !== "Archived" &&
              getClinicAvailability(dentist, iso, clinicClosures).available
          );

      return {
        iso,
        dayNumber: day.getDate(),
        isCurrentMonth,
        isSelected: iso === highlightedDate,
        hasAppointments: appointmentDates.has(iso),
        isPast: iso < todayStr,
        isSunday: isSunday(iso),
        closure,
        isAvailable: isCurrentMonth && iso >= todayStr && !isSunday(iso) && !closure && hasDentist,
      };
    });
  }, [appointmentDates, calendarMonth, clinicClosures, dentists, highlightedDate, summaryDentist, todayStr]);

  const calendarMonthLabel = calendarMonth.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  function moveCalendarMonth(amount) {
    const nextMonth = addMonths(calendarMonth, amount);
    if (nextMonth < getMonthStart(todayStr)) return;
    setCalendarMonth(nextMonth);
  }

  function getCalendarCellLabel(cell) {
    if (cell.closure) return cell.closure.label;
    if (cell.isSunday) return "Closed";
    if (cell.isPast) return "Past";
    if (!cell.isCurrentMonth) return "";
    return cell.isAvailable ? "Available" : "Unavailable";
  }

  function chooseCalendarDate(cell) {
    if (!cell.isAvailable) return;
    if (!editingBookingId || requestMode !== "reschedule") return;
    setRescheduleDraft((current) => ({ ...current, requestedDate: cell.iso }));
  }

  /* ---------- Reschedule suggestions ---------- */
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

  function viewSummary(booking) {
    setSummaryBookingId(booking.id);
  }

  function startReschedule(booking) {
    setRequestMode("reschedule");
    setEditingBookingId(booking.id);
    setSummaryBookingId(booking.id);
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
    setSummaryBookingId(booking.id);
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

      {/* ===================== FORM + APPOINTMENT SUMMARY ===================== */}
      <div className="grid" style={{ marginTop: 18 }}>
        {/* ---------- Form ---------- */}
        <div className="card adminEditorCard">
          <div className="cardHeader">
            <div>
              <h3 className="title">
                {!editingBookingId
                  ? "Request a Change"
                  : requestMode === "cancel"
                    ? "Request a Cancellation"
                    : "Request a New Schedule"}
              </h3>
              <p className="sub">
                {!editingBookingId
                  ? "Pick an appointment below, then choose Request Reschedule or Request Cancellation."
                  : requestMode === "cancel"
                    ? "Send one clear cancellation request to the clinic so they can review and confirm it."
                    : "Send one clear reschedule request to the clinic instead of creating another booking."}
              </p>
            </div>
            {editingBookingId ? (
              <button className="searchClearBtn" type="button" onClick={() => setEditingBookingId("")}>
                Close
              </button>
            ) : null}
          </div>

          {editingBookingId ? (
            <>
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
            </>
          ) : (
            <div className="emptyEditorState">
              No request in progress. Use the buttons on any appointment below to start one.
            </div>
          )}
        </div>

        {/* ---------- Appointment Summary ---------- */}
        <div className="card bookingDetailsCard" data-mascot-target="booking-summary">
          <div className="cardHeader">
            <div>
              <h3 className="title">Appointment Summary</h3>
              <p className="sub">
                {summaryBooking
                  ? summaryBooking.id === nextAppointment?.id
                    ? "Showing your next upcoming appointment."
                    : "Showing the appointment you selected."
                  : "Review the key details of your appointment."}
              </p>
            </div>
            {summaryBooking ? (
              <span className={`statusPill ${summaryBooking.checkedInAt ? "approved" : summaryBooking.status || "pending"}`}>
                {summaryStatus}
              </span>
            ) : null}
          </div>

          {loading ? (
            <div className="emptyEditorState">Loading your appointments...</div>
          ) : !summaryBooking ? (
            <div className="emptyEditorState">
              You have no appointment to summarize yet. Book one and it will show up here.
            </div>
          ) : (
            <>
              <div className="bookingServicePreviewCard">
                <div className="bookingServicePreviewMedia">
                  <img
                    src={getClinicServiceImage(previewServiceRecord || { name: summaryServiceNames[0] || summaryBooking.service })}
                    alt={previewServiceRecord?.name || summaryBooking.service || "Service"}
                    onError={(event) => {
                      event.currentTarget.src = getClinicServiceImage({
                        name: previewServiceRecord?.name || summaryServiceNames[0] || summaryBooking.service,
                        image: "",
                      });
                    }}
                  />
                </div>
                <div className="bookingServicePreviewContent">
                  <span className="detailLabel">Booked services</span>
                  <strong>{previewServiceRecord?.name || summaryServiceNames[0] || summaryBooking.service || "Consultation"}</strong>
                  <p>
                    {previewServiceRecord?.description || "These services were booked through the clinic scheduler."}
                  </p>
                  {summaryServiceRecords.length > 1 ? (
                    <span className="bookingPreviewCounter">
                      Showing {servicePreviewIndex + 1} of {summaryServiceRecords.length} booked services
                    </span>
                  ) : null}
                  <div className="bookingServiceChips">
                    {summaryServiceNames.map((serviceName) => (
                      <span
                        key={serviceName}
                        className={previewServiceRecord?.name === serviceName ? "active" : ""}
                      >
                        {serviceName}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="detailGrid" style={{ marginTop: 18 }}>
                <div className="detailBox luxeBox">
                  <span className="detailLabel">Patient name</span>
                  <strong>{patientName}</strong>
                </div>
                <div className="detailBox luxeBox">
                  <span className="detailLabel">Patient type</span>
                  <strong>{patientProfile?.patientType || "-"}</strong>
                </div>
                <div className="detailBox luxeBox">
                  <span className="detailLabel">Age</span>
                  <strong>{patientProfile?.age || "-"}</strong>
                </div>
                <div className="detailBox luxeBox">
                  <span className="detailLabel">Services</span>
                  <strong>
                    {summaryServiceNames.length} booked
                  </strong>
                </div>
                <div className="detailBox luxeBox bookingRatesBox">
                  <span className="detailLabel">Starting rates</span>
                  <div className="bookingRateList">
                    {summaryServiceRecords.length ? (
                      summaryServiceRecords.map((entry) => (
                        <div key={entry.name} className="bookingRateItem">
                          <span>{entry.name}</span>
                          <strong>{entry.startingRate || "Ask clinic"}</strong>
                        </div>
                      ))
                    ) : (
                      <strong>Ask clinic</strong>
                    )}
                  </div>
                </div>
                <div className="detailBox luxeBox">
                  <span className="detailLabel">Estimated duration</span>
                  <strong>{summaryDuration} minutes</strong>
                </div>
                <div className="detailBox luxeBox">
                  <span className="detailLabel">Dentist</span>
                  <strong>{summaryBooking.selectedDentist || "Clinic dentist"}</strong>
                </div>
                <div className="detailBox luxeBox">
                  <span className="detailLabel">Appointment day</span>
                  <strong>{formatDateLabel(summaryBooking.date)}</strong>
                </div>
                <div className="detailBox luxeBox">
                  <span className="detailLabel">Appointment time</span>
                  <strong>{getBookingTimeRange(summaryBooking)}</strong>
                </div>
                <div className="detailBox luxeBox">
                  <span className="detailLabel">Dentist status</span>
                  <strong>{summaryDentist && summaryDaySchedule?.active ? "Active" : "Inactive"}</strong>
                </div>
              </div>

              <div className="bookingCalendar summaryCalendar" data-mascot-target="booking-calendar">
                <div className="bookingCalendarHeader">
                  <div>
                    <span className="detailLabel">
                      {summaryBooking.selectedDentist ? `${summaryBooking.selectedDentist} availability` : "Dentist availability"}
                    </span>
                    <strong>{calendarMonthLabel}</strong>
                  </div>
                  <div className="bookingCalendarControls">
                    <button
                      type="button"
                      onClick={() => moveCalendarMonth(-1)}
                      disabled={getMonthStart(todayStr).getTime() === calendarMonth.getTime()}
                    >
                      Prev
                    </button>
                    <button type="button" onClick={() => moveCalendarMonth(1)}>
                      Next
                    </button>
                  </div>
                </div>

                <div className="bookingCalendarWeekdays">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((dayName) => (
                    <span key={dayName}>{dayName}</span>
                  ))}
                </div>

                <div className="bookingCalendarGrid">
                  {calendarCells.map((cell) => (
                    <button
                      key={cell.iso}
                      type="button"
                      className={`bookingCalendarDay ${cell.isSelected ? "active" : ""} ${cell.hasAppointments ? "hasAppointments" : ""} ${!cell.isCurrentMonth ? "muted" : ""} ${cell.isAvailable ? "available" : "blocked"}`}
                      onClick={() => chooseCalendarDate(cell)}
                      disabled={!cell.isAvailable}
                      title={getCalendarCellLabel(cell)}
                    >
                      <strong>{cell.dayNumber}</strong>
                      <span>{getCalendarCellLabel(cell)}</span>
                    </button>
                  ))}
                </div>

                {editingBookingId && requestMode === "reschedule" ? (
                  <p className="bookingFieldHint" style={{ marginTop: 10 }}>
                    Tap an available day to use it as your requested date.
                  </p>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ===================== APPOINTMENT LISTS ===================== */}
      <div className="adminPanelGrid" style={{ marginTop: 18 }}>
        {[
          ["Pending", groupedBookings.pending, "Appointments waiting for clinic approval."],
          ["Approved", groupedBookings.approved, "Confirmed appointments ready for your visit."],
          ["Pending Payment", groupedBookings.pendingPayment, "Treatment is finished and payment is pending."],
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
                    isViewing={booking.id === summaryBooking?.id}
                    onViewSummary={viewSummary}
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