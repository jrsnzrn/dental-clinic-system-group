import { useState } from "react";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useNavigate, useSearchParams } from "react-router-dom";
import { auth, db } from "../../firebase";
import BackArrow from "../../components/BackArrow";
import {
  getAdminProfile,
  getStaffLoginPath,
  hasFreshStaffMfa,
  requiresStaffMfa,
  ROLES,
} from "../../utils/rbac";

function getLoginErrorMessage(error) {
  if (error?.message === "not-admin") {
    return "This account does not have staff access.";
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
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  async function completeStaffLogin(credential) {
    const tokenResult = await credential.user.getIdTokenResult(true);

    const adminSnap = await getDoc(doc(db, "admins", credential.user.uid));

    if (!adminSnap.exists()) {
      await signOut(auth);
      throw new Error("not-admin");
    }

    const staffData = adminSnap.data();
    const savedRole = String(staffData.role || "").trim().toLowerCase();
    if (!Object.values(ROLES).includes(savedRole)) {
      await signOut(auth);
      throw new Error("not-admin");
    }
    const profile = getAdminProfile(staffData);

    if (profile.disabled) {
      await signOut(auth);
      throw new Error("account-disabled");
    }

    const requestedNext = searchParams.get("next") || "";
    const targetPath = getStaffLoginPath(profile.role, requestedNext);

    await credential.user.reload();
    if (!credential.user.emailVerified) {
      navigate(`/admin/verify-email?next=${encodeURIComponent(targetPath)}`, {
        replace: true,
      });
      return;
    }

    if (requiresStaffMfa(profile) && !hasFreshStaffMfa(profile, tokenResult.claims.auth_time)) {
      navigate(`/admin/mfa?next=${encodeURIComponent(targetPath)}`, {
        replace: true,
      });
      return;
    }

    navigate(targetPath, { replace: true });
  }

  async function onLogin(e) {
    e.preventDefault();
    if (loading) return;
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
            className="backButton appBackAction topdentBackAction"
            type="button"
            aria-label="Go back"
            onClick={() => navigate("/")}
          >
            <BackArrow />
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
