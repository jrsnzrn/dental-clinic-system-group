export function isTreatmentComplete(booking) {
  return booking.status === "completed" ||
    (booking.status === "pending_payment" && Boolean(booking.treatmentCompletedAt));
}

export function isWaitingForTreatment(booking) {
  return !isTreatmentComplete(booking) && (
    (booking.status === "approved" && Boolean(booking.checkedInAt)) ||
    booking.status === "checked_in" || booking.status === "checked-in"
  );
}

export function getStaffDashboardSummary(bookings, date) {
  const active = bookings.filter(booking => booking.archiveStatus !== "Archived");
  const appointments = active.filter(booking => booking.date === date)
    .sort((left, right) => String(left.time || "99:99").localeCompare(String(right.time || "99:99")) || String(left.id).localeCompare(String(right.id)));
  return {
    appointments,
    scheduled: appointments.filter(booking => !["cancelled", "no_show", "no-show"].includes(booking.status)).length,
    waiting: appointments.filter(isWaitingForTreatment).length,
    completed: appointments.filter(isTreatmentComplete).length,
    pending: active.filter(booking => booking.status === "pending").length,
    pendingPayment: active.filter(booking => booking.status === "pending_payment").length,
    approved: appointments.filter(booking => booking.status === "approved" && !booking.checkedInAt).length,
  };
}

export function getDashboardStatus(booking) {
  if (isWaitingForTreatment(booking)) return "checked_in";
  return booking.status || "pending";
}

export function getDashboardPatientPath(booking) {
  const id = booking.patientId || booking.patientProfileId || booking.uid;
  return id ? `/admin/patients/${encodeURIComponent(id)}` : "/admin/patients";
}
