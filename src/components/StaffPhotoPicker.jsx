import { useEffect, useRef, useState } from "react";
import StaffPhotoCropDialog from "./StaffPhotoCropDialog";
import LoadingIndicator from "./LoadingIndicator";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export default function StaffPhotoPicker({ photo, onChange, onBusyChange, disabled, required = false }) {
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const [cropImage, setCropImage] = useState(null);
  const mounted = useRef(false);
  const fileInput = useRef(null);
  const previewUrl = useRef("");
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    };
  }, []);

  async function prepare(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || disabled || preparing || cropImage) return;
    setError("");
    if (!IMAGE_TYPES.includes(file.type) || file.size > 15 * 1024 * 1024) {
      setError("Choose a JPG, PNG, or WebP image up to 15 MB.");
      return;
    }
    setPreparing(true);
    onBusyChange(true);
    try {
      previewUrl.current = URL.createObjectURL(file);
      const image = new Image();
      image.src = previewUrl.current;
      await image.decode();
      if (mounted.current) setCropImage(image);
    } catch {
      if (mounted.current) {
        setError("Could not prepare this image. Try another file.");
        closeCrop();
      }
    } finally {
      if (mounted.current) setPreparing(false);
    }
  }

  function closeCrop() {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = "";
    setCropImage(null);
    onBusyChange(false);
  }

  return (
    <div className="staffPhotoPicker">
      <button type="button" className="staffPhotoPreview" disabled={disabled || preparing}
        aria-label={photo ? "Change profile picture" : "Choose profile picture"}
        onClick={() => fileInput.current?.click()}>
        <span className="staffPhotoImage" aria-hidden="true">
          {photo ? <img src={photo} alt="" /> : <span>Add photo</span>}
        </span>
        <span className="staffPhotoCamera" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.5 5h-5L8 8H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-3l-1.5-3Z" />
            <circle cx="12" cy="13" r="3" />
          </svg>
        </span>
      </button>
      <input ref={fileInput} type="file" accept={IMAGE_TYPES.join(",")} disabled={disabled || preparing} onChange={prepare} hidden />
      <div className="staffPhotoControls">
        <span>Profile picture</span>
        {preparing ? <LoadingIndicator>Preparing profile picture…</LoadingIndicator> : null}
        {photo && !required ? <button type="button" className="btn secondary" disabled={disabled || preparing} onClick={() => { onChange(""); setError(""); }}>Remove picture</button> : null}
        {error ? <p className="formError" role="alert">{error}</p> : null}
      </div>
      {cropImage ? <StaffPhotoCropDialog image={cropImage} onCancel={closeCrop} onApply={(croppedPhoto) => {
        onChange(croppedPhoto);
        closeCrop();
      }} /> : null}
    </div>
  );
}
