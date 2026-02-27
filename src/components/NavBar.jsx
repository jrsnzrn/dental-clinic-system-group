import { NavLink } from "react-router-dom";

export default function NavBar() {
  const navClass = ({ isActive }) =>
    "navItem" + (isActive ? " active" : "");

  return (
    <div className="nav">
      <div className="navInner">
        {/* 🔥 BRAND */}
        <div className="brand brand-bounce">
          <span className="logo-tooth">🦷</span>
          <span className="logo-text">BrightSmile</span>
          <span className="badge">Dental Clinic</span>
        </div>

        {/* 🔥 NAV LINKS */}
        <div className="navLinks">
          <NavLink to="/" className={navClass}>
            Home
          </NavLink>
          <NavLink to="/services" className={navClass}>
            Services
          </NavLink>
          <NavLink to="/contact" className={navClass}>
            Contact
          </NavLink>
          <NavLink to="/book" className={navClass}>
            Book
          </NavLink>
        </div>

        <div className="spacer" />

        <div className="navLinks">
          <NavLink to="/admin" className={navClass}>
            Admin
          </NavLink>
        </div>
      </div>
    </div>
  );
}