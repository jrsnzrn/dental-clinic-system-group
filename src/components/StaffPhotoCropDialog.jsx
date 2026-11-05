import { useEffect, useId, useRef, useState } from "react";
import { MAX_STAFF_PROFILE_PHOTO_LENGTH } from "../../functions/staffProfile.mjs";
import { encodePhoto } from "../utils/receiptPhotos";

const clamp = (value) => Math.max(0, Math.min(1, value));
const OUTPUT_SIZE = 256;

export default function StaffPhotoCropDialog({ image, onCancel, onApply }) {
  const dialogRef = useRef(null);
  const drag = useRef(null);
  const titleId = useId();
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0.5, y: 0.5 });
  const [error, setError] = useState("");
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const side = Math.min(width, height) / zoom;
  const overflowX = width - side;
  const overflowY = height - side;
  const left = position.x * overflowX;
  const top = position.y * overflowY;

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  function move(origin, deltaX, deltaY) {
    setPosition({
      x: overflowX ? clamp(origin.x - deltaX * side / overflowX) : origin.x,
      y: overflowY ? clamp(origin.y - deltaY * side / overflowY) : origin.y,
    });
  }

  function applyCrop() {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const context = canvas.getContext("2d");
      context.fillStyle = "white";
      context.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
      context.drawImage(image, left, top, side, side, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
      onApply(encodePhoto(canvas, MAX_STAFF_PROFILE_PHOTO_LENGTH, "This crop is too large. Try zooming in or choosing another photo."));
    } catch (failure) {
      setError(failure.message || "Could not apply the crop.");
    }
  }

  return (
    <dialog ref={dialogRef} className="staffPhotoCropDialog" aria-labelledby={titleId} onCancel={(event) => {
      event.preventDefault();
      onCancel();
    }}>
      <h3 id={titleId}>Crop profile picture</h3>
      <p>Drag the photo or use the arrow keys to choose what appears inside the circle.</p>
      <div
        className="staffPhotoCropFrame"
        tabIndex={0}
        aria-label="Crop preview. Use arrow keys to move the photo."
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, position };
        }}
        onPointerMove={(event) => {
          if (drag.current?.pointerId !== event.pointerId) return;
          const size = event.currentTarget.getBoundingClientRect().width;
          move(drag.current.position, (event.clientX - drag.current.x) / size, (event.clientY - drag.current.y) / size);
        }}
        onLostPointerCapture={() => { drag.current = null; }}
        onKeyDown={(event) => {
          const steps = { ArrowLeft: [-0.05, 0], ArrowRight: [0.05, 0], ArrowUp: [0, -0.05], ArrowDown: [0, 0.05] };
          if (!steps[event.key]) return;
          event.preventDefault();
          move(position, ...steps[event.key]);
        }}
      >
        <img src={image.src} alt="" draggable={false} style={{
          width: `${width / side * 100}%`,
          height: `${height / side * 100}%`,
          left: `${-left / side * 100}%`,
          top: `${-top / side * 100}%`,
        }} />
      </div>
      <label className="staffPhotoCropZoom">
        <span>Zoom</span>
        <input type="range" min="1" max="4" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
      </label>
      {error ? <p className="formError" role="alert">{error}</p> : null}
      <div className="staffPhotoCropActions">
        <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btnShine" onClick={applyCrop}>Apply crop</button>
      </div>
    </dialog>
  );
}
