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

export function canAccessRoute(role, allowedRoles = []) {
  const normalizedRole = normalizeRole(role);
  if (!allowedRoles.length) return normalizedRole === ROLES.ADMIN;
  return allowedRoles.includes(normalizedRole);
}

export function getDefaultAdminPath(role) {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === ROLES.RECEPTIONIST) return "/admin/bookings";
  if (normalizedRole === ROLES.DENTIST) return "/admin/patients";
  return "/admin/patients";
}

export const ADMIN_NAV_BY_ROLE = {
  [ROLES.ADMIN]: [
    { to: "/admin/patients", label: "Patients" },
    { to: "/admin/bookings", label: "Bookings" },
    { to: "/admin/dentists", label: "Dentists" },
    { to: "/admin/accounts", label: "Accounts" },
    { to: "/admin/logs", label: "Logs" },
    { to: "/admin/archive", label: "Archive" },
  ],
  [ROLES.RECEPTIONIST]: [
    { to: "/admin/patients", label: "Patients" },
    { to: "/admin/bookings", label: "Bookings" },
    { to: "/admin/archive", label: "Archive" },
  ],
  [ROLES.DENTIST]: [
    { to: "/admin/patients", label: "Patients" },
  ],
};
