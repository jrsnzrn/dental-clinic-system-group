import { useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, useParams } from "react-router-dom";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../firebase";
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

const ARCHIVE_FILTERS = {
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

function ArchiveSection({ title, subtitle, count, children, emptyText }) {
  return (
    <div className="card adminRecordsCard bookingSectionCard">
      <div className="cardHeader">
        <div>
          <h3 className="title">{title}</h3>
          <p className="sub">{subtitle}</p>
        </div>
        <span className="badge">{count} records</span>
      </div>
      {count ? <ul className="list detailedList">{children}</ul> : <EmptyState title={title} message={emptyText} compact />}
    </div>
  );
}

export default function Archive() {
  const [patients, setPatients] = useState([]);
  const [dentists, setDentists] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [confirmState, setConfirmState] = useState(null);
  const { section = "patients" } = useParams();

  async function load() {
    setLoading(true);
    setError("");

    const [patientResult, dentistResult, bookingResult] = await Promise.allSettled([
      getDocs(collection(db, "patients")),
      getDocs(collection(db, "dentists")),
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

    if (bookingResult.status === "fulfilled") {
      setBookings(bookingResult.value.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    } else {
      setBookings([]);
    }

    const failures = [patientResult, dentistResult, bookingResult].filter(
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

  const archiveCounts = {
    patients: archivedPatients.length,
    dentists: archivedDentists.length,
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
    await updateDoc(doc(db, "bookings", id), { archiveStatus: "Active" });
    const booking = bookings.find((entry) => entry.id === id);
    await logAdminAction({
      action: "restore_booking",
      targetType: "booking",
      targetId: id,
      targetLabel: booking?.fullName || booking?.email || "Booking",
    });
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

  async function removeRecord(collectionName, id) {
    const targetCollections = {
      patients,
      dentists,
      bookings,
    };
    const target = (targetCollections[collectionName] || []).find((entry) => entry.id === id);
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

  const archiveBody =
    section === "patients" ? (
      <ArchiveSection
        title={ARCHIVE_FILTERS.patients.title}
        subtitle={ARCHIVE_FILTERS.patients.subtitle}
        count={archivedPatients.length}
        emptyText={ARCHIVE_FILTERS.patients.emptyText}
      >
        {archivedPatients.map((patient) => (
          <li key={patient.id} className="item detailedItem patientShowcase">
            <div className="detailContent">
              <div className="detailTopRow">
                <div>
                  <strong className="detailTitle">{patient.name}</strong>
                  <p className="detailSubtitle">
                    Age {patient.age || "-"} • {patient.patientType || "Regular Patient"} • {patient.phone || "No phone"} • {patient.email || "No email"}
                  </p>
                </div>
                <span className="statusPill cancelled">Archived</span>
              </div>
            </div>
            <div className="actionColumn">
              <button className="btn secondary" onClick={() => restorePatient(patient.id)}>
                Restore
              </button>
              <button
                className="btn danger"
                onClick={() =>
                  openConfirm({
                    title: "Delete archived patient permanently?",
                    message: "This archived patient record will be deleted completely and cannot be recovered.",
                    confirmLabel: "Delete Permanently",
                    tone: "danger",
                    action: () => removeRecord("patients", patient.id),
                  })
                }
              >
                Delete Permanently
              </button>
            </div>
          </li>
        ))}
      </ArchiveSection>
    ) : section === "dentists" ? (
      <ArchiveSection
        title={ARCHIVE_FILTERS.dentists.title}
        subtitle={ARCHIVE_FILTERS.dentists.subtitle}
        count={archivedDentists.length}
        emptyText={ARCHIVE_FILTERS.dentists.emptyText}
      >
        {archivedDentists.map((dentist) => (
          <li key={dentist.id} className="item detailedItem bookingShowcase">
            <div className="detailContent">
              <div className="detailTopRow">
                <div>
                  <strong className="detailTitle">{dentist.name}</strong>
                  <p className="detailSubtitle">
                    {dentist.specialization || "No specialization"} • {dentist.email || "No email"}
                  </p>
                </div>
                <span className="statusPill cancelled">Archived</span>
              </div>
              <div className="detailNote">
                <span className="detailLabel">Weekly schedule</span>
                <p>{formatScheduleSummary(dentist.schedule || {})}</p>
              </div>
            </div>
            <div className="actionColumn">
              <button className="btn secondary" onClick={() => restoreDentist(dentist.id)}>
                Restore
              </button>
              <button
                className="btn danger"
                onClick={() =>
                  openConfirm({
                    title: "Delete archived dentist permanently?",
                    message: "This archived dentist record will be deleted completely and cannot be recovered.",
                    confirmLabel: "Delete Permanently",
                    tone: "danger",
                    action: () => removeRecord("dentists", dentist.id),
                  })
                }
              >
                Delete Permanently
              </button>
            </div>
          </li>
        ))}
      </ArchiveSection>
    ) : (
      <ArchiveSection
        title={ARCHIVE_FILTERS.bookings.title}
        subtitle={ARCHIVE_FILTERS.bookings.subtitle}
        count={archivedBookings.length}
        emptyText={ARCHIVE_FILTERS.bookings.emptyText}
      >
        {archivedBookings.map((booking) => (
          <li key={booking.id} className="item detailedItem bookingShowcase">
            <div className="detailContent">
              <div className="detailTopRow">
                <div>
                  <strong className="detailTitle">{booking.fullName || "No name"}</strong>
                  <p className="detailSubtitle">
                    Age {booking.age || "-"} • {booking.selectedDentist || "No dentist"} • {booking.service || "No service"}
                  </p>
                </div>
                <span className="statusPill cancelled">Archived</span>
              </div>

              <div className="detailGrid">
                <div className="detailBox luxeBox">
                  <span className="detailLabel">Appointment day</span>
                  <strong>{formatDateLabel(booking.date)}</strong>
                </div>
                <div className="detailBox luxeBox">
                  <span className="detailLabel">Appointment time</span>
                  <strong>{formatTimeLabel(booking.time)}</strong>
                </div>
                <div className="detailBox luxeBox">
                  <span className="detailLabel">Booked at</span>
                  <strong>{formatTimestamp(booking.createdAt)}</strong>
                </div>
              </div>
            </div>
            <div className="actionColumn">
              <button className="btn secondary" onClick={() => restoreBooking(booking.id)}>
                Restore
              </button>
              <button
                className="btn danger"
                onClick={() =>
                  openConfirm({
                    title: "Delete archived booking permanently?",
                    message: "This archived booking will be deleted completely and cannot be recovered.",
                    confirmLabel: "Delete Permanently",
                    tone: "danger",
                    action: () => removeRecord("bookings", booking.id),
                  })
                }
              >
                Delete Permanently
              </button>
            </div>
          </li>
        ))}
      </ArchiveSection>
    );

  return (
    <div className="container adminSurface">
      <div className="hero adminHero">
        <div className="adminHeroGlow" />
        <div className="adminHeroContent">
          <span className="heroEyebrow">Archive Center</span>
          <h1>Archived Records</h1>
          <p>The archive is now split into separate pages so archived patients and archived bookings are easier to navigate and read.</p>
        </div>
      </div>

      <div className="card adminEditorCard" style={{ marginTop: 18 }}>
        <div className="cardHeader">
          <div>
            <h3 className="title">Archive Search</h3>
            <p className="sub">Filter the archive by name, then switch between archived patients and archived bookings using the second navigation below.</p>
          </div>
        </div>

        <div className="statsGrid compact archiveSummaryGrid">
          <div className="archiveSummaryCard active">
            <span className="statLabel">Archived patients</span>
            <strong className="statValue">{archiveCounts.patients}</strong>
          </div>
          <div className="archiveSummaryCard active">
            <span className="statLabel">Archived dentists</span>
            <strong className="statValue">{archiveCounts.dentists}</strong>
          </div>
          <div className="archiveSummaryCard active">
            <span className="statLabel">Archived bookings</span>
            <strong className="statValue">{archiveCounts.bookings}</strong>
          </div>
        </div>

        <div className="adminSubnav">
          <NavLink to="/admin/archive/patients" className={({ isActive }) => `subnavItem ${isActive ? "active" : ""}`}>
            Archived Patients
          </NavLink>
          <NavLink to="/admin/archive/dentists" className={({ isActive }) => `subnavItem ${isActive ? "active" : ""}`}>
            Archived Dentists
          </NavLink>
          <NavLink to="/admin/archive/bookings" className={({ isActive }) => `subnavItem ${isActive ? "active" : ""}`}>
            Archived Bookings
          </NavLink>
        </div>

        <div className="patientSearchSpotlight">
          <div className="patientSearchHeader">
            <div>
              <span className="patientSearchEyebrow">Archived Record Search</span>
              <p className="patientSearchHint">
                Search archived patients, dentists, or bookings by name to find records faster.
              </p>
            </div>
            <span className="patientSearchCount">
              {search ? "Filtered archive" : "Ready to search"}
            </span>
          </div>

          <div className="patientSearchRow">
            <input
              className="input searchInput patientSearchInput"
              placeholder="Search archived patient or record name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            {search ? (
              <button
                type="button"
                className="searchClearBtn"
                onClick={() => setSearch("")}
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
        {loading ? <SkeletonList count={2} /> : null}
        {error ? <div className="error">{error}</div> : null}
      </div>

      {!loading ? archiveBody : null}

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
