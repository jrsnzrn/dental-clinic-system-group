export const ROLES = {
  ADMIN: "admin",
  RECEPTIONIST: "receptionist",
  DENTIST: "dentist",
};

export const ROLE_LABELS = {
  [ROLES.ADMIN]: "Administrator",
  [ROLES.RECEPTIONIST]: "Receptionist",
  [ROLES.DENTIST]: "Dentist",
};

export function normalizeRole(value) {
  const role = String(value || "").trim().toLowerCase();
  if (Object.values(ROLES).includes(role)) return role;
  return ROLES.ADMIN;
}

export function getAdminProfile(data = {}) {
  return {
    ...data,
    role: normalizeRole(data.role),
  };
}

function timestampToMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function requiresStaffMfa(profile = {}) {
  if (normalizeRole(profile.role) === ROLES.ADMIN) return true;
  return profile.mfaEnabled === true || profile.mfaRequired === true;
}

export function hasFreshStaffMfa(profile = {}, authTime) {
  if (!requiresStaffMfa(profile)) return true;
  const currentLogin = Number(authTime);
  return Number.isFinite(currentLogin) && currentLogin > 0 &&
    Number(profile.mfaVerifiedAuthTime) === currentLogin &&
    timestampToMillis(profile.mfaVerifiedUntil) > Date.now();
}

export function canAccessRoute(role, allowedRoles = []) {
  const normalizedRole = normalizeRole(role);
  if (!allowedRoles.length) return normalizedRole === ROLES.ADMIN;
  return allowedRoles.includes(normalizedRole);
}

export function getDefaultAdminPath(role) {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === ROLES.RECEPTIONIST) return "/admin/dashboard";
  if (normalizedRole === ROLES.DENTIST) return "/admin/dashboard";
  return "/admin/analytics";
}

export function getStaffLoginPath(role) {
  // Every new login starts at its role's overview, including after verification.
  return getDefaultAdminPath(role);
}

export const ADMIN_NAV_BY_ROLE = {
  [ROLES.ADMIN]: [
    { to: "/admin/analytics", label: "Overview" },
    { to: "/admin/patients", label: "Patients" },
    { to: "/admin/bookings", label: "Appointments" },
    { to: "/admin/payments", label: "Payments" },
    { to: "/admin/dentists", label: "Dentists" },
    { to: "/admin/services", label: "Services" },
     { to: "/admin/promos", label: "Promos" },
    { to: "/admin/accounts", label: "Accounts" },
    { to: "/admin/logs", label: "Activity Logs" },
    { to: "/admin/archive", label: "Archive" },
    { to: "/admin/reports", label: "Reports" },
  ],
  [ROLES.RECEPTIONIST]: [
    { to: "/admin/dashboard", label: "Dashboard" },
    { to: "/admin/patients", label: "Patients" },
    { to: "/admin/bookings", label: "Appointments" },
    { to: "/admin/queue", label: "Queue" },
    { to: "/admin/payments", label: "Payments" },
    { to: "/admin/archive", label: "Archive" },
  ],
  [ROLES.DENTIST]: [
    { to: "/admin/dashboard", label: "Dashboard" },
    { to: "/admin/patients", label: "Patient" },
    { to: "/admin/completed", label: "Completed" },
  ],
};
