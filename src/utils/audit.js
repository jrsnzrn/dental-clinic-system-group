import { httpsCallable } from "firebase/functions";
import { auth, functions } from "../firebase";

function sanitizeDetails(details = {}) {
  return Object.fromEntries(
    Object.entries(details).filter(([, value]) => value !== undefined)
  );
}

const RECORD_ADMIN_AUDIT_LOG = httpsCallable(functions, "recordAdminAuditLog");

export async function logAdminAction({
  action,
  targetType,
  targetId = "",
  targetLabel = "",
  details = {},
}) {
  const currentUser = auth.currentUser;
  if (!currentUser || !action || !targetType) return;

  try {
    await RECORD_ADMIN_AUDIT_LOG({
      action,
      targetType,
      targetId,
      targetLabel,
      details: sanitizeDetails(details),
    });
  } catch (error) {
    console.error("Audit log write failed:", error);
  }
}

const ACTION_LABELS = {
  update_booking_status: "Updated booking status",
  archive_booking: "Archived booking",
  clear_booking_check_in: "Cleared patient check-in",
  mark_booking_check_in: "Marked patient as checked in",
  approve_reschedule_request: "Approved reschedule request",
  decline_reschedule_request: "Declined reschedule request",
  request_staff_mfa_code: "Requested staff MFA code",
  set_staff_mfa_required: "Updated staff MFA requirement",
  update_patient_profile: "Updated patient profile",
  save_dental_chart: "Saved dental chart notes",
  restore_patient: "Restored patient record",
  archive_patient: "Archived patient record",
  restore_booking: "Restored booking record",
  restore_dentist: "Restored dentist record",
  delete_archived_record: "Deleted archived record",
  create_staff_account: "Created staff account",
  archive_staff_account: "Archived staff account",
  restore_staff_account: "Restored staff account",
};

export function getAuditActionLabel(action = "") {
  return ACTION_LABELS[action] || String(action || "Staff activity").replaceAll("_", " ");
}
