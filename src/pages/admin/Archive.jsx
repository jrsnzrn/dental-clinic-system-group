import { useEffect, useMemo, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import {
  collection,
  doc,
  getDocs,
  updateDoc,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../firebase";
import EmptyState from "../../components/EmptyState";
import { SkeletonList } from "../../components/LoadingSkeleton";
import ConfirmDialog from "../../components/ConfirmDialog";
import { logAdminAction } from "../../utils/audit";
import {
  formatScheduleSummary,
  formatTimestamp,
} from "../../utils/schedule";

const RESTORE_BOOKING = httpsCallable(functions, "restoreBooking");
const RESTORE_STAFF_ACCOUNT = httpsCallable(functions, "restoreStaffAccount");

const ARCHIVE_FILTERS = {
  all: {
    title: "Archived Records",
    subtitle: "Archived records across available categories.",
    emptyText: "No archived records matched your search.",
  },
  patients: {
    title: "Archived Patients",
    subtitle: "Former patient records stored away from the active patient list.",
    emptyText: "No archived patients matched your search.",
  },
  dentists: {
    title: "Archived Dentists",
    subtitle: "Dentists removed from the active scheduler and booking selection.",
    emptyText: "No archived dentists matched your search.",
  },
  accounts: {
    title: "Archived Staff Accounts",
    subtitle: "Disabled receptionist and dentist accounts moved away from the active staff list.",
    emptyText: "No archived staff accounts matched your search.",
  },
  bookings: {
    title: "Archived Bookings",
    subtitle: "Old or inactive booking records separated from the live booking board.",
    emptyText: "No archived bookings matched your search.",
  },
};

function normalizeValue(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isArchivedValue(value) {
  const normalized = normalizeValue(value);
  return normalized === "archived" || normalized === "archive";
}

function initialsOf(text) {
  const parts = String(text || "?").trim().split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts.length > 1 ? parts[1][0] : "")).toUpperCase();
}

function formatFieldLabel(key) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());
}

function formatRecordValue(key, value) {
  if (value == null || value === "") return "";
  if (typeof value?.toDate === "function" || value instanceof Date) return formatTimestamp(value);
  if (/schedule$/i.test(key) && value && typeof value === "object" && !Array.isArray(value)) {
    return formatScheduleSummary(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => (item && typeof item === "object" ? JSON.stringify(item) : String(item)))
      .filter(Boolean)
      .join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function getRecordDetails(record = {}) {
  const privateField = /password|token|secret|mfa|two.?factor|verification.?code/i;
  return Object.entries(record)
    .filter(([key, value]) => key !== "id" && !key.startsWith("_") && !privateField.test(key) && value != null && value !== "")
    .map(([key, value]) => ({
      label: formatFieldLabel(key),
      section: /schedule/i.test(key)
        ? "Schedule"
        : /email|phone|mobile|address|contact/i.test(key)
          ? "Contact"
          : /date|time|appointment|service|dentist|booking/i.test(key)
            ? "Appointment"
            : "Record details",
      value: formatRecordValue(key, value),
    }))
    .filter((item) => item.value);
}

function groupRecordDetails(details) {
  return details.reduce((groups, item) => {
    groups[item.section] = [...(groups[item.section] || []), item];
    return groups;
  }, {});
}

function getListMeta(record = {}) {
  const archivedAt = record.archivedAt || record.archiveDate || record.archivedOn;
  return [
    record.email ? { label: "Email", value: record.email } : null,
    archivedAt ? { label: "Archived", value: formatTimestamp(archivedAt) } : null,
  ].filter(Boolean);
}

function ArchiveRow({ title, category, subtitle, meta = [], selectionMode, selected, onSelect, onOpen }) {
  return (
    <li className={`archiveRow${selectionMode ? " isSelecting" : ""}`}>
      {selectionMode ? (
        <input
          className="archiveSelectCheckbox"
          type="checkbox"
          aria-label={`Select archived record: ${title}`}
          checked={selected}
          onChange={(event) => {
            event.stopPropagation();
            onSelect();
          }}
        />
      ) : null}
      <button className="archiveRecordMain" type="button" onClick={onOpen}>
        <span className="archiveAvatar" aria-hidden="true">{initialsOf(title)}</span>
        <span className="archiveText">
          <strong className="archiveTitle">{title}</strong>
          <span className="archiveSub">{category} · {subtitle}</span>
          {meta.length ? (
            <span className="archiveMeta">
              {meta.map((item) => (
                <span key={item.label} className="archiveMetaItem">
                  <span className="archiveMetaLabel">{item.label}</span>
                  <span className="archiveMetaValue">{item.value}</span>
                </span>
              ))}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

export default function Archive({ adminRole, search }) {
  const [patients, setPatients] = useState([]);
  const [dentists, setDentists] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [confirmRestoreRows, setConfirmRestoreRows] = useState(null);
  const [detailRow, setDetailRow] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [success, setSuccess] = useState("");
  const { section = "patients" } = useParams();
  const isAdmin = adminRole === "admin";

  async function load() {
    setLoading(true);
    setError("");

    const [patientResult, dentistResult, accountResult, bookingResult] = await Promise.allSettled([
      getDocs(collection(db, "patients")),
      getDocs(collection(db, "dentists")),
      getDocs(collection(db, "admins")),
      getDocs(collection(db, "bookings")),
    ]);

    if (patientResult.status === "fulfilled") {
      setPatients(patientResult.value.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    } else {
      setPatients([]);
    }

    if (dentistResult.status === "fulfilled") {
      setDentists(dentistResult.value.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    } else {
      setDentists([]);
    }

    if (accountResult.status === "fulfilled") {
      setAccounts(
        accountResult.value.docs
          .map((entry) => ({ id: entry.id, ...entry.data() }))
          .filter((entry) => entry.role === "receptionist" || entry.role === "dentist")
      );
    } else {
      setAccounts([]);
    }

    if (bookingResult.status === "fulfilled") {
      setBookings(bookingResult.value.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    } else {
      setBookings([]);
    }

    const failures = [patientResult, dentistResult, accountResult, bookingResult].filter(
      (result) => result.status === "rejected"
    );

    if (failures.length) {
      setError("Some archive data could not be loaded. This usually means your Firebase rules are blocking one or more collections for the current account.");
    }

    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const term = normalizeValue(search);

  useEffect(() => {
    setSelectedIds([]);
    setSelectionMode(false);
    setDetailRow(null);
  }, [section, term]);

  useEffect(() => {
    if (!detailRow) return undefined;

    function handleKeyDown(event) {
      if (event.key !== "Escape") return;
      if (confirmRestoreRows) {
        setConfirmRestoreRows(null);
        return;
      }
      setDetailRow(null);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [confirmRestoreRows, detailRow]);

  const archivedPatients = useMemo(() => {
    return patients
      .filter((patient) => isArchivedValue(patient.status) || isArchivedValue(patient.archiveStatus))
      .filter((patient) => normalizeValue(patient.name).includes(term));
  }, [patients, term]);

  const archivedBookings = useMemo(() => {
    return bookings
      .filter(
        (booking) =>
          isArchivedValue(booking.archiveStatus) &&
          normalizeValue(booking.status) === "completed"
      )
      .filter((booking) =>
        normalizeValue(booking.fullName || booking.patientKey || booking.name).includes(term)
      );
  }, [bookings, term]);

  const archivedDentists = useMemo(() => {
    return dentists
      .filter((dentist) => dentist.archiveStatus === "Archived")
      .filter((dentist) => normalizeValue(dentist.name).includes(term));
  }, [dentists, term]);

  const archivedAccounts = useMemo(() => {
    return accounts
      .filter((account) => isArchivedValue(account.archiveStatus))
      .filter((account) =>
        normalizeValue(account.name || account.email).includes(term)
      );
  }, [accounts, term]);

  if (!isAdmin && section === "patients") {
    return <Navigate to="/admin/archive/bookings" replace />;
  }

  if (!ARCHIVE_FILTERS[section]) {
    return <Navigate to={`/admin/archive/${isAdmin ? "patients" : "bookings"}`} replace />;
  }

  async function restorePatient(id, refresh = true) {
    if (!isAdmin) {
      throw new Error("Only an Admin can restore archived patients.");
    }
    await updateDoc(doc(db, "patients", id), { status: "Active" });
    const patient = patients.find((entry) => entry.id === id);
    await logAdminAction({
      action: "restore_patient",
      targetType: "patient",
      targetId: id,
      targetLabel: patient?.name || "Patient",
    });
    if (refresh) await load();
  }

  async function restoreBooking(id, refresh = true) {
    await RESTORE_BOOKING({ bookingId: id });
    if (refresh) await load();
  }

  async function restoreDentist(id, refresh = true) {
    await updateDoc(doc(db, "dentists", id), { archiveStatus: "Active" });
    const dentist = dentists.find((entry) => entry.id === id);
    await logAdminAction({
      action: "restore_dentist",
      targetType: "dentist",
      targetId: id,
      targetLabel: dentist?.name || "Dentist",
    });
    if (refresh) await load();
  }

  async function restoreAccount(id, refresh = true) {
    await RESTORE_STAFF_ACCOUNT({ uid: id });
    if (refresh) await load();
  }

  const rows = {
    patients: archivedPatients.map((patient) => ({
      id: `patient-${patient.id}`,
      title: patient.name || "No name",
      category: "Patient",
      subtitle: patient.patientType || "Regular Patient",
      meta: getListMeta(patient),
      details: getRecordDetails(patient),
      restore: (refresh) => restorePatient(patient.id, refresh),
    })),
    dentists: archivedDentists.map((dentist) => ({
      id: `dentist-${dentist.id}`,
      title: dentist.name || "No name",
      category: "Dentist",
      subtitle: dentist.specialization || "No specialization",
      meta: getListMeta(dentist),
      details: getRecordDetails(dentist),
      restore: (refresh) => restoreDentist(dentist.id, refresh),
    })),
    accounts: archivedAccounts.map((account) => ({
      id: `staff-${account.id}`,
      title: account.name || "No staff name saved",
      category: "Staff account",
      subtitle: account.role || "No role",
      meta: getListMeta(account),
      details: getRecordDetails(account),
      restore: (refresh) => restoreAccount(account.id, refresh),
    })),
    bookings: archivedBookings.map((booking) => ({
      id: `booking-${booking.id}`,
      title: booking.fullName || "No name",
      category: "Booking",
      subtitle: booking.service || "Appointment",
      meta: getListMeta(booking),
      details: getRecordDetails(booking),
      restore: (refresh) => restoreBooking(booking.id, refresh),
    })),
  };

  const current = ARCHIVE_FILTERS[section];
  const currentRows = section === "all"
    ? [
        ...(isAdmin ? rows.patients : []),
        ...rows.dentists,
        ...rows.accounts,
        ...rows.bookings,
      ]
    : rows[section];
  const selectedCurrentRows = currentRows.filter((row) => selectedIds.includes(row.id));
  const allCurrentRowsSelected = currentRows.length > 0 && currentRows.every((row) => selectedIds.includes(row.id));

  function toggleRowSelection(id) {
    setSelectedIds((currentIds) =>
      currentIds.includes(id)
        ? currentIds.filter((currentId) => currentId !== id)
        : [...currentIds, id]
    );
  }

  function toggleAllCurrentRows() {
    const currentIds = new Set(currentRows.map((row) => row.id));
    setSelectedIds((selected) =>
      allCurrentRowsSelected
        ? selected.filter((id) => !currentIds.has(id))
        : [...new Set([...selected, ...currentIds])]
    );
  }

  function clearSelection() {
    setSelectedIds([]);
    setSelectionMode(false);
  }

  function requestRestore(rowsToRestore) {
    setConfirmRestoreRows(rowsToRestore);
  }

  async function restoreSelectedRows() {
    if (!confirmRestoreRows?.length || restoring) return;
    const rowsToRestore = confirmRestoreRows;
    setConfirmRestoreRows(null);
    setRestoring(true);
    setError("");
    setSuccess("");

    const results = await Promise.allSettled(rowsToRestore.map((row) => row.restore(false)));
    const succeededRows = rowsToRestore.filter((_, index) => results[index].status === "fulfilled");
    const failedCount = results.length - succeededRows.length;
    setSelectedIds((currentIds) =>
      currentIds.filter((id) => !succeededRows.some((row) => row.id === id))
    );

    try {
      await load();
      if (succeededRows.some((row) => row.id === detailRow?.id)) setDetailRow(null);
      if (failedCount) {
        const firstFailure = results.find((result) => result.status === "rejected");
        setError(
          `${succeededRows.length} record${succeededRows.length === 1 ? "" : "s"} restored; ${failedCount} failed. ${
            firstFailure?.reason?.message || "A restore operation failed."
          }`
        );
        setSelectionMode(succeededRows.length !== rowsToRestore.length);
      } else {
        setSelectionMode(false);
        setSuccess(`${succeededRows.length} record${succeededRows.length === 1 ? "" : "s"} restored.`);
      }
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="container adminSurface archivePage">
      <header className="archiveHeading">
        <h1>{current.title}</h1>
        <p>{current.subtitle}</p>
      </header>

      {error ? <div className="error">{error}</div> : null}
      {success ? <div className="archiveSuccess" role="status">{success}</div> : null}

      <section className="archiveSection">
        {loading ? <SkeletonList count={2} /> : null}

        {!loading && currentRows.length === 0 ? (
          <EmptyState title={current.title} message={current.emptyText} compact />
        ) : null}

        {!loading && currentRows.length > 0 ? (
          <>
            <div className="archiveSelectionToolbar">
              <button
                className="archiveSelectionToggle"
                type="button"
                aria-pressed={selectionMode}
                disabled={restoring}
                onClick={() => selectionMode ? clearSelection() : setSelectionMode(true)}
              >
                {selectionMode ? "Cancel" : "Select"}
              </button>
              <span className="archiveSelectionCount">
                {selectionMode && selectedCurrentRows.length
                  ? `${selectedCurrentRows.length} selected · ${currentRows.length} records`
                  : `${currentRows.length} records`}
              </span>
              {selectedCurrentRows.length ? (
                <button
                  className="btn secondary"
                  type="button"
                  disabled={restoring}
                  onClick={() => setConfirmRestoreRows(selectedCurrentRows)}
                >
                  Restore Selected ({selectedCurrentRows.length})
                </button>
              ) : null}
            </div>
            {selectionMode ? (
              <label className="archiveSelectAll">
                <input
                  className="archiveSelectCheckbox"
                  type="checkbox"
                  aria-label="Select all displayed archived records"
                  checked={allCurrentRowsSelected}
                  ref={(node) => {
                    if (node) {
                      node.indeterminate = selectedCurrentRows.length > 0 && !allCurrentRowsSelected;
                    }
                  }}
                  onChange={toggleAllCurrentRows}
                />
                <span>Select all displayed</span>
              </label>
            ) : null}
            <ul className="archiveList">
              {currentRows.map((row) => (
                <ArchiveRow
                  key={row.id}
                  {...row}
                  selectionMode={selectionMode}
                  selected={selectedIds.includes(row.id)}
                  onSelect={() => toggleRowSelection(row.id)}
                  onOpen={() => setDetailRow(row)}
                />
              ))}
            </ul>
          </>
        ) : null}
      </section>

      {detailRow ? (
        <div
          className="archiveDetailOverlay"
          role="presentation"
          onClick={() => {
            if (!confirmRestoreRows) setDetailRow(null);
          }}
        >
          <section
            className="archiveDetailModal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="archive-detail-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="archiveDetailHeader">
              <div>
                <span className="archiveDetailCategory">{detailRow.category}</span>
                <h2 id="archive-detail-title">{detailRow.title}</h2>
                <p>{detailRow.subtitle}</p>
              </div>
              <button
                className="archiveDetailClose"
                type="button"
                aria-label="Close archived record details"
                onClick={() => setDetailRow(null)}
              >
                ×
              </button>
            </header>
            <div className="archiveDetailBody">
              {detailRow.details.length ? (
                Object.entries(groupRecordDetails(detailRow.details)).map(([section, items]) => (
                  <section className="archiveDetailSection" key={section}>
                    <h3>{section}</h3>
                    <dl className="archiveDetailGrid">
                      {items.map((item) => (
                        <div className="archiveDetailField" key={item.label}>
                          <dt>{item.label}</dt>
                          <dd>{item.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ))
              ) : (
                <p className="archiveDetailEmpty">No additional record details are available.</p>
              )}
            </div>
            <footer className="archiveDetailActions">
              <button
                className="btn secondary"
                type="button"
                disabled={restoring}
                onClick={() => requestRestore([detailRow])}
              >
                Restore
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(confirmRestoreRows)}
        title={confirmRestoreRows?.length === 1
          ? `Restore ${confirmRestoreRows[0].title}?`
          : `Restore ${confirmRestoreRows?.length || 0} archived records?`}
        message={confirmRestoreRows?.length === 1
          ? `${confirmRestoreRows[0].title} will be restored to the active ${confirmRestoreRows[0].category.toLowerCase()} list.`
          : `${confirmRestoreRows?.length || 0} selected archived record${confirmRestoreRows?.length === 1 ? "" : "s"} will be restored.`}
        confirmLabel={confirmRestoreRows?.length === 1
          ? "Restore"
          : `Restore ${confirmRestoreRows?.length || 0} Records`}
        onClose={() => {
          if (!restoring) setConfirmRestoreRows(null);
        }}
        onConfirm={restoreSelectedRows}
      />
    </div>
  );
}