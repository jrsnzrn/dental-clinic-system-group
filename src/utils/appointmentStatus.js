const APPOINTMENT_STATUS_LABELS = {
  pending_payment: "Pending Payment",
  pending: "Pending",
  approved: "Approved",
  checked_in: "Checked In",
  "checked-in": "Checked In",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
  "no-show": "No-show",
};

export function formatAppointmentStatusLabel(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (!normalized) return "Pending";
  if (Object.prototype.hasOwnProperty.call(APPOINTMENT_STATUS_LABELS, normalized)) {
    return APPOINTMENT_STATUS_LABELS[normalized];
  }
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function getAppointmentStatusClass(status) {
  const normalized = String(status || "pending").trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (normalized === "pending-payment") return "pending";
  return normalized || "pending";
}

export function hasPendingCancellationRequest(booking) {
  const request = booking?.cancellationRequest;
  return Boolean(request && String(request.status || "pending").trim().toLowerCase() === "pending" &&
    booking.archiveStatus !== "Archived" &&
    ["pending", "approved"].includes(String(booking.status || "pending").trim().toLowerCase()));
}

export function isCurrentAppointmentSlot(booking, date, time) {
  return Boolean(date && time && booking?.date === date && booking?.time === time);
}

export function getRescheduleRequestBlockLabel(booking) {
  const request = booking?.rescheduleRequest;
  if (request?.status !== "pending") return "";
  if (booking.status === "cancelled") return "Booking cancelled";
  if (hasPendingCancellationRequest(booking)) return "Cancellation takes priority";
  if (isCurrentAppointmentSlot(booking, request.requestedDate, request.requestedTime)) {
    return "Same as current appointment";
  }
  return "";
}
