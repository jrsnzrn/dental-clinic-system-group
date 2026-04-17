import { useState } from "react";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../../firebase";
import { useNavigate } from "react-router-dom";
import { getAdminProfile, getDefaultAdminPath, ROLE_LABELS, ROLES } from "../../utils/rbac";

const ROLE_OPTIONS = [
  {
    value: ROLES.RECEPTIONIST,
    badge: "Reception",
    title: "Reception Access",
    description:
      "Handles appointment intake, patient coordination, booking updates, and front-desk record flow.",
  },
  {
    value: ROLES.DENTIST,
    badge: "Dentist",
    title: "Dentist Access",
    description:
      "Focused on patient chart review, dental notes, and treatment-side record management.",
  },
  {
    value: ROLES.ADMIN,
    badge: "Admin",
    title: "Administrator Access",
    description:
      "Controls the security and integrity of the database, sets up clinic services, and manages system-level accounts for dentists and receptionists with full access to the platform.",
  },
];

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selectedRole, setSelectedRole] = useState(ROLES.ADMIN);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);

  const navigate = useNavigate();

  async function onLogin(e) {
    e.preventDefault();
    setErr("");

    if (!email.trim() || !password.trim()) {
      setErr("Please enter your email and password.");
      setShake(true);
      setTimeout(() => setShake(false), 400);
      return;
    }

    try {
      setLoading(true);
      const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
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
      if (profile.role !== selectedRole) {
        await signOut(auth);
        throw new Error("role-mismatch");
      }

      navigate(getDefaultAdminPath(profile.role));
    } catch (e) {
      if (e.message === "account-disabled") {
        setErr("This staff account is disabled. Please contact the administrator.");
      } else
      if (e.message === "role-mismatch") {
        setErr(`This account is not registered for ${ROLE_LABELS[selectedRole].toLowerCase()} access.`);
      } else if (e.message === "not-admin") {
        setErr("This account does not exist in the admin access list.");
      } else {
        setErr("Login failed. Check your email/password.");
      }

      setShake(true);
      setTimeout(() => setShake(false), 400);
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="authWrap">
      <div className={`authCard roleAuthCard ${shake ? "shake" : ""}`}>
        <div className="authHeader">
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span className="pill">Secure Access</span>
            <span className="pill">{ROLE_LABELS[selectedRole]}</span>
          </div>

          <h2 className="authTitle">Role-Based Login</h2>
          <p className="authSub">
            Choose the access module first, then sign in with the account assigned to that role in Firebase.
          </p>
        </div>

        <div className="roleChoiceGrid">
          {ROLE_OPTIONS.map((role) => (
            <button
              key={role.value}
              type="button"
              className={`roleChoiceCard ${selectedRole === role.value ? "selected" : ""}`}
              onClick={() => setSelectedRole(role.value)}
            >
              <span className="roleChoiceBadge">{role.badge}</span>
              <strong>{role.title}</strong>
              <p>{role.description}</p>
            </button>
          ))}
        </div>

        <form onSubmit={onLogin} className="authGrid">
          <div className="inputGroup">
            <div className="label">Email</div>
            <div className="inputIconRow">
              <div className="inputIcon">@</div>
              <input
                className="inputPlain"
                placeholder={`${selectedRole}@topdent.com`}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
          </div>

          <div className="inputGroup">
            <div className="label">Password</div>
            <div className="inputIconRow">
              <div className="inputIcon">#</div>
              <input
                className="inputPlain"
                placeholder="Enter your password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
          </div>

          <button className="btn btnWide" type="submit" disabled={loading}>
            {loading ? "Signing in..." : `Login as ${ROLE_LABELS[selectedRole]}`}
          </button>

          {err ? <div className="error">{err}</div> : null}

          <div className="helperRow">
            <span>Match the selected role with the `role` field inside `admins/{'{uid}'}` in Firestore.</span>
            <span
              className="linkish"
              onClick={() => navigate("/")}
              role="button"
              tabIndex={0}
            >
              Back to Home
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}
