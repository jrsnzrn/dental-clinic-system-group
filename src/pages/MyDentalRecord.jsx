import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebase";
import { createEmptyDentalChart, getClosestToothFromPoint, TOOTH_LABELS, TOOTH_MARKERS } from "../utils/teeth";

export default function MyDentalRecord() {
  const [user, setUser] = useState(null);
  const [chart, setChart] = useState(createEmptyDentalChart());
  const [loading, setLoading] = useState(true);
  const [selectedTooth, setSelectedTooth] = useState("11");
  const [hoveredTooth, setHoveredTooth] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);

      if (!nextUser) {
        setChart(createEmptyDentalChart());
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const snap = await getDoc(doc(db, "dentalCharts", nextUser.uid));
        if (snap.exists()) {
          setChart({
            uid: nextUser.uid,
            generalNotes: snap.data().generalNotes || "",
            teeth: snap.data().teeth || {},
          });
        } else {
          setChart(createEmptyDentalChart(nextUser.uid));
        }
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, []);

  const selectedComment = useMemo(() => chart.teeth?.[selectedTooth] || "", [chart.teeth, selectedTooth]);
  const focusedTooth = hoveredTooth || selectedTooth;
  const focusedComment = chart.teeth?.[focusedTooth] || "";
  const teethWithNotes = useMemo(
    () => Object.keys(chart.teeth || {}).filter((tooth) => chart.teeth?.[tooth]?.trim()),
    [chart.teeth]
  );
  function resolveToothFromEvent(event) {
    const image = event.currentTarget.querySelector(".toothReferenceImage");
    const bounds = image?.getBoundingClientRect() || event.currentTarget.getBoundingClientRect();
    const xPercent = ((event.clientX - bounds.left) / bounds.width) * 100;
    const yPercent = ((event.clientY - bounds.top) / bounds.height) * 100;
    return getClosestToothFromPoint(xPercent, yPercent);
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
          </div>
        </div>
      </div>

      <div className="grid" style={{ marginTop: 18 }}>
        <div className="card bookingFormCard">
          <div className="cardHeader">
            <div>
              <h3 className="title">Dental Numbering Guide</h3>
              <p className="sub">Tap or hover a tooth on either view. The numbering guide, tooth chips, and note panel all stay linked to the same tooth focus.</p>
            </div>
          </div>

          <div className="toothViewerMeta">
            <div className="viewerFocusCard">
              <span className="detailLabel">Current focus</span>
              <strong>
                Tooth {focusedTooth} {" - "} {TOOTH_LABELS[focusedTooth]}
              </strong>
              <span>{focusedComment ? "Dentist note saved for this tooth." : "No saved tooth note yet."}</span>
            </div>
            <div className="viewerStatusRow">
              <span className="viewerStatusPill active">Dental numbering guide</span>
              <span className="viewerStatusPill">{teethWithNotes.length} teeth with notes</span>
              <span className="viewerStatusPill">Tap anywhere on the chart</span>
            </div>
          </div>

          <div className="toothViewer3d">
            <div
              className="toothViewerHalo"
              style={{
                top: TOOTH_MARKERS[focusedTooth]?.top,
                left: TOOTH_MARKERS[focusedTooth]?.left,
              }}
            />
            <button
              type="button"
              className="toothImageSurface"
              onClick={(event) => setSelectedTooth(resolveToothFromEvent(event))}
              onMouseMove={(event) => setHoveredTooth(resolveToothFromEvent(event))}
              onMouseLeave={() => setHoveredTooth("")}
              aria-label="Tap inside the dental chart image to inspect a tooth"
            >
              <img className="toothReferenceImage" src="/dental-numbering-system.png" alt="Dental numbering system" />
            </button>
            <div className="toothViewerLegend">
              <span>Interactive guide</span>
              <strong>{focusedTooth}</strong>
            </div>
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
            <span className="detailLabel">Selected tooth</span>
            <p>
              <strong>{selectedTooth}</strong> {" - "} {TOOTH_LABELS[selectedTooth]}
            </p>
            <p>{selectedComment || "No comment saved for this tooth yet."}</p>
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
        </div>
      </div>
    </div>
  );
}
