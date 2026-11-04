import { getToothName } from "../utils/teeth";
import { getProcedureColor } from "../utils/dentalTreatments";

export default function ToothNumberDisplay({ toothNumbers, toothNumber, procedure }) {
  const values = toothNumbers ?? (toothNumber == null ? [] : [toothNumber]);
  const numbers = (Array.isArray(values) ? values : String(values).split(","))
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);

  if (!numbers.length) return "—";

  const treatmentColor = getProcedureColor(procedure);

  return (
    <span
      className={`toothNumberDisplay${treatmentColor ? " hasTreatmentColor" : ""}`}
      style={treatmentColor ? { "--treatment-color": treatmentColor } : undefined}
    >
      {treatmentColor ? <i className="toothTreatmentDot" aria-hidden="true" /> : null}
      {numbers.map((number, index) => {
        const name = getToothName(number);
        return (
          <span className="toothNumberDisplayItem" key={`${number}-${index}`}>
            <strong>{number}</strong>
            {name ? <span className="toothNumberDisplayName">· {name}</span> : null}
            {index < numbers.length - 1 ? "," : ""}
          </span>
        );
      })}
    </span>
  );
}
