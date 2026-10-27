import { useState } from "react";
import { Link } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../firebase";

const requestResetCode = httpsCallable(functions, "requestStaffPasswordResetCode");
const resetPassword = httpsCallable(functions, "resetStaffPasswordWithCode");

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function sendCode(event) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const result = await requestResetCode({ email: email.trim().toLowerCase() });
      setChallengeId(result.data?.challengeId || "");
      setMessage("If this email belongs to an active staff account, a verification code has been sent. Check your inbox and spam folder.");
    } catch (requestError) { setError(requestError.message || "Could not send a recovery code. Try again shortly."); }
    finally { setBusy(false); }
  }

  async function submitReset(event) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    if (password.length < 8) { setError("Use a password with at least 8 characters."); setBusy(false); return; }
    if (password !== confirmation) { setError("The passwords do not match."); setBusy(false); return; }
    try {
      await resetPassword({ email: email.trim().toLowerCase(), challengeId, code: code.trim(), newPassword: password });
      setMessage("Your password has been updated. Return to staff sign in.");
      setChallengeId(""); setCode(""); setPassword(""); setConfirmation("");
    } catch (resetError) { setError(resetError.message || "The code could not be verified. Request a new code and try again."); }
    finally { setBusy(false); }
  }

  return <div className="authWrap"><section className="loginCard"><div className="loginHeader"><span className="pill">Staff Portal</span><h1>Reset password</h1><p>We’ll send a one-time code to the email address on your staff account.</p></div>
    {!challengeId ? <form className="form" onSubmit={sendCode}><label className="inputGroup"><span className="label">Staff email address</span><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label><button className="btn btnWide" disabled={busy}>{busy ? "Sending…" : "Send verification code"}</button></form> : <form className="form" onSubmit={submitReset}><label className="inputGroup"><span className="label">6-digit email code</span><input className="input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} /></label><label className="inputGroup"><span className="label">New password</span><input className="input" type="password" minLength={8} autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label><label className="inputGroup"><span className="label">Confirm new password</span><input className="input" type="password" minLength={8} autoComplete="new-password" required value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></label><button className="btn btnWide" disabled={busy}>{busy ? "Updating…" : "Reset password"}</button><button className="btn btnGhost" type="button" disabled={busy} onClick={() => { setChallengeId(""); setMessage(""); }}>Send a new code</button></form>}
    {message && <p className="success">{message}</p>}{error && <div className="error">{error}</div>}<p className="loginFooter"><Link className="appBackAction" to="/admin/login"><svg aria-hidden="true" viewBox="0 0 20 20" focusable="false"><path d="M12.5 4.5 7 10l5.5 5.5M7.5 10h9" /></svg>Back to staff sign in</Link></p>
  </section></div>;
}
