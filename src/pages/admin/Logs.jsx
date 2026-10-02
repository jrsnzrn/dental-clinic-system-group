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
  const [roleFilter, setRoleFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [targetFilter, setTargetFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");

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
    return logs.filter((log) => {
      const matchesSearch =
        !term ||
        [
          log.actorName,
          log.actorEmail,
          log.actorRole,
          log.actionLabel,
          log.targetLabel,
          log.targetType,
        ].some((value) => normalizeText(value).includes(term));

      const matchesRole = !roleFilter || normalizeText(log.actorRole) === normalizeText(roleFilter);
      const matchesAction = !actionFilter || normalizeText(log.action) === normalizeText(actionFilter);
      const matchesTarget = !targetFilter || normalizeText(log.targetType) === normalizeText(targetFilter);
      const matchesDate =
        !dateFilter ||
        (log.createdAt?.toDate?.().toISOString().slice(0, 10) || "") === dateFilter;

      return matchesSearch && matchesRole && matchesAction && matchesTarget && matchesDate;
    });
  }, [actionFilter, dateFilter, logs, roleFilter, search, targetFilter]);

  const actionOptions = useMemo(
    () => [...new Set(logs.map((log) => log.action).filter(Boolean))].sort(),
    [logs]
  );
  const targetOptions = useMemo(
    () => [...new Set(logs.map((log) => log.targetType).filter(Boolean))].sort(),
    [logs]
  );

  return (
    <div className="container adminSurface">
      <div className="auditHeader">
        <div>
          <span className="heroEyebrow">Audit Center</span>
          <h1 className="auditTitle">Activity Logs</h1>
          <p className="auditSub">
            Track real-time staff operations, system adjustments, and account activity across your organization.
          </p>
        </div>
        <span className="badge">{filteredLogs.length} entries</span>
      </div>

      <div className="auditFilterBar">
        <div className="searchWrapper">
          <input
            className="input auditSearchInput"
            placeholder="Search staff, action, or target..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button type="button" className="clearSearchBtn" onClick={() => setSearch("")}>
              Clear
            </button>
          )}
        </div>

        <div className="filterSelectGroup">
          <select className="input" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">All Roles</option>
            <option value="admin">Administrator</option>
            <option value="receptionist">Receptionist</option>
            <option value="dentist">Dentist</option>
          </select>

          <select className="input" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
            <option value="">All Actions</option>
            {actionOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>

          <select className="input" value={targetFilter} onChange={(e) => setTargetFilter(e.target.value)}>
            <option value="">All Targets</option>
            {targetOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>

          <input className="input" type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
        </div>
      </div>

      <div className="auditTableWrapper">
        {filteredLogs.length ? (
          <div className="auditTable">
            <div className="auditTableHeader">
              <div>Actor</div>
              <div>Action</div>
              <div>Target Record</div>
              <div>Timestamp</div>
              <div style={{ textAlign: "right" }}>Meta</div>
            </div>

            {filteredLogs.map((log) => {
              const hasDetails = log.details && Object.keys(log.details).length > 0;

              return (
                <div key={log.id} className="auditTableRow">
                  <div className="actorCell">
                    <strong className="actorName">{log.actorName || log.actorEmail || "Staff"}</strong>
                    <span className="actorRole">{(log.actorRole || "staff").toUpperCase()}</span>
                  </div>

                  <div className="actionCell">
                    <span className="actionBadge">{log.actionLabel}</span>
                  </div>

                  <div className="targetCell">
                    <strong className="targetLabel">{log.targetLabel || log.targetType || "Record"}</strong>
                    <span className="targetType">{log.targetType || "General"}</span>
                  </div>

                  <div className="timeCell">
                    {formatTimestamp(log.createdAt)}
                  </div>

                  <div className="detailsCell">
                    {hasDetails ? (
                      <details className="auditDetailsDrawer">
                        <summary className="detailsSummary">View Details</summary>
                        <div className="auditDetailsContent">
                          {Object.entries(log.details).map(([key, value]) => (
                            <div key={key} className="auditDetailRow">
                              <strong>{key}:</strong>
                              <span>{Array.isArray(value) ? value.join(", ") : String(value)}</span>
                            </div>
                          ))}
                        </div>
                      </details>
                    ) : (
                      <span className="noDetails">—</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="emptyAuditState">
            <strong>No audit logs found</strong>
            <p>Try resetting your active filters or query term to inspect recorded events.</p>
          </div>
        )}
      </div>
    </div>
  );
}