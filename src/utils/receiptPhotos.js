export const MAX_RECEIPT_PHOTOS = 3;

export async function prepareReceiptPhoto(file) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Choose a JPG, PNG, or WebP receipt photo.");
  }
  if (file.size > 15 * 1024 * 1024) throw new Error("Each receipt photo must be smaller than 15 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1400 / Math.max(image.width, image.height));
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.85, 0.7, 0.55, 0.4]) {
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      if (dataUrl.length <= 200000) return { name: file.name.slice(0, 150), dataUrl };
    }
    throw new Error("This receipt photo is too large. Crop it and try again.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function validateReceiptPhotos(photos) {
  if (!Array.isArray(photos) || photos.length > MAX_RECEIPT_PHOTOS || photos.some(photo =>
    typeof photo.name !== "string" || photo.name.length > 150 ||
    typeof photo.dataUrl !== "string" || !photo.dataUrl.startsWith("data:image/jpeg;base64,") || photo.dataUrl.length > 200000
  )) throw new Error("Choose up to three valid receipt photos.");
}
