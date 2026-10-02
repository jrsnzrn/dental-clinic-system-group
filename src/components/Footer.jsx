import { NavLink } from "react-router-dom";
import bancnet from "../assets/bancnet.png";
import gcash from "../assets/gcash.png";
import mastercard from "../assets/mastercard.png";
import qrph from "../assets/qrph.png";
import logo from "../assets/logo.png";

const THEME_OPTIONS = [
  {
    id: "dark",
    icon: (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
      </svg>
    )
  },
  {
    id: "light",
    icon: (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 14.7255 3.09032 17.1962 4.85857 19C5.03454 16.5542 7.09086 14.6154 9.61538 14.6154H14.3846C16.9091 14.6154 18.9655 16.5542 19.1414 19C17.3732 20.8038 14.9026 22 12 22Z"/>
        <circle cx="7.5" cy="10.5" r="1.5"/>
        <circle cx="11.5" cy="7.5" r="1.5"/>
        <circle cx="16.5" cy="9.5" r="1.5"/>
      </svg>
    )
  },
];

const PAYMENT_LOGOS = [
  { id: "bancnet", name: "BancNet", logo: bancnet },
  { id: "mastercard", name: "Mastercard", logo: mastercard },
  { id: "qrph", name: "QR Ph", logo: qrph },
  { id: "gcash", name: "GCash", logo: gcash },
];

export default function Footer({ isAdmin = false, theme = "dark", onThemeChange = () => {} }) {
  if (isAdmin) return null;

  return (
    <footer className="siteFooter">
      <div className="siteFooterInner">
        {/* LEFT: Logo + Theme Mode + Clinic Access */}
        <div className="footerLinksGroup footerBrandGroup">
          <div className="footerLogoRow">
            <img src={logo} alt="TopDent" className="footerLogoImg" />
            <span className="footerBrand">
              TopDent
              <span className="footerBrandSub">DENTAL CLINIC</span>
            </span>
          </div>

          <span className="footerLabel">Theme Mode</span>
          <div className="themeSwitcher footerThemeSwitcher" aria-label="Theme switcher">
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

          <span className="footerLabel">Clinic Access</span>
          <NavLink to="/admin/login" className="footerLink">Login</NavLink>
        </div>

        {/* MIDDLE: Contact Us */}
        <div className="footerLinksGroup footerContactGroup">
          <span className="footerLabel">Contact Us</span>

          <ul className="footerContactList">
            <li className="footerContactItem">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
              <span>67 McArthur Hwy, Banga Meycauayan Bulacan</span>
            </li>
            <li className="footerContactItem">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
              </svg>
              <span>+63 994 376 6421</span>
            </li>
            <li className="footerContactItem">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16v16H4z" opacity="0"/>
                <path d="M22 6l-10 7L2 6"/>
                <rect x="2" y="4" width="20" height="16" rx="2"/>
              </svg>
              <span>topdent@gmail.com</span>
            </li>
            <li className="footerContactItem">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 6v6l4 2"/>
              </svg>
              <span>Monday - Sunday: 9:00AM - 6:00PM</span>
            </li>
          </ul>

          <a
            href="https://www.facebook.com/TopdentDentalClinic"
            target="_blank"
            rel="noreferrer"
            className="footerSocialLink"
            aria-label="Visit our Facebook page"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0 0 22 12z"/>
            </svg>
          </a>
        </div>

        {/*Accepted Payments */}
        <div className="footerLinksGroup footerPaymentGroup">
          <span className="footerLabel">WE ACCEPT PAYMENTS</span>
          <ul className="footerPaymentLogos">
            {PAYMENT_LOGOS.map((method) => (
              <li key={method.id} className="footerPaymentLogo" title={method.name}>
                <img src={method.logo} alt={method.name} />
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="footerCopy footerCopyBottom">© 2026 TopDent. All rights Reserved.</p>
    </footer>
  );
}
