import { useEffect, useMemo, useState, useCallback, useRef } from "react";
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

const REQUEST_STAFF_MFA_CODE = httpsCallable(
  functions,
  "requestStaffMfaCode"
);

const VERIFY_STAFF_MFA_CODE = httpsCallable(
  functions,
  "verifyStaffMfaCode"
);

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
  const codeInputRefs = useRef([]);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const autoRequested = useRef(false);

  const nextPath = useMemo(() => {
    const next = searchParams.get("next") || "";
    return next.startsWith("/admin") ? next : "";
  }, [searchParams]);

  const requireFreshAuthToken = useCallback(async () => {
    const user = currentUser || auth.currentUser;
    if (!user) {
      throw new Error(
        "Your login session is still loading. Please wait a moment and try again."
      );
    }
    await user.getIdToken(true);
    return user;
  }, [currentUser]);

  const requestCode = useCallback(async () => {
    setError("");
    setStatus("");

    try {
      setSending(true);
      await requireFreshAuthToken();

      const result = await REQUEST_STAFF_MFA_CODE();

      if (result.data?.required === false) {
        navigate(
          nextPath || getDefaultAdminPath(profile?.role),
          { replace: true }
        );
        return;
      }

      setChallengeId(result.data?.challengeId || "");
      setEmailHint(result.data?.emailHint || "your staff email");

      setStatus("A verification code has been sent to your email.");
    } catch (err) {
      console.error(err);
      setError(
        err?.message || "Could not send the verification code."
      );
    } finally {
      setSending(false);
    }
  }, [nextPath, profile?.role, navigate, requireFreshAuthToken]);

  useEffect(() => {
    let alive = true;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        if (alive) navigate("/admin/login", { replace: true });
        return;
      }

      if (alive) setCurrentUser(user);

      try {
        await user.reload();
        const freshUser = auth.currentUser || user;
        if (alive) setCurrentUser(freshUser);
        const snap = await getDoc(doc(db, "admins", freshUser.uid));

        if (!snap.exists()) {
          await signOut(auth);
          if (alive) navigate("/admin/login", { replace: true });
          return;
        }

        const nextProfile = getAdminProfile(snap.data());

        if (!alive) return;
        setProfile(nextProfile);

        if (!freshUser.emailVerified) {
          const targetPath = nextPath || getDefaultAdminPath(nextProfile.role);
          navigate(`/admin/verify-email?next=${encodeURIComponent(targetPath)}`, {
            replace: true,
          });
          return;
        }

        if (
          !requiresStaffMfa(nextProfile) ||
          hasFreshStaffMfa(nextProfile)
        ) {
          navigate(
            nextPath || getDefaultAdminPath(nextProfile.role),
            { replace: true }
          );
          return;
        }

       
        if (!autoRequested.current) {
          autoRequested.current = true;
          requestCode();
        }
      } catch (err) {
        console.error(err);
        if (alive) {
          setError("Could not load your staff security profile.");
        }
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [navigate, nextPath, requestCode]);

  function updateCodeDigit(index, value) {
    const digits = value.replace(/\D/g, "");
    if (digits.length > 1) {
      const pastedCode = digits.slice(0, 6).split("");
      setCode(pastedCode.join(""));
      codeInputRefs.current[Math.min(pastedCode.length, 5)]?.focus();
      return;
    }

    const nextCode = code.padEnd(6, " ").split("");
    nextCode[index] = digits;
    setCode(nextCode.join(""));
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

    if (!challengeId) {
      setError("Please request a verification code first.");
      return;
    }

    if (!/^\d{6}$/.test(code.trim())) {
      setError("Please enter the 6-digit verification code.");
      return;
    }

    try {
      setVerifying(true);

      await requireFreshAuthToken();

      await VERIFY_STAFF_MFA_CODE({
        challengeId,
        code: code.trim(),
      });

      const freshUser = auth.currentUser;
      if (freshUser) {
        await freshUser.getIdToken(true);
      }

      navigate(
        nextPath || getDefaultAdminPath(profile?.role),
        { replace: true }
      );
    } catch (err) {
      console.error(err);
      setError(
        err?.message || "Could not verify the code."
      );
    } finally {
      setVerifying(false);
    }
  }

  async function cancelLogin() {
    await signOut(auth);
    navigate("/admin/login", { replace: true });
  }

  if (loading) {
    return (
      <div className="authWrap">
        <div className="authCard">
          <p>Loading...</p>
        </div>
      </div>
    );
  }

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

          {status && (
            <div className="successBanner">
              {status}
            </div>
          )}

          {error && (
            <div className="error" id="verificationCodeError" role="alert">
              {error}
            </div>
          )}

          <button
            className="btn btnWide"
            type="submit"
            disabled={verifying}
          >
            {verifying ? "Verifying..." : "Verify Code"}
          </button>

          <button
            className="textButton"
            type="button"
            onClick={requestCode}
            disabled={sending}
          >
            {sending
              ? "Sending..."
              : "Didn't receive a code? Send again"}
          </button>

          <button
            className="cancelButton"
            type="button"
            onClick={cancelLogin}
          >
            Cancel
          </button>

        </form>
      </div>
    </div>
  );
}