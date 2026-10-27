import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { useNavigate, useSearchParams } from "react-router-dom";
import { auth, db, functions } from "../../firebase";
import {
  getAdminProfile,
  getDefaultAdminPath,
  hasFreshStaffMfa,
  requiresStaffMfa,
} from "../../utils/rbac";

const REQUEST_EMAIL_VERIFICATION_CODE = httpsCallable(
  functions,
  "requestStaffEmailVerificationCode"
);
const VERIFY_EMAIL_VERIFICATION_CODE = httpsCallable(
  functions,
  "verifyStaffEmailVerificationCode"
);
const RESEND_COOLDOWN_SECONDS = 60;

function getVerifiedPath(profile, nextPath) {
  const destination = nextPath || getDefaultAdminPath(profile.role);
  if (requiresStaffMfa(profile) && !hasFreshStaffMfa(profile)) {
    return `/admin/mfa?next=${encodeURIComponent(destination)}`;
  }
  return destination;
}

function maskEmail(email = "") {
  return String(email).replace(/^(.{2}).*(@.*)$/, "$1***$2") || "your staff email";
}

function getVerificationErrorMessage(error, fallback) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  const normalizedMessage = message.toLowerCase();

  if (code.startsWith("app-check/") || normalizedMessage.includes("debug token")) {
    return "App Check rejected this development app. Register the debug token shown in the browser console in Firebase Console, then try again.";
  }
  if (code === "functions/unauthenticated") {
    return "Your sign-in session has expired. Sign in again to verify your email.";
  }
  if (code === "functions/permission-denied") {
    return "This staff account is not permitted to verify email. Contact an administrator if you think this is an error.";
  }
  if (code === "functions/resource-exhausted") {
    return message || "Too many requests. Wait before trying again.";
  }
  if (
    code === "functions/internal" &&
    message &&
    !["internal", "unknown error"].includes(normalizedMessage)
  ) {
    return message;
  }
  if (
    code === "functions/not-found" &&
    message &&
    !["not_found", "not found"].includes(normalizedMessage)
  ) {
    return message;
  }
  if (
    code === "functions/internal" ||
    code === "functions/unavailable" ||
    code === "functions/unknown" ||
    code === "functions/network-request-failed" ||
    (code === "functions/not-found" &&
      ["not_found", "not found"].includes(normalizedMessage)) ||
    normalizedMessage.includes("failed to fetch") ||
    normalizedMessage.includes("networkerror") ||
    normalizedMessage.includes("cors")
  ) {
    return "Could not reach the email verification service. Confirm both OTP callables are deployed in us-central1 and check their Firebase Functions logs. For local development, also register the App Check debug token.";
  }
  if (message) return message;
  return fallback;
}

function logVerificationError(context, error) {
  const message = String(error?.message || "").replace(/\b\d{6}\b/g, "[redacted]");
  console.error(context, {
    code: error?.code || "unknown",
    name: error?.name || "Error",
    message,
  });
}

export default function EmailVerification() {
  const [currentUser, setCurrentUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [emailHint, setEmailHint] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const codeInputRefs = useRef([]);
  const autoRequested = useRef(false);

  const nextPath = useMemo(() => {
    const next = searchParams.get("next") || "";
    return next.startsWith("/admin") ? next : "";
  }, [searchParams]);

  const continueAfterVerification = useCallback((verifiedProfile) => {
    navigate(getVerifiedPath(verifiedProfile, nextPath), { replace: true });
  }, [navigate, nextPath]);

  useEffect(() => {
    let alive = true;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        if (alive) navigate("/admin/login", { replace: true });
        return;
      }

      try {
        await user.reload();
        const freshUser = auth.currentUser || user;
        const snapshot = await getDoc(doc(db, "admins", freshUser.uid));
        if (!snapshot.exists()) {
          await signOut(auth);
          if (alive) navigate("/admin/login", { replace: true });
          return;
        }

        const nextProfile = getAdminProfile(snapshot.data());
        if (nextProfile.disabled) {
          await signOut(auth);
          if (alive) navigate("/admin/login", { replace: true });
          return;
        }

        if (!alive) return;
        if (freshUser.emailVerified) {
          continueAfterVerification(nextProfile);
          return;
        }

        setCurrentUser(freshUser);
        setProfile(nextProfile);
        setEmailHint(maskEmail(freshUser.email || ""));
        setLoading(false);
      } catch (verificationError) {
        console.error("Email verification status could not be loaded:", verificationError);
        if (alive) {
          setError("Could not check your email verification status. Please try again.");
          setLoading(false);
        }
      }
    });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [continueAfterVerification, navigate]);

  const requestCode = useCallback(async () => {
    const user = auth.currentUser || currentUser;
    if (!user || !profile) {
      setError("Your staff sign-in could not be found. Please sign in again.");
      return;
    }

    setError("");
    setStatus("");
    setSending(true);
    try {
      await user.getIdToken(true);
      const result = await REQUEST_EMAIL_VERIFICATION_CODE();
      if (result.data?.alreadyVerified) {
        await user.reload();
        continueAfterVerification(profile);
        return;
      }
      setEmailHint(result.data?.emailHint || maskEmail(user.email || ""));
      setCooldownSeconds(Number(result.data?.resendAfterSeconds) || RESEND_COOLDOWN_SECONDS);
      setStatus("A 6-digit verification code has been sent to your email.");
    } catch (requestError) {
      logVerificationError("Staff email verification code request failed:", requestError);
      if (requestError?.code === "functions/resource-exhausted") {
        const retryAfterSeconds = Number(requestError.details?.retryAfterSeconds);
        setCooldownSeconds(retryAfterSeconds > 0 ? retryAfterSeconds : RESEND_COOLDOWN_SECONDS);
      }
      setError(getVerificationErrorMessage(
        requestError,
        "Could not send a verification code. Please try again."
      ));
    } finally {
      setSending(false);
    }
  }, [continueAfterVerification, currentUser, profile]);

  useEffect(() => {
    if (!currentUser || !profile || autoRequested.current) return;
    autoRequested.current = true;
    requestCode();
  }, [currentUser, profile, requestCode]);

  useEffect(() => {
    if (cooldownSeconds <= 0) return undefined;
    const timer = window.setTimeout(
      () => setCooldownSeconds((seconds) => Math.max(0, seconds - 1)),
      1000
    );
    return () => window.clearTimeout(timer);
  }, [cooldownSeconds]);

  function updateCodeDigit(index, value) {
    const digits = value.replace(/\D/g, "");
    if (digits.length > 1) {
      const pastedCode = digits.slice(0, 6);
      setCode(pastedCode);
      codeInputRefs.current[Math.min(pastedCode.length, 5)]?.focus();
      return;
    }

    const nextCode = code.padEnd(6, " ").split("");
    nextCode[index] = digits || " ";
    setCode(nextCode.join("").trimEnd());
    if (digits && index < 5) codeInputRefs.current[index + 1]?.focus();
  }

  function handleCodeKeyDown(event, index) {
    if (event.key === "Backspace") {
      if (/\d/.test(code[index] || "")) {
        event.preventDefault();
        updateCodeDigit(index, "");
      } else if (index > 0) {
        event.preventDefault();
        updateCodeDigit(index - 1, "");
        codeInputRefs.current[index - 1]?.focus();
      }
    } else if (event.key === "ArrowLeft" && index > 0) {
      codeInputRefs.current[index - 1]?.focus();
    } else if (event.key === "ArrowRight" && index < 5) {
      codeInputRefs.current[index + 1]?.focus();
    }
  }

  function handleCodePaste(event) {
    const pastedCode = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pastedCode) return;
    event.preventDefault();
    setCode(pastedCode);
    codeInputRefs.current[Math.min(pastedCode.length, 5)]?.focus();
  }

  async function verifyCode(event) {
    event.preventDefault();
    setError("");
    setStatus("");

    if (!/^\d{6}$/.test(code.trim())) {
      setError("Please enter the 6-digit verification code.");
      return;
    }

    const user = auth.currentUser || currentUser;
    if (!user || !profile) {
      setError("Your staff sign-in could not be found. Please sign in again.");
      return;
    }

    try {
      setVerifying(true);
      await user.getIdToken(true);
      await VERIFY_EMAIL_VERIFICATION_CODE({ code: code.trim() });
      await user.reload();
      const freshUser = auth.currentUser || user;
      if (!freshUser.emailVerified) {
        throw new Error("Email verification could not be confirmed. Please try again.");
      }
      await freshUser.getIdToken(true);
      setStatus("Your email has been verified.");
      continueAfterVerification(profile);
    } catch (verificationError) {
      logVerificationError("Staff email verification failed:", verificationError);
      setError(getVerificationErrorMessage(
        verificationError,
        "Could not verify the code. Please try again."
      ));
    } finally {
      setVerifying(false);
    }
  }

  async function cancelLogin() {
    try {
      await signOut(auth);
      navigate("/admin/login", { replace: true });
    } catch (signOutError) {
      console.error("Could not cancel staff verification:", signOutError);
      setError(signOutError?.message || "Could not cancel sign-in. Please try again.");
    }
  }

  if (loading) {
    return (
      <div className="authWrap">
        <div className="authCard verificationCard">
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  const resendLabel = sending
    ? "Sending..."
    : cooldownSeconds > 0
      ? `Resend Code in ${Math.floor(cooldownSeconds / 60)}:${String(cooldownSeconds % 60).padStart(2, "0")}`
      : "Didn't receive a code? Resend Code";

  return (
    <div className="authWrap">
      <div className="authCard verificationCard">
        <div className="verificationHeader">
          <h2>Verify Your Email</h2>
          <p>We sent a 6-digit verification code to</p>
          <strong>{emailHint || "your staff email"}</strong>
        </div>

        <form onSubmit={verifyCode} className="verificationForm">
          <div className="inputGroup">
            <label id="verificationCodeLabel">Verification Code</label>
            <div
              className="verificationDigits"
              role="group"
              aria-labelledby="verificationCodeLabel"
              aria-describedby={error ? "verificationCodeError" : undefined}
            >
              {Array.from({ length: 6 }, (_, index) => (
                <input
                  key={index}
                  ref={(element) => { codeInputRefs.current[index] = element; }}
                  className="verificationDigit"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  aria-label={`Digit ${index + 1} of 6`}
                  aria-invalid={Boolean(error)}
                  value={/\d/.test(code[index] || "") ? code[index] : ""}
                  onChange={(event) => updateCodeDigit(index, event.target.value)}
                  onKeyDown={(event) => handleCodeKeyDown(event, index)}
                  onPaste={handleCodePaste}
                  autoComplete={index === 0 ? "one-time-code" : "off"}
                  autoFocus={index === 0}
                  disabled={verifying}
                />
              ))}
            </div>
          </div>

          {status ? <div className="successBanner" role="status">{status}</div> : null}
          {error ? <div className="error" id="verificationCodeError" role="alert">{error}</div> : null}

          <button className="btn btnWide" type="submit" disabled={verifying || sending}>
            {verifying ? "Verifying..." : "Verify Code"}
          </button>
          <button
            className="textButton"
            type="button"
            onClick={requestCode}
            disabled={sending || verifying || cooldownSeconds > 0}
          >
            {resendLabel}
          </button>
          <button className="cancelButton" type="button" onClick={cancelLogin} disabled={sending || verifying}>
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}
