import { useState } from "react";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useNavigate, useSearchParams } from "react-router-dom";
import { auth, db } from "../../firebase";
import {
  getAdminProfile,
  getDefaultAdminPath,
  hasFreshStaffMfa,
  requiresStaffMfa,
  ROLES,
} from "../../utils/rbac";

const ROLE_OPTIONS = [
  { value: ROLES.ADMIN, label: "Admin" },
  { value: ROLES.RECEPTIONIST, label: "Receptionist" },
  { value: ROLES.DENTIST, label: "Dentist" },
];

function getLoginErrorMessage(error) {
  // Correct email & password, but selected the wrong account type or not in staff list
  if (error?.message === "role-mismatch" || error?.message === "not-admin") {
    return "Invalid account";
  }

  // Disabled staff account
  if (error?.message === "account-disabled") {
    return "This staff account is disabled. Please contact the administrator.";
  }

  // Network connection issue
  if (error?.code === "auth/network-request-failed") {
    return "Network error. Please check your connection and try again.";
  }

  // Rate limiting
  if (error?.code === "auth/too-many-requests") {
    return "Too many failed attempts. Please wait a bit before trying again.";
  }

  // Default fallback for wrong password or unrecognized credentials
  return "Invalid email or password.";
}

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [selectedRole, setSelectedRole] = useState(ROLES.ADMIN);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  async function completeStaffLogin(credential) {
    await credential.user.getIdToken(true);

    const adminSnap = await getDoc(doc(db, "admins", credential.user.uid));

    if (!adminSnap.exists()) {
      await signOut(auth);
      throw new Error("not-admin");
    }

    const profile = getAdminProfile(adminSnap.data());

    if (profile.disabled) {
      await signOut(auth);
      throw new Error("account-disabled");
    }

    // Triggers "Invalid account" if role selection doesn't match profile
    if (profile.role !== selectedRole) {
      await signOut(auth);
      throw new Error("role-mismatch");
    }

    const requestedNext = searchParams.get("next") || "";
    const targetPath = requestedNext.startsWith("/admin")
      ? requestedNext
      : getDefaultAdminPath(profile.role);

    await credential.user.reload();
    if (!credential.user.emailVerified) {
      navigate(`/admin/verify-email?next=${encodeURIComponent(targetPath)}`, {
        replace: true,
      });
      return;
    }

    if (requiresStaffMfa(profile) && !hasFreshStaffMfa(profile)) {
      navigate(`/admin/mfa?next=${encodeURIComponent(targetPath)}`, {
        replace: true,
      });
      return;
    }

    navigate(targetPath, { replace: true });
  }

  async function onLogin(e) {
    e.preventDefault();
    setErr("");

    if (!email.trim() || !password.trim()) {
      setErr("Please enter your email and password.");
      return;
    }

    try {
      setLoading(true);

      const credential = await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );

      await completeStaffLogin(credential);
    } catch (e) {
      setErr(getLoginErrorMessage(e));
      console.error(e);
      setLoading(false);
    }
  }

  return (
    <div className="authWrap">
      <div className="loginCard">
        <div className="loginHeader">
          <span className="pill">Staff Portal</span>
          <h1>Welcome Back</h1>
          <p>Sign in to access the TOPDENT staff system.</p>
        </div>

        <form onSubmit={onLogin} className="loginForm">
          {/* Account Type Selection */}
          <div className="inputGroup">
            <label className="label">Account Type</label>
            <div className="radioGroup">
              {ROLE_OPTIONS.map((role) => (
                <label
                  key={role.value}
                  className={`radioOption ${
                    selectedRole === role.value ? "active" : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="accountRole"
                    value={role.value}
                    checked={selectedRole === role.value}
                    onChange={(e) => setSelectedRole(e.target.value)}
                    className="radioInput"
                  />
                  <span className="customRadio" />
                  <span className="radioText">{role.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Email Field */}
          <div className="inputGroup">
            <label htmlFor="loginEmail" className="label">
              Email Address
            </label>
            <input
              id="loginEmail"
              className="input"
              type="email"
              placeholder="name@topdent.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>

          {/* Password Field */}
          <div className="inputGroup">
            <label htmlFor="loginPassword" className="label">
              Password
            </label>
            <div className="passwordWrapper">
              <input
                id="loginPassword"
                className="input passwordInput"
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="eyeButton"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Error Display */}
          {err && (
            <div className="error">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{err}</span>
            </div>
          )}

          <button className="btn btnWide" type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Sign In"}
          </button>

          <button className="backButton" type="button" onClick={() => navigate("/admin/forgot-password")}>
            Forgot password?
          </button>

          <button
            className="backButton appBackAction"
            type="button"
            onClick={() => navigate("/")}
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" focusable="false">
              <path d="M12.5 4.5 7 10l5.5 5.5M7.5 10h9" />
            </svg>
            Back to Home
          </button>
        </form>

        <div className="loginFooter">
          <span>TOPDENT Dental Clinic</span>
          <span>Staff Access Only</span>
        </div>
      </div>
    </div>
  );
}
