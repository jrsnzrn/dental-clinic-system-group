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
  "18": { top: "34%", left: "20%" },
  "17": { top: "29%", left: "24%" },
  "16": { top: "25%", left: "28%" },
  "15": { top: "21%", left: "32%" },
  "14": { top: "18%", left: "38%" },
  "13": { top: "14%", left: "44%" },
  "12": { top: "10%", left: "49%" },
  "11": { top: "8%", left: "53%" },
  "21": { top: "8%", left: "57%" },
  "22": { top: "10%", left: "61%" },
  "23": { top: "14%", left: "66%" },
  "24": { top: "18%", left: "72%" },
  "25": { top: "21%", left: "77%" },
  "26": { top: "25%", left: "81%" },
  "27": { top: "29%", left: "85%" },
  "28": { top: "34%", left: "89%" },
  "48": { top: "65%", left: "20%" },
  "47": { top: "70%", left: "24%" },
  "46": { top: "76%", left: "28%" },
  "45": { top: "81%", left: "33%" },
  "44": { top: "86%", left: "39%" },
  "43": { top: "90%", left: "45%" },
  "42": { top: "93%", left: "50%" },
  "41": { top: "95%", left: "54%" },
  "31": { top: "95%", left: "58%" },
  "32": { top: "93%", left: "62%" },
  "33": { top: "90%", left: "67%" },
  "34": { top: "86%", left: "73%" },
  "35": { top: "81%", left: "79%" },
  "36": { top: "76%", left: "84%" },
  "37": { top: "70%", left: "88%" },
  "38": { top: "65%", left: "92%" },
};

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
