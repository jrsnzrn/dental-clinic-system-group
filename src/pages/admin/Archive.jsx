import { useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, useParams } from "react-router-dom";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  updateDoc,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../firebase";
import ConfirmDialog from "../../components/ConfirmDialog";
import EmptyState from "../../components/EmptyState";
import { SkeletonList } from "../../components/LoadingSkeleton";
import { logAdminAction } from "../../utils/audit";
import {
  formatDateLabel,
  formatScheduleSummary,
  formatTimeLabel,
  formatTimestamp,
} from "../../utils/schedule";

const RESTORE_BOOKING = httpsCallable(functions, "restoreBooking");
const DELETE_ARCHIVED_BOOKING = httpsCallable(functions, "deleteArchivedBooking");
const RESTORE_STAFF_ACCOUNT = httpsCallable(functions, "restoreStaffAccount");
const DELETE_ARCHIVED_STAFF_ACCOUNT = httpsCallable(functions, "deleteArchivedStaffAccount");

const ARCHIVE_FILTERS = {
  patients: {
    tab: "Patients",
    title: "Archived Patients",
    subtitle: "Former patient records stored away from the active patient list.",
    emptyText: "No archived patients matched your search.",
  },
  dentists: {
    tab: "Dentists",
    title: "Archived Dentists",
    subtitle: "Dentists removed from the active scheduler and booking selection.",
    emptyText: "No archived dentists matched your search.",
  },
  accounts: {
    tab: "Staff",
    title: "Archived Staff Accounts",
    subtitle: "Disabled receptionist and dentist accounts moved away from the active staff list.",
    emptyText: "No archived staff accounts matched your search.",
  },
  bookings: {
    tab: "Bookings",
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

function ArchiveRow({ title, subtitle, meta = [], onRestore, onDelete }) {
  return (
    <li className="archiveCard">
      <div className="archiveCardTop">
        <span className="archiveAvatar" aria-hidden="true">{initialsOf(title)}</span>
        <div className="archiveText">
          <strong className="archiveTitle">{title}</strong>
          <span className="archiveSub">{subtitle}</span>
        </div>
        <span className="archiveChip">Archived</span>
        <div className="archiveActions">
          <button className="btn secondary" type="button" onClick={onRestore}>
            Restore
          </button>
          <button className="btn danger" type="button" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
      {meta.length ? (
        <dl className="archiveMeta">
          {meta.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </li>
  );
}

export default function Archive() {
  const [patients, setPatients] = useState([]);
  const [dentists, setDentists] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [confirmState, setConfirmState] = useState(null);
  const { section = "patients" } = useParams();

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

  const archivedPatients = useMemo(() => {
    return patients
      .filter((patient) => isArchivedValue(patient.status) || isArchivedValue(patient.archiveStatus))
      .filter((patient) => normalizeValue(patient.name).includes(term));
  }, [patients, term]);

  const archivedBookings = useMemo(() => {
    return bookings
      .filter(
        (booking) =>
          isArchivedValue(booking.archiveStatus) ||
          isArchivedValue(booking.status)
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

  const archiveCounts = {
    patients: archivedPatients.length,
    dentists: archivedDentists.length,
    accounts: archivedAccounts.length,
    bookings: archivedBookings.length,
  };

  if (!ARCHIVE_FILTERS[section]) {
    return <Navigate to="/admin/archive/patients" replace />;
  }

  async function restorePatient(id) {
    await updateDoc(doc(db, "patients", id), { status: "Active" });
    const patient = patients.find((entry) => entry.id === id);
    await logAdminAction({
      action: "restore_patient",
      targetType: "patient",
      targetId: id,
      targetLabel: patient?.name || "Patient",
    });
    await load();
  }

  async function restoreBooking(id) {
    await RESTORE_BOOKING({ bookingId: id });
    await load();
  }

  async function restoreDentist(id) {
    await updateDoc(doc(db, "dentists", id), { archiveStatus: "Active" });
    const dentist = dentists.find((entry) => entry.id === id);
    await logAdminAction({
      action: "restore_dentist",
      targetType: "dentist",
      targetId: id,
      targetLabel: dentist?.name || "Dentist",
    });
    await load();
  }

  async function restoreAccount(id) {
    await RESTORE_STAFF_ACCOUNT({ uid: id });
    await load();
  }

  async function removeRecord(collectionName, id) {
    const targetCollections = {
      patients,
      dentists,
      admins: accounts,
      bookings,
    };
    const target = (targetCollections[collectionName] || []).find((entry) => entry.id === id);
    if (collectionName === "bookings") {
      await DELETE_ARCHIVED_BOOKING({ bookingId: id });
      await load();
      return;
    }

    if (collectionName === "admins") {
      await DELETE_ARCHIVED_STAFF_ACCOUNT({ uid: id });
      await load();
      return;
    }

    await deleteDoc(doc(db, collectionName, id));
    await logAdminAction({
      action: "delete_archived_record",
      targetType: collectionName.slice(0, -1),
      targetId: id,
      targetLabel: target?.name || target?.fullName || target?.email || "Archived record",
    });
    await load();
  }

  function openConfirm(config) {
    setConfirmState(config);
  }

  async function handleConfirmAction() {
    if (!confirmState?.action) return;
    const action = confirmState.action;
    setConfirmState(null);
    await action();
  }

  const askDelete = (noun, collectionName, id) => () =>
    openConfirm({
      title: `Delete archived ${noun} permanently?`,
      message:
        collectionName === "admins"
          ? "This archived staff access record will be deleted from Firestore completely and cannot be recovered."
          : `This archived ${noun} record will be deleted completely and cannot be recovered.`,
      confirmLabel: "Delete Permanently",
      tone: "danger",
      action: () => removeRecord(collectionName, id),
    });

  const rows = {
    patients: archivedPatients.map((patient) => ({
      id: patient.id,
      title: patient.name || "No name",
      subtitle: `Age ${patient.age || "-"} • ${patient.patientType || "Regular Patient"} • ${patient.phone || "No phone"} • ${patient.email || "No email"}`,
      onRestore: () => restorePatient(patient.id),
      onDelete: askDelete("patient", "patients", patient.id),
    })),
    dentists: archivedDentists.map((dentist) => ({
      id: dentist.id,
      title: dentist.name || "No name",
      subtitle: `${dentist.specialization || "No specialization"} • ${dentist.email || "No email"}`,
      meta: [{ label: "Weekly schedule", value: formatScheduleSummary(dentist.schedule || {}) }],
      onRestore: () => restoreDentist(dentist.id),
      onDelete: askDelete("dentist", "dentists", dentist.id),
    })),
    accounts: archivedAccounts.map((account) => ({
      id: account.id,
      title: account.name || "No staff name saved",
      subtitle: `${account.role || "No role"} • ${account.email || "No email"}`,
      onRestore: () => restoreAccount(account.id),
      onDelete: askDelete("staff", "admins", account.id),
    })),
    bookings: archivedBookings.map((booking) => ({
      id: booking.id,
      title: booking.fullName || "No name",
      subtitle: `Age ${booking.age || "-"} • ${booking.selectedDentist || "No dentist"} • ${booking.service || "No service"}`,
      meta: [
        { label: "Appointment day", value: formatDateLabel(booking.date) },
        { label: "Appointment time", value: formatTimeLabel(booking.time) },
        { label: "Booked at", value: formatTimestamp(booking.createdAt) },
      ],
      onRestore: () => restoreBooking(booking.id),
      onDelete: askDelete("booking", "bookings", booking.id),
    })),
  };

  const current = ARCHIVE_FILTERS[section];
  const currentRows = rows[section];

  return (
    <div className="container adminSurface archivePage">
      <div className="archiveBar">
        <nav className="archiveTabs" aria-label="Archive sections">
          {Object.entries(ARCHIVE_FILTERS).map(([key, value]) => (
            <NavLink
              key={key}
              to={`/admin/archive/${key}`}
              className={({ isActive }) => `archiveTab${isActive ? " active" : ""}`}
            >
              {value.tab}
              <span>{archiveCounts[key]}</span>
            </NavLink>
          ))}
        </nav>

        <div className="archiveSearch">
          <svg className="archiveSearchIcon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M20 20l-3.5-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            className="input"
            type="text"
            placeholder="Search archived records by name"
            aria-label="Search archived records"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search ? (
            <button className="archiveSearchClear" type="button" aria-label="Clear search" onClick={() => setSearch("")}>
              ✕
            </button>
          ) : null}
        </div>
      </div>

      {error ? <div className="error">{error}</div> : null}

      <section className="archiveSection">
        <p className="archiveIntro">{current.subtitle}</p>

        {loading ? <SkeletonList count={2} /> : null}

        {!loading && currentRows.length === 0 ? (
          <EmptyState title={current.title} message={current.emptyText} compact />
        ) : null}

        {!loading && currentRows.length > 0 ? (
          <ul className="archiveGrid">
            {currentRows.map(({ id, ...row }) => (
              <ArchiveRow key={id} {...row} />
            ))}
          </ul>
        ) : null}
      </section>

      <ConfirmDialog
        open={Boolean(confirmState)}
        title={confirmState?.title}
        message={confirmState?.message}
        confirmLabel={confirmState?.confirmLabel}
        tone={confirmState?.tone}
        onClose={() => setConfirmState(null)}
        onConfirm={handleConfirmAction}
      />
    </div>
  );
}