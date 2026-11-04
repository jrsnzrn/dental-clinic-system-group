import { useEffect, useId, useRef } from "react";
import ModalPortal from "./ModalPortal";
import { isTopmostModal } from "../utils/modalUtils";

export default function ConfirmDialog({
  open,
  title = "Confirm action",
  message = "",
  confirmLabel = "Continue",
  cancelLabel = "Cancel",
  showCancelButton = true,
  tone = "default",
  className = "",
  overlayClassName = "",
  icon = null,
  closeIcon = "x",
  onConfirm,
  onClose,
}) {
  const titleId = useId();
  const overlayRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape" && isTopmostModal(overlayRef.current)) onClose?.();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const toneLabel =
    tone === "danger"
      ? "Important action"
      : tone === "archive"
        ? "Archive action"
        : "Confirmation";

  return (
    <ModalPortal>
      <div
        ref={overlayRef}
        className={`modalOverlay confirmDialogOverlay ${overlayClassName}`}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose?.();
        }}
      >
        <div
          className={`modalCard confirmModalCard ${tone} ${className}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="modalHeader">
            <div className="modalTitleGroup">
              {icon ? <span className="confirmModalIcon" aria-hidden="true">{icon}</span> : null}
              <span className={`modalToneLabel ${tone}`}>{toneLabel}</span>
              <h3 id={titleId}>{title}</h3>
            </div>
            <button className="modalClose" type="button" onClick={onClose} aria-label="Close confirmation dialog">
              {closeIcon}
            </button>
          </div>
          <div className="confirmModalBody">
            <p>{message}</p>
          </div>
          <div className="confirmModalActions">
            <button className="btn secondary btnSoft" type="button" onClick={onClose}>
              {cancelLabel}
            </button>
            <button
              className={`btn ${tone === "danger" ? "danger" : tone === "archive" ? "archiveButton" : "btnShine"}`}
              type="button"
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          </div>
<<<<<<< HEAD
          <button className="modalClose" type="button" onClick={onClose} aria-label="Close confirmation dialog">
            {closeIcon}
          </button>
        </div>
        <div className="confirmModalBody">
          <p>{message}</p>
        </div>
        <div className="confirmModalActions">
          {showCancelButton ? (
            <button className="btn secondary btnSoft" type="button" onClick={onClose}>
              {cancelLabel}
            </button>
          ) : null}
          <button
            className={`btn ${tone === "danger" ? "danger" : tone === "archive" ? "archiveButton" : "btnShine"}`}
            type="button"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
=======
>>>>>>> 32699ca33289193c838c8c2e294d2cb2c181be6a
        </div>
      </div>
    </ModalPortal>
  );
}
