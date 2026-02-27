import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../../firebase";
import { useNavigate } from "react-router-dom";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
      await signInWithEmailAndPassword(auth, email.trim(), password);
      navigate("/admin/patients");
    } catch (e) {
      setErr("Login failed. Check your email/password.");
      setShake(true);
      setTimeout(() => setShake(false), 400);
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="authWrap">
      <div className={`authCard ${shake ? "shake" : ""}`}>
        <div className="authHeader">
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span className="pill">Admin</span>
            <span className="pill">Secure Login</span>
          </div>

          <h2 className="authTitle">Welcome back</h2>
          <p className="authSub">
            Sign in to manage patients, appointments, and tooth tracking.
          </p>
        </div>

        <form onSubmit={onLogin} className="authGrid">
          <div className="inputGroup">
            <div className="label">Email</div>
            <div className="inputIconRow">
              <div className="inputIcon">✉️</div>
              <input
                className="inputPlain"
                placeholder="admin@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
          </div>

          <div className="inputGroup">
            <div className="label">Password</div>
            <div className="inputIconRow">
              <div className="inputIcon">🔒</div>
              <input
                className="inputPlain"
                placeholder="••••••••"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
          </div>

          <button className="btn btnWide" type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Login"}
          </button>

          {err ? <div className="error">{err}</div> : null}

          <div className="helperRow">
            <span>Tip: use the admin account from Firebase Auth</span>
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