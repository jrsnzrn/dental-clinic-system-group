import { createPortal } from "react-dom";

export default function ModalPortal({ children }) {
  if (typeof document === "undefined") return null;

  const portalTarget = document.getElementById("root") || document.body;
  return createPortal(children, portalTarget);
}
