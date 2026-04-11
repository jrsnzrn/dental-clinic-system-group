import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";

export default function NavBar({ isAdmin: adminFromApp = false, user: userFromApp = null }) {
  const navClass = ({ isActive }) => "navItem" + (isActive ? " active" : "");

  const [user, setUser] = useState(userFromApp);
  const [isAdmin, setIsAdmin] = useState(adminFromApp);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);

      if (!u) {
        setIsAdmin(false);
        return;
      }

      try {
        const snap = await getDoc(doc(db, "admins", u.uid));
        setIsAdmin(snap.exists());
      } catch (err) {
        console.error("Admin check failed:", err);
        setIsAdmin(false);
      }
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    setUser(userFromApp);
  }, [userFromApp]);

  useEffect(() => {
    setIsAdmin(adminFromApp);
  }, [adminFromApp]);

  async function logout() {
    try {
      await signOut(auth);
    } catch (e) {
      console.error("Logout failed:", e);
    }
  }

  return (
    <div className="nav">
      <div className="navInner">
        <div className="brand brand-bounce">
          <span className="logo-tooth" aria-hidden="true">🦷</span>
          <span className="logo-text">TopDent</span>
          <span className="badge">Dental Clinic</span>
        </div>

        {!isAdmin ? (
          <div className="navLinks">
            <NavLink to="/" className={navClass}>Home</NavLink>
            <NavLink to="/services" className={navClass}>Services</NavLink>
            <NavLink to="/contact" className={navClass}>Contact</NavLink>
            <NavLink to="/book" className={navClass}>Book</NavLink>
            {user && <NavLink to="/my-record" className={navClass}>My Record</NavLink>}
          </div>
        ) : (
          <div className="navLinks">
            <NavLink to="/admin/patients" className={navClass}>Patients</NavLink>
            <NavLink to="/admin/bookings" className={navClass}>Bookings</NavLink>
            <NavLink to="/admin/dentists" className={navClass}>Dentists</NavLink>
            <NavLink to="/admin/archive" className={navClass}>Archive</NavLink>
          </div>
        )}

        <div className="spacer" />

        <div className="navLinks">
          {!user && (
            <NavLink to="/admin/login" className={navClass}>
              Admin Login
            </NavLink>
          )}

          {user && (
            <button className="navItem" onClick={logout} type="button">
              Logout
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
