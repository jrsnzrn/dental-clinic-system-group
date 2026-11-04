import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { ROLES } from "../utils/rbac";

export default function useStaffDashboard(uid, role, retry) {
  const [state, setState] = useState({});
  const identity = JSON.stringify([uid, role, retry]);
  useEffect(() => {
    if (!uid || ![ROLES.DENTIST, ROLES.RECEPTIONIST].includes(role)) return;
    let active = true;
    let version = 0;
    let bookingListeners = [];
    const update = patch => {
      if (active) setState(current => ({ ...(current.identity === identity ? current : { identity }), ...patch }));
    };
    const fail = error => {
      console.error("Staff dashboard could not load:", error);
      update({ error: "Appointments could not be loaded. Please try again.", loading: false });
    };
    const stopProfile = onSnapshot(doc(db, "admins", uid), snapshot => update({ profile: snapshot.data() || {} }),
      () => update({ profile: {} }));
    const parse = snapshot => snapshot.docs.map(entry => ({ ...entry.data(), id: entry.id }));
    let stopSource;
    if (role === ROLES.RECEPTIONIST) {
      stopSource = onSnapshot(collection(db, "bookings"), snapshot => update({ bookings: parse(snapshot), loading: false }), fail);
    } else {
      // Each booking query is limited to a dentist profile linked to this staff UID.
      stopSource = onSnapshot(query(collection(db, "dentists"), where("linkedStaffUid", "==", uid)), snapshot => {
        const request = ++version;
        bookingListeners.forEach(stop => stop());
        bookingListeners = [];
        update({ bookings: [], loading: snapshot.size > 0, linked: snapshot.size > 0, error: "" });
        const sources = new Map();
        for (const dentist of snapshot.docs) {
          bookingListeners.push(onSnapshot(query(collection(db, "bookings"), where("dentistId", "==", dentist.id)), bookings => {
            if (!active || request !== version) return;
            sources.set(dentist.id, parse(bookings));
            const combined = new Map([...sources.values()].flat().map(booking => [booking.id, booking]));
            update({ bookings: [...combined.values()], loading: sources.size !== snapshot.size });
          }, error => { if (request === version) fail(error); }));
        }
      }, fail);
    }
    return () => {
      active = false;
      stopProfile();
      stopSource();
      bookingListeners.forEach(stop => stop());
    };
  }, [uid, role, identity]);
  return state.identity === identity ? state : { loading: true };
}
