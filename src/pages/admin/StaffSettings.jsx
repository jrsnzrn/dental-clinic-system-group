import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { db, functions } from "../../firebase";
import { buildStaffProfile, formatStaffDisplayName, getStaffTitle, staffProfileDraft, needsStaffProfileSetup } from "../../utils/staffProfile";
import { getDefaultAdminPath, ROLE_LABELS } from "../../utils/rbac";
import SuccessDialog from "../../components/SuccessDialog";
import LoadingIndicator from "../../components/LoadingIndicator";
import BackArrow from "../../components/BackArrow";

const UPDATE_PROFILE = httpsCallable(functions, "updateStaffProfile");
const EDITABLE_FIELDS = ["firstName", "middleName", "lastName", "nickname", "age", "gender", "phone"];

export default function StaffSettings({ uid }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [profile, setProfile] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [completedSetup, setCompletedSetup] = useState(false);
  const [retry, setRetry] = useState(0);
  const submissionLock = useRef(false);
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(doc(db, "admins", uid), snapshot => {
      if (!snapshot.exists()) { setLoadError("Your staff profile could not be found. Contact the administrator."); return; }
      const nextProfile = snapshot.data();
      setProfile(nextProfile);
      setDraft(current => current || staffProfileDraft(nextProfile));
      setLoadError("");
    }, () => setLoadError("Your account details could not be loaded. Please try again."));
  }, [uid, retry]);

  const original = profile ? staffProfileDraft(profile) : {};
  const dirty = draft && EDITABLE_FIELDS.some(field => String(draft[field] ?? "").trim() !== String(original[field] ?? "").trim());
  const setupRequired = profile ? needsStaffProfileSetup(profile, uid) : false;
  const update = (field, value) => setDraft(current => ({ ...current, [field]: value }));
  async function save(event) {
    event.preventDefault();
    if (submissionLock.current || !profile || !draft || (!dirty && !setupRequired) || loadError) return;
    setError("");
    try {
      const fields = buildStaffProfile(draft, profile.role);
      submissionLock.current = true;
      flushSync(() => setSaving(true));
      // The server derives the account ID and role from the signed-in staff member.
      const result = await UPDATE_PROFILE(Object.fromEntries(EDITABLE_FIELDS.map(field => [field, fields[field]])));
      const next = { ...profile, ...result.data };
      setProfile(next);
      setDraft(staffProfileDraft(next));
      setCompletedSetup(setupRequired);
      setSuccess(`${setupRequired ? "Your profile setup is complete. You can now use the staff portal." : "Your account details have been saved."}${result.data?.authDisplayNameSynced === false ? " Contact the administrator if your sign-in display name stays out of date." : ""}`);
    } catch (failure) {
      setError(failure.message || "Your account details could not be saved. Please try again.");
    } finally {
      submissionLock.current = false;
      setSaving(false);
    }
  }

  return <div className="container adminSurface staffSettingsPage">
    <SuccessDialog message={success} onConfirm={() => {
      setSuccess("");
      setCompletedSetup(false);
      if (completedSetup) navigate(getDefaultAdminPath(profile.role), { replace: true });
    }} />
    {!setupRequired ? <button className="appBackAction topdentBackAction staffSettingsBack" type="button" disabled={saving || !profile} onClick={() => {
      const from = location.state?.from;
      navigate(typeof from === "string" && from.startsWith("/admin/") && !from.startsWith("/admin/settings") ? from : getDefaultAdminPath(profile.role));
    }}><BackArrow /><span>Back</span></button> : null}
    <header className="staffSettingsHeading"><span>Account</span><h1>Settings</h1><p>Keep your personal and contact details up to date.</p></header>
    {setupRequired ? <div className="staffProfileSetupNotice" role="status"><strong>Complete your profile to continue</strong><p>Review your name, enter your nickname, age, and gender, then select Save and continue. Middle name and contact number are optional.</p></div> : null}
    {loadError ? <div className="formError" role="alert">{loadError} <button className="btn secondary" onClick={() => setRetry(value => value + 1)}>Try again</button></div> : null}
    {!draft || !profile ? !loadError ? <p><LoadingIndicator>Loading your account details…</LoadingIndicator></p> : null : <>
      <section className="staffSettingsPanel" aria-labelledby="staff-settings-profile"><h2 id="staff-settings-profile">Personal details</h2><p>Your title updates automatically based on your role and gender.</p>
        <form onSubmit={save} aria-busy={saving}>
          <fieldset disabled={saving || Boolean(loadError)} className="staffSettingsFields">
            {[["firstName", "First name"], ["middleName", "Middle name (optional)"], ["lastName", "Last name"]].map(([field, label]) => <label key={field}><span>{label}</span>
              <input className="input" required={field !== "middleName"} maxLength={80} autoComplete={field === "firstName" ? "given-name" : field === "lastName" ? "family-name" : "additional-name"}
                value={draft[field]} onChange={event => update(field, event.target.value)} /></label>)}
            <label><span>Nickname{profile.role === "admin" ? " (optional)" : ""}</span><input className="input" autoComplete="nickname" maxLength={40} required={profile.role !== "admin"} value={draft.nickname} onChange={event => update("nickname", event.target.value)} /><small className="staffNicknameHint">Shown in booking and your account menu instead of your full name.</small></label>
            <div className="staffSettingsTitle"><span>Display name</span><strong>{formatStaffDisplayName({ ...draft, role: profile.role })}</strong></div>
            <label><span>Age</span><input className="input" type="number" min="18" max="100" step="1" required value={draft.age} onChange={event => update("age", event.target.value)} /></label>
            <label><span>Gender</span><select className="input" value={draft.gender} required onChange={event => update("gender", event.target.value)}>
              <option value="">Select gender</option><option value="male">Male</option><option value="female">Female</option>
            </select></label>
            <div className="staffSettingsTitle"><span>Title</span><strong>{profile.role === "admin" || draft.gender ? getStaffTitle(profile.role, draft.gender) : "Choose gender first"}</strong></div>
            <label><span>Contact number (optional)</span><input className="input" type="tel" autoComplete="tel" maxLength={30} value={draft.phone} onChange={event => update("phone", event.target.value)} /></label>
          </fieldset>
          {error ? <div className="formError" role="alert">{error}</div> : null}
          <footer className="staffSettingsActions">
            {saving ? <div className="staffSettingsSaveProgress"><LoadingIndicator>Saving your account details…</LoadingIndicator><p>Please wait while your changes are saved.</p><div className="staffSettingsProgressTrack" aria-hidden="true"><span /></div></div> : null}
            <div className="staffSettingsActionButtons"><button className="btn btnShine" type="submit" disabled={saving || (!dirty && !setupRequired) || Boolean(loadError)} aria-busy={saving}>
              {saving ? <LoadingIndicator>Saving…</LoadingIndicator> : setupRequired ? "Save and continue" : "Save changes"}</button>
              <button className="btn secondary" type="button" disabled={saving || !dirty} onClick={() => { setDraft(staffProfileDraft(profile)); setError(""); }}>Reset changes</button>
            </div>
          </footer>
        </form>
      </section>
      <section className="staffSettingsPanel staffSettingsSecurity" aria-labelledby="staff-settings-signin">
        <header className="staffSettingsSecurityHeader"><span className="staffSettingsSecurityIcon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></svg></span>
          <div><h2 id="staff-settings-signin">Sign-in and access</h2><p>Your login details and password settings.</p></div>
        </header>
        <dl className="staffSettingsFacts staffSettingsSecurityFacts">
          <div><dt>Sign-in email</dt><dd>{profile.email || "Not recorded"}</dd><span className="staffSettingsManagedBadge">Managed by admin</span></div>
          <div><dt>Account role</dt><dd><span className="staffSettingsRoleBadge">{ROLE_LABELS[profile.role] || "Staff"}</span></dd><span className="staffSettingsManagedBadge">Managed by admin</span></div>
        </dl>
        <p className="staffSettingsAccessNotice">Only the administrator can change your sign-in email or account role.</p>
        <div className="staffSettingsPasswordCard"><span className="staffSettingsPasswordIcon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="9" r="5" /><path d="m11.5 12.5 8 8 2-2-2-2 1.5-1.5-2-2-1.5 1.5-2.5-2.5" /></svg></span>
          <div><h3>Password</h3><p>Reset your password with a verification code sent to your staff email.</p></div>
          <Link className="btn btnShine staffSettingsPasswordButton" to="/admin/forgot-password" onClick={event => { if (saving) event.preventDefault(); }} aria-disabled={saving}>
            Reset password <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>
    </>}
  </div>;
}
