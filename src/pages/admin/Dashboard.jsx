import { useEffect, useMemo, useState } from "react";
import { Outlet } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../../firebase";
import { buildBookingAnalytics } from "../../utils/appointments";
import { ROLE_LABELS, normalizeRole } from "../../utils/rbac";

export default function Dashboard({ adminRole = "" }) {
  const [patients, setPatients] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [dentists, setDentists] = useState([]);
  const role = normalizeRole(adminRole);
  const heading =
    role === "receptionist"
      ? "Reception Dashboard"
      : role === "dentist"
        ? "Dentist Dashboard"
        : "Admin Dashboard";
  const summary =
    role === "receptionist"
      ? "Manage patient coordination, booking flow, and archive-ready records from the reception workspace."
      : role === "dentist"
        ? "Review patients and work on clinical chart notes from the dentist workspace."
        : "Manage patients, bookings, dentists, and archived records from one clean admin workspace.";

  useEffect(() => {
    async function loadOverview() {
      const [patientsResult, bookingsResult, dentistsResult] = await Promise.allSettled([
        getDocs(collection(db, "patients")),
        role === "dentist" ? Promise.resolve({ docs: [] }) : getDocs(collection(db, "bookings")),
        role === "admin" ? getDocs(collection(db, "dentists")) : Promise.resolve({ docs: [] }),
      ]);

      setPatients(
        patientsResult.status === "fulfilled"
          ? patientsResult.value.docs.map((entry) => ({ id: entry.id, ...entry.data() }))
          : []
      );
      setBookings(
        bookingsResult.status === "fulfilled"
          ? bookingsResult.value.docs.map((entry) => ({ id: entry.id, ...entry.data() }))
          : []
      );
      setDentists(
        dentistsResult.status === "fulfilled"
          ? dentistsResult.value.docs.map((entry) => ({ id: entry.id, ...entry.data() }))
          : []
      );
    }

    loadOverview();
  }, [role]);

  const bookingAnalytics = useMemo(() => buildBookingAnalytics(bookings), [bookings]);

  return (
    <div className="container">
      <div className="hero">
        <h1>{heading}</h1>
        <p>
          {summary} Current access: <strong>{ROLE_LABELS[role]}</strong>
        </p>
      </div>

      <div style={{ marginTop: 18 }}>
        <Outlet />
      </div>
    </div>
  );
}
