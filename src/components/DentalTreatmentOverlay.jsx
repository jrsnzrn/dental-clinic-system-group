import { getLatestToothTreatments, PROCEDURE_COLOR_LEGEND } from "../utils/dentalTreatments";
import { TOOTH_LABELS, TOOTH_MARKERS } from "../utils/teeth";

function getTreatmentType(title) {
  if (/extraction|extract/i.test(title || "")) return "extraction";
  if (/dentur/i.test(title || "")) return "denture";
  return "present";
}

export default function DentalTreatmentOverlay({ procedures = [] }) {
  const latestTreatments = getLatestToothTreatments(procedures);

  return [...latestTreatments.entries()].map(([toothNumber, treatment]) => {
    const treatmentType = getTreatmentType(treatment.procedure.title);
    const position = TOOTH_MARKERS[toothNumber];

    return (
      <span
        className={`dentalTreatmentTooth ${treatmentType}`}
        key={toothNumber}
        style={{
          top: position.top,
          left: position.left,
          "--treatment-color": treatment.color,
        }}
        role="img"
        aria-label={`${toothNumber} ${TOOTH_LABELS[toothNumber]}, ${treatment.procedure.title}${treatmentType === "extraction" ? ", tooth missing" : treatmentType === "denture" ? ", denture replacement" : ""}`}
        title={`${toothNumber} · ${treatment.procedure.title}`}
      >
        {treatmentType === "extraction" ? (
          <svg viewBox="0 0 100 140" aria-hidden="true">
            <path className="dentalTreatmentGap" d="M17 25c7-13 22-18 33-18s26 5 33 18c5 9 2 22-3 32-6 12-15 17-17 33-1 13-4 31-13 31s-12-18-13-31c-2-16-11-21-17-33-5-10-8-23-3-32Z" />
            <path className="dentalTreatmentExtractionMark" d="M32 52 68 88m0-36L32 88" />
          </svg>
        ) : (
          <svg viewBox="0 0 100 140" aria-hidden="true">
            <path className="dentalTreatmentToothShape" d="M50 5C29 2 12 13 10 34c-2 21 9 35 18 49 6 10 3 39 13 46 7 5 7-25 9-30 2 5 2 35 9 30 10-7 7-36 13-46 9-14 20-28 18-49C88 13 71 2 50 5Z" />
            {treatmentType === "denture" ? (
              <path className="dentalTreatmentDentureBase" d="M26 94c15 8 33 8 48 0" />
            ) : null}
          </svg>
        )}
      </span>
    );
  });
}

export function DentalProcedureLegend() {
  return (
    <div className="dentalProcedureLegend" aria-label="Procedure color legend">
      {PROCEDURE_COLOR_LEGEND.map(({ label, color }) => (
        <span key={label} style={{ "--treatment-color": color }}>
          <i aria-hidden="true" />
          {label}
        </span>
      ))}
    </div>
  );
}
