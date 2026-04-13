const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

admin.initializeApp();

const db = admin.firestore();
const auth = admin.auth();

const ALLOWED_ROLES = ["admin", "receptionist", "dentist"];

exports.createStaffAccount = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const callerUid = request.auth.uid;
  const callerSnap = await db.collection("admins").doc(callerUid).get();

  if (!callerSnap.exists) {
    throw new HttpsError("permission-denied", "Only admin accounts can create staff.");
  }

  const callerRole = String(callerSnap.data()?.role || "").trim().toLowerCase();
  if (callerRole !== "admin") {
    throw new HttpsError("permission-denied", "Only administrator accounts can create staff.");
  }

  const payload = request.data || {};
  const name = String(payload.name || "").trim();
  const email = String(payload.email || "").trim().toLowerCase();
  const password = String(payload.password || "");
  const role = String(payload.role || "").trim().toLowerCase();

  if (!name) {
    throw new HttpsError("invalid-argument", "Full name is required.");
  }

  if (!email) {
    throw new HttpsError("invalid-argument", "Email is required.");
  }

  if (password.length < 6) {
    throw new HttpsError("invalid-argument", "Password must be at least 6 characters.");
  }

  if (!ALLOWED_ROLES.includes(role)) {
    throw new HttpsError("invalid-argument", "Invalid role.");
  }

  let userRecord;
  try {
    userRecord = await auth.createUser({
      email,
      password,
      displayName: name,
      disabled: false,
    });
  } catch (error) {
    throw new HttpsError("already-exists", error.message || "Could not create auth user.");
  }

  await db.collection("admins").doc(userRecord.uid).set({
    name,
    email,
    role,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: callerUid,
  });

  return {
    uid: userRecord.uid,
    email,
    role,
    name,
  };
});
