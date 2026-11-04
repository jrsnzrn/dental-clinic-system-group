import { useEffect, useRef } from "react";
import { useBlocker } from "react-router-dom";

export default function BookingLeaveGuard({ active }) {
  const blocker = useBlocker(({ nextLocation }) => active && nextLocation.pathname !== "/book");
  const dialogRef = useRef(null);
  const blocked = blocker.state === "blocked";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (blocked && !dialog.open) dialog.showModal();
    if (!blocked && dialog.open) dialog.close();
  }, [blocked]);

  useEffect(() => {
    if (!active) return;
    const warn = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);

  return <dialog ref={dialogRef} className="bookingLeaveDialog" aria-labelledby="booking-leave-title"
    onCancel={event => { event.preventDefault(); blocker.reset?.(); }}>
    <h2 id="booking-leave-title">Leave this booking?</h2>
    <p>Your selected services, date, and time will be reset if you leave. Your appointment has not been submitted yet.</p>
    <div className="bookingLeaveActions">
      <button type="button" className="btn" onClick={() => blocker.reset?.()} autoFocus>Keep booking</button>
      <button type="button" className="btn secondary" onClick={() => blocker.proceed?.()}>Leave and reset</button>
    </div>
  </dialog>;
}
