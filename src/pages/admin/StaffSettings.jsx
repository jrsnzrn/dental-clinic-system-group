import { useEffect, useRef, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { Link } from "react-router-dom";
import { db, functions } from "../../firebase";
import { buildStaffProfile, getStaffTitle, staffProfileDraft } from "../../utils/staffProfile";
import { ROLE_LABELS } from "../../utils/rbac";
import SuccessDialog from "../../components/SuccessDialog";
import LoadingIndicator from "../../components/LoadingIndicator";

const UPDATE_PROFILE = httpsCallable(functions, "updateStaffProfile");
const EDITABLE_FIELDS = ["firstName", "middleName", "lastName", "age", "gender", "phone"];

export default function StaffSettings({ uid }) {
  const [profile, setProfile] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
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
  const update = (field, value) => setDraft(current => ({ ...current, [field]: value }));
  async function save(event) {
    event.preventDefault();
    if (submissionLock.current || !profile || !draft || !dirty || loadError) return;
    setError("");
    try {
      const fields = buildStaffProfile(draft, profile.role);
      submissionLock.current = true;
      setSaving(true);
      // The server derives the account ID and role from the signed-in staff member.
      const result = await UPDATE_PROFILE(Object.fromEntries(EDITABLE_FIELDS.map(field => [field, fields[field]])));
      const next = { ...profile, ...result.data };
      setProfile(next);
      setDraft(staffProfileDraft(next));
      setSuccess(`Your account details have been saved.${result.data?.authDisplayNameSynced === false ? " Contact the administrator if your sign-in display name stays out of date." : ""}`);
    } catch (failure) {
      setError(failure.message || "Your account details could not be saved. Please try again.");
    } finally {
      submissionLock.current = false;
      setSaving(false);
    }
  }

  return <div className="container adminSurface staffSettingsPage">
    <SuccessDialog message={success} onConfirm={() => setSuccess("")} />
    <header className="staffSettingsHeading"><span>Account</span><h1>Settings</h1><p>Keep your personal and contact details up to date.</p></header>
    {loadError ? <div className="formError" role="alert">{loadError} <button className="btn secondary" onClick={() => setRetry(value => value + 1)}>Try again</button></div> : null}
    {!draft || !profile ? !loadError ? <p role="status">Loading your account details…</p> : null : <>
      <section className="staffSettingsPanel" aria-labelledby="staff-settings-profile"><h2 id="staff-settings-profile">Personal details</h2><p>Your title updates automatically based on your role and gender.</p>
        <form onSubmit={save}>
          <fieldset disabled={saving || Boolean(loadError)} className="staffSettingsFields">
            {[["firstName", "First name"], ["middleName", "Middle name (optional)"], ["lastName", "Last name"]].map(([field, label]) => <label key={field}><span>{label}</span>
              <input className="input" required={field !== "middleName"} maxLength={80} autoComplete={field === "firstName" ? "given-name" : field === "lastName" ? "family-name" : "additional-name"}
                value={draft[field]} onChange={event => update(field, event.target.value)} /></label>)}
            <label><span>Age</span><input className="input" type="number" min="18" max="100" step="1" required value={draft.age} onChange={event => update("age", event.target.value)} /></label>
            <label><span>Gender</span><select className="input" value={draft.gender} required onChange={event => update("gender", event.target.value)}>
              <option value="">Select gender</option><option value="male">Male</option><option value="female">Female</option>
            </select></label>
            <div className="staffSettingsTitle"><span>Title</span><strong>{profile.role === "admin" || draft.gender ? getStaffTitle(profile.role, draft.gender) : "Choose gender first"}</strong></div>
            <label><span>Contact number (optional)</span><input className="input" type="tel" autoComplete="tel" maxLength={30} value={draft.phone} onChange={event => update("phone", event.target.value)} /></label>
          </fieldset>
          {error ? <div className="formError" role="alert">{error}</div> : null}
          <footer className="staffSettingsActions"><button className="btn btnShine" type="submit" disabled={saving || !dirty || Boolean(loadError)} aria-busy={saving}>
            {saving ? <LoadingIndicator>Saving details…</LoadingIndicator> : "Save changes"}</button>
            <button className="btn secondary" type="button" disabled={saving || !dirty} onClick={() => { setDraft(staffProfileDraft(profile)); setError(""); }}>Reset changes</button>
          </footer>
        </form>
      </section>
      <section className="staffSettingsPanel" aria-labelledby="staff-settings-signin"><h2 id="staff-settings-signin">Sign-in and access</h2>
        <dl className="staffSettingsFacts"><div><dt>Email address</dt><dd>{profile.email || "Not recorded"}</dd></div><div><dt>Account role</dt><dd>{ROLE_LABELS[profile.role] || "Staff"}</dd></div></dl>
        <p>Contact the administrator to change your sign-in email or account role.</p>
        <Link className="staffSettingsResetLink" to="/admin/forgot-password">Reset your password</Link>
      </section>
    </>}
  </div>;
}
