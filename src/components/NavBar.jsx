import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "../firebase";
import { ADMIN_NAV_BY_ROLE, getAdminProfile, ROLE_LABELS, ROLES } from "../utils/rbac";
import topDentLogo from "../assets/logo.png";

const THEME_OPTIONS = [
  { 
    id: "dark", 
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
      </svg>
    ) 
  },
  { 
    id: "light", 
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="5"/>
        <line x1="12" y1="1" x2="12" y2="3"/>
        <line x1="12" y1="21" x2="12" y2="23"/>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
        <line x1="1" y1="12" x2="3" y2="12"/>
        <line x1="21" y1="12" x2="23" y2="12"/>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
      </svg>
    ) 
  },
  { 
    id: "blue", 
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 14.7255 3.09032 17.1962 4.85857 19C5.03454 16.5542 7.09086 14.6154 9.61538 14.6154H14.3846C16.9091 14.6154 18.9655 16.5542 19.1414 19C17.3732 20.8038 14.9026 22 12 22Z"/>
        <circle cx="7.5" cy="10.5" r="1.5"/>
        <circle cx="11.5" cy="7.5" r="1.5"/>
        <circle cx="16.5" cy="9.5" r="1.5"/>
      </svg>
    ) 
  },
];

// Icons
const ADMIN_NAV_ICONS = {
  "/admin/dashboard": (
    <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
  ),
  "/admin/bookings": (
    <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/></svg>
  ),
  "/admin/appointments": (
    <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/></svg>
  ),
  "/admin/services": (
    <svg viewBox="0 0 24 24"><path d="M14.5 3.5 17 6l-8 8-3.5.8L6.3 11z"/><path d="M3 21l2.2-5.2"/><path d="M13.5 4.5l3 3"/></svg>
  ),
  "/admin/patients": (
    <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"/></svg>
  ),
  "/admin/records": (
    <svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9 12h6"/><path d="M9 16h6"/></svg>
  ),
  "/admin/staff": (
    <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M2 20c0-3 3-5 7-5s7 2 7 5"/><circle cx="18" cy="9" r="2.4"/><path d="M15.5 20c.2-2 1.8-3.6 3.8-3.9"/></svg>
  ),
  "/admin/settings": (
    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V20a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H4a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H10a1.7 1.7 0 0 0 1-1.6V4a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V10a1.7 1.7 0 0 0 1.6 1H20a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1z"/></svg>
  ),
  "/admin/dentists": (
    <svg viewBox="0 0 24 24"><path d="M12 3c-1.8 0-2.9.8-3.8.8-.9 0-1.7-.5-2.6-.1C4.2 4.3 3.5 5.9 3.5 8c0 3.2 1.6 8.5 3.2 10.2.7.8 1.2-.3 1.5-1.3.3-1 .5-3.1 1.5-3.1s1.2 2.1 1.5 3.1c.3 1 .8 2.1 1.5 1.3C14.9 16.5 16.5 11.2 16.5 8c0-2.1-.7-3.7-2.1-4.3-.9-.4-1.7.1-2.4.1z"/></svg>
  ),
  "/admin/braces": (
    <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M7 15h4"/></svg>
  ),
  "/admin/accounts": (
    <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.2"/><path d="M5.5 20c.7-3.4 3.4-5.5 6.5-5.5s5.8 2.1 6.5 5.5"/></svg>
  ),
  "/admin/logs": (
    <svg viewBox="0 0 24 24"><path d="M4 5h11M4 10h7"/><circle cx="16" cy="15" r="5"/><path d="M16 12.5V15l1.8 1"/></svg>
  ),
  "/admin/archive": (
    <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="4.5" rx="1"/><path d="M4.5 8.5v10a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-10"/><path d="M10 13h4"/></svg>
  ),
};

const ADMIN_NAV_ICON_DEFAULT = (
  <svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="1.4"/><circle cx="12" cy="6" r="1.4"/><circle cx="18" cy="6" r="1.4"/><circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/></svg>
);

export default function NavBar({
  isAdmin: adminFromApp = false,
  user: userFromApp = null,
  adminRole: adminRoleFromApp = "",
  theme = "light",
  onThemeChange = () => {},
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

  const adminLinks = ADMIN_NAV_BY_ROLE[adminRole] || ADMIN_NAV_BY_ROLE[ROLES.ADMIN] || [];

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
                  {ADMIN_NAV_ICONS[link.to] || ADMIN_NAV_ICON_DEFAULT}
                  <span>{link.label}</span>
                </NavLink>
              ))}
            </nav>

            <div className="adminSidebarFooter">
              {/* Theme Switcher using Icons */}
              <div className="themeSwitcher adminThemeSwitcher">
                {THEME_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`themeChip iconThemeChip ${theme === option.id ? "active" : ""}`}
                    onClick={() => onThemeChange(option.id)}
                    aria-label={`Switch to ${option.id} theme`}
                    title={`${option.id.charAt(0).toUpperCase() + option.id.slice(1)} Theme`}
                  >
                    {option.icon}
                  </button>
                ))}
              </div>

              {/* Logout Button */}
              {user && (
                <button
                  className="btn secondary adminSidebarLogout"
                  onClick={logout}
                  type="button"
                  data-mascot-target="nav-logout"
                >
                  Logout
                </button>
              )}
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
              <NavLink to="/services" className={navClass} onClick={() => setMenuOpen(false)} data-mascot-target="nav-services">Services</NavLink>
              <NavLink to="/contact" className={navClass} onClick={() => setMenuOpen(false)} data-mascot-target="nav-contact">Contact</NavLink>
              <NavLink to="/book" className={navClass} onClick={() => setMenuOpen(false)} data-mascot-target="nav-book">Book</NavLink>
              <NavLink to="/about" className={navClass} onClick={() => setMenuOpen(false)}>About Us</NavLink>
              {user && <NavLink to="/my-appointments" className={navClass} onClick={() => setMenuOpen(false)}>My Appointments</NavLink>}
              {user && <NavLink to="/my-record" className={navClass} onClick={() => setMenuOpen(false)}>My Record</NavLink>}
            </div>
          </div>

          {user && (
            <div className="navLinks navLinksUtility navUtilityStandalone">
              <button className="navItem" onClick={logout} type="button" data-mascot-target="nav-logout">
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    )
  );
}