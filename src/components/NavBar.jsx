import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "../firebase";
import { ADMIN_NAV_BY_ROLE, getAdminProfile, ROLE_LABELS, ROLES } from "../utils/rbac";
import topDentLogo from "../assets/logo.png";
import StaffNotificationBell from "./StaffNotificationBell";

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

const ADMIN_NAV_ICONS = {
  "/admin/analytics": (
    <svg viewBox="0 0 24 24"><path d="M4 19V5"/><path d="M4 19h16"/><path d="m7 15 4-4 3 2 5-6"/></svg>
  ),
  "/admin/dashboard": (
    <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
  ),
  "/admin/bookings": (
    <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/></svg>
  ),
  "/admin/services": (
    <svg viewBox="0 0 24 24"><path d="M14.5 3.5 17 6l-8 8-3.5.8L6.3 11z"/><path d="M3 21l2.2-5.2"/><path d="M13.5 4.5l3 3"/></svg>
  ),
  "/admin/patients": (
    <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"/></svg>
  ),
  "/admin/completed": (
    <svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>
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
  "/admin/payments": (
    <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M7 15h4"/><path d="M16 15h1"/></svg>
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

const ACCOUNT_ICONS = {
  appointments: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/>
    </svg>
  ),
  record: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9 12h6"/><path d="M9 16h6"/>
    </svg>
  ),
  logout: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>
    </svg>
  ),
  chevron: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6"/>
    </svg>
  ),
};

const ADMIN_ACCOUNT_ITEMS = [];

const USER_ACCOUNT_ITEMS = [
  { to: "/my-appointments", label: "My Appointments", desc: "View your bookings", icon: ACCOUNT_ICONS.appointments },
  { to: "/my-record", label: "My Record", desc: "View your dental record", icon: ACCOUNT_ICONS.record },
];

function getDisplayName(user) {
  if (!user) return "Account";
  if (user.displayName) return user.displayName;
  if (user.email) return user.email.split("@")[0];
  return "Account";
}

function getInitial(user) {
  return getDisplayName(user).charAt(0).toUpperCase();
}

function AccountAvatar({ user, large = false }) {
  return (
    <span className={`accountAvatar ${large ? "large" : ""}`}>
      {user?.photoURL ? (
        <img src={user.photoURL} alt="" referrerPolicy="no-referrer" />
      ) : (
        getInitial(user)
      )}
    </span>
  );
}

function AccountMenu({ user, items, onLogout, theme, onThemeChange, accountRole = "" }) {
  const [open, setOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event) {
      if (ref.current && !ref.current.contains(event.target)) {
        setOpen(false);
        setAppearanceOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setOpen(false);
        setAppearanceOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="accountMenu" ref={ref}>
      <button
        type="button"
        className={`accountTrigger ${open ? "open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (open) setAppearanceOpen(false);
          setOpen((current) => !current);
        }}
      >
        <AccountAvatar user={user} />
        <span className="accountMeta">
          <span className="accountName">{getDisplayName(user)}</span>
        </span>
        <span className="accountChevron">{ACCOUNT_ICONS.chevron}</span>
      </button>

      <div className={`accountDropdown ${open ? "open" : ""}`} role="menu">
        <div className="accountDropdownHead">
          <AccountAvatar user={user} large />
          <div className="accountDropdownInfo">
            <strong>{getDisplayName(user)}</strong>
            {accountRole ? <span className="accountRole">{accountRole}</span> : null}
            <span className="accountEmail">{user?.email}</span>
          </div>
        </div>

        <div className="accountDropdownDivider" />

        {items.length > 0 && (
          <>
            {items.map((item) => (
              <NavLink key={item.to + item.label} to={item.to} className="accountDropdownItem" role="menuitem" onClick={() => setOpen(false)}>
                <span className="accountItemIcon">{item.icon}</span>
                <span className="accountItemText">
                  <strong>{item.label}</strong>
                  <small>{item.desc}</small>
                </span>
              </NavLink>
            ))}

            <div className="accountDropdownDivider" />
          </>
        )}

        {theme && onThemeChange && (
          <>
            <div className="accountAppearance">
              <button
                type="button"
                className="accountDropdownItem accountAppearanceTrigger"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={appearanceOpen}
                onClick={() => setAppearanceOpen((current) => !current)}
              >
                <span className="accountItemIcon accountAppearanceIcon" aria-hidden="true">
                  {THEME_OPTIONS.find((option) => option.id === "blue").icon}
                </span>
                <span className="accountItemText"><strong>Appearance</strong></span>
                <span className="accountAppearanceChevron" aria-hidden="true">›</span>
              </button>
              {appearanceOpen && (
                <div className="accountAppearanceMenu" role="menu" aria-label="Choose appearance">
                  {["light", "dark", "blue"].map((themeId) => {
                    const option = THEME_OPTIONS.find((themeOption) => themeOption.id === themeId);
                    return (
                      <button
                        key={themeId}
                        type="button"
                        className="accountAppearanceOption"
                        role="menuitemradio"
                        aria-checked={theme === themeId}
                        onClick={() => onThemeChange(themeId)}
                      >
                        <span className="accountAppearanceOptionLabel">
                          {option.icon}
                          {themeId.charAt(0).toUpperCase() + themeId.slice(1)} theme
                        </span>
                        {theme === themeId && (
                          <svg className="accountAppearanceCheck" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                            <path d="m4 10 4 4 8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {theme && onThemeChange && <div className="accountDropdownDivider" />}
        <button
          type="button"
          className="accountDropdownItem danger"
          role="menuitem"
          onClick={onLogout}
          data-mascot-target="nav-logout"
        >
          <span className="accountItemIcon">{ACCOUNT_ICONS.logout}</span>
          <span className="accountItemText">
            <strong>Logout</strong>
          </span>
        </button>
      </div>
    </div>
  );
}

export default function NavBar({
  isAdmin: adminFromApp = false,
  user: userFromApp = null,
  adminRole: adminRoleFromApp = "",
  theme = "light",
  onThemeChange = () => {},
  dentistSearch = "",
  onDentistSearchChange = () => {},
  dentistPatientTypeFilter = "All",
  onDentistPatientTypeFilterChange = () => {},
  archiveSearch = "",
  onArchiveSearchChange = () => {},
}) {
  const navClass = ({ isActive }) => "navItem" + (isActive ? " active" : "");

  const [user, setUser] = useState(userFromApp);
  const [isAdmin, setIsAdmin] = useState(adminFromApp);
  const [adminRole, setAdminRole] = useState(adminRoleFromApp);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

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
  const isDentistRecordsRoute =
    adminRole === ROLES.DENTIST &&
    (location.pathname === "/admin/patients" || location.pathname === "/admin/completed");
  const isDentistPatientsRoute =
    adminRole === ROLES.DENTIST &&
    (location.pathname === "/admin/patients" || location.pathname === "/admin/patients/");
  const isArchiveRoute = isAdmin && location.pathname.startsWith("/admin/archive");
  const isStaffVerificationRoute =
    location.pathname === "/admin/verify-email" || location.pathname === "/admin/mfa";
  const archiveSection = location.pathname.split("/")[3] || "all";
  const archiveCategory = archiveSection === "accounts"
    ? "accounts"
    : ["all", "patients", "dentists", "bookings"].includes(archiveSection)
      ? archiveSection
      : "all";

  if (isStaffVerificationRoute || (user && isAdmin && !user.emailVerified)) return null;

  return (
    isAdmin ? (
      <>
        {user && (
          <div className={`adminTopbar${isDentistRecordsRoute ? " dentistRecordsTopbar" : ""}${isArchiveRoute ? " archiveTopbar" : ""}`}>
            {isArchiveRoute ? (
              <>
                <div className="archiveTopbarSearch">
                  <svg className="topSearchIcon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                  <input
                    className="input"
                    type="search"
                    placeholder="Search archived records by name"
                    aria-label="Search archived records"
                    value={archiveSearch}
                    onChange={(event) => onArchiveSearchChange(event.target.value)}
                  />
                </div>
                <label className="archiveTopbarFilter">
                  <span>Sort</span>
                  <select
                    className="input"
                    aria-label="Filter archived records by category"
                    value={archiveCategory}
                    onChange={(event) => navigate(`/admin/archive/${event.target.value}`)}
                  >
                    <option value="all">All</option>
                    <option value="patients" disabled={adminRole !== ROLES.ADMIN}>Patients</option>
                    <option value="dentists">Dentists</option>
                    <option value="accounts">Staff</option>
                    <option value="bookings">Bookings</option>
                  </select>
                </label>
              </>
            ) : null}
            {isDentistRecordsRoute ? (
              <>
                <div className="dentistHeaderSearch topSearchBar">
                  <svg className="topSearchIcon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                  <input
                    className="input topSearchInput"
                    type="search"
                    placeholder="Search patients"
                    aria-label="Search patients"
                    value={dentistSearch}
                    onChange={(event) => onDentistSearchChange(event.target.value)}
                  />
                </div>
                {isDentistPatientsRoute ? (
                  <label className="dentistPatientTypeFilter">
                    <select
                      className="input"
                      aria-label="Filter patients by type"
                      value={dentistPatientTypeFilter}
                      onChange={(event) => onDentistPatientTypeFilterChange(event.target.value)}
                    >
                      <option value="All">All</option>
                      <option value="Ortho">Ortho</option>
                      <option value="Regular">Regular</option>
                    </select>
                  </label>
                ) : null}
              </>
            ) : null}
            <StaffNotificationBell adminRole={adminRole} />
            <AccountMenu
              key={`${location.pathname}:${menuOpen}`}
              user={user}
              items={ADMIN_ACCOUNT_ITEMS}
              onLogout={logout}
              theme={theme}
              onThemeChange={onThemeChange}
              accountRole={ROLE_LABELS[adminRole] || "Staff"}
            />
          </div>
        )}

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

            <nav className="adminSidebarNav">
              {adminLinks.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  className={({ isActive }) => `adminSidebarLink ${isActive ? "active" : ""}`}
                  onClick={() => setMenuOpen(false)}
                  title={link.to === "/admin/braces" && adminRole === ROLES.RECEPTIONIST ? "Braces payment ledger" : undefined}
                >
                  {ADMIN_NAV_ICONS[link.to] || ADMIN_NAV_ICON_DEFAULT}
                  <span>{link.label}</span>
                </NavLink>
              ))}
            </nav>

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
            onClick={() => {
              setMenuOpen((current) => !current);
            }}
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
            </div>
          </div>

          {user && (
            <AccountMenu
              key={`${location.pathname}:${menuOpen}`}
              user={user}
              items={USER_ACCOUNT_ITEMS}
              onLogout={logout}
            />
          )}
        </div>
      </div>
    )
  );
}