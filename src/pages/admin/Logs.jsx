import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../../firebase";
import { getAuditActionLabel } from "../../utils/audit";
import { ROLE_LABELS } from "../../utils/rbac";
import { formatTimestamp } from "../../utils/schedule";

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

const ACTION_CATEGORIES = [
  "Create",
  "Update",
  "Request",
  "Approve",
  "Decline",
  "Cancel",
  "Complete",
  "Archive",
  "Restore",
  "Delete",
];

function getActionCategory(log) {
  const action = normalizeText(log.action);
  const status = normalizeText(log.details?.status || log.details?.nextStatus || log.details?.newStatus);

  if (action === "update_booking_status") {
    if (status.includes("cancel")) return "Cancel";
    if (["completed", "complete"].includes(status)) return "Complete";
    if (status === "approved") return "Approve";
    return "Update";
  }
  if (action.startsWith("approve")) return "Approve";
  if (action.startsWith("decline")) return "Decline";
  if (action.startsWith("request")) return "Request";
  if (action.startsWith("cancel")) return "Cancel";
  if (action.startsWith("complete")) return "Complete";
  if (action.startsWith("archive")) return "Archive";
  if (action.startsWith("restore")) return "Restore";
  if (action.startsWith("delete")) return "Delete";
  if (["create", "add", "log", "schedule"].some((prefix) => action.startsWith(prefix))) return "Create";
  if (["update", "set", "toggle", "mark", "clear", "save", "sync", "share", "hide", "remove"].some((prefix) => action.startsWith(prefix))) {
    return "Update";
  }
  return "";
}

const TARGET_TYPE_LABELS = {
  admin_account: "Staff Account",
  staff_account: "Staff Account",
  booking: "Appointment",
  appointment: "Appointment",
  clinic_service: "Service",
  patient: "Patient",
  promotion: "Promotion",
};

function getTargetTypeLabel(targetType) {
  const normalized = normalizeText(targetType);
  return TARGET_TYPE_LABELS[normalized] || normalized.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) || "General";
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
          getTargetTypeLabel(log.targetType),
        ].some((value) => normalizeText(value).includes(term));

      const matchesRole = !roleFilter || normalizeText(log.actorRole) === normalizeText(roleFilter);
      const matchesAction = !actionFilter || getActionCategory(log) === actionFilter;
      const matchesTarget = !targetFilter || normalizeText(log.targetType) === normalizeText(targetFilter);
      const matchesDate =
        !dateFilter ||
        (log.createdAt?.toDate?.().toISOString().slice(0, 10) || "") === dateFilter;

      return matchesSearch && matchesRole && matchesAction && matchesTarget && matchesDate;
    });
  }, [actionFilter, dateFilter, logs, roleFilter, search, targetFilter]);

  const actionOptions = useMemo(
    () => ACTION_CATEGORIES.filter((category) => logs.some((log) => getActionCategory(log) === category)),
    [logs]
  );
  const targetOptions = useMemo(
    () => [...new Set(logs.map((log) => log.targetType).filter(Boolean))].sort(),
    [logs]
  );

  return (
    <div className="container adminSurface auditPage">
      <div className="auditFilterBar">
        <div className="searchWrapper adminSearchField">
          <svg className="adminSearchIcon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            className="input"
            aria-label="Search activity logs"
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
          <select className="input" aria-label="Filter activity logs by role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">All Roles</option>
            <option value="admin">Administrator</option>
            <option value="receptionist">Receptionist</option>
            <option value="dentist">Dentist</option>
          </select>

          <select className="input" aria-label="Filter activity logs by action" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
            <option value="">All Actions</option>
            {actionOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>

          <select className="input" aria-label="Filter activity logs by target" value={targetFilter} onChange={(e) => setTargetFilter(e.target.value)}>
            <option value="">All Targets</option>
            {targetOptions.map((option) => (
              <option key={option} value={option}>{getTargetTypeLabel(option)}</option>
            ))}
          </select>

          <input className="input" type="date" aria-label="Filter activity logs by date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
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
                    <span className="actorRole">{ROLE_LABELS[log.actorRole] || log.actorRole || "Staff"}</span>
                  </div>

                  <div className="actionCell">
                    <span className="actionBadge">{log.actionLabel}</span>
                  </div>

                  <div className="targetCell">
                    <strong className="targetLabel">{log.targetLabel || getTargetTypeLabel(log.targetType)}</strong>
                    <span className="targetType">{getTargetTypeLabel(log.targetType)}</span>
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