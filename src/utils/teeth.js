export const TEETH_ROWS = [
  ["18", "17", "16", "15", "14", "13", "12", "11"],
  ["21", "22", "23", "24", "25", "26", "27", "28"],
  ["48", "47", "46", "45", "44", "43", "42", "41"],
  ["31", "32", "33", "34", "35", "36", "37", "38"],
];

export const TOOTH_LABELS = {
  "11": "Upper right central incisor",
  "12": "Upper right lateral incisor",
  "13": "Upper right canine",
  "14": "Upper right first premolar",
  "15": "Upper right second premolar",
  "16": "Upper right first molar",
  "17": "Upper right second molar",
  "18": "Upper right third molar",
  "21": "Upper left central incisor",
  "22": "Upper left lateral incisor",
  "23": "Upper left canine",
  "24": "Upper left first premolar",
  "25": "Upper left second premolar",
  "26": "Upper left first molar",
  "27": "Upper left second molar",
  "28": "Upper left third molar",
  "31": "Lower left central incisor",
  "32": "Lower left lateral incisor",
  "33": "Lower left canine",
  "34": "Lower left first premolar",
  "35": "Lower left second premolar",
  "36": "Lower left first molar",
  "37": "Lower left second molar",
  "38": "Lower left third molar",
  "41": "Lower right central incisor",
  "42": "Lower right lateral incisor",
  "43": "Lower right canine",
  "44": "Lower right first premolar",
  "45": "Lower right second premolar",
  "46": "Lower right first molar",
  "47": "Lower right second molar",
  "48": "Lower right third molar",
};

export const TOOTH_MARKERS = {
  "18": { top: "47.2%", left: "28.1%" },
  "17": { top: "41.5%", left: "28.4%" },
  "16": { top: "36.2%", left: "28.6%" },
  "15": { top: "31.5%", left: "30.3%" },
  "14": { top: "27.5%", left: "33.0%" },
  "13": { top: "25.2%", left: "36.6%" },
  "12": { top: "22.0%", left: "40.5%" },
  "11": { top: "20.1%", left: "47.6%" },
  "21": { top: "20.1%", left: "54.2%" },
  "22": { top: "21.4%", left: "60.2%" },
  "23": { top: "24.9%", left: "64.9%" },
  "24": { top: "27.2%", left: "67.9%" },
  "25": { top: "31.1%", left: "69.6%" },
  "26": { top: "35.8%", left: "71.1%" },
  "27": { top: "40.9%", left: "71.8%" },
  "28": { top: "46.6%", left: "72.2%" },
  "48": { top: "57.6%", left: "28.7%" },
  "47": { top: "62.8%", left: "29.0%" },
  "46": { top: "68.0%", left: "30.0%" },
  "45": { top: "72.8%", left: "31.4%" },
  "44": { top: "76.8%", left: "34.6%" },
  "43": { top: "79.8%", left: "37.7%" },
  "42": { top: "82.9%", left: "41.9%" },
  "41": { top: "84.3%", left: "46.6%" },
  "31": { top: "84.5%", left: "53.9%" },
  "32": { top: "83.4%", left: "60.0%" },
  "33": { top: "80.2%", left: "64.6%" },
  "34": { top: "77.8%", left: "67.4%" },
  "35": { top: "73.2%", left: "70.8%" },
  "36": { top: "68.3%", left: "71.8%" },
  "37": { top: "63.2%", left: "73.0%" },
  "38": { top: "58.0%", left: "72.6%" },
};

export const TOOTH_IDS = Object.keys(TOOTH_MARKERS);
export const DENTAL_CHART_IMAGE = "/dental-numbering-system-proper.png";

function parsePercent(value) {
  return Number(String(value).replace("%", ""));
}

export function getClosestToothFromPoint(xPercent, yPercent) {
  let closestTooth = "11";
  let closestDistance = Number.POSITIVE_INFINITY;

  Object.entries(TOOTH_MARKERS).forEach(([tooth, position]) => {
    const dx = parsePercent(position.left) - xPercent;
    const dy = parsePercent(position.top) - yPercent;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < closestDistance) {
      closestDistance = distance;
      closestTooth = tooth;
    }
  });

  return closestTooth;
}

export function createEmptyDentalChart(uid = "") {
  return {
    uid,
    generalNotes: "",
    teeth: {},
  };
}
