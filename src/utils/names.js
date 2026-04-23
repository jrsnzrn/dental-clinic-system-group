export function buildFullName({
  firstName = "",
  middleName = "",
  lastName = "",
  fallback = "",
} = {}) {
  const parts = [firstName, middleName, lastName]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  if (parts.length) {
    return parts.join(" ");
  }

  return String(fallback || "").trim();
}

export function splitFullName(fullName = "") {
  const clean = String(fullName || "").trim().replace(/\s+/g, " ");
  if (!clean) {
    return {
      firstName: "",
      middleName: "",
      lastName: "",
    };
  }

  const parts = clean.split(" ");
  if (parts.length === 1) {
    return {
      firstName: parts[0],
      middleName: "",
      lastName: "",
    };
  }

  if (parts.length === 2) {
    return {
      firstName: parts[0],
      middleName: "",
      lastName: parts[1],
    };
  }

  return {
    firstName: parts[0],
    middleName: parts.slice(1, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}
