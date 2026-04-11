import { useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, useParams } from "react-router-dom";
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  doc,
  updateDoc,
  getDocs,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "../../firebase";
import {
  formatDateLabel,
  formatTimeLabel,
  formatTimestamp,
} from "../../utils/schedule";

const BOOKING_FILTERS = {
  pending: {
    title: "Pending Bookings",
    subtitle: "New requests stay here until the admin approves or cancels them.",
    emptyText: "No pending bookings right now.",
  },
  approved: {
    title: "Approved Bookings",
    subtitle: "Approved appointments are separated here so the team can review confirmed visits more easily.",
    emptyText: "No approved bookings yet.",
  },
  cancelled: {
    title: "Cancelled Bookings",
    subtitle: "Cancelled appointments move here automatically so the pending queue stays clean.",
    emptyText: "No cancelled bookings.",
  },
};

function normalizeName(value) {
  return String(value ?? "").trim().toLowerCase();
}

async function syncPatientRecordFromBooking(bookingData) {
  const patientsSnap = await getDocs(collection(db, "patients"));
  const match = patientsSnap.docs.find((patientDoc) => {
    const patient = patientDoc.data();
    if (bookingData.uid && patient.uid === bookingData.uid) return true;
    return normalizeName(patient.name) === normalizeName(bookingData.fullName || bookingData.patientKey);
  });

  const payload = {
    uid: bookingData.uid || "",
    name: bookingData.fullName || "Unnamed Patient",
    age: bookingData.age || "",
    phone: bookingData.phone || "",
    email: bookingData.email || "",
    patientType: bookingData.patientType || "Regular Patient",
    preferredDentist: bookingData.selectedDentist || "",
    latestService: bookingData.service || "",
    latestBookedAt: bookingData.createdAt || null,
    lastApprovedAt: bookingData.appointmentAt || null,
    lastAppointmentDate: bookingData.date || "",
    lastAppointmentTime: bookingData.time || "",
    lastCheckedInAt: bookingData.checkedInAt || null,
    status: "Active",
  };

  if (match) {
    await updateDoc(doc(db, "patients", match.id), payload);
    return;
  }

  await addDoc(collection(db, "patients"), {
    ...payload,
    createdAt: serverTimestamp(),
  });
}

function BookingCard({ booking, onApprove, onPending, onCheckIn, onCancel, onArchive }) {
  return (
    <li className="item detailedItem bookingShowcase">
      <div className="detailContent">
        <div className="detailTopRow">
          <div>
            <strong className="detailTitle">{booking.fullName || "No name"}</strong>
            <p className="detailSubtitle">
              Age {booking.age || "-"} • {booking.patientType || "Regular Patient"} • {booking.phone || "No phone"} • {booking.email || "No email"}
            </p>
          </div>
          <div className="statusStack">
            <span className={`statusPill ${booking.status || "pending"}`}>{booking.status || "pending"}</span>
            <span className={`statusPill ${booking.archiveStatus === "Archived" ? "cancelled" : "approved"}`}>
              {booking.archiveStatus || "Active"}
            </span>
          </div>
        </div>

        <div className="detailGrid">
          <div className="detailBox luxeBox">
            <span className="detailLabel">Preferred dentist</span>
            <strong>{booking.selectedDentist || "Not selected"}</strong>
          </div>
          <div className="detailBox luxeBox">
            <span className="detailLabel">Service</span>
            <strong>{booking.service || "Not set"}</strong>
          </div>
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
          <div className="detailBox luxeBox">
            <span className="detailLabel">Checked in at</span>
            <strong>{formatTimestamp(booking.checkedInAt)}</strong>
          </div>
        </div>

        {booking.notes ? (
          <div className="detailNote noteRibbon">
            <span className="detailLabel">Notes</span>
            <p>{booking.notes}</p>
          </div>
        ) : null}
      </div>

      <div className="actionColumn">
        <button className="btn btnShine actionApprove" onClick={onApprove}>
          Approve
        </button>
        <button className="btn secondary btnSoft actionPending" onClick={onPending}>
          Set Pending
        </button>
        <button className="btn secondary btnSoft actionCheckin" onClick={onCheckIn}>
          {booking.checkedInAt ? "Clear Check-in" : "Mark Check-in"}
        </button>
        <button className="btn danger actionCancel" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn archiveButton actionArchive" onClick={onArchive}>
          Move to Archive
        </button>
      </div>
    </li>
  );
}

export default function Bookings() {
  const [bookings, setBookings] = useState([]);
  const { status = "pending" } = useParams();

  useEffect(() => {
    const q = query(collection(db, "bookings"), orderBy("appointmentAt", "asc"));

    const unsub = onSnapshot(q, (snap) => {
      setBookings(
        snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }))
      );
    });

    return () => unsub();
  }, []);

  const activeBookings = useMemo(
    () => bookings.filter((booking) => booking.archiveStatus !== "Archived"),
    [bookings]
  );

  const groupedBookings = useMemo(
    () => ({
      pending: activeBookings.filter((booking) => (booking.status || "pending") === "pending"),
      approved: activeBookings.filter((booking) => booking.status === "approved"),
      cancelled: activeBookings.filter((booking) => booking.status === "cancelled"),
    }),
    [activeBookings]
  );

  const bookingStats = useMemo(() => {
    const checkedIn = activeBookings.filter((booking) => booking.checkedInAt).length;
    return {
      total: activeBookings.length,
      pending: groupedBookings.pending.length,
      approved: groupedBookings.approved.length,
      cancelled: groupedBookings.cancelled.length,
      checkedIn,
    };
  }, [activeBookings, groupedBookings]);

  if (!BOOKING_FILTERS[status]) {
    return <Navigate to="/admin/bookings/pending" replace />;
  }

  async function setStatus(id, nextStatus, bookingData) {
    await updateDoc(doc(db, "bookings", id), { status: nextStatus });

    if (nextStatus === "approved") {
      await syncPatientRecordFromBooking(bookingData);
    }
  }

  async function toggleArchive(id) {
    await updateDoc(doc(db, "bookings", id), {
      archiveStatus: "Archived",
    });
  }

  async function toggleCheckIn(booking) {
    const nextCheckedInAt = booking.checkedInAt ? null : Timestamp.now();

    await updateDoc(doc(db, "bookings", booking.id), {
      checkedInAt: nextCheckedInAt,
    });

    if (booking.status === "approved") {
      await syncPatientRecordFromBooking({
        ...booking,
        checkedInAt: nextCheckedInAt,
      });
    }
  }

  const activeConfig = BOOKING_FILTERS[status];
  const activeItems = groupedBookings[status];

  return (
    <div className="container adminSurface">
      <div className="hero adminHero bookingsHero">
        <div className="adminHeroGlow" />
        <div className="adminHeroContent">
          <span className="heroEyebrow">Appointment Command Center</span>
          <h1>Bookings</h1>
          <p>The booking board is now split into separate pages so pending, approved, and cancelled appointments are easier to scan and manage.</p>
        </div>
      </div>

      <div className="statsGrid adminStats">
        <div className="statCard accentTeal">
          <span className="statLabel">Active bookings</span>
          <strong className="statValue">{bookingStats.total}</strong>
        </div>
        <div className="statCard accentBlue">
          <span className="statLabel">Pending</span>
          <strong className="statValue">{bookingStats.pending}</strong>
        </div>
        <div className="statCard accentGold">
          <span className="statLabel">Approved</span>
          <strong className="statValue">{bookingStats.approved}</strong>
        </div>
        <div className="statCard accentRose">
          <span className="statLabel">Cancelled</span>
          <strong className="statValue">{bookingStats.cancelled}</strong>
        </div>
        <div className="statCard accentGold">
          <span className="statLabel">Checked in</span>
          <strong className="statValue">{bookingStats.checkedIn}</strong>
        </div>
      </div>

      <div className="adminSubnav">
        <NavLink to="/admin/bookings/pending" className={({ isActive }) => `subnavItem ${isActive ? "active" : ""}`}>
          Pending
        </NavLink>
        <NavLink to="/admin/bookings/approved" className={({ isActive }) => `subnavItem ${isActive ? "active" : ""}`}>
          Approved
        </NavLink>
        <NavLink to="/admin/bookings/cancelled" className={({ isActive }) => `subnavItem ${isActive ? "active" : ""}`}>
          Cancelled
        </NavLink>
      </div>

      <div className="card adminRecordsCard bookingSectionCard">
        <div className="cardHeader">
          <div>
            <h3 className="title">{activeConfig.title}</h3>
            <p className="sub">{activeConfig.subtitle}</p>
          </div>
          <span className="badge">{activeItems.length} records</span>
        </div>

        {activeItems.length ? (
          <ul className="list detailedList">
            {activeItems.map((booking) => (
              <BookingCard
                key={booking.id}
                booking={booking}
                onApprove={() => setStatus(booking.id, "approved", booking)}
                onPending={() => setStatus(booking.id, "pending", booking)}
                onCheckIn={() => toggleCheckIn(booking)}
                onCancel={() => setStatus(booking.id, "cancelled", booking)}
                onArchive={() => toggleArchive(booking.id)}
              />
            ))}
          </ul>
        ) : (
          <div className="emptyEditorState">{activeConfig.emptyText}</div>
        )}
      </div>
    </div>
  );
}
