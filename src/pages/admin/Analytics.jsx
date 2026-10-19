import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../../firebase";

const iso = (date) => date.toISOString().slice(0, 10);
const money = (value) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(value || 0);
function startFor(period) {
  const date = new Date(); date.setHours(0, 0, 0, 0);
  if (period === "today") return iso(date);
  if (period === "week") { date.setDate(date.getDate() - 6); return iso(date); }
  if (period === "year") { date.setMonth(0, 1); return iso(date); }
  date.setDate(1); return iso(date);
}
function dateValue(value) {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  if (typeof value.toDate === "function") return iso(value.toDate());
  if (value.seconds) return iso(new Date(value.seconds * 1000));
  return "";
}
function monthLabel(date) { return date.toLocaleDateString("en", { month: "short" }); }

export default function Analytics() {
  const [bookings, setBookings] = useState([]);
  const [patients, setPatients] = useState([]);
  const [payments, setPayments] = useState([]);
  const [period, setPeriod] = useState("month");
  const [customStart, setCustomStart] = useState(startFor("month"));
  const [customEnd, setCustomEnd] = useState(iso(new Date()));
  const [status, setStatus] = useState("all");
  const [service, setService] = useState("all");
  const [dentist, setDentist] = useState("all");
  const [patientType, setPatientType] = useState("all");
  const [paymentMethod, setPaymentMethod] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([getDocs(collection(db, "bookings")), getDocs(collection(db, "patients")), getDocs(collection(db, "bracesPayments"))])
      .then(([bookingSnap, patientSnap, paymentSnap]) => {
        setBookings(bookingSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
        setPatients(patientSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
        setPayments(paymentSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
      }).catch((loadError) => setError(loadError.message || "Could not load clinic reports."))
      .finally(() => setLoading(false));
  }, []);

  const range = useMemo(() => period === "custom" ? [customStart, customEnd] : [startFor(period), iso(new Date())], [period, customEnd, customStart]);
  const choices = useMemo(() => ({
    services: [...new Set(bookings.flatMap((item) => item.services || [item.service]).filter(Boolean))].sort(),
    dentists: [...new Set(bookings.map((item) => item.selectedDentist).filter(Boolean))].sort(),
    methods: [...new Set(payments.map((item) => item.method).filter(Boolean))].sort(),
  }), [bookings, payments]);
  const scopedBookings = useMemo(() => bookings.filter((item) => {
    const date = String(item.date || "");
    if (date < range[0] || date > range[1]) return false;
    if (status !== "all" && String(item.status || "pending").toLowerCase() !== status) return false;
    if (dentist !== "all" && item.selectedDentist !== dentist) return false;
    if (patientType !== "all" && String(item.patientType || "").toLowerCase() !== patientType) return false;
    if (service !== "all" && !(item.services || [item.service]).includes(service)) return false;
    return true;
  }), [bookings, range, status, dentist, patientType, service]);
  const scopedPayments = useMemo(() => payments.filter((item) => {
    const date = dateValue(item.paymentDate);
    return date >= range[0] && date <= range[1] && (paymentMethod === "all" || item.method === paymentMethod);
  }), [payments, range, paymentMethod]);
  const stats = useMemo(() => {
    const eligible = scopedBookings.filter((item) => String(item.date || "") < iso(new Date()) && ["approved", "completed", "no-show"].includes(String(item.status || "").toLowerCase()));
    const completed = scopedBookings.filter((item) => String(item.status || "").toLowerCase() === "completed").length;
    const totalPatients = patients.length;
    const newPatients = patients.filter((item) => { const created = dateValue(item.createdAt); return created >= range[0] && created <= range[1]; }).length;
    const returning = new Set(scopedBookings.filter((item) => item.uid).map((item) => item.uid)).size;
    return { totalPatients, newPatients, returning, appointments: scopedBookings.length, pending: scopedBookings.filter((x) => x.status === "pending").length, approved: scopedBookings.filter((x) => x.status === "approved").length, completed, cancelled: scopedBookings.filter((x) => x.status === "cancelled").length, noShow: scopedBookings.filter((x) => ["no-show", "no show"].includes(String(x.status || "").toLowerCase())).length, completion: eligible.length ? Math.round(completed / eligible.length * 100) : 0, revenue: scopedPayments.reduce((sum, item) => sum + Number(item.amount || 0), 0) };
  }, [scopedBookings, scopedPayments, patients, range]);
  const trends = useMemo(() => Array.from({ length: 6 }, (_, index) => {
    const date = new Date(); date.setDate(1); date.setMonth(date.getMonth() - 5 + index);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    return { label: monthLabel(date), value: bookings.filter((item) => String(item.date || "").startsWith(key)).length };
  }), [bookings]);
  const serviceRows = useMemo(() => {
    const counts = new Map();
    scopedBookings.forEach((item) => (item.services || [item.service]).filter(Boolean).forEach((name) => counts.set(name, (counts.get(name) || 0) + 1)));
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [scopedBookings]);
  const dentistRows = useMemo(() => {
    const counts = new Map();
    scopedBookings.forEach((item) => item.selectedDentist && counts.set(item.selectedDentist, (counts.get(item.selectedDentist) || 0) + 1));
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [scopedBookings]);
  const promotionRows = useMemo(() => {
    const counts = new Map();
    scopedBookings.filter((item) => item.promotionId).forEach((item) => counts.set(item.promotionTitle || "Promotion", (counts.get(item.promotionTitle || "Promotion") || 0) + 1));
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [scopedBookings]);
  const statusRows = [["Pending", stats.pending], ["Approved", stats.approved], ["Completed", stats.completed], ["Cancelled", stats.cancelled], ["No-show", stats.noShow]];

  function exportCsv() {
    const rows = [["Date", "Time", "Service", "Dentist", "Status", "Patient type"], ...scopedBookings.map((item) => [item.date || "", item.time || "", (item.services || [item.service]).filter(Boolean).join("; "), item.selectedDentist || "", item.status || "pending", item.patientType || ""])];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); link.download = `clinic-report-${range[0]}-to-${range[1]}.csv`; link.click(); URL.revokeObjectURL(link.href);
  }

  const barRows = (rows, max) => rows.map(([label, value]) => <div className="analyticsBarRow" key={label}><span>{label}</span><div><i style={{ width: `${max ? Math.max(3, value / max * 100) : 0}%` }} /></div><strong>{value}</strong></div>);
  if (loading) return <section className="container adminSurface pageSection adminPage analyticsPage"><p>Loading clinic analytics…</p></section>;
  return <section className="container adminSurface pageSection adminPage analyticsPage">
    <header className="pageHeader analyticsHeader"><div><span className="pill">Clinic reporting</span><h1>Clinic Analytics</h1><p>Performance overview from clinic bookings, patient records, and logged brace payments.</p></div><div className="inlineActionRow analyticsActions"><button className="btn btnGhost" onClick={exportCsv}>Export CSV</button><button className="btn btnGhost" onClick={() => window.print()}>Print report</button></div></header>
    {error && <div className="error">{error}</div>}
    <div className="card analyticsFilters"><label>Reporting period<select className="input" value={period} onChange={(e) => setPeriod(e.target.value)}><option value="today">Today</option><option value="week">This week</option><option value="month">This month</option><option value="year">This year</option><option value="custom">Custom range</option></select></label>{period === "custom" && <><label>From<input className="input" type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} /></label><label>To<input className="input" type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} /></label></>}<label>Status<select className="input" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All statuses</option>{["pending", "approved", "completed", "cancelled", "no-show"].map((x) => <option key={x} value={x}>{x}</option>)}</select></label><label>Service<select className="input" value={service} onChange={(e) => setService(e.target.value)}><option value="all">All services</option>{choices.services.map((x) => <option key={x}>{x}</option>)}</select></label><label>Dentist<select className="input" value={dentist} onChange={(e) => setDentist(e.target.value)}><option value="all">All dentists</option>{choices.dentists.map((x) => <option key={x}>{x}</option>)}</select></label><label>Patient type<select className="input" value={patientType} onChange={(e) => setPatientType(e.target.value)}><option value="all">All types</option><option value="regular">Regular</option><option value="ortho">Ortho</option><option value="new patient">New Patient</option></select></label><label>Payment method<select className="input" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}><option value="all">All methods</option>{choices.methods.map((x) => <option key={x}>{x}</option>)}</select></label></div>
    <div className="statsGrid analyticsStats"><div className="statCard"><span className="statLabel">Registered patients</span><strong className="statValue">{stats.totalPatients}</strong><small>{stats.newPatients} new in range</small></div><div className="statCard"><span className="statLabel">Appointments</span><strong className="statValue">{stats.appointments}</strong><small>{stats.pending} pending · {stats.approved} approved</small></div><div className="statCard"><span className="statLabel">Logged payments collected</span><strong className="statValue">{money(stats.revenue)}</strong><small>From braces payment records only</small></div><div className="statCard"><span className="statLabel">Completion rate</span><strong className="statValue">{stats.completion}%</strong><small>{stats.completed} completed in range</small></div></div>
    <div className="analyticsGrid"><article className="card"><h2>Appointment trends</h2><p className="sub">Monthly booking volume across the last six months.</p><div className="analyticsTrend">{trends.map((item) => <div key={item.label}><div className="analyticsTrendBar" style={{ height: `${Math.max(5, item.value / Math.max(1, ...trends.map((x) => x.value)) * 150)}px` }} /><strong>{item.value}</strong><span>{item.label}</span></div>)}</div></article><article className="card"><h2>Appointment status</h2><p className="sub">Bookings within the selected filters.</p>{barRows(statusRows, Math.max(1, ...statusRows.map((x) => x[1])))}</article><article className="card"><h2>Most popular services</h2><p className="sub">Booking frequency by service.</p>{barRows(serviceRows, Math.max(1, ...serviceRows.map((x) => x[1])))}</article><article className="card"><h2>Appointments by dentist</h2><p className="sub">Volume in the selected reporting range.</p>{barRows(dentistRows, Math.max(1, ...dentistRows.map((x) => x[1])))}</article><article className="card"><h2>Promotion usage</h2><p className="sub">Bookings attributed to a selected promotion.</p>{promotionRows.length ? barRows(promotionRows, Math.max(1, ...promotionRows.map((x) => x[1]))) : <p>No promotion bookings in this reporting range.</p>}</article></div>
    <p className="analyticsFootnote">Revenue includes only payment entries recorded in the braces payment ledger. Regular appointment payments and refunds are not tracked consistently, so they are excluded. Promotion usage counts bookings that selected a promotion; the appointment system does not record final treatment prices, so it cannot report discounts granted or promotion attributed revenue. Returning patient counts represent distinct patient accounts with bookings in the selected period.</p>
  </section>;
}
