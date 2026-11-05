import LoadingIndicator from "../../components/LoadingIndicator";
import RecordPagination from "../../components/RecordPagination";
import useRecordPagination from "../../hooks/useRecordPagination";
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../firebase";
import ConfirmDialog from "../../components/ConfirmDialog";
import { formatDateLabel, formatTimeLabel } from "../../utils/schedule";

const SET_BOOKING_STATUS = httpsCallable(functions, "setBookingStatus");
const TOGGLE_BOOKING_CHECK_IN = httpsCallable(functions, "toggleBookingCheckIn");
const SKIP_BOOKING_QUEUE = httpsCallable(functions, "skipBookingQueue");
const RESCHEDULE_BOOKING = httpsCallable(functions, "rescheduleBooking");

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function pad(value) {
  return String(value).padStart(2, "0");
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

function hasTimestamp(value) {
  if (!value) return false;
  if (typeof value.toMillis === "function") return Number.isFinite(value.toMillis());
  if (typeof value.toDate === "function") return Number.isFinite(value.toDate().getTime());
  if (value instanceof Date) return Number.isFinite(value.getTime());
  return Number.isFinite(new Date(value).getTime());
}

function isQueueRecord(booking) {
  if (booking.archiveStatus === "Archived") return false;
  const status = String(booking.status || "").toLowerCase();
  return status === "approved" ||
    status === "completed" ||
    (status === "pending_payment" && Boolean(booking.treatmentCompletedAt));
}

function getQueueStatus(booking) {
  const status = String(booking.status || "").toLowerCase();
  if (status === "completed" || (status === "pending_payment" && booking.treatmentCompletedAt)) {
    return { label: "Completed", className: "completed" };
  }
  if (status === "approved" && hasTimestamp(booking.checkedInAt)) {
    return { label: "Ongoing", className: "ongoing" };
  }
  if (hasTimestamp(booking.queueSkippedAt)) {
    return { label: "Skipped", className: "skipped" };
  }
  return { label: "Waiting", className: "waiting" };
}

function getPatientName(booking) {
  return booking.fullName || booking.name ||
    [booking.firstName, booking.middleName, booking.lastName].filter(Boolean).join(" ") ||
    "No name";
}

function getServiceName(booking) {
  if (booking.service) return booking.service;
  return Array.isArray(booking.services) ? booking.services.join(", ") || "Not set" : "Not set";
}

function QueueRescheduleModal({ booking, onClose, onSave }) {
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const today = getLocalDateKey(new Date());

  useEffect(() => {
    if (!booking) return;
    setNewDate(booking.date && booking.date >= today ? booking.date : "");
    setNewTime(booking.time || "");
    setFormError("");
    setSaving(false);
  }, [booking, today]);

  function submit(event) {
    event.preventDefault();
    if (!newDate || !newTime) {
      setFormError("Choose both a date and a time.");
      return;
    }
    if (newDate < today) {
      setFormError("The new date can't be in the past.");
      return;
    }
    setFormError("");
    setConfirmOpen(true);
  }

  async function confirmReschedule() {
    if (saving) return;
    setConfirmOpen(false);
    setSaving(true);
    setFormError("");
    try {
      const error = await onSave(booking, newDate, newTime);
      if (error) setFormError(error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className={`patientDrawerOverlay rescheduleOverlay${booking ? " open" : ""}`} onClick={onClose} />
      <div className={`patientDrawer rescheduleModal${booking ? " open" : ""}`} role="dialog" aria-modal="true" aria-label="Reschedule appointment">
        {booking ? (
          <form className="patientDrawerInner" onSubmit={submit}>
            <div className="patientDrawerHeader">
              <div>
                <span className="heroEyebrow">Reschedule</span>
                <h3>{getPatientName(booking)}</h3>
                <div className="patientRecordPeek">
                  <span>Current: {booking.date ? formatDateLabel(booking.date) : "Not set"} at {formatTimeLabel(booking.time)}</span>
                </div>
              </div>
              <button type="button" className="patientDrawerCloseBtn" onClick={onClose} aria-label="Close">×</button>
            </div>
            <div className="rescheduleFields">
              <label>
                New date
                <input type="date" min={today} value={newDate} onChange={(event) => setNewDate(event.target.value)} />
              </label>
              <label>
                New time
                <input type="time" step="900" value={newTime} onChange={(event) => setNewTime(event.target.value)} />
              </label>
            </div>
            {formError ? <div className="formError" role="alert">{formError}</div> : null}
            <div className="actionColumn actionColumnFriendly">
              <button className="btn btnShine patientActionBtn" type="submit" disabled={saving}>
                {saving ? <LoadingIndicator>Saving…</LoadingIndicator> : "Save new schedule"}
              </button>
              <button className="btn secondary btnSoft patientActionBtn" type="button" onClick={onClose} disabled={saving}>Cancel</button>
            </div>
          </form>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="Confirm reschedule"
        message={`Reschedule ${getPatientName(booking || {})} to ${formatDateLabel(newDate)} at ${formatTimeLabel(newTime)}?`}
        confirmLabel="Confirm reschedule"
        onClose={() => setConfirmOpen(false)}
        onConfirm={confirmReschedule}
      />
    </>
  );
}

export default function Queue() {
  const today = getLocalDateKey(new Date());
  const [bookings, setBookings] = useState([]);
  const [dentists, setDentists] = useState([]);
  const [loadingBookings, setLoadingBookings] = useState(true);
  const [bookingsError, setBookingsError] = useState("");
  const [dentistsError, setDentistsError] = useState("");
  const [selectedDate, setSelectedDate] = useState(today);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [search, setSearch] = useState("");
  const [openMenuId, setOpenMenuId] = useState("");
  const [actionPendingId, setActionPendingId] = useState("");
  const [actionError, setActionError] = useState("");
  const [confirmState, setConfirmState] = useState(null);
  const [rescheduleBooking, setRescheduleBooking] = useState(null);
  const actionMenuRef = useRef(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "bookings"), (snapshot) => {
      setBookings(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
      setBookingsError("");
      setLoadingBookings(false);
    }, (error) => {
      console.error("Queue appointments could not load:", error);
      setBookingsError("Appointments could not be loaded. Please try again.");
      setLoadingBookings(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "dentists"), (snapshot) => {
      setDentists(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
      setDentistsError("");
    }, (error) => {
      console.error("Queue dentist records could not load:", error);
      setDentistsError("Dentist names could not be loaded.");
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!openMenuId) return undefined;
    function dismissOnPointer(event) {
      if (!actionMenuRef.current?.contains(event.target)) {
        setOpenMenuId("");
      }
    }
    function dismissOnEscape(event) {
      if (event.key === "Escape") setOpenMenuId("");
    }
    document.addEventListener("pointerdown", dismissOnPointer);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOnPointer);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [openMenuId]);

  const dentistNames = useMemo(() => new Map(dentists.map((dentist) => [dentist.id, dentist.name])), [dentists]);
  const queueRecords = useMemo(
    () => bookings.filter(isQueueRecord),
    [bookings]
  );
  const recordsByDay = useMemo(() => {
    const byDay = new Map();
    queueRecords.forEach((booking) => {
      const date = String(booking.date || "");
      if (!date) return;
      byDay.set(date, (byDay.get(date) || 0) + 1);
    });
    return byDay;
  }, [queueRecords]);
  const dayRecords = useMemo(() => queueRecords
    .filter((booking) => booking.date === selectedDate)
    .sort((left, right) => {
      const leftSkipped = hasTimestamp(left.queueSkippedAt);
      const rightSkipped = hasTimestamp(right.queueSkippedAt);
      if (leftSkipped !== rightSkipped) return Number(leftSkipped) - Number(rightSkipped);
      return String(left.time || "").localeCompare(String(right.time || "")) ||
        String(left.id).localeCompare(String(right.id));
    }), [queueRecords, selectedDate]);
  const visibleRecords = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    if (!term) return dayRecords;
    return dayRecords.filter((booking) => {
      const dentistName = booking.selectedDentist || dentistNames.get(booking.dentistId) || booking.dentistId || "";
      return [
        getPatientName(booking),
        booking.patientProfileId,
        booking.uid,
        booking.id,
        getServiceName(booking),
        dentistName,
      ].some((value) => String(value || "").toLocaleLowerCase().includes(term));
    });
  }, [dayRecords, dentistNames, search]);
  const queueNumbers = useMemo(
    () => new Map(dayRecords.map((booking, index) => [booking.id, `Q-${String(index + 1).padStart(3, "0")}`])),
    [dayRecords]
  );
  const calendarDays = useMemo(() => getMonthCalendarDays(calendarMonth), [calendarMonth]);

  const queuePage = useRecordPagination(visibleRecords, JSON.stringify([search, selectedDate]));
  async function runQueueAction(bookingId, action) {
    if (actionPendingId) return "Another queue action is already processing.";
    setActionPendingId(bookingId);
    setActionError("");
    try {
      await action();
      return "";
    } catch (error) {
      console.error("Queue action could not be completed:", error);
      const message = error?.message || "The queue action could not be completed.";
      setActionError(message);
      return message;
    } finally {
      setActionPendingId("");
    }
  }

  function closeActionMenu() {
    setOpenMenuId("");
  }

  function requestSkip(booking) {
    const skipped = !hasTimestamp(booking.queueSkippedAt);
    closeActionMenu();
    setConfirmState({
      bookingId: booking.id,
      title: skipped ? "Skip this patient?" : "Bring this patient forward?",
      message: skipped
        ? `${getPatientName(booking)} will move behind the other patients scheduled for ${formatDateLabel(selectedDate)}.`
        : `${getPatientName(booking)} will return to appointment-time order.`,
      confirmLabel: skipped ? "Skip patient" : "Bring forward",
      action: () => SKIP_BOOKING_QUEUE({ bookingId: booking.id, skipped }),
    });
  }

  function requestCancel(booking) {
    closeActionMenu();
    setConfirmState({
      bookingId: booking.id,
      title: "Cancel this appointment?",
      message: "The appointment will leave the Queue and remain in Bookings as cancelled.",
      confirmLabel: "Cancel appointment",
      tone: "danger",
      action: () => SET_BOOKING_STATUS({ bookingId: booking.id, status: "cancelled" }),
    });
  }

  async function handleConfirmAction() {
    if (!confirmState || actionPendingId) return;
    const pending = confirmState;
    await runQueueAction(pending.bookingId, pending.action);
    setConfirmState(null);
  }

  async function startTreatment(booking) {
    closeActionMenu();
    await runQueueAction(booking.id, async () => {
      const result = await TOGGLE_BOOKING_CHECK_IN({ bookingId: booking.id });
      if (!Number.isFinite(result.data?.checkedInAt)) {
        throw new Error("Check-in succeeded, but its recorded timestamp could not be confirmed.");
      }
    });
  }

  async function saveReschedule(booking, date, time) {
    const error = await runQueueAction(
      booking.id,
      () => RESCHEDULE_BOOKING({ bookingId: booking.id, date, time })
    );
    if (!error) setRescheduleBooking(null);
    return error;
  }

  return (
    <div className="container adminSurface queuePage">
      <div className="queueToolbar">
        <label className="queueSearch">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            className="input"
            type="search"
            placeholder="Search patients or appointments"
            aria-label="Search queue appointments"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>

      {actionPendingId && !confirmState && !rescheduleBooking ? <div className="queueError"><LoadingIndicator>Updating appointment…</LoadingIndicator></div> : null}
      {actionError ? <div className="formError queueError" role="alert">{actionError}</div> : null}
      {bookingsError ? <div className="formError queueError" role="alert">{bookingsError}</div> : null}
      {dentistsError ? <div className="formError queueError" role="alert">{dentistsError}</div> : null}

      <div className="queueLayout">
        <section className="queueTablePanel" aria-label="Queue appointments">
          <div className="queueTableWrap">
            <table className="queueTable">
              <thead>
                <tr>
                  <th>Numbering System</th>
                  <th>Name</th>
                  <th>Service</th>
                  <th>Dentist</th>
                  <th>Time</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {loadingBookings ? (
                  <tr><td className="queueEmptyCell" colSpan="7"><LoadingIndicator>Loading appointments…</LoadingIndicator></td></tr>
                ) : visibleRecords.length ? queuePage.items.map((booking) => {
                  const queueStatus = getQueueStatus(booking);
                  const status = String(booking.status || "").toLowerCase();
                  const isApproved = status === "approved";
                  const isOngoing = queueStatus.className === "ongoing";
                  const isCompleted = queueStatus.className === "completed";
                  const isBusy = actionPendingId === booking.id;
                  const patientId = booking.patientProfileId || booking.uid || "Not linked";
                  const dentistName = booking.selectedDentist || dentistNames.get(booking.dentistId) || booking.dentistId || "Not assigned";
                  return (
                    <tr key={booking.id}>
                      <td className="queueNumberCell">{queueNumbers.get(booking.id)}</td>
                      <td className="queuePatientCell">
                        <strong>{getPatientName(booking)}</strong>
                        <small>{patientId}</small>
                      </td>
                      <td>{getServiceName(booking)}</td>
                      <td>{dentistName}</td>
                      <td>{formatTimeLabel(booking.time)}</td>
                      <td><span className={`queueStatus queueStatus-${queueStatus.className}`}>{queueStatus.label}</span></td>
                      <td className="queueActionCell">
                        <div
                          className="queueActionMenu"
                          ref={openMenuId === booking.id ? actionMenuRef : null}
                        >
                          <button
                            type="button"
                            className="queueMenuTrigger"
                            aria-label={`Actions for ${getPatientName(booking)}`}
                            aria-haspopup="menu"
                            aria-expanded={openMenuId === booking.id}
                            disabled={isBusy || Boolean(actionPendingId)}
                            onClick={() => {
                              if (openMenuId === booking.id) {
                                closeActionMenu();
                              } else {
                                setOpenMenuId(booking.id);
                              }
                            }}
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <circle cx="12" cy="5" r="1.5" />
                              <circle cx="12" cy="12" r="1.5" />
                              <circle cx="12" cy="19" r="1.5" />
                            </svg>
                          </button>
                          {openMenuId === booking.id ? (
                            <div className="queueActionMenuItems" role="menu">
                              <button type="button" role="menuitem" disabled={!isApproved || isOngoing || isCompleted || isBusy} onClick={() => startTreatment(booking)}>In</button>
                              <button type="button" role="menuitem" disabled={!isApproved || isOngoing || isCompleted || isBusy} onClick={() => requestSkip(booking)}>
                                {hasTimestamp(booking.queueSkippedAt) ? "Bring forward" : "Skip"}
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                disabled={!isApproved || isCompleted || isBusy}
                                onClick={() => {
                                  closeActionMenu();
                                  setRescheduleBooking(booking);
                                }}
                              >
                                Reschedule
                              </button>
                              <button type="button" role="menuitem" disabled={!isApproved || isCompleted || isBusy} onClick={() => requestCancel(booking)}>Cancel</button>
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td className="queueEmptyCell" colSpan="7">
                      {bookingsError
                        ? "Queue appointments are unavailable."
                        : search.trim()
                          ? "No appointments match your search for this date."
                          : `No queue appointments for ${formatDateLabel(selectedDate)}.`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
              {queuePage.pageCount > 1 ? <RecordPagination pagination={queuePage} /> : null}
          </div>
        </section>

        <aside className="queueCalendarPanel" aria-label="Queue calendar">
          <div className="queueCalendarHeader">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setCalendarMonth((month) => new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.5 4.5-5.5 5.5 5.5 5.5" /></svg>
            </button>
            <h2>{calendarMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h2>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setCalendarMonth((month) => new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7.5 4.5 5.5 5.5-5.5 5.5" /></svg>
            </button>
          </div>
          <div className="queueCalendarGrid" role="group" aria-label="Select queue date">
            {WEEKDAYS.map((weekday) => <span className="queueWeekday" key={weekday}>{weekday}</span>)}
            {calendarDays.map((date, index) => {
              if (!date) return <span key={`blank-${index}`} className="queueCalendarBlank" aria-hidden="true" />;
              const dateKey = getLocalDateKey(date);
              const isSelected = dateKey === selectedDate;
              const isToday = dateKey === today;
              const hasAppointments = recordsByDay.has(dateKey);
              const classNames = [
                "queueCalendarDay",
                isToday ? "today" : "",
                isSelected ? "selected" : "",
                hasAppointments && !isSelected ? "hasAppointments" : "",
              ].filter(Boolean).join(" ");
              return (
                <button
                  type="button"
                  key={dateKey}
                  className={classNames}
                  aria-pressed={isSelected}
                  aria-label={`${date.toLocaleDateString(undefined, { dateStyle: "full" })}${hasAppointments ? ", queue appointments" : ""}`}
                  onClick={() => setSelectedDate(dateKey)}
                >
                  <span>{date.getDate()}</span>
                  {hasAppointments && !isSelected ? <i aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
        </aside>
      </div>

      {confirmState ? (
        <ConfirmDialog
          open
          title={confirmState.title}
          message={confirmState.message}
          confirmLabel={actionPendingId === confirmState.bookingId ? <LoadingIndicator>Updating…</LoadingIndicator> : confirmState.confirmLabel}
          confirmDisabled={Boolean(actionPendingId)}
          tone={confirmState.tone}
          onClose={() => { if (!actionPendingId) setConfirmState(null); }}
          onConfirm={handleConfirmAction}
        />
      ) : null}

      {rescheduleBooking ? (
        <QueueRescheduleModal
          booking={rescheduleBooking}
          onClose={() => setRescheduleBooking(null)}
          onSave={saveReschedule}
        />
      ) : null}
    </div>
  );
}
