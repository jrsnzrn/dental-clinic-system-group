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
  "18": { top: "46.73%", left: "28.30%" },
  "17": { top: "41.36%", left: "28.06%" },
  "16": { top: "35.92%", left: "28.76%" },
  "15": { top: "31.26%", left: "30.41%" },
  "14": { top: "27.68%", left: "33.08%" },
  "13": { top: "24.50%", left: "36.24%" },
  "12": { top: "22.15%", left: "40.85%" },
  "11": { top: "20.47%", left: "46.58%" },
  "21": { top: "20.49%", left: "53.39%" },
  "22": { top: "22.14%", left: "59.08%" },
  "23": { top: "24.50%", left: "63.71%" },
  "24": { top: "27.68%", left: "66.84%" },
  "25": { top: "31.26%", left: "69.48%" },
  "26": { top: "35.92%", left: "71.26%" },
  "27": { top: "41.36%", left: "71.96%" },
  "28": { top: "46.72%", left: "71.73%" },
  "48": { top: "57.76%", left: "28.67%" },
  "47": { top: "62.96%", left: "28.88%" },
  "46": { top: "68.01%", left: "29.49%" },
  "45": { top: "72.92%", left: "30.92%" },
  "44": { top: "77.02%", left: "33.64%" },
  "43": { top: "79.97%", left: "36.95%" },
  "42": { top: "82.32%", left: "41.32%" },
  "41": { top: "83.78%", left: "46.90%" },
  "31": { top: "83.78%", left: "52.94%" },
  "32": { top: "82.30%", left: "58.60%" },
  "33": { top: "79.97%", left: "63.05%" },
  "34": { top: "77.02%", left: "66.37%" },
  "35": { top: "72.92%", left: "69.12%" },
  "36": { top: "68.01%", left: "70.57%" },
  "37": { top: "62.96%", left: "71.17%" },
  "38": { top: "57.77%", left: "71.40%" },
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
