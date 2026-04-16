import { addDoc, collection, doc, getDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../firebase";
import { getAdminProfile } from "./rbac";

function sanitizeDetails(details = {}) {
  return Object.fromEntries(
    Object.entries(details).filter(([, value]) => value !== undefined)
  );
}

export async function logAdminAction({
  action,
  targetType,
  targetId = "",
  targetLabel = "",
  details = {},
}) {
  const currentUser = auth.currentUser;
  if (!currentUser || !action || !targetType) return;

  let actorName = currentUser.displayName || currentUser.email || "Staff";
  let actorRole = "";

  try {
    const adminSnap = await getDoc(doc(db, "admins", currentUser.uid));
    if (adminSnap.exists()) {
      const profile = getAdminProfile(adminSnap.data());
      actorName = profile.name || actorName;
      actorRole = profile.role || "";
    }
  } catch (error) {
    console.error("Audit actor lookup failed:", error);
  }

  try {
    await addDoc(collection(db, "auditLogs"), {
      actorUid: currentUser.uid,
      actorName,
      actorEmail: currentUser.email || "",
      actorRole,
      action,
      targetType,
      targetId,
      targetLabel,
      details: sanitizeDetails(details),
      createdAt: serverTimestamp(),
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
  update_patient_profile: "Updated patient profile",
  save_dental_chart: "Saved dental chart notes",
  restore_patient: "Restored patient record",
  archive_patient: "Archived patient record",
  restore_booking: "Restored booking record",
  restore_dentist: "Restored dentist record",
  delete_archived_record: "Deleted archived record",
  create_staff_account: "Created staff account",
};

export function getAuditActionLabel(action = "") {
  return ACTION_LABELS[action] || String(action || "Staff activity").replaceAll("_", " ");
}
