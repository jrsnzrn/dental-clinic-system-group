import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";

const GET_STAFF_ACCOUNTS = httpsCallable(functions, "getStaffAccounts");

function toIso(value) {
  return value?.toDate ? value.toDate().toISOString() : value || null;
}

function normalizeStaffAccount(entry) {
  return {
    ...entry,
    createdAt: toIso(entry.createdAt),
    mfaVerifiedUntil: toIso(entry.mfaVerifiedUntil),
    mfaLastVerifiedAt: toIso(entry.mfaLastVerifiedAt),
  };
}

async function loadStaffAccountsFromFirestore() {
  const snapshot = await getDocs(query(collection(db, "admins"), orderBy("createdAt", "desc")));
  return snapshot.docs.map((entry) => normalizeStaffAccount({ id: entry.id, ...entry.data() }));
}

export async function fetchStaffAccounts() {
  try {
    const result = await GET_STAFF_ACCOUNTS();
    return Array.isArray(result.data) ? result.data : [];
  } catch (callableError) {
    console.error("getStaffAccounts callable failed, using Firestore read fallback:", callableError);
    return loadStaffAccountsFromFirestore();
  }
}
