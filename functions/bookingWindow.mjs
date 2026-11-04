export function getClinicDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = type => parts.find(entry => entry.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

// Two calendar months, clamped to the last day when the target month is shorter.
export function getLatestBookingDate(today = getClinicDate()) {
  const [year, month, day] = today.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
  return new Date(Date.UTC(year, month + 1, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

export function isWithinBookingWindow(date, today = getClinicDate()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
    && date >= today && date <= getLatestBookingDate(today);
}
