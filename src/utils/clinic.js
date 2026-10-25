import { normalizeText } from "./appointments";
import bracesImg from "../assets/services/braces.jpg";
import cleaningImg from "../assets/services/cleaning.jpg";
import extractionImg from "../assets/services/extraction.jpg";
import fillingsImg from "../assets/services/fillings.jpg";
import crownsImg from "../assets/services/crowns.jpg";
import denturesImg from "../assets/services/dentures.jpg";
import oralSurgeryImg from "../assets/services/oralsurgery.jpg";
import rootCanalImg from "../assets/services/rootcanal.jpg";
import veneersImg from "../assets/services/veneers.jpg";
import whiteningImg from "../assets/services/whitening.jpg";
import xrayImg from "../assets/services/xray.jpg";

export const CLINIC_SERVICE_IMAGES = {
  braces: bracesImg,
  cleaning: cleaningImg,
  extraction: extractionImg,
  fillings: fillingsImg,
  crowns: crownsImg,
  dentures: denturesImg,
  oralSurgery: oralSurgeryImg,
  rootCanal: rootCanalImg,
  whitening: whiteningImg,
  veneers: veneersImg,
  xray: xrayImg,
};

export const CLINIC_SERVICE_IMAGE_OPTIONS = [
  { key: "braces", label: "Braces", image: CLINIC_SERVICE_IMAGES.braces },
  { key: "cleaning", label: "Cleaning", image: CLINIC_SERVICE_IMAGES.cleaning },
  { key: "extraction", label: "Extraction", image: CLINIC_SERVICE_IMAGES.extraction },
  { key: "fillings", label: "Fillings", image: CLINIC_SERVICE_IMAGES.fillings },
  { key: "crowns", label: "Crowns", image: CLINIC_SERVICE_IMAGES.crowns },
  { key: "dentures", label: "Dentures", image: CLINIC_SERVICE_IMAGES.dentures },
  { key: "oralSurgery", label: "Oral surgery", image: CLINIC_SERVICE_IMAGES.oralSurgery },
  { key: "rootCanal", label: "Root canal", image: CLINIC_SERVICE_IMAGES.rootCanal },
  { key: "veneers", label: "Veneers", image: CLINIC_SERVICE_IMAGES.veneers },
  { key: "whitening", label: "Teeth whitening", image: CLINIC_SERVICE_IMAGES.whitening },
  { key: "xray", label: "Dental X-ray", image: CLINIC_SERVICE_IMAGES.xray },
];

export const BOOKING_SLOT_INTERVAL_MINUTES = 30;

export const PUBLIC_SERVICE_CATALOG = [
  { name: "Cleaning", description: "Professional cleaning for healthier gums and a fresher smile.", durationMinutes: 60, startingRate: "PHP 800 starting", active: true, category: "General" },
  { name: "Extraction", description: "Safe and comfortable tooth removal when needed.", durationMinutes: 60, startingRate: "PHP 800 starting", active: true, category: "General" },
  { name: "Teeth Whitening", description: "Whitening treatment designed to brighten your smile in one session.", durationMinutes: 60, startingRate: "PHP 8,000", active: true, category: "General" },
  { name: "Oral Surgery", description: "Minor oral surgical procedures with proper planning and care.", durationMinutes: 60, startingRate: "PHP 5,000 starting", active: true, category: "General" },
  { name: "Veneers", description: "Cosmetic veneer treatment for smile improvement and tooth enhancement.", durationMinutes: 60, startingRate: "Depends on procedure and product", active: true, category: "General" },
  { name: "Crowns", description: "Dental crowns to restore strength, shape, and appearance of teeth.", durationMinutes: 60, startingRate: "PHP 7,000 starting", active: true, category: "General" },
  { name: "Dentures", description: "Custom removable replacement for missing teeth.", durationMinutes: 60, startingRate: "PHP 5,000 starting", active: true, category: "General" },
  { name: "Root Canal", description: "Treatment for infected canals to help save the tooth.", durationMinutes: 90, startingRate: "PHP 8,000 per canal", active: true, category: "General" },
  { name: "Braces", description: "Orthodontic treatment for bite alignment and smile correction.", durationMinutes: 60, startingRate: "PHP 5,000 down payment", active: true, category: "General" },
  { name: "Dental X-ray", description: "Diagnostic imaging for treatment planning and case evaluation.", durationMinutes: 60, startingRate: "Panoramic: PHP 1,000 • Periapical: PHP 500", active: true, category: "General" },
  { name: "Fillings", description: "Tooth-colored restoration service.", durationMinutes: 60, startingRate: "PHP 800 starting", active: true, category: "General" },
];

function normalizeServiceName(name) {
  return normalizeText(name).replace(/\s+/g, " ");
}

export function getPublicServiceMigrationPlan(existingServices = []) {
  const exactMatches = new Map();
  existingServices.forEach((service) => {
    const normalizedName = normalizeServiceName(service.name);
    if (!normalizedName) return;
    exactMatches.set(normalizedName, [...(exactMatches.get(normalizedName) || []), service]);
  });

  return PUBLIC_SERVICE_CATALOG.map((service) => {
    const matches = exactMatches.get(normalizeServiceName(service.name)) || [];
    const possibleAliases = service.name === "Teeth Whitening"
      ? exactMatches.get(normalizeServiceName("Whitening")) || []
      : [];
    if (matches.length > 1 || (matches.length && possibleAliases.length)) {
      return { service, status: "ambiguous", matches: [...matches, ...possibleAliases] };
    }
    if (matches.length === 1) return { service, status: "existing", matches };
    if (possibleAliases.length) return { service, status: "ambiguous", matches: possibleAliases };
    return { service, status: "missing", matches: [] };
  });
}

export function getPublicServiceDocumentId(name) {
  const slug = normalizeServiceName(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `public-${slug}`;
}

export function normalizeService(service = {}) {
  const durationMinutes = Number(service.durationMinutes);
  return {
    id: String(service.id || ""),
    name: String(service.name || "").trim(),
    description: String(service.description || "").trim(),
    durationMinutes: Number.isFinite(durationMinutes) && durationMinutes > 0 ? durationMinutes : null,
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
  return getActiveServices(services);
}

export function getClinicServiceImage(service = {}) {
  const normalized = normalizeService(service);
  const localImageMatch = normalized.image.match(/^local:([a-zA-Z]+)$/);
  if (localImageMatch && CLINIC_SERVICE_IMAGES[localImageMatch[1]]) {
    return CLINIC_SERVICE_IMAGES[localImageMatch[1]];
  }
  if (normalized.image && !/\/services\/[^/?#]+\.png(?:[?#]|$)/i.test(normalized.image)) {
    return normalized.image;
  }

  return getLocalClinicServiceImage(normalized);
}

export function getLocalClinicServiceImage(service = {}) {
  const normalized = normalizeService(service);
  const serviceName = normalizeText(normalized.name).replace(/\s+/g, " ");
  const serviceImagesByName = {
    "braces consultation": CLINIC_SERVICE_IMAGES.braces,
    braces: CLINIC_SERVICE_IMAGES.braces,
    cleaning: CLINIC_SERVICE_IMAGES.cleaning,
    crowns: CLINIC_SERVICE_IMAGES.crowns,
    dentures: CLINIC_SERVICE_IMAGES.dentures,
    "dental x-ray": CLINIC_SERVICE_IMAGES.xray,
    extraction: CLINIC_SERVICE_IMAGES.extraction,
    fillings: CLINIC_SERVICE_IMAGES.fillings,
    "oral surgery": CLINIC_SERVICE_IMAGES.oralSurgery,
    "root canal": CLINIC_SERVICE_IMAGES.rootCanal,
    "teeth whitening": CLINIC_SERVICE_IMAGES.whitening,
    whitening: CLINIC_SERVICE_IMAGES.whitening,
    veneers: CLINIC_SERVICE_IMAGES.veneers,
  };
  if (serviceImagesByName[serviceName]) return serviceImagesByName[serviceName];

  if (serviceName.includes("clean") || serviceName.includes("denture")) return CLINIC_SERVICE_IMAGES.cleaning;
  if (serviceName.includes("extract") || serviceName.includes("surgery")) return CLINIC_SERVICE_IMAGES.extraction;
  if (serviceName.includes("brace")) return CLINIC_SERVICE_IMAGES.braces;
  if (serviceName.includes("root") || serviceName.includes("x-ray") || serviceName.includes("xray")) return CLINIC_SERVICE_IMAGES.rootCanal;
  if (serviceName.includes("white")) return CLINIC_SERVICE_IMAGES.whitening;
  return CLINIC_SERVICE_IMAGES.fillings;
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