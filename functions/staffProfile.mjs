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
  const name = formatStaffDisplayName(profile);
  return { name, nickname: text(profile.nickname), linkedStaffName: name, title: profile.title || "",
    fullName: "", firstName: "", middleName: "", lastName: "" };
}

export function formatStaffDisplayName(profile = {}) {
  const role = text(profile.role).toLowerCase();
  if (role === "admin") return "ADMIN";
  const stripTitle = value => text(value).replace(/^(?:dra?\.?|mr\.?|ms\.?)\s+/i, "");
  const title = profile.gender ? getStaffTitle(role, profile.gender) : text(profile.title);
  const legacyFirstName = stripTitle(profile.firstName || profile.name || profile.fullName).split(" ")[0];
  const nickname = stripTitle(profile.nickname) || legacyFirstName || (role === "dentist" ? "Dentist" : "Staff");
  return [title, nickname].filter(Boolean).join(" ");
}

export function staffHeaderName(role, profileName) {
  if (text(role).toLowerCase() === "admin") return "ADMIN";
  const name = text(profileName);
  return name && !name.includes("@") ? name : "Staff";
}

export function buildStaffProfile(input, role) {
  const firstName = text(input.firstName);
  const middleName = text(input.middleName);
  const lastName = text(input.lastName);
  const gender = text(input.gender).toLowerCase();
  const age = Number(input.age);
  const phone = text(input.phone);
  const nickname = text(input.nickname);
  if (!firstName || !lastName || [firstName, middleName, lastName].some(part => part.length > 80)) {
    throw new Error("Enter a first and last name, using no more than 80 characters per name field.");
  }
  if (!Number.isInteger(age) || age < 18 || age > 100) throw new Error("Staff age must be a whole number from 18 to 100.");
  if (!["male", "female"].includes(gender)) throw new Error("Choose the staff member’s gender to set their title.");
  if ((!nickname && role !== "admin") || nickname.length > 40) throw new Error("Enter a nickname of up to 40 characters for your display name.");
  if (phone && (!/^[+\d ()-]+$/.test(phone) || phone.replace(/\D/g, "").length < 7 || phone.length > 30)) throw new Error("Enter a valid contact number or leave it blank.");
  const fields = { firstName, middleName, lastName, nickname, age, gender, phone, title: getStaffTitle(role, gender),
    fullName: [firstName, middleName, lastName].filter(Boolean).join(" ") };
  return { ...fields, name: formatStaffName({ ...fields, role }) };
}

export function needsStaffProfileSetup(profile = {}, uid) {
  const role = text(profile.role).toLowerCase();
  if (!["dentist", "receptionist"].includes(role)) return false;
  const confirmed = profile.profileSetupCompleted === true && profile.profileSetupCompletedBy === uid;
  const previouslySavedOwnProfile = profile.profileSetupCompleted == null && profile.updatedBy === uid && Boolean(profile.updatedAt);
  if (!uid || (!confirmed && !previouslySavedOwnProfile)) return true;
  try { buildStaffProfile(profile, role); return false; }
  catch { return true; }
}
