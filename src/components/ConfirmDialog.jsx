export default function ConfirmDialog({
  open,
  title = "Confirm action",
  message = "",
  confirmLabel = "Continue",
  cancelLabel = "Cancel",
  tone = "default",
  onConfirm,
  onClose,
}) {
  if (!open) return null;

  const toneLabel =
    tone === "danger"
      ? "Important action"
      : tone === "archive"
        ? "Archive action"
        : "Confirmation";

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className={`modalCard confirmModalCard ${tone}`} onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div className="modalTitleGroup">
            <span className={`modalToneLabel ${tone}`}>{toneLabel}</span>
            <h3>{title}</h3>
          </div>
          <button className="modalClose" type="button" onClick={onClose} aria-label="Close confirmation dialog">
            x
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
      </div>
    </div>
  );
}
