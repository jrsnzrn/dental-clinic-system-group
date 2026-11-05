export function getVerifiedWalkInEmail(token = {}) {
  const email = String(token.email || "").trim().toLowerCase();
  return token.email_verified === true
    && token.firebase?.sign_in_provider === "google.com"
    && /^[^@\s]+@(?:gmail|googlemail)\.com$/.test(email)
    ? email : "";
}

export async function linkWalkInPatient({ db, uid, email, timestamp }) {
  const patients = db.collection("patients");
  const profileRef = db.collection("patientProfiles").doc(uid);
  const chartRef = db.collection("dentalCharts").doc(uid);
  return db.runTransaction(async (transaction) => {
    const [staff, profile, matches] = await Promise.all([
      transaction.get(db.collection("admins").doc(uid)),
      transaction.get(profileRef),
      transaction.get(patients.where("email", "==", email).limit(2)),
    ]);
    if (staff.exists || !matches.size) return { status: "no-match" };
    if (matches.size !== 1) return { status: "review" };

    const patient = matches.docs[0];
    const record = patient.data();
    const existingProfile = profile.data() || {};
    if (record.uid === uid && existingProfile.linkedWalkInPatientId === patient.id) return { status: "linked" };
    if (record.uid && record.uid !== uid || existingProfile.linkedWalkInPatientId && existingProfile.linkedWalkInPatientId !== patient.id
      || [record.archiveStatus, record.status].some((value) => String(value || "").toLowerCase() === "archived")) {
      return { status: "review" };
    }

    const [bookings, ownedPatients, sourceChart, targetChart, ...related] = await Promise.all([
      transaction.get(db.collection("bookings").where("patientId", "==", patient.id)),
      transaction.get(patients.where("uid", "==", uid).limit(2)),
      transaction.get(db.collection("dentalCharts").doc(patient.id)),
      transaction.get(chartRef),
      ...["payments", "paymentTreatmentSummaries", "bracesPayments", "bracesAccounts"].map((collection) =>
        transaction.get(db.collection(collection).where("patientId", "==", patient.id))
      ),
      transaction.get(db.collection("bracesAccounts").doc(patient.id)),
    ]);

    const walkInBookings = bookings.docs.filter((entry) => entry.data().walkIn === true);
    if (!walkInBookings.some((entry) => String(entry.data().email || "").trim().toLowerCase() === email)) {
      return { status: "no-match" };
    }
    if (ownedPatients.docs.some((entry) => entry.id !== patient.id) || (sourceChart.exists && targetChart.exists)) {
      return { status: "review" };
    }

    const linkedDocuments = new Map([...bookings.docs, ...related.flatMap((snapshot) => snapshot.docs || (snapshot.exists ? [snapshot] : []))]
      .map((entry) => [entry.ref.path, entry]));
    const conflictingOwner = (entry) => entry.data()?.uid && entry.data().uid !== uid;
    if ([...linkedDocuments.values()].some(conflictingOwner) || (sourceChart.exists && conflictingOwner(sourceChart))
      || linkedDocuments.size > 440) {
      return { status: "review" };
    }

    const profileData = Object.fromEntries(["firstName", "middleName", "lastName", "age", "phone"].map((key) => [
      key, existingProfile[key] || record[key] || "",
    ]));
    const authorizedDentistUids = [...new Set([
      ...(record.authorizedDentistUids || []),
      ...(existingProfile.authorizedDentistUids || []),
      ...(sourceChart.data()?.authorizedDentistUids || []),
      ...walkInBookings.map((entry) => entry.data().dentistStaffUid).filter(Boolean),
    ])];
    transaction.update(patient.ref, { uid, authorizedDentistUids });
    transaction.set(profileRef, {
      ...profileData,
      uid,
      email,
      fullName: existingProfile.fullName || record.name || [profileData.firstName, profileData.middleName, profileData.lastName].filter(Boolean).join(" "),
      patientType: existingProfile.patientType && existingProfile.patientType !== "New Patient"
        ? existingProfile.patientType : record.patientType || "Regular",
      ...(record.bracesType && !existingProfile.bracesType ? { bracesType: record.bracesType } : {}),
      authorizedDentistUids,
      linkedWalkInPatientId: patient.id,
      updatedAt: timestamp,
      ...(profile.exists ? {} : { createdAt: timestamp }),
    }, { merge: true });
    for (const entry of linkedDocuments.values()) {
      if (!entry.data().uid) transaction.update(entry.ref, { uid });
    }
    if (sourceChart.exists) transaction.set(chartRef, { ...sourceChart.data(), uid, authorizedDentistUids });
    return { status: "linked" };
  });
}
