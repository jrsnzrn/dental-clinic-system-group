import { TOOTH_MARKERS } from "./teeth";

export const PROCEDURE_COLOR_LEGEND = [
  { label: "Extraction", pattern: /extraction|extract/i, color: "#F87171" },
  { label: "Restoration", pattern: /restoration|filling/i, color: "#60A5FA" },
  { label: "Dentures", pattern: /dentur/i, color: "#A78BFA" },
  { label: "Crowns", pattern: /crown/i, color: "#FBBF24" },
  { label: "Root Canal", pattern: /root[\s-]*canal/i, color: "#34D399" },
];

export function getProcedureColor(procedure) {
  const title = String(procedure || "");
  return PROCEDURE_COLOR_LEGEND.find(({ pattern }) => pattern.test(title))?.color || "";
}

function getTimestamp(value) {
  if (value?.toDate) return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  return Date.parse(value || "") || 0;
}

function getProcedureDate(procedure) {
  return getTimestamp(procedure.targetDate) || getTimestamp(procedure.createdAt);
}

function getSameDatePriority(procedure) {
  const title = String(procedure.title || "");
  if (/extraction|extract/i.test(title)) return 3;
  if (/dentur/i.test(title)) return 2;
  return 1;
}

function isLaterTreatment(candidate, current) {
  if (candidate.date !== current.date) return candidate.date > current.date;

  const candidateCreated = getTimestamp(candidate.procedure.createdAt);
  const currentCreated = getTimestamp(current.procedure.createdAt);
  if (candidateCreated !== currentCreated) return candidateCreated > currentCreated;

  // Same-date records prefer later creation time, then extraction, dentures, other treatments, title, and record content.
  const candidatePriority = getSameDatePriority(candidate.procedure);
  const currentPriority = getSameDatePriority(current.procedure);
  if (candidatePriority !== currentPriority) return candidatePriority > currentPriority;

  const candidateTitle = String(candidate.procedure.title || "");
  const currentTitle = String(current.procedure.title || "");
  if (candidateTitle !== currentTitle) return candidateTitle.localeCompare(currentTitle) < 0;

  return JSON.stringify(candidate.procedure).localeCompare(JSON.stringify(current.procedure)) > 0;
}

export function getLatestToothTreatments(procedures = []) {
  const latestByTooth = new Map();

  procedures.forEach((procedure) => {
    const color = getProcedureColor(procedure.title);
    if (!color) return;

    const toothNumbers = Array.isArray(procedure.toothNumbers)
      ? procedure.toothNumbers
      : String(procedure.toothNumbers || "").split(",");
    toothNumbers.forEach((value) => {
      const toothNumber = String(value || "").trim();
      if (!TOOTH_MARKERS[toothNumber]) return;

      const candidate = {
        procedure,
        color,
        date: getProcedureDate(procedure),
      };
      const current = latestByTooth.get(toothNumber);
      if (!current || isLaterTreatment(candidate, current)) {
        latestByTooth.set(toothNumber, candidate);
      }
    });
  });

  return latestByTooth;
}
