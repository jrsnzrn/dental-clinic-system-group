import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, onSnapshot } from "firebase/firestore";
import { NavLink } from "react-router-dom";
import { db } from "../../firebase";

// Edit these if your collection or field names are different.
const ROUTES = { bookings: "/admin/bookings", dentists: "/admin/dentists", accounts: "/admin/accounts", payments: "/admin/braces" };
const PAYMENTS_COLLECTION = "payments";

const pad = (value) => String(value).padStart(2, "0");
const iso = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function toISO(value) {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  if (typeof value.toDate === "function") return iso(value.toDate());
  if (value.seconds) return iso(new Date(value.seconds * 1000));
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : iso(date);
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

const peso = (value) => `₱${Math.round(value).toLocaleString("en-PH")}`;
const statusOf = (data) => String(data.status || "pending").toLowerCase().replace(" ", "-");
const initialOf = (name) => String(name || "?").trim().charAt(0).toUpperCase();

function normalizeBooking(entry) {
  const data = entry.data();
  const services = (data.services || [data.service]).filter(Boolean);
  const date = toISO(data.date);
  return {
    id: entry.id,
    name: data.patientName || data.fullName || data.name || data.email || "Patient",
    service: services.join(", "),
    phone: data.phone || data.contactNumber || data.contact || data.mobile || "",
    email: data.email || "",
    dentist: data.selectedDentist || "",
    date,
    time: data.time || "",
    added: toISO(data.createdAt) || date,
    status: statusOf(data),
  };
}

const PERIODS = [
  { key: "today", label: "Today", phrase: "today", since: "yesterday" },
  { key: "week", label: "7 days", phrase: "in the last 7 days", since: "the previous 7 days" },
  { key: "month", label: "Month", phrase: "this month", since: "last month" },
  { key: "year", label: "Year", phrase: "this year", since: "last year" },
];

function clampDay(year, month, day) {
  return new Date(year, month, Math.min(day, new Date(year, month + 1, 0).getDate()));
}

// Returns the selected range and the matching previous range to compare against.
function rangesFor(period) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const end = iso(now);
  if (period === "today") {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return { range: [end, end], prev: [iso(yesterday), iso(yesterday)] };
  }
  if (period === "week") {
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    const prevEnd = new Date(start);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - 6);
    return { range: [iso(start), end], prev: [iso(prevStart), iso(prevEnd)] };
  }
  if (period === "year") {
    const year = now.getFullYear();
    return { range: [`${year}-01-01`, end], prev: [`${year - 1}-01-01`, iso(clampDay(year - 1, now.getMonth(), now.getDate()))] };
  }
  return {
    range: [iso(new Date(now.getFullYear(), now.getMonth(), 1)), end],
    prev: [iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), iso(clampDay(now.getFullYear(), now.getMonth() - 1, now.getDate()))],
  };
}

function change(current, previous) {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function Delta({ value, since }) {
  if (value === null) return <span className="ovDelta">No data for {since}</span>;
  return (
    <span className="ovDelta">
      <b className={value >= 0 ? "up" : "down"}>{value >= 0 ? "↑" : "↓"} {Math.abs(value)}%</b> from {since}
    </span>
  );
}

function StatCard({ icon, label, value, delta, since }) {
  return (
    <article className="ovStatCard">
      <span className="ovIcon">{icon}</span>
      <div>
        <span className="ovStatLabel">{label}</span>
        <strong className="ovStatValue">{value}</strong>
        <Delta value={delta} since={since} />
      </div>
    </article>
  );
}

function PeopleCard({ title, icon, people, to, empty }) {
  return (
    <article className="ovCard ovPeopleCard">
      <NavLink to={to} className="ovCardHead">
        <span className="ovHeadTitle"><span className="ovIconSm">{icon}</span>{title}</span>
        <span aria-hidden="true">›</span>
      </NavLink>
      {people.length ? (
        <ul className="ovPeople">
          {people.slice(0, 6).map((name) => (
            <li key={name}>
              <span className="ovAvatar">{initialOf(name)}</span>
              <span>{name.split(" ")[0]}</span>
            </li>
          ))}
          {people.length > 6 && (
            <li>
              <span className="ovAvatar">+{people.length - 6}</span>
              <span>more</span>
            </li>
          )}
        </ul>
      ) : (
        <p className="ovMuted">{empty}</p>
      )}
    </article>
  );
}

const icons = {
  patients: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2" /><path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><circle cx="17" cy="9" r="2.4" /><path d="M16.5 14c2.7.2 4.5 2 4.5 5" /></svg>
  ),
  bookings: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2.5" /><path d="M4 10h16M9 3v4M15 3v4" /></svg>
  ),
  revenue: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M3 10h18" /><circle cx="16.5" cy="14.5" r="1.2" /></svg>
  ),
  dentist: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c-1.8 0-2.8 1-4.2 1C6 6 5 7.5 5 9.5c0 3 1.4 8 3 9.5.7.6 1.2-.4 1.5-1.4.3-1 .5-3.1 1.5-3.1s1.2 2.100 1.500 3.100c.3 1 .8 2 1.500 1.400 1.600-1.500 3-6.500 3-9.500 0-2-1-3.500-2.800-3.500C14.800 6 13.800 5 12 5z" /></svg>
  ),
  user: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c0-3.600 3-6 7-6s7 2.400 7 6" /></svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.500" /><path d="m16 16 4 4" /></svg>
  ),
  filter: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4" /></svg>
  ),
};

export default function Overview() {
  const [bookings, setBookings] = useState([]);
  const [patients, setPatients] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [payments, setPayments] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [viewMonth, setViewMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [period, setPeriod] = useState("month");
  const [selectedDay, setSelectedDay] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showFilter, setShowFilter] = useState(false);

  useEffect(() => {
    const stop = onSnapshot(
      collection(db, "bookings"),
      (snap) => {
        setBookings(snap.docs.map(normalizeBooking));
        setLoading(false);
      },
      (snapError) => {
        setError(snapError.message || "Could not load bookings.");
        setLoading(false);
      }
    );
    const safe = (name) =>
      getDocs(collection(db, name))
        .then((snap) => snap.docs.map((entry) => ({ id: entry.id, ...entry.data() })))
        .catch((readError) => {
          console.warn(`Overview: could not read "${name}"`, readError);
          return [];
        });
    Promise.all([safe("patients"), safe(PAYMENTS_COLLECTION)]).then(([patientList, paymentList]) => {
      setPatients(patientList);
      setPayments(paymentList);
    });
    getDocs(collection(db, "admins"))
      .then((snapshot) => {
        setAccounts(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
        setAccountsError("");
      })
      .catch((readError) => {
        console.error('Overview: could not read staff accounts from "admins".', readError);
        setAccounts([]);
        setAccountsError("Staff accounts could not be loaded. The Receptionists list may be incomplete.");
      })
      .finally(() => setAccountsLoading(false));
    return stop;
  }, []);

  const today = iso(new Date());
  const periodInfo = PERIODS.find((item) => item.key === period);
  const { range, prev } = useMemo(() => rangesFor(period), [period]);

  const stats = useMemo(() => {
    const inside = (value, bounds) => Boolean(value) && value >= bounds[0] && value <= bounds[1];
    const patientsNew = patients.filter((item) => inside(toISO(item.createdAt), range)).length;
    const patientsBefore = patients.length - patientsNew;
    const bookingsNow = bookings.filter((item) => inside(item.date, range)).length;
    const bookingsPrev = bookings.filter((item) => inside(item.date, prev)).length;
    const amountOf = (item) => Number(item.amount ?? item.total ?? item.paid ?? 0) || 0;
    const dateOf = (item) => toISO(item.date || item.paidAt || item.createdAt);
    const revenueNow = payments.filter((item) => inside(dateOf(item), range)).reduce((sum, item) => sum + amountOf(item), 0);
    const revenuePrev = payments.filter((item) => inside(dateOf(item), prev)).reduce((sum, item) => sum + amountOf(item), 0);
    return {
      patients: patients.length,
      patientsDelta: change(patientsNew, patientsBefore),
      bookings: bookingsNow,
      bookingsDelta: change(bookingsNow, bookingsPrev),
      revenue: revenueNow,
      revenueDelta: change(revenueNow, revenuePrev),
    };
  }, [patients, bookings, payments, range, prev]);

  const nameOf = (item) =>
    item.name || item.displayName || item.fullName || [item.firstName, item.lastName].filter(Boolean).join(" ") || item.username || item.email || "";
  const hasRole = (item, word) =>
    [item.role, item.roleName, item.type, ...(Array.isArray(item.roles) ? item.roles : [])]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(word));
  const peopleWith = (...words) => [...new Set(accounts.filter((item) => words.some((word) => hasRole(item, word))).map(nameOf).filter(Boolean))];

  const dentists = useMemo(() => {
    const fromAccounts = peopleWith("dentist", "doctor");
    return fromAccounts.length ? fromAccounts : [...new Set(bookings.map((item) => item.dentist).filter(Boolean))].sort();
  }, [accounts, bookings]);
  const receptionists = useMemo(() => peopleWith("reception", "front desk"), [accounts]);

  const dayCounts = useMemo(() => {
    const counts = new Map();
    bookings.forEach((item) => item.date && counts.set(item.date, (counts.get(item.date) || 0) + 1));
    return counts;
  }, [bookings]);

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

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return bookings
      .filter((item) => (statusFilter === "all" ? true : item.status === statusFilter))
      .filter((item) => (selectedDay ? item.date === selectedDay : true))
      .filter((item) => !term || [item.name, item.service, item.phone, item.email].some((value) => String(value).toLowerCase().includes(term)))
      .sort((a, b) => b.added.localeCompare(a.added) || b.time.localeCompare(a.time))
      .slice(0, 10);
  }, [bookings, search, statusFilter, selectedDay]);

  if (loading) {
    return (
      <section className="container adminSurface pageSection adminPage ovPage">
        <p className="ovMuted">Loading overview…</p>
      </section>
    );
  }

  return (
    <section className="container adminSurface pageSection adminPage ovPage">
      <header className="ovHead">
        <div>
          <h1>Overview</h1>
          <p>Here&apos;s a summary of your clinic&apos;s activity {periodInfo.phrase}.</p>
        </div>

        <div className="ovHeadTools">
          <div className="ovPeriod" role="group" aria-label="Period">
            {PERIODS.map((item) => (
              <button key={item.key} type="button" className={period === item.key ? "active" : ""} aria-pressed={period === item.key} onClick={() => setPeriod(item.key)}>
                {item.label}
              </button>
            ))}
          </div>

        </div>
      </header>

      {error && <div className="error" role="alert">{error}</div>}
      {accountsError && <div className="error" role="alert">{accountsError}</div>}

      <div className="ovTop">
        <div className="ovLeft">
          <div className="ovStats">
            <StatCard icon={icons.patients} label="Total Patients" value={stats.patients} delta={stats.patientsDelta} since={periodInfo.since} />
            <StatCard icon={icons.bookings} label="Bookings" value={stats.bookings} delta={stats.bookingsDelta} since={periodInfo.since} />
            <StatCard icon={icons.revenue} label="Revenue" value={peso(stats.revenue)} delta={stats.revenueDelta} since={periodInfo.since} />
          </div>

          <div className="ovPeopleRow">
            <PeopleCard title="Dentists" icon={icons.dentist} people={dentists} to={ROUTES.dentists} empty="No dentists yet." />
            <PeopleCard
              title="Receptionists"
              icon={icons.user}
              people={receptionists}
              to={ROUTES.accounts}
              empty={accountsLoading ? "Loading staff accounts…" : accountsError ? "Receptionist list unavailable." : "No receptionists yet."}
            />
          </div>
        </div>

        <aside className="ovCard ovCalendar">
          <div className="ovCalHead">
            <button type="button" onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))} aria-label="Previous month">‹</button>
            <strong>{viewMonth.toLocaleDateString("en", { month: "long", year: "numeric" })}</strong>
            <button type="button" onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))} aria-label="Next month">›</button>
          </div>
          <div className="ovCalGrid">
            {WEEKDAYS.map((day) => <span className="ovWeekday" key={day}>{day}</span>)}
            {calendarCells.map((cell, index) => {
              if (!cell) return <span key={`blank-${index}`} />;
              const classes = ["ovDay", cell === today ? "today" : "", cell === selectedDay ? "selected" : "", dayCounts.get(cell) ? "has" : ""].join(" ");
              return (
                <button type="button" key={cell} className={classes} aria-pressed={cell === selectedDay} onClick={() => setSelectedDay(cell === selectedDay ? "" : cell)}>
                  {Number(cell.slice(8))}
                </button>
              );
            })}
          </div>
        </aside>
      </div>

      <article className="ovCard ovHistory">
        <div className="ovHistoryHead">
          <span className="ovHeadTitle"><span className="ovIconSm">{icons.bookings}</span><strong>History</strong></span>
          <div className="ovSearchRow">
            <label className="ovSearch">
              {icons.search}
              <input type="search" placeholder="Search name, service, or contact number…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
            <button type="button" className="ovFilterBtn" aria-label="Filter by status" aria-expanded={showFilter} onClick={() => setShowFilter((open) => !open)}>
              {icons.filter}
            </button>
          </div>
        </div>

        {(showFilter || selectedDay) && (
          <div className="ovFilterRow">
            {showFilter && (
              <label>
                <span>Status</span>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="all">All</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="no-show">No-show</option>
                </select>
              </label>
            )}
            {selectedDay && (
              <button type="button" className="ovLink" onClick={() => setSelectedDay("")}>Showing {formatDate(selectedDay)} · Clear</button>
            )}
          </div>
        )}

        <div className="ovTableWrap">
          <table className="ovTable">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Service</th>
                <th>Contact Number</th>
                <th>Email</th>
                <th>Date Added</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((item, index) => (
                  <tr key={item.id}>
                    <td>{index + 1}</td>
                    <td className="ovName">{item.name}</td>
                    <td>{item.service || "—"}</td>
                    <td className="ovName">{item.phone || "—"}</td>
                    <td>{item.email || "—"}</td>
                    <td>{formatDate(item.added)}</td>
                    <td>
                      <NavLink to={ROUTES.bookings} className="ovDots" aria-label={`Open ${item.name} in bookings`}>⋮</NavLink>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="ovMuted ovTableEmpty">No bookings found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}