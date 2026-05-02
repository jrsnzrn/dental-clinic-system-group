import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { useNavigate, useSearchParams } from "react-router-dom";
import { auth, db, functions } from "../../firebase";
import { getAdminProfile, getDefaultAdminPath, hasFreshStaffMfa, requiresStaffMfa } from "../../utils/rbac";

const REQUEST_STAFF_MFA_CODE = httpsCallable(functions, "requestStaffMfaCode");
const VERIFY_STAFF_MFA_CODE = httpsCallable(functions, "verifyStaffMfaCode");

export default function Mfa() {
  const [profile, setProfile] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [challengeId, setChallengeId] = useState("");
  const [emailHint, setEmailHint] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const nextPath = useMemo(() => {
    const next = searchParams.get("next") || "";
    return next.startsWith("/admin") ? next : "";
  }, [searchParams]);

  useEffect(() => {
    let alive = true;
    let unsubscribe = () => {};

    async function loadProfile(user) {
      if (!user) {
        navigate("/admin/login", { replace: true });
        return;
      }

      try {
        const snap = await getDoc(doc(db, "admins", user.uid));
        if (!snap.exists()) {
          await signOut(auth);
          navigate("/admin/login", { replace: true });
          return;
        }

        const nextProfile = getAdminProfile(snap.data());
        if (!alive) return;
        setProfile(nextProfile);

        if (!requiresStaffMfa(nextProfile) || hasFreshStaffMfa(nextProfile)) {
          navigate(nextPath || getDefaultAdminPath(nextProfile.role), { replace: true });
        }
      } catch (err) {
        console.error(err);
        if (alive) setError("Could not load your staff security profile.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    unsubscribe = onAuthStateChanged(auth, (user) => {
      if (alive) setCurrentUser(user);
      loadProfile(user);
    });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [navigate, nextPath]);

  async function requireFreshAuthToken() {
    const user = currentUser || auth.currentUser;
    if (!user) {
      throw new Error("Your login session is still loading. Please wait a moment and try again.");
    }

    await user.getIdToken(true);
    return user;
  }

  async function requestCode() {
    setError("");
    setStatus("");

    try {
      setSending(true);
      await requireFreshAuthToken();
      const result = await REQUEST_STAFF_MFA_CODE();
      if (result.data?.required === false) {
        navigate(nextPath || getDefaultAdminPath(profile?.role), { replace: true });
        return;
      }

      setChallengeId(result.data?.challengeId || "");
      setEmailHint(result.data?.emailHint || "your staff email");
      setStatus("Verification code sent. Check your staff email.");
    } catch (err) {
      console.error(err);
      setError(err?.message || "Could not send the verification code.");
    } finally {
      setSending(false);
    }
  }

  async function verifyCode(event) {
    event.preventDefault();
    setError("");
    setStatus("");

    if (!challengeId) {
      setError("Request a verification code first.");
      return;
    }

    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the 6-digit code from your staff email.");
      return;
    }

    try {
      setVerifying(true);
      await requireFreshAuthToken();
      await VERIFY_STAFF_MFA_CODE({
        challengeId,
        code: code.trim(),
      });
      navigate(nextPath || getDefaultAdminPath(profile?.role), { replace: true });
    } catch (err) {
      console.error(err);
      setError(err?.message || "Could not verify that code.");
    } finally {
      setVerifying(false);
    }
  }

  async function cancelLogin() {
    await signOut(auth);
    navigate("/admin/login", { replace: true });
  }

  if (loading) {
    return <div style={{ padding: 20 }}>Loading security check...</div>;
  }

  return (
    <div className="authWrap">
      <div className="authCard roleAuthCard">
        <div className="authHeader">
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span className="pill">Staff MFA</span>
            <span className="pill">{profile?.role || "staff"}</span>
          </div>
          <h2 className="authTitle">Verify Staff Access</h2>
          <p className="authSub">
            Enter the one-time code sent to your staff email before opening the admin workspace.
          </p>
        </div>

        <div className="detailNote historyPanel selectedToothPanel">
          <span className="detailLabel">Verification email</span>
          <p>{emailHint || "Request a code to continue."}</p>
        </div>

        <form className="authGrid" onSubmit={verifyCode}>
          <button className="btn secondary btnSoft" type="button" onClick={requestCode} disabled={sending}>
            {sending ? "Sending..." : challengeId ? "Send New Code" : "Send Verification Code"}
          </button>

          <div className="inputGroup">
            <div className="label">Verification Code</div>
            <div className="inputIconRow">
              <div className="inputIcon">#</div>
              <input
                className="inputPlain"
                inputMode="numeric"
                maxLength={6}
                placeholder="6-digit code"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                autoComplete="one-time-code"
              />
            </div>
          </div>

          <button className="btn btnWide" type="submit" disabled={verifying}>
            {verifying ? "Verifying..." : "Verify and Continue"}
          </button>

          <button className="btn secondary btnSoft" type="button" onClick={cancelLogin}>
            Cancel Login
          </button>

          {status ? <div className="successBanner">{status}</div> : null}
          {error ? <div className="error">{error}</div> : null}
        </form>
      </div>
    </div>
  );
}
