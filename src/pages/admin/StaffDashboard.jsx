import { useState } from "react";
import { Link } from "react-router-dom";
import PaginatedRecords from "../../components/PaginatedRecords";
import useStaffDashboard from "../../hooks/useStaffDashboard";
import { ROLES } from "../../utils/rbac";
import { formatDateLabel, formatTimeLabel } from "../../utils/schedule";
import { formatAppointmentStatusLabel, getAppointmentStatusClass } from "../../utils/appointmentStatus";
import { getDashboardPatientPath, getDashboardStatus, getStaffDashboardSummary } from "../../utils/staffDashboard";
import { getClinicDate } from "../../../functions/bookingWindow.mjs";

const ICON_PATHS = {
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  waiting: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  complete: <><circle cx="12" cy="12" r="9" /><path d="m7 12 3 3 7-7" /></>,
  request: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
};

export default function StaffDashboard({ uid, role }) {
  const dentist = role === ROLES.DENTIST;
  const [date, setDate] = useState(() => getClinicDate());
  const [search, setSearch] = useState("");
  const [retry, setRetry] = useState(0);
  const data = useStaffDashboard(uid, role, retry);
  const loading = data.loading || !data.bookings;
  const unavailable = loading || Boolean(data.error);
  const summary = getStaffDashboardSummary(data.bookings || [], date);
  const name = data.profile?.name || data.profile?.fullName || "";
  const rows = summary.appointments.filter(booking => [booking.fullName, booking.patientName, booking.service,
    booking.selectedDentist, booking.id, ...(Array.isArray(booking.services) ? booking.services : [])].some(value => String(value || "").toLowerCase().includes(search.trim().toLowerCase())));
  const cards = [
    { label: "Appointments", value: summary.scheduled, hint: "Scheduled for the selected day", icon: "calendar", to: dentist ? "/admin/patients" : "/admin/bookings/calendar" },
    { label: "Checked in", value: summary.waiting, hint: "Waiting for treatment on this day", icon: "waiting", to: dentist ? "/admin/patients" : "/admin/queue" },
    dentist
      ? { label: "Not checked in", value: summary.approved, hint: "Approved appointments on this day", icon: "request", to: "/admin/patients" }
      : { label: "Pending requests", value: summary.pending, hint: "All active dates · awaiting approval", icon: "request", to: "/admin/bookings/pending" },
    { label: "Treatment completed", value: summary.completed, hint: "Completed treatments on this day", icon: "complete", to: dentist ? "/admin/completed" : "/admin/bookings/completed" },
  ];
  const actions = dentist ? [
    ["Patient records", "Open your assigned patients and tooth charts.", "/admin/patients"],
    ["Completed treatments", "Review your completed visits and notes.", "/admin/completed"],
  ] : [
    ["Manage appointments", "Review requests and manage bookings.", "/admin/bookings/calendar"],
    ["Patient queue", "Check arrivals and manage the waiting list.", "/admin/queue"],
    ["Patient records", "Find patient profiles and visit details.", "/admin/patients"],
    ["Payments", "Record payments and attach receipt photos.", "/admin/payments"],
  ];

  return <div className="container adminSurface staffDashboardPage">
    <header className="staffDashboardHero">
      <div><span className="staffDashboardEyebrow">{dentist ? "Dentist" : "Receptionist"} dashboard</span>
        <h1>{name ? `Welcome, ${name}` : "Your daily overview"}</h1>
        <p>{dentist ? "Your assigned appointments and patient care, in one place." : "Keep track of appointments, arrivals, and the front desk."}</p>
      </div>
      <div className="staffDashboardDate"><label htmlFor="staff-dashboard-date">Appointment day</label>
        <input id="staff-dashboard-date" className="input" type="date" value={date} onChange={event => { if (event.target.value) setDate(event.target.value); }} />
        <button type="button" onClick={() => setDate(getClinicDate())}>Back to today</button>
      </div>
    </header>
    {data.error ? <div className="staffDashboardNotice" role="alert">{data.error} <button className="btn secondary" onClick={() => setRetry(value => value + 1)}>Try again</button></div> : null}
    {dentist && data.linked === false && !data.error ? <div className="staffDashboardNotice" role="status">Your staff account is not linked to a dentist profile yet. Ask the administrator to link it so your appointments can appear here.</div> : null}
    <div className="staffDashboardStats" aria-busy={Boolean(loading)}>
      {cards.map(card => <Link to={card.to} className={`staffDashboardStat staffDashboardStat-${card.icon}`} key={card.label}>
        <span className="staffDashboardStatIcon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">{ICON_PATHS[card.icon]}</svg></span>
        <span className="staffDashboardStatLabel">{card.label}</span><strong>{unavailable ? "—" : card.value}</strong><span className="staffDashboardHint">{card.hint}</span>
      </Link>)}
    </div>
    {!dentist ? <div className="staffDashboardPaymentNote"><div><strong>{unavailable ? "Awaiting payment" : `${summary.pendingPayment} booking${summary.pendingPayment === 1 ? "" : "s"} awaiting payment`}</strong><p>Across all active appointment dates.</p></div><Link className="btn secondary" to="/admin/payments">Open payments</Link></div> : null}
    <section className="staffDashboardPanel" aria-labelledby="staff-dashboard-appointments">
      <header className="staffDashboardPanelHeader"><div><h2 id="staff-dashboard-appointments">{dentist ? "Your appointments" : "Clinic appointments"}</h2><p>{formatDateLabel(date)}</p></div>
        <input type="search" className="input" placeholder="Search patient or service" aria-label="Search dashboard appointments" value={search} onChange={event => setSearch(event.target.value)} />
      </header>
      {loading ? <div className="staffDashboardEmpty" role="status">Loading appointments…</div> : data.error ? <div className="staffDashboardEmpty">Appointment details are unavailable until the connection is restored.</div> : rows.length ? <div className="staffDashboardTableScroll"><table className="staffDashboardTable">
        <thead><tr><th scope="col">Time</th><th scope="col">Patient</th><th scope="col">Service</th>{!dentist ? <th scope="col">Dentist</th> : null}<th scope="col">Status</th><th scope="col">Record</th></tr></thead>
        <tbody><PaginatedRecords items={rows} tableColumns={dentist ? 5 : 6} resetKey={`${date}-${search}`} label="appointments" hideSinglePageControls>{booking => {
          const status = getDashboardStatus(booking);
          return <tr key={booking.id}><td>{booking.time ? formatTimeLabel(booking.time) : "Not recorded"}{booking.timeEnd ? <small>until {formatTimeLabel(booking.timeEnd)}</small> : null}</td>
            <td><strong>{booking.fullName || booking.patientName || "Patient"}</strong><small>{booking.patientType || ""}</small></td>
            <td>{booking.service || (Array.isArray(booking.services) ? booking.services.join(", ") : "") || "Not recorded"}</td>
            {!dentist ? <td>{booking.selectedDentist || "Not assigned"}</td> : null}
            <td><span className={`statusPill ${getAppointmentStatusClass(status)}`}>{formatAppointmentStatusLabel(status)}</span></td>
            <td><Link className="staffDashboardRecordLink" to={getDashboardPatientPath(booking)}>View record<span aria-hidden="true"> →</span></Link></td>
          </tr>;
        }}</PaginatedRecords></tbody>
      </table></div> : <div className="staffDashboardEmpty"><strong>{search ? "No matching appointments" : "No appointments for this day"}</strong><p>{search ? "Try a different patient name or service." : "Choose another date to view the schedule."}</p></div>}
    </section>
    <section aria-labelledby="staff-dashboard-actions"><h2 className="staffDashboardActionsTitle" id="staff-dashboard-actions">Quick access</h2><div className="staffDashboardActions">{actions.map(([title, description, to]) => <Link key={to} to={to}><strong>{title}<span aria-hidden="true">↗</span></strong><p>{description}</p></Link>)}</div></section>
  </div>;
}
