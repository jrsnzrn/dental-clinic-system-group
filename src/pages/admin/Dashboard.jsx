import { NavLink, Outlet } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../../firebase";

export default function Dashboard() {
  return (
    <div className="container">
      <div className="cardHeader">
        <h2 className="title">Admin Dashboard</h2>
        <button className="btn secondary" onClick={() => signOut(auth)}>
          Logout
        </button>
      </div>

      {/* 🔥 ADMIN NAV */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <NavLink
          to="/admin/patients"
          className={({ isActive }) =>
            isActive ? "btn" : "btn secondary"
          }
        >
          👤 Patients
        </NavLink>

        {/* future buttons */}
        {/* <NavLink to="/admin/appointments" className={({isActive}) => isActive ? "btn" : "btn secondary"}>📅 Appointments</NavLink> */}
      </div>

      <div className="card">
        <Outlet />
      </div>
    </div>
  );
}