import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../../firebase";
import { getAuditActionLabel } from "../../utils/audit";
import { formatTimestamp } from "../../utils/schedule";

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

export default function Logs() {
  const [logs, setLogs] = useState([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const logsQuery = query(collection(db, "auditLogs"), orderBy("createdAt", "desc"), limit(80));
    const unsubscribe = onSnapshot(logsQuery, (snapshot) => {
      setLogs(
        snapshot.docs.map((entry) => ({
          id: entry.id,
          ...entry.data(),
          actionLabel: getAuditActionLabel(entry.data().action),
        }))
      );
    });

    return () => unsubscribe();
  }, []);

  const filteredLogs = useMemo(() => {
    const term = normalizeText(search);
    if (!term) return logs;

    return logs.filter((log) =>
      [
        log.actorName,
        log.actorEmail,
        log.actorRole,
        log.actionLabel,
        log.targetLabel,
        log.targetType,
      ].some((value) => normalizeText(value).includes(term))
    );
  }, [logs, search]);

  return (
    <div className="container adminSurface">
      <div className="hero adminHero">
        <div className="adminHeroGlow" />
        <div className="adminHeroContent">
          <span className="heroEyebrow">Audit Center</span>
          <h1>Activity Logs</h1>
          <p>Review the latest staff actions across bookings, patients, dentists, archive activity, and account management from one dedicated page.</p>
        </div>
      </div>

      <div className="card adminEditorCard" style={{ marginTop: 18 }}>
        <div className="cardHeader">
          <div>
            <h3 className="title">Search Activity Log</h3>
            <p className="sub">Search by staff name, role, action, or target record to find the exact update faster.</p>
          </div>
          <span className="badge">{filteredLogs.length} entries</span>
        </div>

        <div className="patientSearchSpotlight">
          <div className="patientSearchHeader">
            <div>
              <span className="patientSearchEyebrow">Log Search</span>
              <p className="patientSearchHint">Type a role, name, action, or target record to filter the audit trail.</p>
            </div>
            <span className="patientSearchCount">{search ? "Filtered log view" : "Ready to search"}</span>
          </div>

          <div className="patientSearchRow">
            <input
              className="input searchInput patientSearchInput"
              placeholder="Search activity log"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            {search ? (
              <button type="button" className="searchClearBtn" onClick={() => setSearch("")}>
                Clear
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="card adminRecordsCard" style={{ marginTop: 18 }}>
        <div className="cardHeader">
          <div>
            <h3 className="title">Full Audit Log</h3>
            <p className="sub">Every logged staff action appears here once Firestore rules allow the `auditLogs` collection.</p>
          </div>
        </div>

        {filteredLogs.length ? (
          <ul className="list detailedList auditLogList">
            {filteredLogs.map((log) => (
              <li key={log.id} className="item detailedItem bookingShowcase">
                <div className="detailContent">
                  <div className="detailTopRow">
                    <div>
                      <strong className="detailTitle">{log.actorName || log.actorEmail || "Staff"}</strong>
                      <p className="detailSubtitle">
                        {(log.actorRole || "staff").toUpperCase()} • {formatTimestamp(log.createdAt)}
                      </p>
                    </div>
                    <span className="badge">{log.actionLabel}</span>
                  </div>

                  <div className="detailGrid">
                    <div className="detailBox luxeBox">
                      <span className="detailLabel">Target</span>
                      <strong>{log.targetLabel || log.targetType || "Record"}</strong>
                    </div>
                    <div className="detailBox luxeBox">
                      <span className="detailLabel">Type</span>
                      <strong>{log.targetType || "Not recorded"}</strong>
                    </div>
                    <div className="detailBox luxeBox">
                      <span className="detailLabel">Actor email</span>
                      <strong>{log.actorEmail || "No email recorded"}</strong>
                    </div>
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
          <div className="emptyEditorState">
            <strong>No audit entries yet</strong>
            <p>Once your Firestore rules allow `auditLogs`, every staff action will appear here in one dedicated page.</p>
          </div>
        )}
      </div>
    </div>
  );
}
