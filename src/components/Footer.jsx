import { NavLink } from "react-router-dom";

export default function Footer({ isAdmin = false }) {
  if (isAdmin) return null;

  return (
    <footer className="siteFooter">
      <div className="siteFooterInner">
        <div className="footerLinksGroup">
          <span className="footerLabel">Clinic Access</span>
          <NavLink to="/admin/login" className="footerLink">Admin Login</NavLink>
          <NavLink to="/terms" className="footerLink">Terms and Conditions</NavLink>
          <NavLink to="/privacy-policy" className="footerLink">Privacy Policy</NavLink>
        </div>

        <div className="footerLinksGroup footerMetaGroup">
          <span className="footerLabel">TopDent</span>
          <p className="footerCopy">© 2026 TopDent. All rights Reserved.</p>
        </div>
      </div>
    </footer>
  );
}
