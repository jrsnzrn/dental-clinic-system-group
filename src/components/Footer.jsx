import { NavLink } from "react-router-dom";

const THEME_OPTIONS = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "blue", label: "Blue" },
];

export default function Footer({ isAdmin = false, theme = "dark", onThemeChange = () => {} }) {
  if (isAdmin) return null;

  return (
    <footer className="siteFooter">
      <div className="siteFooterInner">
        <div className="footerLinksGroup">
          <span className="footerLabel">Clinic Access</span>
          <NavLink to="/admin/login" className="footerLink">Admin Login</NavLink>
        </div>

        <div className="footerLinksGroup footerMetaGroup">
          <span className="footerLabel">Theme Mode</span>
          <div className="themeSwitcher footerThemeSwitcher" aria-label="Theme switcher">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`themeChip ${theme === option.id ? "active" : ""}`}
                onClick={() => onThemeChange(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <span className="footerLabel">TopDent</span>
          <p className="footerCopy">© 2026 TopDent. All rights Reserved.</p>
        </div>
      </div>
    </footer>
  );
}
