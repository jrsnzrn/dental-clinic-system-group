import { Outlet } from "react-router-dom";
import { ROLE_LABELS, normalizeRole } from "../../utils/rbac";

export default function Dashboard({ adminRole = "" }) {
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

  return (
    <div className="container">
      <div className="hero">
        <h1>{heading}</h1>
        <p>
          {summary}
          {" "}
          Current access:
          {" "}
          <strong>{ROLE_LABELS[role]}</strong>
        </p>
      </div>

      <div style={{ marginTop: 18 }}>
        <Outlet />
      </div>
    </div>
  );
}
