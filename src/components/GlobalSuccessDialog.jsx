import { useEffect, useRef, useState } from "react";
import ModalPortal from "./ModalPortal";
import { isTopmostModal } from "../utils/modalUtils";

export default function GlobalSuccessDialog() {
  const [dialog, setDialog] = useState(null);
  const overlayRef = useRef(null);

  useEffect(() => {
    function showSuccess(event) {
      setDialog(event.detail);
    }

    window.addEventListener("topdent:success", showSuccess);
    return () => window.removeEventListener("topdent:success", showSuccess);
  }, []);

  useEffect(() => {
    if (!dialog) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function closeOnEscape(event) {
      if (event.key === "Escape" && isTopmostModal(overlayRef.current)) {
        setDialog(null);
      }
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [dialog]);

  if (!dialog) return null;

  return (
    <ModalPortal>
      <div
        ref={overlayRef}
        className="globalSuccessOverlay"
        onClick={(event) => {
          if (event.target === event.currentTarget) setDialog(null);
        }}
      >
        <section
          className="globalSuccessDialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="global-success-title"
          aria-describedby="global-success-message"
        >
          <button
            className="globalSuccessClose"
            type="button"
            aria-label="Close success message"
            onClick={() => setDialog(null)}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="m5 5 10 10M15 5 5 15" />
            </svg>
          </button>
          <span className="globalSuccessIcon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="m5 12.5 4.5 4.5L19 7" />
            </svg>
          </span>
          <h2 id="global-success-title">{dialog.title || "Success"}</h2>
          {dialog.message ? <p id="global-success-message">{dialog.message}</p> : null}
          {dialog.content ? <div className="globalSuccessContent">{dialog.content}</div> : null}
          <button
            className="globalSuccessOkay"
            type="button"
            onClick={() => {
              const { onAction } = dialog;
              setDialog(null);
              onAction?.();
            }}
          >
            {dialog.actionLabel || "OK"}
          </button>
        </section>
      </div>
    </ModalPortal>
  );
}
