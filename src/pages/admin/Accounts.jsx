import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { db, functions } from "../../firebase";
import { ROLE_LABELS, ROLES } from "../../utils/rbac";
import { formatTimestamp } from "../../utils/schedule";

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
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    const logsQuery = query(collection(db, "auditLogs"), orderBy("createdAt", "desc"), limit(40));
    const unsubscribe = onSnapshot(logsQuery, (snapshot) => {
      setLogs(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    });

    return () => unsubscribe();
  }, []);

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

      <div className="card adminRecordsCard" style={{ marginTop: 18 }}>
        <div className="cardHeader">
          <div>
            <h3 className="title">Activity Log</h3>
            <p className="sub">Review the latest staff actions across bookings, patients, dentists, archive activity, and account creation.</p>
          </div>
          <span className="badge">{logs.length} entries</span>
        </div>

        {logs.length ? (
          <ul className="list detailedList auditLogList">
            {logs.map((log) => (
              <li key={log.id} className="item detailedItem bookingShowcase">
                <div className="detailContent">
                  <div className="detailTopRow">
                    <div>
                      <strong className="detailTitle">{log.actorName || log.actorEmail || "Staff"}</strong>
                      <p className="detailSubtitle">
                        {(log.actorRole || "staff").toUpperCase()} • {formatTimestamp(log.createdAt)}
                      </p>
                    </div>
                    <span className="badge">{String(log.action || "").replaceAll("_", " ")}</span>
                  </div>

                  <div className="detailNote historyPanel">
                    <span className="detailLabel">Target</span>
                    <p>
                      <strong>{log.targetLabel || log.targetType || "Record"}</strong>
                    </p>
                    <p>{log.targetType ? `Type: ${log.targetType}` : "No target type recorded."}</p>
                  </div>

                  {log.details && Object.keys(log.details).length ? (
                    <div className="detailNote historyPanel" style={{ marginTop: 12 }}>
                      <span className="detailLabel">Details</span>
                      <div className="auditDetails">
                        {Object.entries(log.details).map(([key, value]) => (
                          <div key={key} className="auditDetailRow">
                            <strong>{key}</strong>
                            <span>{Array.isArray(value) ? value.join(", ") : String(value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="emptyEditorState">No audit entries yet.</div>
        )}
      </div>
    </div>
  );
}
