import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebase";
import ToothNumberDisplay from "../components/ToothNumberDisplay";
import DentalTreatmentOverlay, { DentalProcedureLegend } from "../components/DentalTreatmentOverlay";
import ProcedureBadge from "../components/ProcedureBadge";
import PatientPaymentReceipts from "../components/PatientPaymentReceipts";
import PaginatedRecords from "../components/PaginatedRecords";
import useRecordPagination from "../hooks/useRecordPagination";
import { DENTAL_CHART_IMAGE, TOOTH_IDS, TOOTH_LABELS, TOOTH_MARKERS } from "../utils/teeth";

function isPendingProcedure(plan) {
  return ["planned", "pending", "in progress"].includes(
    String(plan.status || "Planned").trim().toLowerCase()
  );
}

function RecordFacts({ items }) {
  return (
    <dl className="patientRecordFacts">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value || "Not recorded"}</dd>
        </div>
      ))}
    </dl>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M7.5 5h9M7.5 10h9M7.5 15h9" />
      <path d="M3.5 5h.01M3.5 10h.01M3.5 15h.01" />
    </svg>
  );
}

function PageArrow({ direction }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d={direction === "previous" ? "M12.5 4.5 7 10l5.5 5.5" : "m7.5 4.5 5.5 5.5-5.5 5.5"} />
    </svg>
  );
}

export default function MyDentalRecord() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [records, setRecords] = useState({});

  useEffect(() => {
    let stopRecords = [];
    const stopAuth = onAuthStateChanged(auth, (nextUser) => {
      stopRecords.forEach((stop) => stop());
      stopRecords = [];
      setUser(nextUser);
      setAuthReady(true);

      if (!nextUser) {
        setRecords({});
        return;
      }

      const uid = nextUser.uid;
      const update = (name, value, error = "") => {
        if (auth.currentUser?.uid !== uid) return;
        setRecords((current) => {
          const previous = current.uid === uid ? current : { uid, errors: {} };
          return {
            ...previous,
            [name]: value,
            errors: { ...previous.errors, [name]: error },
          };
        });
      };
      const listen = (name, reference, fallback, convert) => onSnapshot(
        reference,
        (snapshot) => update(name, convert(snapshot)),
        (error) => {
          console.error(`Patient ${name} could not load:`, error);
          const label = name === "chart"
            ? "Dental notes"
            : name === "profile"
              ? "Patient details"
              : "Appointment history";
          update(name, fallback, `${label} could not be loaded. Please refresh and try again.`);
        }
      );

      stopRecords = [
        listen("chart", doc(db, "dentalCharts", uid), {}, (snapshot) => snapshot.data() || {}),
        listen("profile", doc(db, "patientProfiles", uid), {}, (snapshot) => snapshot.data() || {}),
        listen(
          "bookings",
          query(collection(db, "bookings"), where("uid", "==", uid)),
          [],
          (snapshot) => snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }))
        ),
      ];
    });

    return () => {
      stopAuth();
      stopRecords.forEach((stop) => stop());
    };
  }, []);

  const current = records.uid === user?.uid ? records : {};
  const chart = current.chart || {};
  const profile = current.profile || {};
  const bookings = [...(current.bookings || [])].sort((left, right) =>
    `${right.date || ""} ${right.time || ""}`.localeCompare(`${left.date || ""} ${left.time || ""}`)
  );
  const toothNotes = TOOTH_IDS.filter((tooth) => String(chart.teeth?.[tooth] || "").trim());
  const procedureHistory = (chart.patientTreatmentPlans || []).filter(
    (plan) => !isPendingProcedure(plan)
  );
  const pagination = useRecordPagination(procedureHistory, user?.uid || "");
  const loading = !current.chart || !current.profile || !current.bookings;
  const errors = Object.values(current.errors || {}).filter(Boolean);

  if (!authReady) {
    return <div className="container"><p role="status">Loading your dental record…</p></div>;
  }

  if (!user) {
    return (
      <div className="container bookingPage patientDentalRecordsPage">
        <header className="patientDentalRecordsHeader">
          <h1>Dental Records</h1>
          <p>View your dental chart and treatment history.</p>
        </header>
        <p className="patientDentalRecordsSignIn">
          Sign in first to view the dental records linked to your account.
        </p>
      </div>
    );
  }

  const fullName = profile.fullName
    || [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(" ")
    || user.displayName;

  return (
    <div className="container bookingPage patientDentalRecordPage patientDentalRecordsPage">
      <header className="patientDentalRecordsHeader">
        <h1>Dental Records</h1>
        <p>Review your patient details, dental chart, treatment history, and payment receipts.</p>
      </header>

      {loading ? <p role="status">Loading your saved records…</p> : null}
      {errors.map((error) => <p className="error" role="alert" key={error}>{error}</p>)}

      <section className="card patientDentalRecordsCard patientRecordSection" aria-labelledby="record-patient-heading">
        <h2 id="record-patient-heading">Patient details</h2>
        <RecordFacts items={[
          ["Name", fullName],
          ["Email", profile.email || user.email],
          ["Phone", profile.phone],
          ["Age", profile.age ? String(profile.age) : ""],
          ["Patient type", profile.patientType],
          ["Address", profile.address],
        ]} />
      </section>

      <div className="patientDentalRecordsGrid patientRecordSection">
        <section className="card patientDentalRecordsCard patientDentalChartCard" aria-labelledby="record-chart-heading">
          <h2 id="record-chart-heading">Dental Numbering System</h2>
          <div className="patientDentalChartFrame">
            <div className="patientDentalChartSurface">
              <img
                className="patientDentalChartImage"
                src={DENTAL_CHART_IMAGE}
                alt="FDI dental numbering system showing all 32 permanent teeth and four quadrants"
              />
              <div className="patientDentalChartOverlay">
                <DentalTreatmentOverlay procedures={procedureHistory} />
              </div>
              <div className="toothViewerOverlay" aria-hidden="true">
                {TOOTH_IDS.map((tooth) => (
                  <span
                    key={tooth}
                    className={`toothMarker${toothNotes.includes(tooth) ? " hasNote" : ""}`}
                    style={{ top: TOOTH_MARKERS[tooth]?.top, left: TOOTH_MARKERS[tooth]?.left }}
                  >
                    {tooth}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <DentalProcedureLegend />
          <p className="patientRecordText">Highlighted teeth have saved notes; treatment markings show the latest recorded procedures.</p>
        </section>

        <section className="card patientDentalRecordsCard" aria-labelledby="record-notes-heading">
          <h2 id="record-notes-heading">Dentist notes</h2>
          <h3>General notes</h3>
          <p className="patientRecordText">{chart.generalNotes || "No general notes saved yet."}</p>
          <h3>Tooth notes</h3>
          {toothNotes.length ? (
            <PaginatedRecords items={toothNotes} resetKey={user.uid} label="tooth notes">
              {(tooth) => (
                <article className="detailNote historyPanel" key={tooth}>
                  <strong>Tooth {tooth} — {TOOTH_LABELS[tooth]}</strong>
                  <p className="patientRecordText">{chart.teeth[tooth]}</p>
                </article>
              )}
            </PaginatedRecords>
          ) : <p>No tooth notes saved yet.</p>}
        </section>
      </div>

      <section className="card patientDentalRecordsCard patientProcedureHistoryCard patientRecordSection">
        <h2>Procedure History</h2>
        <div className="patientProcedureTableWrap">
          <table className="patientProcedureTable">
            <thead>
              <tr>
                <th scope="col">TOOTH NUMBER</th>
                <th scope="col">PROCEDURE</th>
                <th scope="col">PROCEDURE DATE</th>
                <th scope="col">PROCEDURE NOTES</th>
              </tr>
            </thead>
            <tbody>
              {pagination.items.length ? (
                pagination.items.map((procedure, index) => (
                  <tr key={`${procedure.createdAt || procedure.title}-${index}`}>
                    <td data-label="TOOTH NUMBER">
                      <ToothNumberDisplay toothNumbers={procedure.toothNumbers} procedure={procedure.title} />
                    </td>
                    <td data-label="PROCEDURE"><ProcedureBadge procedure={procedure.title} /></td>
                    <td data-label="PROCEDURE DATE">{procedure.targetDate || "—"}</td>
                    <td data-label="PROCEDURE NOTES">{procedure.instructions || "—"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="patientProcedureEmpty" colSpan={4}>No procedure history available.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <footer className="patientProcedureFooter">
          <div className="patientProcedureRecordCount" role="status">
            <ListIcon />
            <span>{pagination.total} {pagination.total === 1 ? "record" : "records"}</span>
          </div>
          {pagination.pageCount > 1 ? (
            <nav className="patientProcedurePagination" aria-label="Procedure history pagination">
              <button
                type="button"
                aria-label="Previous page"
                disabled={pagination.page === 1}
                onClick={() => pagination.setPage(pagination.page - 1)}
              >
                <PageArrow direction="previous" />
              </button>
              <span aria-current="page">{pagination.page}</span>
              <button
                type="button"
                aria-label="Next page"
                disabled={pagination.page === pagination.pageCount}
                onClick={() => pagination.setPage(pagination.page + 1)}
              >
                <PageArrow direction="next" />
              </button>
            </nav>
          ) : null}
        </footer>
      </section>

      <section className="card patientDentalRecordsCard patientRecordSection" aria-label="My payment receipts">
        <PatientPaymentReceipts
          key={user.uid}
          uid={user.uid}
          patientName={fullName || ""}
          bookings={bookings}
        />
      </section>
    </div>
  );
}
