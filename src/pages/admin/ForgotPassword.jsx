import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../firebase";
import BackArrow from "../../components/BackArrow";

const requestResetCode = httpsCallable(functions, "requestStaffPasswordResetCode");
const resetPassword = httpsCallable(functions, "resetStaffPasswordWithCode");

export default function ForgotPassword() {
  const navigate = useNavigate();
  const returnButtonRef = useRef(null);
  const [resetComplete, setResetComplete] = useState(false);
  const [email, setEmail] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!resetComplete) return;
    returnButtonRef.current?.focus();
    function onKeyDown(event) {
      if (event.key === "Escape") navigate("/admin/login", { replace: true });
      if (event.key === "Tab") {
        event.preventDefault();
        returnButtonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [resetComplete, navigate]);

  async function sendCode(event) {
    if (busy || resetComplete) { event.preventDefault(); return; }
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const result = await requestResetCode({ email: email.trim().toLowerCase() });
      setChallengeId(result.data?.challengeId || "");
      setMessage("If this email belongs to an active staff account, a verification code has been sent. Check your inbox and spam folder.");
    } catch (requestError) { setError(requestError.message || "Could not send a recovery code. Try again shortly."); }
    finally { setBusy(false); }
  }

  async function submitReset(event) {
    if (busy || resetComplete) { event.preventDefault(); return; }
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    if (password.length < 8) { setError("Use a password with at least 8 characters."); setBusy(false); return; }
    if (password !== confirmation) { setError("The passwords do not match."); setBusy(false); return; }
    try {
      await resetPassword({ email: email.trim().toLowerCase(), challengeId, code: code.trim(), newPassword: password });
      setResetComplete(true);
      setChallengeId(""); setCode(""); setPassword(""); setConfirmation("");
    } catch (resetError) { setError(resetError.message || "The code could not be verified. Request a new code and try again."); }
    finally { setBusy(false); }
  }

  return <div className="authWrap"><section className="loginCard" inert={resetComplete ? true : undefined}><div className="loginHeader"><span className="pill">Staff Portal</span><h1>Reset password</h1><p>We’ll send a one-time code to the email address on your staff account.</p></div>
    {!resetComplete && (!challengeId ? <form className="form" onSubmit={sendCode}><label className="inputGroup"><span className="label">Staff email address</span><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label><button className="btn btnWide" disabled={busy}>{busy ? "Sending…" : "Send verification code"}</button></form> : <form className="form" onSubmit={submitReset}><label className="inputGroup"><span className="label">6-digit email code</span><input className="input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} /></label><label className="inputGroup"><span className="label">New password</span><input className="input" type="password" minLength={8} autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label><label className="inputGroup"><span className="label">Confirm new password</span><input className="input" type="password" minLength={8} autoComplete="new-password" required value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></label><button className="btn btnWide" disabled={busy}>{busy ? "Updating…" : "Reset password"}</button><button className="btn btnGhost" type="button" disabled={busy} onClick={() => { setChallengeId(""); setMessage(""); }}>Send a new code</button></form>)}
    {message && <p className="success">{message}</p>}{error && <div className="error">{error}</div>}<p className="loginFooter"><Link className="appBackAction topdentBackAction" aria-label="Go back" to="/admin/login"><BackArrow /></Link></p>
  </section>
    {resetComplete ? (
      <div className="modalOverlay">
        <section className="modalCard confirmModalCard" role="dialog" aria-modal="true"
          aria-labelledby="password-reset-title" aria-describedby="password-reset-message">
          <div className="modalHeader"><h3 id="password-reset-title">Password updated</h3></div>
          <div className="confirmModalBody"><p id="password-reset-message">Your password has been updated. You can now sign in with your new password.</p></div>
          <div className="confirmModalActions">
            <button ref={returnButtonRef} type="button" className="btn btnShine"
              onClick={() => navigate("/admin/login", { replace: true })}>Back to staff sign in</button>
          </div>
        </section>
      </div>
    ) : null}
  </div>;
}
