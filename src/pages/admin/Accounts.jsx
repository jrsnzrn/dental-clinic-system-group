import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../firebase";
import { ROLE_LABELS, ROLES } from "../../utils/rbac";

const CREATE_STAFF = httpsCallable(functions, "createStaffAccount");

function emptyDraft() {
  return {
    name: "",
    email: "",
    password: "",
    role: ROLES.RECEPTIONIST,
  };
}

export default function Accounts() {
  const [draft, setDraft] = useState(emptyDraft());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [created, setCreated] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setCreated(null);

    if (!draft.name.trim() || !draft.email.trim() || !draft.password.trim()) {
      setError("Complete the staff name, email, password, and role first.");
      return;
    }

    try {
      setSubmitting(true);
      const result = await CREATE_STAFF({
        name: draft.name.trim(),
        email: draft.email.trim(),
        password: draft.password,
        role: draft.role,
      });

      setCreated(result.data || null);
      setSuccess(`${ROLE_LABELS[draft.role]} account created successfully.`);
      setDraft(emptyDraft());
    } catch (err) {
      setError(err?.message || "Could not create the staff account.");
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="container adminSurface">
      <div className="hero adminHero">
        <div className="adminHeroGlow" />
        <div className="adminHeroContent">
          <span className="heroEyebrow">Security Control</span>
          <h1>Staff Accounts</h1>
          <p>Create receptionist, dentist, and additional administrator accounts securely from inside the system instead of manually editing Firestore.</p>
        </div>
      </div>

      <div className="card adminEditorCard" style={{ marginTop: 18 }}>
        <div className="cardHeader">
          <div>
            <h3 className="title">Create Staff Account</h3>
            <p className="sub">This form creates the Firebase Authentication login and the matching `admins/{'{uid}'}` role record through a protected backend function.</p>
          </div>
          <span className="badge">Admin Only</span>
        </div>

        <form className="form" onSubmit={handleSubmit}>
          <input
            className="input"
            placeholder="Full name"
            value={draft.name}
            onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value }))}
          />

          <input
            className="input"
            type="email"
            placeholder="staff@topdent.com"
            value={draft.email}
            onChange={(e) => setDraft((current) => ({ ...current, email: e.target.value }))}
          />

          <input
            className="input"
            type="password"
            placeholder="Temporary password"
            value={draft.password}
            onChange={(e) => setDraft((current) => ({ ...current, password: e.target.value }))}
          />

          <select
            className="input"
            value={draft.role}
            onChange={(e) => setDraft((current) => ({ ...current, role: e.target.value }))}
          >
            <option value={ROLES.RECEPTIONIST}>{ROLE_LABELS[ROLES.RECEPTIONIST]}</option>
            <option value={ROLES.DENTIST}>{ROLE_LABELS[ROLES.DENTIST]}</option>
            <option value={ROLES.ADMIN}>{ROLE_LABELS[ROLES.ADMIN]}</option>
          </select>

          <button className="btn btnShine" type="submit" disabled={submitting}>
            {submitting ? "Creating Account..." : "Create Staff Account"}
          </button>
        </form>

        {error ? <div className="error" style={{ marginTop: 12 }}>{error}</div> : null}
        {success ? <div className="successBanner" style={{ marginTop: 12 }}>{success}</div> : null}

        {created ? (
          <div className="detailNote historyPanel selectedToothPanel" style={{ marginTop: 14 }}>
            <span className="detailLabel">Latest created account</span>
            <p><strong>{created.name}</strong> {" - "} {created.email}</p>
            <p>Role: {ROLE_LABELS[created.role] || created.role}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
