import LoadingIndicator from "../components/LoadingIndicator";
import PaginatedRecords from "../components/PaginatedRecords";
import ModalPortal from "../components/ModalPortal";
import ConfirmDialog from "../components/ConfirmDialog";
import PatientPaymentReceipts from "../components/PatientPaymentReceipts";
import { useEffect, useMemo, useState } from "react";
import { notifySuccess } from "../utils/successDialog";
import {
  doc,
  deleteField,
  onSnapshot,
  query,
  collection,
  runTransaction,
  where,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { getClinicDate } from "../../functions/bookingWindow.mjs";
import { auth, db, functions } from "../firebase";
import {
  formatDateLabel,
  formatTimeLabel,
  formatTimestamp,
} from "../utils/schedule";
import { isArchivedBooking, sortBookings } from "../utils/appointments";
import { formatAppointmentStatusLabel, getAppointmentStatusClass, getRescheduleRequestBlockLabel, hasPendingCancellationRequest, isCurrentAppointmentSlot } from "../utils/appointmentStatus";

const RESPOND_TO_RESCHEDULE_OFFER = httpsCallable(functions, "respondToRescheduleOffer");
const GET_RESCHEDULE_AVAILABILITY = httpsCallable(functions, "getRescheduleAvailability");
const REQUEST_RESCHEDULE = httpsCallable(functions, "requestReschedule");
const CANCEL_PATIENT_BOOKING = httpsCallable(functions, "cancelPatientBooking");
const offerDeadlineDate = new Intl.DateTimeFormat("en-PH", {
  weekday: "long", month: "long", day: "numeric", timeZone: "Asia/Manila",
});
const offerDeadlineTime = new Intl.DateTimeFormat("en-PH", {
  hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Manila",
});

function hasActiveRescheduleOffer(booking) {
  const offer = booking.rescheduleOffer;
  const request = booking.rescheduleRequest;
  return offer?.status === "pending" && offer.expiresAt?.toMillis() > Date.now() &&
    ["pending", "approved"].includes(booking.status) && !booking.checkedInAt &&
    !isArchivedBooking(booking) && booking.cancellationRequest?.status !== "pending" &&
    booking.date === offer.originalDate && booking.time === offer.originalTime && booking.dentistId === offer.dentistId &&
    request?.status === "pending" && (request.requestedDate || "") === offer.requestDate &&
    (request.requestedTime || "") === offer.requestTime &&
    request.requestedAt?.toMillis?.() === offer.requestAt?.toMillis?.();
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function isSunday(dateStr) {
  return new Date(`${dateStr}T00:00:00`).getDay() === 0;
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

function AppointmentTableRow({ booking, onStartReschedule, onStartCancellation, onWithdraw }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const canRequestChanges = ["pending", "approved"].includes(booking.status) && !booking.checkedInAt && !isArchivedBooking(booking);
  const cancellationPending = hasPendingCancellationRequest(booking);
  const reschedulePending = booking.rescheduleRequest?.status === "pending";
  const hasAdditionalDetails = Boolean(
    booking.notes ||
    booking.cancellationRequest ||
    booking.cancellationReason ||
    booking.rescheduleRequest ||
    booking.checkedInAt ||
    booking.createdAt
  );
  const detailsId = `appointment-details-${booking.id}`;
  const rescheduleBlockLabel = getRescheduleRequestBlockLabel(booking);
  const rescheduleStatusClass = String(booking.rescheduleRequest?.status || "pending")
    .toLowerCase()
    .replace(/[\s_]+/g, "-");

  return (
    <>
      <tr className="appointmentTableRow">
        <td className="appointmentTableService">
          <div className="appointmentTableServiceMain">
            <svg className="appointmentTableTooth" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3.2c-2.2-1.1-6-.7-7.4 2.2-1.4 2.9.4 7.3 1.7 10.1 1 2.2 1.5 5.2 2.8 5.2 1.1 0 1.3-4.1 2.9-4.1s1.8 4.1 2.9 4.1c1.3 0 1.8-3 2.8-5.2 1.3-2.8 3.1-7.2 1.7-10.1C18 2.5 14.2 2.1 12 3.2Z" />
            </svg>
            <span>
              <strong>{booking.service || "Consultation"}</strong>
              {booking.bracesPackage?.type && booking.bracesPackage.type !== booking.bracesPackage.service ? (
                <small>Braces type: {booking.bracesPackage.type}</small>
              ) : null}
              <small>{booking.selectedDentist || "Clinic dentist"}</small>
            </span>
          </div>
          {hasAdditionalDetails ? (
            <button
              className="appointmentTableDetailsToggle"
              type="button"
              aria-expanded={detailsOpen}
              aria-controls={detailsId}
              aria-label={`${detailsOpen ? "Hide" : "Show"} details for ${booking.service || "appointment"}`}
              onClick={() => setDetailsOpen((open) => !open)}
            >
              {detailsOpen ? "Hide details" : "View details"}
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="m6 8 4 4 4-4" />
              </svg>
            </button>
          ) : null}
        </td>
        <td className="appointmentTableDateTime">
          <span>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <rect x="3" y="4.5" width="14" height="13" rx="2" />
              <path d="M3 8h14M7 2.5v4M13 2.5v4" />
            </svg>
            {formatDateLabel(booking.date)}
          </span>
          <span>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="10" cy="10" r="7" />
              <path d="M10 6v4l2.5 1.5" />
            </svg>
            {getBookingTimeRange(booking)}
          </span>
        </td>
        <td className="appointmentTableStatus">
          <span className={`statusPill ${getAppointmentStatusClass(booking.status)}`}>
            {formatAppointmentStatusLabel(booking.status)}
          </span>
        </td>
        <td className="appointmentTableActions">
          {canRequestChanges && (cancellationPending || reschedulePending) ? (
            <>
              {reschedulePending ? (
                <button className="appointmentTableReschedule" type="button" onClick={() => onWithdraw(booking, "rescheduleRequest")}>
                  Withdraw reschedule
                </button>
              ) : null}
              {cancellationPending ? (
                <button className="appointmentTableCancel" type="button" onClick={() => onWithdraw(booking, "cancellationRequest")}>
                  Withdraw cancellation
                </button>
              ) : null}
              {cancellationPending && !reschedulePending ? (
                <button className="appointmentTableCancel" type="button" onClick={() => onStartCancellation(booking)}>
                  Cancel appointment
                </button>
              ) : null}
            </>
          ) : canRequestChanges ? (
            <>
              <button
                className="appointmentTableReschedule"
                type="button"
                onClick={() => onStartReschedule(booking)}
              >
                Reschedule
              </button>
              <button
                className="appointmentTableCancel"
                type="button"
                onClick={() => onStartCancellation(booking)}
              >
                Cancel
              </button>
            </>
          ) : <span className="appointmentTableNoAction">—</span>}
        </td>
      </tr>
      {detailsOpen ? (
        <tr className="appointmentTableDetailsRow">
          <td colSpan="4" id={detailsId}>
            {booking.checkedInAt ? <p><strong>Checked in:</strong> {formatTimestamp(booking.checkedInAt)}</p> : null}
            {booking.createdAt ? <p><strong>Booked:</strong> {formatTimestamp(booking.createdAt)}</p> : null}
            {booking.notes ? <p><strong>Appointment notes:</strong> {booking.notes}</p> : null}
            {booking.rescheduleRequest ? (
              <p>
                <strong>Reschedule Request:</strong> Requested for {formatDateLabel(booking.rescheduleRequest.requestedDate)} at{" "}
                {formatTimeLabel(booking.rescheduleRequest.requestedTime)} · Status:{" "}
                <strong className={`appointmentRequestStatus status-${rescheduleStatusClass}`}>
                  {rescheduleBlockLabel || formatAppointmentStatusLabel(booking.rescheduleRequest.status || "pending")}
                </strong>
                {booking.rescheduleRequest.reason ? ` · ${booking.rescheduleRequest.reason}` : ""}
              </p>
            ) : null}
            {booking.cancellationReason ? (
              <p><strong>Cancellation reason:</strong> {booking.cancellationReason}</p>
            ) : booking.cancellationRequest ? (
              <p>
                <strong>Cancellation Request:</strong> {booking.cancellationRequest.reason || "No reason provided."} · Status:{" "}
                <strong className={`appointmentRequestStatus status-${String(booking.cancellationRequest.status || "pending").toLowerCase().replace(/[\s_]+/g, "-")}`}>
                  {formatAppointmentStatusLabel(booking.cancellationRequest.status || "pending")}
                </strong>
              </p>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
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
  const [bookings, setBookings] = useState([]);
  const [authReady, setAuthReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingBookingId, setEditingBookingId] = useState("");
  const [sendingRequest, setSendingRequest] = useState(false);
  const [withdrawal, setWithdrawal] = useState(null);
  const [requestFormOpen, setRequestFormOpen] = useState(false);
  const [requestMode, setRequestMode] = useState("reschedule");
  const [rescheduleDraft, setRescheduleDraft] = useState({
    requestedDate: "",
    requestedTime: "09:00",
    reason: "",
  });
  const [rescheduleAvailability, setRescheduleAvailability] = useState(null);
  const [availabilityVersion, setAvailabilityVersion] = useState(0);

  useEffect(() => {
    if (!requestFormOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function closeOnEscape(event) {
      if (event.key === "Escape" && !sendingRequest) {
        setRequestFormOpen(false);
        setEditingBookingId("");
        setError("");
      }
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [requestFormOpen, sendingRequest]);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      setError("");
      setLoading(Boolean(nextUser));
      if (!nextUser) setBookings([]);
    });

    return () => unsubAuth();
  }, []);

  useEffect(() => {
    if (!user) {
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

  const groupedBookings = useMemo(() => buildStatusGroups(bookings), [bookings]);
  const [activeStatusTab, setActiveStatusTab] = useState("pending");
  const [respondingToOffer, setRespondingToOffer] = useState(false);
  const appointmentStatusTabs = [
    { id: "pending", label: "Pending", bookings: groupedBookings.pending, subtitle: "Appointments waiting for clinic approval." },
    { id: "approved", label: "Approved", bookings: groupedBookings.approved, subtitle: "Confirmed appointments ready for your visit." },
    { id: "pendingPayment", label: "Payment History", bookings: groupedBookings.pendingPayment, subtitle: "Recorded receipts and appointments with payment pending." },
    { id: "completed", label: "Completed", bookings: groupedBookings.completed, subtitle: "Appointments already checked in and completed." },
    { id: "cancelled", label: "Cancelled", bookings: groupedBookings.cancelled, subtitle: "Appointments cancelled by the clinic or patient flow." },
  ];
  const activeStatusGroup = appointmentStatusTabs.find((tab) => tab.id === activeStatusTab) || appointmentStatusTabs[0];
  const editingBooking = bookings.find((booking) => booking.id === editingBookingId);
  const today = getClinicDate();
  const availabilityDate = requestFormOpen && requestMode === "reschedule" ? rescheduleDraft.requestedDate : "";
  const canLoadTimes = Boolean(editingBookingId && availabilityDate && availabilityDate >= today && !isSunday(availabilityDate));
  const availabilityKey = `${editingBookingId}:${availabilityDate}:${availabilityVersion}`;
  const currentAvailability = canLoadTimes && rescheduleAvailability?.key === availabilityKey ? rescheduleAvailability : null;
  const availableTimes = currentAvailability?.slots || [];

  useEffect(() => {
    if (!canLoadTimes) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { data } = await GET_RESCHEDULE_AVAILABILITY({ bookingId: editingBookingId, date: availabilityDate });
        if (!cancelled) setRescheduleAvailability({ key: availabilityKey, slots: data.availableSlots });
      } catch (loadError) {
        if (!cancelled) setRescheduleAvailability({ key: availabilityKey, error: loadError.message || "Available times could not be loaded." });
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [canLoadTimes, availabilityDate, availabilityKey, editingBookingId]);

  function refreshRescheduleTimes(date = rescheduleDraft.requestedDate) {
    setRescheduleDraft((current) => ({ ...current, requestedDate: date, requestedTime: "" }));
    setAvailabilityVersion((current) => current + 1);
  }

  function startReschedule(booking) {
    setRequestMode("reschedule");
    setAvailabilityVersion((current) => current + 1);
    setEditingBookingId(booking.id);
    setRequestFormOpen(true);
    setRescheduleDraft({
      requestedDate: booking.date && booking.date >= today ? booking.date : today,
      requestedTime: "",
      reason: booking.rescheduleRequest?.reason || "",
    });
    setError("");
  }

  function startCancellation(booking) {
    setRequestMode("cancel");
    setEditingBookingId(booking.id);
    setRequestFormOpen(true);
    setRescheduleDraft({
      requestedDate: booking.date || "",
      requestedTime: booking.time || "09:00",
      reason: booking.cancellationRequest?.reason || "",
    });
    setError("");
  }

  function closeRequestModal() {
    if (sendingRequest) return;
    setRequestFormOpen(false);
    setEditingBookingId("");
    setError("");
  }

  async function submitAppointmentRequest(bookingId) {
    if (sendingRequest) return;
    setError("");
    const booking = bookings.find((entry) => entry.id === bookingId);
    if ((requestMode === "reschedule" && hasPendingCancellationRequest(booking)) || booking?.rescheduleRequest?.status === "pending") {
      setError("Withdraw your pending request before submitting another one.");
      return;
    }

    if (!rescheduleDraft.reason.trim()) {
      setError(
        requestMode === "cancel"
          ? "Please give a reason for cancelling the appointment."
          : "Please give a reason for the reschedule request."
      );
      return;
    }

    if (requestMode === "cancel") {
      setSendingRequest(true);
      try {
        await CANCEL_PATIENT_BOOKING({ bookingId, reason: rescheduleDraft.reason.trim() });

        setEditingBookingId("");
        setRequestFormOpen(false);
        setActiveStatusTab("cancelled");
        notifySuccess(
          "Your appointment has been cancelled and the clinic schedule has been updated.",
          "Appointment cancelled"
        );
      } catch (requestError) {
        console.error(requestError);
        setError(requestError?.message || "Could not cancel the appointment. Please try again.");
      } finally {
        setSendingRequest(false);
      }
      return;
    }

    const { requestedDate, requestedTime } = rescheduleDraft;
    if (!requestedDate || !requestedTime) {
      setError("Please choose a date and time for the reschedule request.");
      return;
    }
    if (isCurrentAppointmentSlot(booking, requestedDate, requestedTime)) {
      setError("Choose a date or time different from your current appointment.");
      return;
    }
    if (!availableTimes.includes(requestedTime)) {
      setError("Choose a time from the available options.");
      return;
    }

    const requestDate = new Date(`${rescheduleDraft.requestedDate}T00:00:00`);
    if (requestDate.getDay() === 0) {
      setError("Sunday reschedule requests are not allowed. Please choose Monday to Saturday.");
      return;
    }

    setSendingRequest(true);
    try {
      await REQUEST_RESCHEDULE({
        bookingId,
        date: requestedDate,
        time: requestedTime,
        reason: rescheduleDraft.reason.trim(),
      });

      setEditingBookingId("");
      setRequestFormOpen(false);
      notifySuccess(
        "Your reschedule request was sent successfully. The clinic can now review the new schedule.",
        "Reschedule Request Sent!"
      );
    } catch (requestError) {
      console.error(requestError);
      if (requestError?.code === "functions/already-exists") {
        refreshRescheduleTimes();
        setError("That time was just booked. Choose another available time.");
      } else {
        setError(requestError?.message || "Could not send the reschedule request. Please try again.");
      }
    } finally {
      setSendingRequest(false);
    }
  }

  async function withdrawRequest() {
    if (!withdrawal || sendingRequest) return;
    const { booking, field } = withdrawal;
    setSendingRequest(true);
    setError("");
    try {
      const ref = doc(db, "bookings", booking.id);
      await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(ref);
        const current = snapshot.data()?.[field];
        if (current?.status !== "pending" ||
          current.requestedAt?.toMillis?.() !== booking[field]?.requestedAt?.toMillis?.()) {
          throw new Error("This request changed. Check the latest appointment details.");
        }
        transaction.update(ref, { [field]: deleteField() });
      });
      setWithdrawal(null);
      notifySuccess("Your appointment is unchanged. You can now submit a different request.", "Request withdrawn");
    } catch (withdrawError) {
      setWithdrawal(null);
      setError(withdrawError?.message || "Could not withdraw the request. Please try again.");
    } finally {
      setSendingRequest(false);
    }
  }

  async function respondToOffer(booking, accept) {
    if (respondingToOffer) return;
    setRespondingToOffer(true);
    setError("");
    try {
      await RESPOND_TO_RESCHEDULE_OFFER({ bookingId: booking.id, offerId: booking.rescheduleOffer.id, accept });
      notifySuccess(
        accept ? "Your appointment has moved to the offered time." : "Your original appointment is still scheduled.",
        accept ? "Alternate time accepted" : "Alternate time declined"
      );
    } catch (offerError) {
      setError(offerError?.code === "functions/already-exists"
        ? "That time is no longer available. Your original appointment is still scheduled."
        : offerError?.message || "Could not respond to the offer. Please try again.");
    } finally {
      setRespondingToOffer(false);
    }
  }

  if (!authReady) return <div className="sessionLoading"><LoadingIndicator>Loading your appointments…</LoadingIndicator></div>;

  if (!user) {
    return (
      <div className="container bookingPage patientAppointmentsPage">
        <header className="appointmentsPageHeading">
          <h1>My Appointments</h1>
          <p>View and manage your appointment requests, schedules, and history.</p>
        </header>
      </div>
    );
  }

  return (
    <div className="container bookingPage patientAppointmentsPage">
      <header className="appointmentsPageHeading">
        <h1>My Appointments</h1>
        <p>View and manage your appointment requests, schedules, and history.</p>
      </header>

      {error && !requestFormOpen ? <div className="error" style={{ marginTop: 18 }}>{error}</div> : null}

      {bookings.filter(hasActiveRescheduleOffer).map((booking) => {
        const offer = booking.rescheduleOffer;
        const deadline = offer.expiresAt.toDate();
        return (
          <section key={booking.id} className="card appointmentOfferCard" aria-label="Alternate appointment offer">
            <header className="appointmentOfferHeading">
              <span className="appointmentOfferIcon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="14" rx="2" /><path d="M8 4v4m8-4v4M4 11h16m-11 4 2 2 4-4" /></svg>
              </span>
              <div>
                <h2>Would this time work for you?</h2>
                <p>We found another time for your appointment.</p>
              </div>
            </header>
            <dl className="appointmentOfferTimes">
              <div className="appointmentOfferProposed">
                <dt>Offered appointment</dt>
                <dd>{formatDateLabel(offer.date)} at {formatTimeLabel(offer.time)}</dd>
                {booking.service ? <dd className="appointmentOfferService">{booking.service}</dd> : null}
              </div>
              <div>
                <dt>Current appointment</dt>
                <dd>{formatDateLabel(booking.date)} at {formatTimeLabel(booking.time)}</dd>
              </div>
            </dl>
            <div className="appointmentOfferNote">
              <p>If this time works for you, please let us know by <strong>{offerDeadlineTime.format(deadline)} on {offerDeadlineDate.format(deadline)}</strong>.</p>
              <p>If you prefer your current appointment, you can keep it. It also stays booked if you don’t reply. We’ll check the new time is still free when you accept.</p>
            </div>
            <div className="appointmentOfferActions">
              <button type="button" className="btn" disabled={respondingToOffer} onClick={() => respondToOffer(booking, true)}>Accept new time</button>
              <button type="button" className="btn secondary" disabled={respondingToOffer} onClick={() => respondToOffer(booking, false)}>Keep current appointment</button>
            </div>
          </section>
        );
      })}

      <div className="appointmentStatusSection">
        <div className="appointmentStatusTabs" role="group" aria-label="Filter appointments by status">
          {appointmentStatusTabs.map((tab) => (
            <button
              key={tab.id}
              id={`appointment-tab-${tab.id}`}
              className={`appointmentStatusTab${activeStatusTab === tab.id ? " active" : ""}`}
              type="button"
              aria-pressed={activeStatusTab === tab.id}
              aria-controls="appointment-status-panel"
              onClick={() => setActiveStatusTab(tab.id)}
            >
              <span>{tab.label}</span>
              <span className="appointmentStatusCount">{tab.bookings.length}</span>
            </button>
          ))}
        </div>

        <div
          id="appointment-status-panel"
          className="appointmentStatusPanel"
          aria-label={activeStatusTab === "pendingPayment" ? "Payment history" : `${activeStatusGroup.label} appointments`}
        >
          {activeStatusTab === "pendingPayment" && user ? (
            <section className="card patientDentalRecordsCard patientRecordSection" aria-label="Payment receipts">
              <PatientPaymentReceipts
                key={user.uid}
                uid={user.uid}
                patientName={user.displayName || ""}
                bookings={bookings}
                showReceiptPhotos={false}
              />
            </section>
          ) : null}
          <div className="appointmentTableWrap">
            <table className="appointmentTable" aria-label={`${activeStatusGroup.label} appointments`}>
              <thead>
                <tr>
                  <th scope="col">Service</th>
                  <th scope="col">Date and Time</th>
                  <th scope="col">Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td className="appointmentTableMessage" colSpan="4"><LoadingIndicator>Loading your appointments…</LoadingIndicator></td></tr>
                ) : activeStatusGroup.bookings.length ? (
                  <PaginatedRecords
                    items={activeStatusGroup.bookings}
                    tableColumns={4}
                    resetKey={activeStatusGroup.label}
                    label="appointments"
                  >
                    {(booking) => (
                      <AppointmentTableRow
                        key={booking.id}
                        booking={booking}
                        onStartReschedule={startReschedule}
                        onStartCancellation={startCancellation}
                        onWithdraw={(booking, field) => setWithdrawal({ booking, field })}
                      />
                    )}
                  </PaginatedRecords>
                ) : (
                  <tr>
                    <td className="appointmentTableMessage" colSpan="4">
                      No {activeStatusGroup.label.toLowerCase()} appointments right now.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(withdrawal)}
        title={withdrawal?.field === "cancellationRequest" ? "Withdraw cancellation request?" : "Withdraw reschedule request?"}
        message="Your appointment will stay at its current date and time."
        confirmLabel="Withdraw request"
        confirmDisabled={sendingRequest}
        onClose={() => { if (!sendingRequest) setWithdrawal(null); }}
        onConfirm={withdrawRequest}
      />

      {requestFormOpen ? (
        <ModalPortal>
          <div
            className="appointmentRequestOverlay"
            onClick={(event) => {
              if (event.target === event.currentTarget) closeRequestModal();
            }}
          >
            <section
              className="appointmentRequestModal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="appointment-request-title"
            >
              <header className="appointmentRequestModalHeader">
                <span className={`appointmentRequestModalIcon${requestMode === "cancel" ? " danger" : ""}`} aria-hidden="true">
                  {requestMode === "cancel" ? (
                    <svg viewBox="0 0 24 24">
                      <path d="M12 3 22 21H2L12 3Z" />
                      <path d="M12 9v5m0 3h.01" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24">
                      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
                      <path d="M7.5 3.5v3M16.5 3.5v3M3.5 9.5h17" />
                    </svg>
                  )}
                </span>
                <div>
                  <h2 id="appointment-request-title">
                    {requestMode === "cancel" ? "Cancel Appointment?" : "Request a New Schedule"}
                  </h2>
                  <p>
                    {requestMode === "cancel"
                      ? `Cancel ${editingBooking?.service || "this appointment"}? This takes effect immediately and releases the reserved time.`
                      : "Choose a new date and time, then send your request to the clinic for review."}
                  </p>
                </div>
                <button
                  className="appointmentRequestModalClose"
                  type="button"
                  aria-label="Close dialog"
                  onClick={closeRequestModal}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="m5 5 10 10M15 5 5 15" />
                  </svg>
                </button>
              </header>

              <div className="appointmentRequestModalBody">
                {error ? <div className="error" role="alert">{error}</div> : null}

                {requestMode === "reschedule" ? (
                  <>
                    <div className="appointmentRequestFields">
                      <label className="bookingFieldCard">
                        <span className="detailLabel">Requested Date</span>
                        <input
                          className="input bookingInputSpecial"
                          type="date"
                          min={today}
                          value={rescheduleDraft.requestedDate}
                          onChange={(event) => refreshRescheduleTimes(event.target.value)}
                        />
                      </label>
                      <label className="bookingFieldCard">
                        <span className="detailLabel">Available time</span>
                        <select
                          className="input bookingInputSpecial"
                          disabled={!availableTimes.length}
                          value={rescheduleDraft.requestedTime}
                          onChange={(event) =>
                            setRescheduleDraft((current) => ({ ...current, requestedTime: event.target.value }))
                          }
                        >
                          <option value="">Choose a time</option>
                          {availableTimes.map((time) => (
                            <option key={time} value={time}>{formatTimeLabel(time)}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {availabilityDate && isSunday(availabilityDate) ? (
                      <p>The clinic is closed on Sundays. Choose another date.</p>
                    ) : canLoadTimes && !currentAvailability ? (
                      <LoadingIndicator>Checking available times…</LoadingIndicator>
                    ) : currentAvailability?.error || (currentAvailability && !availableTimes.length) ? (
                      <p role="status">{currentAvailability.error || "No times are available on this date."}{" "}
                        <button type="button" className="btn secondary" onClick={() => refreshRescheduleTimes()}>Refresh times</button>
                      </p>
                    ) : null}
                    <label className="appointmentRequestReason">
                      <span className="detailLabel">Reason for Reschedule</span>
                      <textarea
                        className="input"
                        rows={4}
                        placeholder="Reason for reschedule (required)"
                        value={rescheduleDraft.reason}
                        onChange={(event) =>
                          setRescheduleDraft((current) => ({ ...current, reason: event.target.value }))
                        }
                      />
                    </label>
                  </>
                ) : (
                  <label className="appointmentRequestReason">
                    <span className="detailLabel">Reason for Cancellation</span>
                    <textarea
                      className="input"
                      rows={4}
                      placeholder="Reason for cancellation (required)"
                      value={rescheduleDraft.reason}
                      onChange={(event) =>
                        setRescheduleDraft((current) => ({ ...current, reason: event.target.value }))
                      }
                    />
                  </label>
                )}
              </div>

              <footer className="appointmentRequestModalFooter">
                <button
                  className={`appointmentRequestSubmit${requestMode === "cancel" ? " danger" : ""}`}
                  type="button"
                  onClick={() => submitAppointmentRequest(editingBookingId)}
                  disabled={sendingRequest || (requestMode === "reschedule" && !availableTimes.includes(rescheduleDraft.requestedTime))}
                >
                  {sendingRequest ? <LoadingIndicator>Sending request…</LoadingIndicator> : requestMode === "cancel" ? "Confirm Cancellation" : "Send Reschedule Request"}
                </button>
                <button
                  className={`appointmentRequestCancel${requestMode === "reschedule" ? " danger" : ""}`}
                  type="button"
                  onClick={closeRequestModal}
                >
                  {requestMode === "cancel" ? "Keep Appointment" : "Cancel"}
                </button>
              </footer>
            </section>
          </div>
        </ModalPortal>
      ) : null}
    </div>
  );
}
