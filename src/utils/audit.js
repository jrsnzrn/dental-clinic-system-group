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
