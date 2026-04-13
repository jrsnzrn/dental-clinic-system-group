import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { ADMIN_NAV_BY_ROLE, getAdminProfile, ROLE_LABELS, ROLES } from "../utils/rbac";

export default function NavBar({
  isAdmin: adminFromApp = false,
  user: userFromApp = null,
  adminRole: adminRoleFromApp = "",
}) {
  const navClass = ({ isActive }) => "navItem" + (isActive ? " active" : "");

  const [user, setUser] = useState(userFromApp);
  const [isAdmin, setIsAdmin] = useState(adminFromApp);
  const [adminRole, setAdminRole] = useState(adminRoleFromApp);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);

      if (!u) {
        setIsAdmin(false);
        setAdminRole("");
        return;
      }

      try {
        const snap = await getDoc(doc(db, "admins", u.uid));
        if (snap.exists()) {
          const profile = getAdminProfile(snap.data());
          setIsAdmin(true);
          setAdminRole(profile.role);
        } else {
          setIsAdmin(false);
          setAdminRole("");
        }
      } catch (err) {
        console.error("Admin check failed:", err);
        setIsAdmin(false);
        setAdminRole("");
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

  useEffect(() => {
    setAdminRole(adminRoleFromApp);
  }, [adminRoleFromApp]);

  useEffect(() => {
    setMenuOpen(false);
  }, [user, isAdmin]);

  async function logout() {
    try {
      await signOut(auth);
      setMenuOpen(false);
    } catch (e) {
      console.error("Logout failed:", e);
    }
  }

  const adminLinks = ADMIN_NAV_BY_ROLE[adminRole] || ADMIN_NAV_BY_ROLE[ROLES.ADMIN];

  return (
    <div className="nav">
      <div className="navInner">
        <div className="brand brand-bounce">
          <span className="logo-tooth" aria-hidden="true">🦷</span>
          <span className="logo-text">TopDent</span>
          <span className="badge">Dental Clinic</span>
        </div>

        {!isAdmin ? (
          <>
            <button
              type="button"
              className={`menuToggle ${menuOpen ? "active" : ""}`}
              aria-label="Toggle navigation menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((current) => !current)}
            >
              <span />
              <span />
              <span />
            </button>

            <div className={`navMenuShell ${menuOpen ? "open" : ""}`}>
              <div className={`navLinks navLinksPrimary ${menuOpen ? "open" : ""}`}>
                <NavLink to="/" className={navClass} onClick={() => setMenuOpen(false)}>Home</NavLink>
                <NavLink to="/services" className={navClass} onClick={() => setMenuOpen(false)}>Services</NavLink>
                <NavLink to="/contact" className={navClass} onClick={() => setMenuOpen(false)}>Contact</NavLink>
                <NavLink to="/book" className={navClass} onClick={() => setMenuOpen(false)}>Book</NavLink>
                {user && <NavLink to="/my-record" className={navClass} onClick={() => setMenuOpen(false)}>My Record</NavLink>}
              </div>

              <div className={`navLinks navLinksUtility ${menuOpen ? "open" : ""}`}>
                {user && (
                  <button className="navItem" onClick={logout} type="button">
                    Logout
                  </button>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="navLinks">
              {adminLinks.map((link) => (
                <NavLink key={link.to} to={link.to} className={navClass}>
                  {link.label}
                </NavLink>
              ))}
            </div>

            <div className="spacer" />

            <div className="navLinks">
              {adminRole ? (
                <span className="badge roleBadge">{ROLE_LABELS[adminRole]}</span>
              ) : null}
              {user && (
                <button className="navItem" onClick={logout} type="button">
                  Logout
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
