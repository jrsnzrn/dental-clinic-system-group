import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebase";
import { DENTAL_CHART_IMAGE, TOOTH_IDS, TOOTH_LABELS, TOOTH_MARKERS } from "../utils/teeth";
import PatientPaymentReceipts from "../components/PatientPaymentReceipts";
import PaginatedRecords from "../components/PaginatedRecords";

function RecordFacts({ items }) {
  return <dl className="patientRecordFacts">{items.map(([label, value]) => (
    <div key={label}><dt>{label}</dt><dd>{value || "Not recorded"}</dd></div>
  ))}</dl>;
}

export default function MyDentalRecord() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [records, setRecords] = useState({});

  useEffect(() => {
    let stopRecords = [];
    const stopAuth = onAuthStateChanged(auth, nextUser => {
      stopRecords.forEach(stop => stop());
      stopRecords = [];
      setUser(nextUser);
      setAuthReady(true);
      if (!nextUser) return;
      const uid = nextUser.uid;
      const update = (name, value, error = "") => {
        if (auth.currentUser?.uid !== uid) return;
        setRecords(current => {
          const previous = current.uid === uid ? current : { uid, errors: {} };
          return { ...previous, [name]: value, errors: { ...previous.errors, [name]: error } };
        });
      };
      const listen = (name, reference, fallback, convert) => onSnapshot(reference,
        snapshot => update(name, convert(snapshot)),
        error => {
          console.error(`Patient ${name} could not load:`, error);
          update(name, fallback, `${name === "chart" ? "Dental notes" : name === "profile" ? "Patient details" : "Appointment history"} could not be loaded. Please refresh and try again.`);
        });
      stopRecords = [
        listen("chart", doc(db, "dentalCharts", uid), {}, snapshot => snapshot.data() || {}),
        listen("profile", doc(db, "patientProfiles", uid), {}, snapshot => snapshot.data() || {}),
        listen("bookings", query(collection(db, "bookings"), where("uid", "==", uid)), [],
          snapshot => snapshot.docs.map(entry => ({ id: entry.id, ...entry.data() }))),
      ];
    });
    return () => { stopAuth(); stopRecords.forEach(stop => stop()); };
  }, []);

  if (!authReady) return <div className="container"><p role="status">Loading your dental record…</p></div>;
  if (!user) return <div className="container"><h1>My Dental Record</h1><p>Sign in to view your dental record.</p></div>;

  const current = records.uid === user.uid ? records : {};
  const chart = current.chart || {};
  const profile = current.profile || {};
  const bookings = [...(current.bookings || [])].sort((left, right) =>
    `${right.date || ""} ${right.time || ""}`.localeCompare(`${left.date || ""} ${left.time || ""}`));
  const toothNotes = TOOTH_IDS.filter(tooth => String(chart.teeth?.[tooth] || "").trim());
  const loading = !current.chart || !current.profile || !current.bookings;
  const errors = Object.values(current.errors || {}).filter(Boolean);

  return (
    <div className="container bookingPage patientDentalRecordPage">
      <div className="hero bookingHero"><div className="bookingHeroGrid"><div>
        <span className="heroEyebrow">Dental Record</span>
        <h1>My Dental Record</h1>
        <p>Review your patient details, dentist notes, and payment receipts.</p>
      </div></div></div>
      {loading ? <p role="status">Loading your saved records…</p> : null}
      {errors.map(error => <p className="error" role="alert" key={error}>{error}</p>)}

      <section className="card bookingFormCard patientRecordSection" aria-labelledby="record-patient-heading">
        <h2 id="record-patient-heading">Patient details</h2>
        <RecordFacts items={[
          ["Name", profile.fullName || [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(" ") || user.displayName],
          ["Email", profile.email || user.email], ["Phone", profile.phone],
          ["Age", profile.age ? String(profile.age) : ""], ["Patient type", profile.patientType], ["Address", profile.address],
        ]} />
      </section>

      <div className="grid dentalRecordLayout patientRecordSection">
        <section className="card bookingFormCard" aria-labelledby="record-chart-heading">
          <h2 id="record-chart-heading">Tooth chart</h2>
          <p className="sub">This chart is a reference. All saved tooth notes are listed alongside it.</p>
          <div className="toothChartFrame patientReadOnlyChart">
            <div className="toothImageSurface" role="img" aria-label="Read-only dental numbering chart. Tooth notes are listed in Dentist notes.">
              <img className="toothReferenceImage" src={DENTAL_CHART_IMAGE} alt="Dental numbering system" />
              <div className="toothViewerOverlay" aria-hidden="true">
                {TOOTH_IDS.map(tooth => <span key={tooth} className={`toothMarker${toothNotes.includes(tooth) ? " hasNote" : ""}`}
                  style={{ top: TOOTH_MARKERS[tooth]?.top, left: TOOTH_MARKERS[tooth]?.left }}>{tooth}</span>)}
              </div>
            </div>
          </div>
        </section>
        <section className="card bookingDetailsCard" aria-labelledby="record-notes-heading">
          <h2 id="record-notes-heading">Dentist notes</h2>
          <h3>General notes</h3>
          <p className="patientRecordText">{chart.generalNotes || "No general notes saved yet."}</p>
          <h3>Tooth notes</h3>
          {toothNotes.length ? <PaginatedRecords items={toothNotes} resetKey={user.uid} label="tooth notes">{tooth => (
            <article className="detailNote historyPanel" key={tooth}>
              <strong>Tooth {tooth} — {TOOTH_LABELS[tooth]}</strong>
              <p className="patientRecordText">{chart.teeth[tooth]}</p>
            </article>
          )}</PaginatedRecords> : <p>No tooth notes saved yet.</p>}
        </section>
      </div>

      <section className="card bookingFormCard patientRecordSection" aria-label="My payment receipts">
        <PatientPaymentReceipts key={user.uid} uid={user.uid} patientName={profile.fullName || user.displayName || ""} bookings={bookings} />
      </section>
    </div>
  );
}
