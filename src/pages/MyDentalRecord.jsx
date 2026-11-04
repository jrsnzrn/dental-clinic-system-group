import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebase";
import ToothNumberDisplay from "../components/ToothNumberDisplay";
import DentalTreatmentOverlay, { DentalProcedureLegend } from "../components/DentalTreatmentOverlay";
import ProcedureBadge from "../components/ProcedureBadge";
import useRecordPagination from "../hooks/useRecordPagination";
import { createEmptyDentalChart, DENTAL_CHART_IMAGE } from "../utils/teeth";

function isPendingProcedure(plan) {
  return ["planned", "pending", "in progress"].includes(
    String(plan.status || "Planned").trim().toLowerCase()
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
  const [chart, setChart] = useState(createEmptyDentalChart());

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);

      if (!nextUser) {
        setChart(createEmptyDentalChart());
        return;
      }

      const chartSnap = await getDoc(doc(db, "dentalCharts", nextUser.uid));

      if (chartSnap.exists()) {
        const chartData = chartSnap.data();
        setChart({
          uid: nextUser.uid,
          generalNotes: chartData.generalNotes || "",
          teeth: chartData.teeth || {},
          patientTreatmentPlans: Array.isArray(chartData.patientTreatmentPlans)
            ? chartData.patientTreatmentPlans
            : [],
        });
      } else {
        setChart(createEmptyDentalChart(nextUser.uid));
      }
    });

    return () => unsub();
  }, []);

  const procedureHistory = (chart.patientTreatmentPlans || []).filter(
    (plan) => !isPendingProcedure(plan)
  );
  const pagination = useRecordPagination(procedureHistory, user?.uid || "");

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

  return (
    <div className="container bookingPage patientDentalRecordsPage">
      <header className="patientDentalRecordsHeader">
        <h1>Dental Records</h1>
        <p>View your dental chart and treatment history.</p>
      </header>

      <div className="patientDentalRecordsGrid">
        <section className="card patientDentalRecordsCard patientDentalChartCard">
          <h2>Dental Numbering System</h2>
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
            </div>
          </div>
          <DentalProcedureLegend />
        </section>

        <section className="card patientDentalRecordsCard patientProcedureHistoryCard">
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
                    <td className="patientProcedureEmpty" colSpan={4}>
                      No procedure history available.
                    </td>
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
      </div>
    </div>
  );
}
