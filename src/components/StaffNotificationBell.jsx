import { useEffect, useMemo, useRef, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { useLocation, useNavigate } from "react-router-dom";
import { db } from "../firebase";
import { ROLES } from "../utils/rbac";

const READ_KEY = "topdentOverviewRead";

function pad(value) {
  return String(value).padStart(2, "0");
}

function toISO(value) {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  if (typeof value.toDate === "function") return toISO(value.toDate());
  if (value.seconds) return toISO(new Date(value.seconds * 1000));
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

function normalizeBooking(entry) {
  const data = entry.data();
  const services = (data.services || [data.service]).filter(Boolean);
  return {
    id: entry.id,
    name: data.patientName || data.fullName || data.name || data.email || "Patient",
    service: services.join(", "),
    date: toISO(data.date),
    time: data.time || "",
    added: toISO(data.createdAt) || toISO(data.date),
    status: String(data.status || "pending").toLowerCase().replace(" ", "-"),
  };
}

function getStoredReadIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(READ_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

export default function StaffNotificationBell({ adminRole }) {
  const navigate = useNavigate();
  const location = useLocation();
  const canAccessBookings = adminRole === ROLES.ADMIN || adminRole === ROLES.RECEPTIONIST;
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [readIds, setReadIds] = useState(getStoredReadIds);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "bookings"),
      (snapshot) => {
        setBookings(snapshot.docs.map(normalizeBooking));
        setError("");
        setLoading(false);
      },
      (snapshotError) => {
        console.error("Staff notifications could not load bookings:", snapshotError);
        setError("Notifications could not be loaded.");
        setLoading(false);
      }
    );
    return unsubscribe;
  }, []);

  const today = `${new Date().getFullYear()}-${pad(new Date().getMonth() + 1)}-${pad(new Date().getDate())}`;
  const notifications = useMemo(() => {
    const items = [];
    if (canAccessBookings) {
      bookings
        .filter((booking) => booking.status === "pending")
        .sort((a, b) => b.added.localeCompare(a.added))
        .slice(0, 6)
        .forEach((booking) => {
          items.push({
            id: `pending:${booking.id}`,
            bookingId: booking.id,
            title: `New appointment: ${booking.name}`,
            sub: `${formatDate(booking.date)}${booking.time ? `, ${booking.time}` : ""} · Booking ${booking.id}`,
          });
        });

      bookings
        .filter((booking) => booking.status === "cancelled" && booking.date >= today)
        .slice(0, 4)
        .forEach((booking) => {
          items.push({
            id: `cancelled:${booking.id}`,
            title: `${booking.name} cancelled`,
            sub: `${booking.service || "No service"} · ${formatDate(booking.date)}`,
          });
        });
    }

    const todayCount = bookings.filter(
      (booking) => booking.date === today && !["cancelled", "no-show"].includes(booking.status)
    ).length;
    if (todayCount) {
      items.unshift({
        id: `today:${today}:${todayCount}`,
        title: `${todayCount} appointment${todayCount > 1 ? "s" : ""} today`,
        sub: "Open bookings to see the schedule",
      });
    }

    return items;
  }, [adminRole, bookings, canAccessBookings, today]);

  const unread = notifications.filter((item) => !readIds.has(item.id)).length;

  function saveReadIds(nextIds) {
    setReadIds(nextIds);
    try {
      localStorage.setItem(READ_KEY, JSON.stringify([...nextIds]));
    } catch {
      console.warn("Notification read state could not be saved in local storage.");
    }
  }

  function openNotification(item) {
    saveReadIds(new Set([...readIds, item.id]));
    if (item.bookingId && canAccessBookings) {
      navigate(`/admin/bookings/calendar?bookingId=${encodeURIComponent(item.bookingId)}`);
      return;
    }
    navigate(adminRole === ROLES.DENTIST ? "/admin/patients" : "/admin/bookings");
  }

  return (
    <NotificationPopover
      key={location.key}
      notifications={notifications}
      unread={unread}
      loading={loading}
      error={error}
      readIds={readIds}
      onMarkAllRead={() =>
        saveReadIds(new Set([...readIds, ...notifications.map((item) => item.id)]))
      }
      onSelectNotification={openNotification}
    />
  );
}

function NotificationPopover({
  notifications,
  unread,
  loading,
  error,
  readIds,
  onMarkAllRead,
  onSelectNotification,
}) {
  const bellRef = useRef(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event) {
      if (bellRef.current && !bellRef.current.contains(event.target)) setOpen(false);
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setOpen(false);
        bellRef.current?.querySelector("button")?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="staffNotification" ref={bellRef}>
      <button
        type="button"
        className="staffNotificationButton"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="staff-notification-panel"
        onClick={() => setOpen((current) => !current)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
          <path d="M10 21h4" />
        </svg>
        {unread > 0 ? <span className="staffNotificationBadge">{unread > 9 ? "9+" : unread}</span> : null}
      </button>

      {open ? (
        <div
          className="staffNotificationPanel"
          id="staff-notification-panel"
          role="dialog"
          aria-label="Notifications"
          aria-busy={loading}
        >
          <div className="staffNotificationHead">
            <strong>Notifications</strong>
            <button type="button" onClick={onMarkAllRead} disabled={!unread}>
              Mark all as read
            </button>
          </div>
          {error ? (
            <p className="staffNotificationMessage" role="alert">{error}</p>
          ) : loading ? (
            <p className="staffNotificationMessage" role="status">Loading notifications…</p>
          ) : notifications.length ? (
            <ul>
              {notifications.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`staffNotificationItem${readIds.has(item.id) ? " read" : ""}`}
                    onClick={() => onSelectNotification(item)}
                  >
                    <strong>{item.title}</strong>
                    <span>{item.sub}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="staffNotificationMessage">You&apos;re all caught up.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
