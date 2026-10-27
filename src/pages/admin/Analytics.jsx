import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { NavLink } from "react-router-dom";
import { auth, db } from "../../firebase";
import { getAuditActionLabel } from "../../utils/audit";
import { formatCurrency } from "../../utils/braces";
import { ROLES } from "../../utils/rbac";

const ROUTES = {
  patients: "/admin/patients",
  bookings: "/admin/bookings",
  payments: "/admin/payments",
  dentists: "/admin/dentists",
  receptionists: "/admin/accounts",
};
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const pad = (value) => String(value).padStart(2, "0");

function toISO(value) {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  if (typeof value.toDate === "function") return toISO(value.toDate());
  if (typeof value.seconds === "number") return toISO(new Date(value.seconds * 1000));
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toDate(value) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const dateOnly = new Date(`${value}T00:00:00`);
    return Number.isNaN(dateOnly.getTime()) ? null : dateOnly;
  }
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function timestampMillis(value) {
  const date = toDate(value);
  return date ? date.getTime() : null;
}

function appointmentMillis(booking) {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(booking.date || ""));
  const time = /^(\d{1,2}):(\d{2})$/.exec(String(booking.time || ""));
  if (date && time) {
    const [, year, month, day] = date.map(Number);
    const [, hour, minute] = time.map(Number);
    if (hour <= 23 && minute <= 59) {
      const appointmentDate = new Date(year, month - 1, day, hour, minute);
      if (
        appointmentDate.getFullYear() === year &&
        appointmentDate.getMonth() === month - 1 &&
        appointmentDate.getDate() === day
      ) {
        return appointmentDate.getTime();
      }
    }
  }
  return timestampMillis(booking.appointmentAt);
}

function formatDate(value) {
  const date = toDate(value) || (typeof value === "string" ? new Date(`${value}T00:00:00`) : null);
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })
    : "Date unavailable";
}

function formatDateTime(value) {
  const date = toDate(value);
  return date
    ? date.toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "Time unavailable";
}

function getAppointmentTime(booking) {
  if (booking.appointmentAt) return formatDateTime(booking.appointmentAt);
  if (!booking.date) return booking.time || "Time unavailable";
  return `${formatDate(booking.date)}${booking.time ? ` · ${booking.time}` : ""}`;
}

function getProfileName(profile = {}) {
  return String(
    profile.name ||
    profile.displayName ||
    profile.fullName ||
    [profile.firstName, profile.lastName].filter(Boolean).join(" ") ||
    ""
  ).trim();
}

function getName(profile = {}) {
  return getProfileName(profile) || String(profile.username || "").trim();
}

function firstNameOf(value) {
  const name = String(value || "").trim();
  if (!name || name.includes("@")) return "";
  return name.split(/\s+/)[0] || "";
}

function initialsOf(value) {
  const initials = String(value || "").trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0].toUpperCase()).join("");
  return initials || "•";
}

function profileImage(profile) {
  return profile.photoURL || profile.photoUrl || profile.profileImage || profile.imageUrl || profile.avatarUrl || "";
}

function normalizeBooking(entry) {
  const data = entry.data();
  const services = Array.isArray(data.services) && data.services.length
    ? data.services
    : String(data.service || "").split(",");
  return {
    id: entry.id,
    name: data.patientName || data.fullName || data.name || data.email || "Patient",
    service: services.map((service) => String(service || "").trim()).filter(Boolean).join(", ") || "—",
    date: toISO(data.date || data.appointmentAt),
    appointmentAt: data.appointmentAt || null,
    time: data.time || "",
    status: String(data.status || "pending").toLowerCase().replaceAll("_", " "),
    archiveStatus: data.archiveStatus || "",
  };
}

function StatCard({ icon, label, value, to, tone }) {
  const contents = (
    <>
      <span className="overviewStatIcon" aria-hidden="true">{icon}</span>
      <span className="overviewStatText">
        <span className="overviewStatLabel">{label}</span>
        <strong className="overviewStatValue">{value}</strong>
      </span>
      <span className="overviewChevron" aria-hidden="true">›</span>
    </>
  );

  return (
    <NavLink className={`overviewStatCard ${tone}`} to={to} aria-label={`${label}: ${value}`}>
      {contents}
    </NavLink>
  );
}

function PeopleCard({ label, count, people, to, tone, loading, error }) {
  return (
    <NavLink className={`overviewPeopleCard ${tone}`} to={to}>
      <span className="overviewPeopleInfo">
        <span className="overviewStatLabel">{label}</span>
        <strong className="overviewStatValue">{count}</strong>
        <span className="overviewPeopleAvatars" aria-label={`${Math.min(people.length, 3)} ${label.toLowerCase()}`}>
          {people.slice(0, 3).map((person) => {
            const image = profileImage(person);
            const name = getName(person) || person.email || label.slice(0, -1);
            return (
              <span className="overviewAvatar" key={person.id || name} title={name}>
                {image ? (
                  <img
                    src={image}
                    alt=""
                    onError={(event) => {
                      event.currentTarget.hidden = true;
                      event.currentTarget.nextElementSibling.hidden = false;
                    }}
                  />
                ) : null}
                <span hidden={Boolean(image)}>{initialsOf(name)}</span>
              </span>
            );
          })}
          {!people.length && !loading && !error ? <span className="overviewAvatarFallback" aria-hidden="true">♙</span> : null}
          {loading ? <span className="overviewAvatarFallback" aria-label="Loading">…</span> : null}
          {error ? <span className="overviewAvatarFallback" aria-label="Unavailable">!</span> : null}
        </span>
      </span>
      <span className="overviewChevron" aria-hidden="true">›</span>
    </NavLink>
  );
}

const icons = {
  patients: <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2" /><path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><circle cx="17" cy="9" r="2.4" /><path d="M16.5 14c2.7.2 4.5 2 4.5 5" /></svg>,
  bookings: <svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2.5" /><path d="M4 10h16M9 3v4M15 3v4" /></svg>,
  payments: <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" /></svg>,
  dentists: <svg viewBox="0 0 24 24"><path d="M12 4c-2 0-3 1.2-4.6 1.2S4.5 7 4.5 9.8c0 3.3 1.7 8.6 3.4 9.7 1.5 1 1.9-4.5 4.1-4.5s2.6 5.5 4.1 4.5c1.7-1.1 3.4-6.4 3.4-9.7 0-2.8-1.3-4.6-2.9-4.6S14 4 12 4z" /></svg>,
  receptionists: <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3.5 2.8-6 7-6s7 2.5 7 6" /></svg>,
};

export default function Overview() {
  const [bookings, setBookings] = useState([]);
  const [patients, setPatients] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [payments, setPayments] = useState([]);
  const [activities, setActivities] = useState([]);
  const [userName, setUserName] = useState("");
  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [sourceErrors, setSourceErrors] = useState({});

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let active = true;
    const currentUser = auth.currentUser;
    if (currentUser) {
      const authName = currentUser.displayName || "";
      getDoc(doc(db, "admins", currentUser.uid)).then((snapshot) => {
        if (!active) return;
        const profile = snapshot.exists() ? snapshot.data() : {};
        setUserName(firstNameOf(getProfileName(profile) || authName));
      }).catch((error) => {
        console.error("Overview user profile could not load:", error);
        if (active) setUserName(firstNameOf(authName));
      });
    }

    let resolveBookingsLoaded;
    const bookingsLoaded = new Promise((resolve) => {
      resolveBookingsLoaded = resolve;
    });
    const markBookingsLoaded = () => resolveBookingsLoaded();
    const unsubscribeBookings = onSnapshot(
      query(collection(db, "bookings"), orderBy("appointmentAt", "asc")),
      (snapshot) => {
        setBookings(snapshot.docs.map(normalizeBooking));
        setSourceErrors((current) => {
          const next = { ...current };
          delete next.bookings;
          return next;
        });
        markBookingsLoaded();
      },
      (error) => {
        console.error("Overview bookings could not load:", error);
        setSourceErrors((current) => ({ ...current, bookings: "Appointments could not be loaded." }));
        markBookingsLoaded();
      }
    );

    const loadSource = async (name, setter, sourceName = name) => {
      try {
        const snapshot = name === "auditLogs"
          ? await getDocs(query(collection(db, name), orderBy("createdAt", "desc"), limit(8)))
          : await getDocs(collection(db, name));
        if (!active) return;
        const records = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
        setter(records);
        setSourceErrors((current) => {
          const next = { ...current };
          delete next[sourceName];
          return next;
        });
      } catch (error) {
        console.error(`Overview ${sourceName} could not load:`, error);
        if (!active) return;
        setSourceErrors((current) => ({ ...current, [sourceName]: `${sourceName} could not be loaded.` }));
        setter([]);
      }
    };

    const paymentSourcesReady = new Set();
    let resolvePaymentsLoaded;
    const paymentsLoaded = new Promise((resolve) => {
      resolvePaymentsLoaded = resolve;
    });
    const markPaymentSourceReady = (name) => {
      paymentSourcesReady.add(name);
      if (paymentSourcesReady.size === 2) resolvePaymentsLoaded();
    };
    const subscribePaymentSource = (name) => onSnapshot(
      collection(db, name),
      (snapshot) => {
        const records = snapshot.docs.map((entry) => ({
          id: entry.id,
          ...entry.data(),
          source: name,
        }));
        setPayments((current) => [
          ...current.filter((item) => item.source !== name),
          ...records,
        ]);
        setSourceErrors((current) => {
          const next = { ...current };
          delete next[name];
          return next;
        });
        markPaymentSourceReady(name);
      },
      (error) => {
        console.error(`Overview ${name} could not load (${error?.code || "unknown"}):`, error);
        setSourceErrors((current) => ({
          ...current,
          [name]: `${name} could not be loaded.`,
        }));
        markPaymentSourceReady(name);
      }
    );
    const unsubscribePayments = [
      subscribePaymentSource("payments"),
      subscribePaymentSource("bracesPayments"),
    ];

    const sourceLoads = Promise.all([
      loadSource("patients", setPatients),
      loadSource("admins", setAccounts, "staff accounts"),
      loadSource("auditLogs", setActivities, "recent activity"),
    ]);
    void Promise.all([sourceLoads, paymentsLoaded, bookingsLoaded]).finally(() => {
      if (active) setLoading(false);
    });

    return () => {
      active = false;
      unsubscribeBookings();
      unsubscribePayments.forEach((unsubscribe) => unsubscribe());
    };
  }, []);

  const today = toISO(new Date(now));
  const totalPayments = useMemo(() => payments.reduce((total, payment) =>
    total + (Number(payment.amount ?? payment.paid ?? 0) || 0), 0), [payments]);

  const activeBookings = useMemo(() => bookings.filter((booking) =>
    booking.archiveStatus !== "Archived"
  ), [bookings]);
  const activeAccounts = useMemo(() => accounts.filter((account) =>
    account.archiveStatus !== "Archived"
  ), [accounts]);
  const receptionists = useMemo(() => activeAccounts.filter((account) =>
    account.role === ROLES.RECEPTIONIST
  ), [activeAccounts]);
  const dentistAccounts = useMemo(() => activeAccounts.filter((account) =>
    account.role === ROLES.DENTIST
  ), [activeAccounts]);
  const paymentsUnavailable = Boolean(sourceErrors.payments || sourceErrors.bracesPayments);

  const appointments = useMemo(() => activeBookings
    .filter((booking) => !selectedDay || booking.date === selectedDay)
    .sort((left, right) => {
      const leftTime = appointmentMillis(left);
      const rightTime = appointmentMillis(right);
      if (leftTime == null) return rightTime == null ? left.id.localeCompare(right.id) : 1;
      if (rightTime == null) return -1;
      return leftTime - rightTime;
    }), [activeBookings, selectedDay]);

  const appointmentDates = useMemo(() => {
    const dates = new Set();
    activeBookings.forEach((booking) => {
      if (booking.date) dates.add(booking.date);
    });
    return dates;
  }, [activeBookings]);

  const calendarCells = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const offset = new Date(year, month, 1).getDay();
    const days = new Date(year, month + 1, 0).getDate();
    return [
      ...Array.from({ length: offset }, () => null),
      ...Array.from({ length: days }, (_, index) => `${year}-${pad(month + 1)}-${pad(index + 1)}`),
    ];
  }, [viewMonth]);

  const recentActivities = useMemo(() => activities.slice(0, 6), [activities]);
  return (
    <section className="container adminSurface overviewDashboard">
      <header className="overviewWelcome">
        <span className="overviewWelcomeTooth" aria-hidden="true">{icons.dentists}</span>
        <div>
          <h1>Hi{userName ? `, ${userName}` : ""}! <span aria-hidden="true">👋</span></h1>
          <p>Here's what's happening at your dental clinic today.</p>
        </div>
      </header>

      {Object.values(sourceErrors).length ? (
        <div className="error" role="alert">{Object.values(sourceErrors).join(" ")}</div>
      ) : null}

      <div className="overviewStats overviewStatsPrimary">
        <StatCard icon={icons.patients} label="Total Patients" value={loading ? "…" : sourceErrors.patients ? "—" : patients.length} to={ROUTES.patients} tone="yellow" />
        <StatCard icon={icons.bookings} label="Bookings" value={loading ? "…" : sourceErrors.bookings ? "—" : activeBookings.length} to={ROUTES.bookings} tone="green" />
        <StatCard icon={icons.payments} label="Payments" value={loading ? "…" : paymentsUnavailable ? "—" : formatCurrency(totalPayments)} to={ROUTES.payments} tone="blue" />
      </div>

      <div className="overviewStats overviewStatsPeople">
        <PeopleCard label="Dentists" count={loading ? "…" : sourceErrors["staff accounts"] ? "—" : dentistAccounts.length} people={dentistAccounts} to={ROUTES.dentists} tone="pink" loading={loading} error={Boolean(sourceErrors["staff accounts"])} />
        <PeopleCard label="Receptionists" count={loading ? "…" : sourceErrors["staff accounts"] ? "—" : receptionists.length} people={receptionists} to={ROUTES.receptionists} tone="purple" loading={loading} error={Boolean(sourceErrors["staff accounts"])} />
      </div>

      <div className="overviewLower">
        <section className="overviewPanel overviewAppointments">
          <div className="overviewPanelHeader">
            <div>
              <h2>Appointments</h2>
              <p>{selectedDay ? `Appointments for ${new Date(`${selectedDay}T00:00:00`).toLocaleDateString("en-PH")}` : "All clinic appointments"}</p>
            </div>
            {selectedDay ? <button type="button" className="overviewClearDay" onClick={() => setSelectedDay("")}>Clear date</button> : null}
          </div>
          {loading ? <p className="overviewEmpty">Loading appointments…</p> : appointments.length ? (
            <div className="overviewTableWrap">
              <table className="overviewTable">
                <thead>
                  <tr><th>Patient</th><th>Service</th><th>Date &amp; Time</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {appointments.map((booking) => (
                    <tr key={booking.id}>
                      <td>{booking.name}</td>
                      <td>{booking.service}</td>
                      <td>{getAppointmentTime(booking)}</td>
                      <td><span className={`overviewStatus ${booking.status.replaceAll(" ", "-")}`}>{booking.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="overviewEmpty">{sourceErrors.bookings || (selectedDay ? "No appointments for this date." : "No appointments found.")}</p>
          )}
        </section>

        <div className="overviewRight">
          <section className="overviewPanel overviewCalendar" aria-label="Appointment calendar">
            <div className="overviewCalendarHeader">
              <button type="button" onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))} aria-label="Previous month">‹</button>
              <h2>{viewMonth.toLocaleDateString("en", { month: "long", year: "numeric" })}</h2>
              <button type="button" onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))} aria-label="Next month">›</button>
            </div>
            <div className="overviewCalendarGrid">
              {WEEKDAYS.map((day) => <span className="overviewWeekday" key={day}>{day}</span>)}
              {calendarCells.map((cell, index) => {
                if (!cell) return <span key={`blank-${index}`} />;
                const pastWithAppointments = cell < today && appointmentDates.has(cell);
                const isToday = cell === today;
                const hasAppointments = appointmentDates.has(cell);
                const className = [
                  "overviewCalendarDay",
                  isToday ? "today" : "",
                  cell === selectedDay ? "selected" : "",
                  hasAppointments ? "hasAppointments" : "",
                  pastWithAppointments ? "pastAppointment" : "",
                ].filter(Boolean).join(" ");
                return (
                  <button
                    key={cell}
                    type="button"
                    className={className}
                    aria-pressed={cell === selectedDay}
                    aria-label={`${formatDate(cell)}${hasAppointments ? ", appointments" : ""}${isToday ? ", today" : ""}`}
                    onClick={() => setSelectedDay(cell === selectedDay ? "" : cell)}
                  >
                    {Number(cell.slice(8))}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="overviewPanel overviewActivity">
            <div className="overviewPanelHeader">
              <div><h2>Recent Activity</h2><p>Latest recorded clinic updates</p></div>
            </div>
            {recentActivities.length ? (
              <ol className="overviewActivityList">
                {recentActivities.map((activity) => (
                  <li key={activity.id}>
                    <div>
                      <strong>{getAuditActionLabel(activity.action)}</strong>
                      {activity.targetLabel ? <span>{activity.targetLabel}</span> : null}
                      <time>{formatDateTime(activity.createdAt)}</time>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="overviewEmpty">
                {sourceErrors["recent activity"] || "No recent activity recorded."}
              </p>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
