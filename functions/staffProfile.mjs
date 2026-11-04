const text = value => String(value || "").trim().replace(/\s+/g, " ");

export function getStaffTitle(role, gender) {
  role = text(role).toLowerCase();
  gender = text(gender).toLowerCase();
  if (role === "admin") return "ADMIN";
  if (role === "dentist") return gender === "female" ? "Dra." : "Dr.";
  if (role === "receptionist") return gender === "female" ? "Ms." : gender === "male" ? "Mr." : "";
  return "";
}

export function formatStaffName(profile = {}) {
  const structured = [profile.firstName, profile.middleName, profile.lastName].map(text).filter(Boolean).join(" ");
  const fallback = text(profile.fullName || profile.name);
  const title = profile.gender || text(profile.role).toLowerCase() === "admin" ? getStaffTitle(profile.role, profile.gender) : text(profile.title);
  const fullName = structured || (title ? fallback.replace(/^(?:dra?\.?|mr\.?|ms\.?|admin)\s+/i, "") : fallback);
  return [title, fullName].filter(Boolean).join(" ") || fallback;
}

export function dentistNameFields(profile) {
  const name = formatStaffName(profile);
  return { name, linkedStaffName: name, title: profile.title || "", fullName: profile.fullName || "",
    firstName: profile.firstName || "", middleName: profile.middleName || "", lastName: profile.lastName || "" };
}

export function staffHeaderName(role, profileName, authName) {
  if (text(role).toLowerCase() === "admin") return "ADMIN";
  return [profileName, authName].map(text).find(name => name && !name.includes("@")) || "Staff";
}

export function buildStaffProfile(input, role) {
  const firstName = text(input.firstName);
  const middleName = text(input.middleName);
  const lastName = text(input.lastName);
  const gender = text(input.gender).toLowerCase();
  const age = Number(input.age);
  const phone = text(input.phone);
  if (!firstName || !lastName || [firstName, middleName, lastName].some(part => part.length > 80)) {
    throw new Error("Enter a first and last name, using no more than 80 characters per name field.");
  }
  if (!Number.isInteger(age) || age < 18 || age > 100) throw new Error("Staff age must be a whole number from 18 to 100.");
  if (!["male", "female"].includes(gender)) throw new Error("Choose the staff member’s gender to set their title.");
  if (phone && (!/^[+\d ()-]+$/.test(phone) || phone.replace(/\D/g, "").length < 7 || phone.length > 30)) throw new Error("Enter a valid contact number or leave it blank.");
  const fields = { firstName, middleName, lastName, age, gender, phone, title: getStaffTitle(role, gender),
    fullName: [firstName, middleName, lastName].filter(Boolean).join(" ") };
  return { ...fields, name: formatStaffName({ ...fields, role }) };
}
