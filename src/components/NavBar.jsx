import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "../firebase";
import { ADMIN_NAV_BY_ROLE, getAdminProfile, ROLE_LABELS, ROLES } from "../utils/rbac";
import topDentLogo from "../assets/topdent-logo.png";

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
  const location = useLocation();

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

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

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
    isAdmin ? (
      <>
        <div className="adminMobileBar">
          <div className="adminMobileBrand">
            <img className="brandLogoImage" src={topDentLogo} alt="TopDent logo" />
            <div>
              <strong>TopDent</strong>
              <span>{ROLE_LABELS[adminRole] || "Staff"}</span>
            </div>
          </div>

          <button
            type="button"
            className={`menuToggle ${menuOpen ? "active" : ""}`}
            aria-label="Toggle staff navigation"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((current) => !current)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>

        <aside className={`adminSidebar ${menuOpen ? "open" : ""}`}>
          <div className="adminSidebarInner">
            <div className="adminSidebarBrand">
              <img className="adminSidebarLogo" src={topDentLogo} alt="TopDent logo" />
              <div>
                <strong>TopDent</strong>
                <span>Dental Clinic</span>
              </div>
            </div>

            <div className="adminSidebarMeta">
              <span className="detailLabel">Workspace</span>
              <strong>{ROLE_LABELS[adminRole] || "Staff"}</strong>
              <p>{user?.email || "Signed-in staff account"}</p>
            </div>

            <nav className="adminSidebarNav">
              {adminLinks.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  className={({ isActive }) => `adminSidebarLink ${isActive ? "active" : ""}`}
                  onClick={() => setMenuOpen(false)}
                >
                  <span className="adminSidebarBullet" />
                  <span>{link.label}</span>
                </NavLink>
              ))}
            </nav>

            <div className="adminSidebarFooter">
              {adminRole ? <span className="badge roleBadge adminSidebarRole">{ROLE_LABELS[adminRole]}</span> : null}
              {user ? (
                <button className="btn secondary adminSidebarLogout" onClick={logout} type="button">
                  Logout
                </button>
              ) : null}
            </div>
          </div>
        </aside>
      </>
    ) : (
      <div className="nav">
        <div className="navInner">
          <div className="brand brand-bounce">
            <img className="brandLogoImage" src={topDentLogo} alt="TopDent logo" />
            <span className="logo-text">TopDent</span>
            <span className="badge">Dental Clinic</span>
          </div>

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
              <NavLink to="/about" className={navClass} onClick={() => setMenuOpen(false)}>About Us</NavLink>
              {user && <NavLink to="/my-appointments" className={navClass} onClick={() => setMenuOpen(false)}>My Appointments</NavLink>}
              {user && <NavLink to="/my-record" className={navClass} onClick={() => setMenuOpen(false)}>My Record</NavLink>}
            </div>
          </div>

          {user && (
            <div className="navLinks navLinksUtility navUtilityStandalone">
              <button className="navItem" onClick={logout} type="button">
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    )
  );
}
