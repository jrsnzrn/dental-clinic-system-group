import { formatDateLabel, formatTimeLabel } from "./schedule";

export function buildCalendarCells(bookings = [], daysToShow = 21) {
  const today = new Date();
  const cells = [];

  for (let offset = 0; offset < daysToShow; offset += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() + offset);
    const iso = date.toISOString().slice(0, 10);
    const items = bookings
      .filter((booking) => booking.date === iso)
      .sort((a, b) => String(a.time || "").localeCompare(String(b.time || "")));

    cells.push({
      date: iso,
      label: formatDateLabel(iso),
      items,
    });
  }

  return cells;
}

export function getBookingCalendarTone(booking = {}) {
  if (String(booking.archiveStatus || "").toLowerCase() === "archived") return "archived";
  if (booking.checkedInAt) return "completed";
  const status = String(booking.status || "pending").toLowerCase();
  if (status === "approved") return "approved";
  if (status === "cancelled") return "cancelled";
  if (status === "archived") return "archived";
  return "pending";
}

export function getCalendarItemLabel(booking = {}) {
  return `${formatTimeLabel(booking.time)} • ${booking.fullName || "Patient"}`;
}
