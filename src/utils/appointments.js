export function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizeName(value) {
  return normalizeText(value);
}

export function isArchivedBooking(booking = {}) {
  return normalizeText(booking.archiveStatus) === "archived";
}

export function sortBookings(bookings = []) {
  return [...bookings].sort((a, b) => {
    const aTime = a.appointmentAt?.seconds || a.createdAt?.seconds || 0;
    const bTime = b.appointmentAt?.seconds || b.createdAt?.seconds || 0;
    return bTime - aTime;
  });
}

export function getLatestBooking(bookings = []) {
  return sortBookings(bookings)[0] || null;
}

export function doesBookingMatchPatient(patient = {}, booking = {}) {
  if (patient.uid && booking.uid) {
    return patient.uid === booking.uid;
  }

  return normalizeName(booking.fullName || booking.patientKey) === normalizeName(patient.name);
}

export function getPatientBookingHistory(bookings = [], patient = {}) {
  return sortBookings(
    bookings.filter((booking) => doesBookingMatchPatient(patient, booking) && !isArchivedBooking(booking))
  );
}

export function buildTreatmentProgress(history = []) {
  const progressMap = new Map();

  history.forEach((booking) => {
    const service = booking.service || "General Consultation";
    const current = progressMap.get(service) || {
      service,
      totalSessions: 0,
      approvedSessions: 0,
      checkedInSessions: 0,
      latestStatus: "pending",
      latestDate: "",
      preferredDentists: new Set(),
    };

    current.totalSessions += 1;
    if (booking.status === "approved") current.approvedSessions += 1;
    if (booking.checkedInAt) current.checkedInSessions += 1;
    current.latestStatus = booking.status || current.latestStatus;
    current.latestDate = booking.date || current.latestDate;
    if (booking.selectedDentist) current.preferredDentists.add(booking.selectedDentist);

    progressMap.set(service, current);
  });

  return [...progressMap.values()]
    .map((entry) => ({
      ...entry,
      activeSessions: entry.approvedSessions + entry.checkedInSessions,
      progressLabel: entry.checkedInSessions
        ? `Session ${entry.checkedInSessions} completed`
        : entry.approvedSessions
          ? `Session ${entry.approvedSessions} approved`
          : `Session ${entry.totalSessions} requested`,
      completionState:
        entry.latestStatus === "cancelled"
          ? "Paused"
          : entry.checkedInSessions >= 3
            ? "Completed"
            : entry.approvedSessions || entry.checkedInSessions
              ? "In Progress"
              : "Requested",
      dentistSummary: [...entry.preferredDentists].join(", ") || "No dentist assigned",
    }))
    .sort((a, b) => b.totalSessions - a.totalSessions);
}

export function buildPatientTimeline(history = []) {
  const bookingEvents = history.flatMap((booking) => {
    const events = [];
    const timelineStatus = isArchivedBooking(booking)
      ? "archived"
      : String(booking.status || "").trim().toLowerCase() || "pending";

    if (booking.createdAt) {
      events.push({
        id: `${booking.id}-created`,
        kind: "booking",
        timestamp: booking.createdAt,
        title: `Booked ${booking.service || "consultation"}`,
        subtitle: `${booking.selectedDentist || "Clinic dentist"} on ${booking.date || "date pending"} at ${booking.time || "time pending"}`,
        status: timelineStatus === "archived" ? "archived" : "pending",
      });
    }

    if (booking.statusUpdatedAt) {
      events.push({
        id: `${booking.id}-status`,
        kind: "status",
        timestamp: booking.statusUpdatedAt,
        title: `Booking ${booking.status || "pending"}`,
        subtitle: booking.service || "Appointment update",
        status: timelineStatus,
      });
    }

    if (booking.checkedInAt) {
      events.push({
        id: `${booking.id}-checkin`,
        kind: "checkin",
        timestamp: booking.checkedInAt,
        title: "Patient checked in",
        subtitle: `${booking.service || "Appointment"} with ${booking.selectedDentist || "clinic dentist"}`,
        status: timelineStatus === "archived" ? "archived" : "approved",
      });
    }

    if (booking.rescheduleRequest?.requestedAt) {
      events.push({
        id: `${booking.id}-reschedule`,
        kind: "reschedule",
        timestamp: booking.rescheduleRequest.requestedAt,
        title: "Reschedule requested",
        subtitle: `${booking.rescheduleRequest.requestedDate || "New date"} at ${booking.rescheduleRequest.requestedTime || "new time"}`,
        status: timelineStatus === "archived"
          ? "archived"
          : booking.rescheduleRequest.status || "pending",
      });
    }

    return events;
  });

  return bookingEvents
    .filter((entry) => entry.timestamp)
    .sort((a, b) => {
      const aTime = a.timestamp?.seconds || 0;
      const bTime = b.timestamp?.seconds || 0;
      return bTime - aTime;
    });
}

export function buildBookingAnalytics(bookings = []) {
  const activeBookings = bookings.filter((booking) => !isArchivedBooking(booking));

  const counters = {
    total: activeBookings.length,
    pending: 0,
    approved: 0,
    cancelled: 0,
    checkedIn: 0,
  };
  const serviceCounts = new Map();
  const dayCounts = new Map();
  const dentistCounts = new Map();
  const monthlyCounts = new Map();

  activeBookings.forEach((booking) => {
    const status = normalizeText(booking.status) || "pending";
    if (status === "pending") counters.pending += 1;
    if (status === "approved") counters.approved += 1;
    if (status === "cancelled") counters.cancelled += 1;
    if (booking.checkedInAt) counters.checkedIn += 1;

    const service = booking.service || "General Consultation";
    const dentist = booking.selectedDentist || "Unassigned";
    const day = booking.date
      ? new Date(`${booking.date}T00:00:00`).toLocaleDateString([], { weekday: "long" })
      : "Unscheduled";
    const monthKey = booking.date ? booking.date.slice(0, 7) : "No month";

    serviceCounts.set(service, (serviceCounts.get(service) || 0) + 1);
    dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
    dentistCounts.set(dentist, (dentistCounts.get(dentist) || 0) + 1);
    monthlyCounts.set(monthKey, (monthlyCounts.get(monthKey) || 0) + 1);
  });

  const topEntry = (map, fallback) => {
    const entries = [...map.entries()].sort((a, b) => b[1] - a[1]);
    if (!entries.length) return { label: fallback, count: 0 };
    return { label: entries[0][0], count: entries[0][1] };
  };

  return {
    ...counters,
    mostRequestedService: topEntry(serviceCounts, "No services yet"),
    busiestDay: topEntry(dayCounts, "No booking days yet"),
    mostBookedDentist: topEntry(dentistCounts, "No dentist bookings yet"),
    monthlyTrends: [...monthlyCounts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, count]) => ({ month, count })),
  };
}

export function isInactivePatient(patient = {}, latestBooking = null, staleDays = 180) {
  const referenceDate = patient.lastAppointmentDate || latestBooking?.date || "";
  if (!referenceDate) return false;
  const visitDate = new Date(`${referenceDate}T00:00:00`);
  if (Number.isNaN(visitDate.getTime())) return false;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - staleDays);
  return visitDate < cutoff;
}
