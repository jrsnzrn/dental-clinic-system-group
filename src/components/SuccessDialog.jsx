import { useEffect, useId, useRef } from "react";

export default function SuccessDialog({ message, title = "Action completed", onConfirm }) {
  const dialogRef = useRef(null);
  const titleId = useId();
  const messageId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (message && !dialog.open) dialog.showModal();
    if (!message && dialog.open) dialog.close();
  }, [message]);

  return <dialog ref={dialogRef} className="actionSuccessDialog" role="alertdialog"
    aria-labelledby={titleId} aria-describedby={messageId} onCancel={event => event.preventDefault()}>
    <span className="actionSuccessIcon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 12 4 4 8-8" /></svg></span>
    <h2 id={titleId}>{title}</h2>
    <p id={messageId}>{message}</p>
    <button type="button" className="btn btnShine" autoFocus onClick={onConfirm}>OK</button>
  </dialog>;
}
