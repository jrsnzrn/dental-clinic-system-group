import { Outlet } from "react-router-dom";

export default function Dashboard() {
  return (
    <div className="container">
      <div className="hero">
        <h1>Admin Dashboard</h1>
        <p>Manage patients, bookings, dentists, and archived records from one clean admin workspace.</p>
      </div>

      <div style={{ marginTop: 18 }}>
        <Outlet />
      </div>
    </div>
  );
}
