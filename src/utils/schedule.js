export const DAY_ORDER = [
  { key: "monday", label: "Monday" },
  { key: "tuesday", label: "Tuesday" },
  { key: "wednesday", label: "Wednesday" },
  { key: "thursday", label: "Thursday" },
  { key: "friday", label: "Friday" },
  { key: "saturday", label: "Saturday" },
  { key: "sunday", label: "Sunday" },
];

export function createDefaultSchedule() {
  return {
    monday: { active: true, start: "09:00", end: "18:00" },
    tuesday: { active: true, start: "09:00", end: "18:00" },
    wednesday: { active: true, start: "09:00", end: "18:00" },
    thursday: { active: true, start: "09:00", end: "18:00" },
    friday: { active: true, start: "09:00", end: "18:00" },
    saturday: { active: true, start: "09:00", end: "18:00" },
    sunday: { active: false, start: "09:00", end: "18:00" },
  };
}

export function normalizeSchedule(schedule) {
  const defaults = createDefaultSchedule();

  return DAY_ORDER.reduce((acc, day) => {
    acc[day.key] = {
      ...defaults[day.key],
      ...(schedule?.[day.key] || {}),
    };
    return acc;
  }, {});
}

export function getDayKeyFromDate(dateStr) {
  if (!dateStr) return "";
  const dayIndex = new Date(`${dateStr}T00:00:00`).getDay();
  return DAY_ORDER[(dayIndex + 6) % 7].key;
}

export function isDentistAvailableOnDate(dentist, dateStr) {
  if (!dentist || !dateStr) return false;
  const schedule = normalizeSchedule(dentist.schedule);
  const dayKey = getDayKeyFromDate(dateStr);
  return Boolean(schedule[dayKey]?.active);
}

export function getDentistScheduleStatus(dentist, dateStr) {
  return isDentistAvailableOnDate(dentist, dateStr) ? "Active" : "Inactive";
}

export function formatTimestamp(value) {
  if (!value) return "Not available";
  const date = value.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";

  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDateLabel(dateStr) {
  if (!dateStr) return "Not set";
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateStr;

  return date.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatTimeLabel(timeStr) {
  if (!timeStr) return "Not set";
  const [hourText = "0", minuteText = "00"] = timeStr.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const date = new Date();
  date.setHours(hour, minute, 0, 0);

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatScheduleSummary(schedule) {
  const normalized = normalizeSchedule(schedule);
  const activeDays = DAY_ORDER.filter((day) => normalized[day.key].active);

  if (!activeDays.length) return "No active days";

  return activeDays
    .map((day) => {
      const entry = normalized[day.key];
      return `${day.label.slice(0, 3)} ${formatTimeLabel(entry.start)} - ${formatTimeLabel(entry.end)}`;
    })
    .join(" | ");
}
