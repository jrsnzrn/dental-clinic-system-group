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

export function normalizeScheduleExceptions(exceptions = []) {
  return (Array.isArray(exceptions) ? exceptions : [])
    .map((entry) => ({
      id: entry.id || `${entry.date || ""}-${entry.label || ""}`,
      date: String(entry.date || "").trim(),
      label: String(entry.label || "").trim(),
      type: String(entry.type || "exception").trim(),
      active: entry.active !== false,
      start: String(entry.start || "09:00"),
      end: String(entry.end || "18:00"),
    }))
    .filter((entry) => entry.date);
}

export function getDayKeyFromDate(dateStr) {
  if (!dateStr) return "";
  const dayIndex = new Date(`${dateStr}T00:00:00`).getDay();
  return DAY_ORDER[(dayIndex + 6) % 7].key;
}

export function isDentistAvailableOnDate(dentist, dateStr) {
  if (!dentist || !dateStr) return false;
  const exception = normalizeScheduleExceptions(dentist.scheduleExceptions).find(
    (entry) => entry.date === dateStr
  );
  if (exception) return Boolean(exception.active);
  const schedule = normalizeSchedule(dentist.schedule);
  const dayKey = getDayKeyFromDate(dateStr);
  return Boolean(schedule[dayKey]?.active);
}

export function getDentistDaySchedule(dentist, dateStr) {
  const exception = normalizeScheduleExceptions(dentist?.scheduleExceptions).find(
    (entry) => entry.date === dateStr
  );
  if (exception) {
    return {
      active: Boolean(exception.active),
      start: exception.start,
      end: exception.end,
      label: exception.label,
      type: exception.type,
      source: "exception",
    };
  }

  const schedule = normalizeSchedule(dentist?.schedule);
  const dayKey = getDayKeyFromDate(dateStr);
  return {
    ...(schedule[dayKey] || { active: false, start: "09:00", end: "18:00" }),
    source: "weekly",
  };
}

export function getDentistScheduleStatus(dentist, dateStr) {
  return isDentistAvailableOnDate(dentist, dateStr) ? "Active" : "Inactive";
}

export function getClinicAvailability(dentist, dateStr, clinicClosures = []) {
  const closure = (clinicClosures || []).find(
    (entry) => String(entry?.date || "").trim() === dateStr && entry.active !== false
  );

  if (closure) {
    return {
      available: false,
      reason: closure.label || "Clinic Closed",
      type: closure.type || "closure",
      closure,
      schedule: null,
    };
  }

  const schedule = getDentistDaySchedule(dentist, dateStr);
  return {
    available: Boolean(schedule.active),
    reason: schedule.active ? "" : schedule.label || "Dentist inactive on this day",
    type: schedule.source,
    closure: null,
    schedule,
  };
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

export function formatExceptionSummary(exceptions = []) {
  const normalized = normalizeScheduleExceptions(exceptions);
  if (!normalized.length) return "No exceptions added";

  return normalized
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((entry) => {
      const state = entry.active
        ? `${formatTimeLabel(entry.start)} - ${formatTimeLabel(entry.end)}`
        : "Unavailable";
      return `${entry.date} • ${entry.label || entry.type} • ${state}`;
    })
    .join(" | ");
}
