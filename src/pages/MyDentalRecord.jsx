import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebase";
import { buildBracesAccount, formatCurrency, getInstallmentLabel } from "../utils/braces";
import { createEmptyDentalChart, DENTAL_CHART_IMAGE, TOOTH_IDS, TOOTH_LABELS, TOOTH_MARKERS } from "../utils/teeth";
import { formatDateLabel, formatTimeLabel } from "../utils/schedule";

export default function MyDentalRecord() {
  const [user, setUser] = useState(null);
  const [chart, setChart] = useState(createEmptyDentalChart());
  const [bracesAccount, setBracesAccount] = useState(null);
  const [bracesPayments, setBracesPayments] = useState([]);
  const [bracesAdjustments, setBracesAdjustments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTeeth, setSelectedTeeth] = useState(["11"]);
  const [hoveredTooth, setHoveredTooth] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);

      if (!nextUser) {
        setChart(createEmptyDentalChart());
        setBracesAccount(null);
        setBracesPayments([]);
        setBracesAdjustments([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const [chartSnap, bracesAccountSnap, bracesPaymentsSnap, bracesAdjustmentsSnap] = await Promise.all([
          getDoc(doc(db, "dentalCharts", nextUser.uid)),
          getDocs(query(collection(db, "bracesAccounts"), where("uid", "==", nextUser.uid))),
          getDocs(query(collection(db, "bracesPayments"), where("uid", "==", nextUser.uid))),
          getDocs(query(collection(db, "bracesAdjustments"), where("uid", "==", nextUser.uid))),
        ]);

        if (chartSnap.exists()) {
          setChart({
            uid: nextUser.uid,
            generalNotes: chartSnap.data().generalNotes || "",
            teeth: chartSnap.data().teeth || {},
          });
        } else {
          setChart(createEmptyDentalChart(nextUser.uid));
        }

        const rawAccount = bracesAccountSnap.docs[0]
          ? { id: bracesAccountSnap.docs[0].id, ...bracesAccountSnap.docs[0].data() }
          : null;
        const paymentRows = bracesPaymentsSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));

        setBracesPayments(
          paymentRows.sort((a, b) => String(b.paymentDate || "").localeCompare(String(a.paymentDate || "")))
        );
        setBracesAdjustments(
          bracesAdjustmentsSnap.docs
            .map((entry) => ({ id: entry.id, ...entry.data() }))
            .sort((a, b) => `${a.adjustmentDate || ""} ${a.adjustmentTime || ""}`.localeCompare(`${b.adjustmentDate || ""} ${b.adjustmentTime || ""}`))
        );
        setBracesAccount(rawAccount ? buildBracesAccount(rawAccount, paymentRows) : null);
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, []);

  const selectedComment = useMemo(() => {
    const selectedValues = selectedTeeth.map((tooth) => chart.teeth?.[tooth] || "");
    return selectedValues.every((note) => note === selectedValues[0]) ? selectedValues[0] || "" : "";
  }, [chart.teeth, selectedTeeth]);
  const selectedToothEntries = useMemo(
    () =>
      selectedTeeth.map((tooth) => ({
        tooth,
        label: TOOTH_LABELS[tooth],
        note: chart.teeth?.[tooth] || "",
      })),
    [chart.teeth, selectedTeeth]
  );
  const hasMixedSelectedNotes = useMemo(() => {
    const selectedValues = selectedTeeth.map((tooth) => chart.teeth?.[tooth] || "");
    return selectedValues.some((note) => note !== selectedValues[0]);
  }, [chart.teeth, selectedTeeth]);
  const focusedTooth = hoveredTooth || selectedTeeth[selectedTeeth.length - 1] || "11";
  const focusedComment = chart.teeth?.[focusedTooth] || "";
  const teethWithNotes = useMemo(
    () => Object.keys(chart.teeth || {}).filter((tooth) => chart.teeth?.[tooth]?.trim()),
    [chart.teeth]
  );
  const notedSelectedCount = selectedTeeth.filter((tooth) => chart.teeth?.[tooth]?.trim()).length;

  function toggleToothSelection(tooth) {
    setSelectedTeeth((current) => {
      if (current.includes(tooth)) {
        return current.length === 1 ? current : current.filter((entry) => entry !== tooth);
      }

      return [...current, tooth];
    });
  }

  if (!user) {
    return (
      <div className="container">
        <div className="hero bookingHero">
          <div className="bookingHeroGlow" />
          <div className="bookingHeroGrid">
            <div>
              <span className="heroEyebrow">Dental Record</span>
              <h1>My Dental Record</h1>
              <p>Sign in first to view the dentist comments and tooth notes linked to your account.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container bookingPage">
      <div className="hero bookingHero">
        <div className="bookingHeroGlow" />
        <div className="bookingHeroGrid">
          <div>
            <span className="heroEyebrow">Dental Record</span>
            <h1>My Dental Record</h1>
            <p>Review the dentist notes saved to your signed-in patient account, including tooth-by-tooth comments and general observations.</p>
          </div>
          <div className="bookingHeroSummary">
            <div className="bookingSummaryCard">
              <span className="detailLabel">Account</span>
              <strong>{user.email}</strong>
            </div>
            <div className="bookingSummaryCard">
              <span className="detailLabel">Chart status</span>
              <strong>{loading ? "Loading..." : "Available to view"}</strong>
            </div>
            <div className="bookingSummaryCard">
              <span className="detailLabel">Braces tracking</span>
              <strong>{bracesAccount ? bracesAccount.paymentState : "No braces plan yet"}</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="grid" style={{ marginTop: 18 }}>
        <div className="card bookingFormCard">
          <div className="cardHeader">
            <div>
              <h3 className="title">Dental Numbering Guide</h3>
              <p className="sub">Hover a tooth marker to preview it, or tap several teeth to review grouped notes from the numbering guide.</p>
            </div>
          </div>

          <div className="toothViewerMeta">
            <div className="viewerFocusCard">
              <span className="detailLabel">Current focus</span>
              <strong>Tooth {focusedTooth} {" - "} {TOOTH_LABELS[focusedTooth]}</strong>
              <span>{focusedComment ? "Dentist note saved for this tooth." : "No saved tooth note yet."}</span>
            </div>
            <div className="viewerStatusRow">
              <span className="viewerStatusPill active">Dental numbering guide</span>
              <span className="viewerStatusPill">{teethWithNotes.length} teeth with notes</span>
              <span className="viewerStatusPill">{selectedTeeth.length} selected</span>
            </div>
          </div>

          <div className="toothViewer3d">
            <div className="toothChartFrame">
              <div
                className="toothViewerHalo"
                style={{
                  top: TOOTH_MARKERS[focusedTooth]?.top,
                  left: TOOTH_MARKERS[focusedTooth]?.left,
                }}
              />
              <div className="toothImageSurface" aria-label="Tap a tooth marker to inspect one or more teeth">
                <img className="toothReferenceImage" src={DENTAL_CHART_IMAGE} alt="Dental numbering system" />
                <div className="toothViewerOverlay">
                  {TOOTH_IDS.map((tooth) => (
                    <button
                      key={tooth}
                      type="button"
                      className={`toothMarker ${selectedTeeth.includes(tooth) ? "active" : ""} ${focusedTooth === tooth ? "focused" : ""} ${chart.teeth?.[tooth]?.trim() ? "hasNote" : ""}`}
                      style={{
                        top: TOOTH_MARKERS[tooth]?.top,
                        left: TOOTH_MARKERS[tooth]?.left,
                      }}
                      onClick={() => toggleToothSelection(tooth)}
                      onMouseEnter={() => setHoveredTooth(tooth)}
                      onMouseLeave={() => setHoveredTooth("")}
                      onFocus={() => setHoveredTooth(tooth)}
                      onBlur={() => setHoveredTooth("")}
                      aria-pressed={selectedTeeth.includes(tooth)}
                      aria-label={`Tooth ${tooth} ${TOOTH_LABELS[tooth]}`}
                    >
                      {tooth}
                    </button>
                  ))}
                </div>
              </div>
              <div className="toothViewerLegend">
                <span>Interactive guide</span>
                <strong>{focusedTooth}</strong>
                <small>{TOOTH_LABELS[focusedTooth]}</small>
              </div>
            </div>
          </div>

          <div className="toothSelectedChips" style={{ marginTop: 12 }}>
            {selectedTeeth.map((tooth) => (
              <button
                key={tooth}
                type="button"
                className={`toothSelectedChip ${focusedTooth === tooth ? "active" : ""}`}
                onClick={() => setSelectedTeeth([tooth])}
              >
                Tooth {tooth}
              </button>
            ))}
          </div>
        </div>

        <div className="card bookingDetailsCard">
          <div className="cardHeader">
            <div>
              <h3 className="title">Dentist Notes</h3>
              <p className="sub">The note panel updates instantly as you explore the numbering guide and tooth chart.</p>
            </div>
          </div>

          <div className="detailNote historyPanel selectedToothPanel">
            <span className="detailLabel">{selectedTeeth.length > 1 ? "Selected teeth" : "Selected tooth"}</span>
            <p>
              <strong>{selectedTeeth.join(", ")}</strong>
            </p>
            <p>
              {selectedTeeth.length === 1
                ? TOOTH_LABELS[selectedTeeth[0]]
                : "Multiple teeth selected for grouped review."}
            </p>
            {selectedTeeth.length > 1 ? (
              <div className="selectedToothNotesList">
                {selectedToothEntries.map(({ tooth, label, note }) => (
                  <div key={tooth} className="selectedToothNoteItem">
                    <strong>Tooth {tooth}</strong>
                    <span>{label}</span>
                    <p>{note || "No comment saved for this tooth yet."}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p>{selectedComment || "No comment saved for the selected tooth yet."}</p>
            )}
          </div>

          <div className="detailNote historyPanel liveFocusPanel" style={{ marginTop: 12 }}>
            <span className="detailLabel">Live guide focus</span>
            <p>
              <strong>{focusedTooth}</strong> {" - "} {TOOTH_LABELS[focusedTooth]}
            </p>
            <p>{focusedComment || "Hover or tap a tooth marker to preview its details here."}</p>
          </div>

          <div className="detailNote historyPanel" style={{ marginTop: 12 }}>
            <span className="detailLabel">General dentist notes</span>
            <p>{chart.generalNotes || "No general notes saved yet."}</p>
          </div>

          <div className="detailNote historyPanel bracesPatientPanel" style={{ marginTop: 12 }}>
            <span className="detailLabel">Braces payment status</span>
            {bracesAccount ? (
              <>
                <p>
                  <strong>{bracesAccount.paymentState}</strong>
                </p>
                <div className="detailGrid">
                  <div className="detailBox luxeBox">
                    <span className="detailLabel">Total cost</span>
                    <strong>{formatCurrency(bracesAccount.totalCost)}</strong>
                  </div>
                  <div className="detailBox luxeBox">
                    <span className="detailLabel">Amount paid</span>
                    <strong>{formatCurrency(bracesAccount.amountPaid)}</strong>
                  </div>
                  <div className="detailBox luxeBox">
                    <span className="detailLabel">Remaining balance</span>
                    <strong>{formatCurrency(bracesAccount.remainingBalance)}</strong>
                  </div>
                  <div className="detailBox luxeBox">
                    <span className="detailLabel">{getInstallmentLabel(bracesAccount.planFrequency)}</span>
                    <strong>{formatCurrency(bracesAccount.installmentAmount || bracesAccount.monthlyAmount)}</strong>
                  </div>
                  <div className="detailBox luxeBox">
                    <span className="detailLabel">Payment schedule</span>
                    <strong>{bracesAccount.planFrequency}</strong>
                  </div>
                  <div className="detailBox luxeBox">
                    <span className="detailLabel">Discount applied</span>
                    <strong>{((bracesAccount.discountRate || 0) * 100).toFixed(bracesAccount.discountRate ? 1 : 0)}%</strong>
                  </div>
                  <div className="detailBox luxeBox">
                    <span className="detailLabel">Next expected payment</span>
                    <strong>{bracesAccount.nextDueDate ? formatDateLabel(bracesAccount.nextDueDate) : "No due date"}</strong>
                  </div>
                </div>

                <div className="historyList" style={{ marginTop: 12 }}>
                  {bracesPayments.length ? (
                    bracesPayments.map((payment) => (
                      <div key={payment.id} className="historyRow bracesHistoryRow">
                        <div>
                          <strong>{formatCurrency(payment.amount)}</strong>
                          <p>{payment.method || "Manual payment"}{payment.notes ? ` • ${payment.notes}` : ""}</p>
                        </div>
                        <div className="historyMeta">
                          <span>{formatDateLabel(payment.paymentDate)}</span>
                          <span className="statusPill active">{payment.method || "Cash"}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p>No braces payments have been logged yet.</p>
                  )}
                </div>

                <div className="historyList" style={{ marginTop: 12 }}>
                  <span className="detailLabel">Braces adjustment schedule</span>
                  {bracesAdjustments.length ? (
                    bracesAdjustments.map((adjustment) => (
                      <div key={adjustment.id} className="historyRow bracesHistoryRow">
                        <div>
                          <strong>{adjustment.notes || "Braces adjustment visit"}</strong>
                          <p>
                            {adjustment.dentist || "No dentist"}
                            {adjustment.adjustmentTime ? ` • ${formatTimeLabel(adjustment.adjustmentTime)}` : ""}
                          </p>
                        </div>
                        <div className="historyMeta">
                          <span>{formatDateLabel(adjustment.adjustmentDate)}</span>
                          <span className={`statusPill ${String(adjustment.status || "").toLowerCase() === "cancelled" ? "cancelled" : String(adjustment.status || "").toLowerCase() === "completed" ? "approved" : "active"}`}>
                            {adjustment.status || "Scheduled"}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p>No braces adjustments have been scheduled yet.</p>
                  )}
                </div>
              </>
            ) : (
              <p>No braces installment account is linked to your record yet. The clinic can set one up for you when your braces plan starts.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
