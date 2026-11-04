import { getProcedureColor } from "../utils/dentalTreatments";

export default function ProcedureBadge({ procedure }) {
  const color = getProcedureColor(procedure);

  return (
    <span
      className={`dentalProcedureBadge${color ? " colored" : ""}`}
      style={color ? { "--treatment-color": color } : undefined}
    >
      {procedure || "—"}
    </span>
  );
}
