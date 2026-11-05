import LoadingIndicator from "./LoadingIndicator";
import { useEffect, useRef, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { useLocation, useNavigate } from "react-router-dom";
import { db } from "../firebase";
import { formatStaffDisplayName, needsStaffProfileSetup } from "../utils/staffProfile";

function RequiredProfilePrompt({ profile }) {
  const dialogRef = useRef(null);
  const navigate = useNavigate();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog.open) dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);
  return <dialog ref={dialogRef} className="staffProfileRequiredDialog" aria-labelledby="staff-profile-required-title"
    aria-describedby="staff-profile-required-description" onCancel={event => event.preventDefault()}>
    <span className="staffProfileRequiredBadge">One-time setup</span>
    <p className="staffProfileRequiredWelcome">Welcome{formatStaffDisplayName(profile) ? `, ${formatStaffDisplayName(profile)}` : ""}</p>
    <h1 id="staff-profile-required-title">Complete your staff profile</h1>
    <p id="staff-profile-required-description">Before using the staff portal, please review and save your personal information.</p>
    <ol className="staffProfileRequiredSteps">
      <li><span aria-hidden="true">1</span><div><strong>Review your name</strong><p>Confirm your first, middle, and last name.</p></div></li>
      <li><span aria-hidden="true">2</span><div><strong>Choose your display name</strong><p>Enter your nickname, age, and gender. Your title is set automatically.</p></div></li>
      <li><span aria-hidden="true">3</span><div><strong>Save and continue</strong><p>You only need to complete this setup once.</p></div></li>
    </ol>
    <button type="button" className="btn btnShine" autoFocus onClick={() => navigate("/admin/settings", { replace: true })}>Update my information <span aria-hidden="true">→</span></button>
  </dialog>;
}

export default function StaffProfileSetupGate({ user, children }) {
  const [state, setState] = useState({});
  const [retry, setRetry] = useState(0);
  const location = useLocation();
  useEffect(() => {
    if (!user?.uid) return;
    return onSnapshot(doc(db, "admins", user.uid), snapshot => setState({ uid: user.uid, profile: snapshot.data(), error: snapshot.exists() ? "" : "Your staff profile could not be found." }),
      () => setState({ uid: user.uid, error: "Your staff profile could not be checked. Please try again." }));
  }, [user?.uid, retry]);
  if (state.uid !== user?.uid) return <div className="sessionLoading"><LoadingIndicator>Checking your staff profile…</LoadingIndicator></div>;
  if (state.error) return <div className="container"><p className="formError" role="alert">{state.error}</p><button className="btn secondary" type="button" onClick={() => setRetry(value => value + 1)}>Try again</button></div>;
  const required = needsStaffProfileSetup(state.profile, user?.uid);
  // This single gate wraps every protected staff page, including direct URLs.
  if (required && location.pathname.replace(/\/+$/, "") !== "/admin/settings") return <RequiredProfilePrompt profile={state.profile} />;
  return children;
}
