import { normalizeText } from "./appointments";

export const DEFAULT_CLINIC_SERVICES = [
  { name: "Cleaning", description: "Gentle scaling and polishing.", durationMinutes: 60, startingRate: "PHP 800 starting", active: true, image: "/services/cleaning.png" },
  { name: "Fillings", description: "Tooth-colored restoration service.", durationMinutes: 60, startingRate: "PHP 800 starting", active: true, image: "/services/fillings.png" },
  { name: "Extraction", description: "Safe and comfortable tooth removal.", durationMinutes: 60, startingRate: "PHP 800 starting", active: true, image: "/services/extraction.png" },
  { name: "Braces Consultation", description: "Orthodontic evaluation and care planning.", durationMinutes: 45, startingRate: "Consultation pricing available at clinic", active: true, image: "/services/braces.png" },
  { name: "Root Canal", description: "Tooth-saving endodontic treatment.", durationMinutes: 90, startingRate: "PHP 8,000 per canal", active: true, image: "/services/rootcanal.png" },
  { name: "Whitening", description: "Brightening treatment for your smile.", durationMinutes: 60, startingRate: "PHP 8,000", active: true, image: "/services/whitening.png" },
];

export function normalizeService(service = {}) {
  return {
    name: String(service.name || "").trim(),
    description: String(service.description || "").trim(),
    durationMinutes: Number(service.durationMinutes || 60),
    startingRate: String(service.startingRate || "").trim(),
    active: service.active !== false,
    image: String(service.image || "").trim(),
    category: String(service.category || "General").trim(),
  };
}

export function getActiveServices(services = []) {
  return services
    .map(normalizeService)
    .filter((service) => service.active && service.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getBookingServiceOptions(services = []) {
  const merged = new Map();

  DEFAULT_CLINIC_SERVICES
    .map(normalizeService)
    .filter((service) => service.active && service.name)
    .forEach((service) => {
      merged.set(normalizeText(service.name), service);
    });

  getActiveServices(services).forEach((service) => {
    merged.set(normalizeText(service.name), service);
  });

  return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function getClinicServiceImage(service = {}) {
  const normalized = normalizeService(service);
  if (normalized.image) return normalized.image;

  const serviceName = normalized.name.toLowerCase();
  if (serviceName.includes("clean")) return "/services/cleaning.png";
  if (serviceName.includes("extract") || serviceName.includes("surgery")) return "/services/extraction.png";
  if (serviceName.includes("brace")) return "/services/braces.png";
  if (serviceName.includes("root") || serviceName.includes("x-ray") || serviceName.includes("xray")) return "/services/rootcanal.png";
  if (serviceName.includes("white")) return "/services/whitening.png";
  return "/services/fillings.png";
}

export function normalizeClosure(closure = {}) {
  return {
    id: closure.id || "",
    date: String(closure.date || "").trim(),
    label: String(closure.label || "Clinic Closed").trim(),
    type: String(closure.type || "holiday").trim(),
    notes: String(closure.notes || "").trim(),
    active: closure.active !== false,
  };
}

export function getActiveClosureForDate(closures = [], date) {
  return closures
    .map(normalizeClosure)
    .find((closure) => closure.active && closure.date === date) || null;
}

export function formatClosureLabel(closure) {
  if (!closure) return "";
  return [closure.label, closure.type].filter(Boolean).join(" • ");
}

export function hasPotentialDuplicateBooking(bookings = [], bookingDraft = {}) {
  const patientUid = normalizeText(bookingDraft.uid);
  const date = String(bookingDraft.date || "");
  const service = normalizeText(bookingDraft.service);

  return bookings.some((booking) => {
    if (normalizeText(booking.archiveStatus) === "archived") return false;
    if (normalizeText(booking.status) === "cancelled") return false;
    return (
      normalizeText(booking.uid) === patientUid &&
      String(booking.date || "") === date &&
      normalizeText(booking.service) === service
    );
  });
}
