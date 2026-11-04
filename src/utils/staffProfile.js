import { splitFullName } from "./names.js";
import { dentistNameFields } from "../../functions/staffProfile.mjs";
export { buildStaffProfile, formatStaffName, formatStaffDisplayName, getStaffTitle, staffHeaderName, needsStaffProfileSetup } from "../../functions/staffProfile.mjs";

export function staffProfileDraft(account) {
  const bareName = String(account.fullName || account.name || "").replace(/^(?:dra?\.?|mr\.?|ms\.?|admin)\s+/i, "");
  const names = account.firstName || account.lastName ? account : splitFullName(bareName);
  return { firstName: names.firstName || "", middleName: names.middleName || "", lastName: names.lastName || "",
    nickname: account.nickname || "", age: account.age ?? "", gender: account.gender || "", phone: account.phone || "", email: account.email || "", password: "", role: account.role };
}

export function linkedDentistNameFields(account) {
  if (!account) return {};
  return dentistNameFields(account);
}
