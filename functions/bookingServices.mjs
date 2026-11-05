export const MAX_BOOKING_SERVICES = 3;
export const BRACES_TYPES = ["Metal", "Sapphire Plastic", "Ceramic", "Self-Ligating"];

export function getKnownBracesType(value) {
  const key = serviceKey(value).replace(/[\s-]+/g, "").replace(/braces$/, "");
  if (key === "sapphire") return "Sapphire Plastic";
  return BRACES_TYPES.find((type) => type.toLowerCase().replace(/[\s-]+/g, "") === key) || "";
}

export function isGenericBracesPackage(service) {
  return serviceKey(service.name) === "braces";
}
export const BRACES_PACKAGE_INCLUSIONS = [
  "Free Cleaning",
  "Free Restoration or Extraction",
  "Free Dental X-ray",
];

export const BRACES_FREE_PROCEDURES = ["Restoration", "Extraction"];

export function canRecordBracesFreeProcedure(booking) {
  if (serviceKey(booking.archiveStatus) === "archived") return false;
  const services = booking.services?.length ? booking.services : String(booking.service || "").split(",");
  const hasPackage = Boolean(booking.bracesPackage) || services.some((name) => isBracesPackage({ name }));
  return hasPackage && (["pending_payment", "completed"].includes(booking.status) || (booking.status === "approved" && Boolean(booking.checkedInAt)));
}

export const CROWN_TYPES = [
  ["Porcelain fused to metal", 8000],
  ["Ceramage", 11000],
  ["Emax", 15000],
  ["Zirconia", 25000],
  ["Tilite", 10000],
];

export function isCrownTypeService(service) {
  return CROWN_TYPES.some(([type]) => serviceKey(service.name) === serviceKey(`${type} Crown`));
}

export const BOOKING_CATALOG_ADDITIONS = [
  { name: "Consultation", durationMinutes: 45, startingRate: "Consultation pricing available at clinic", description: "Dental assessment and treatment planning." },
  ...CROWN_TYPES.map(([type, price]) => ({
    name: `${type} Crown`,
    durationMinutes: 60,
    startingRate: `PHP ${price.toLocaleString("en-PH")} each`,
    description: `${type} dental crown.`,
  })),
];

function serviceKey(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function withBookingCatalogAdditions(services) {
  const existingNames = new Set(services.map((service) => serviceKey(service.name)));
  return [
    ...services,
    ...BOOKING_CATALOG_ADDITIONS.filter((service) => !existingNames.has(serviceKey(service.name))),
  ];
}

export function getBookableCatalog(services) {
  const byName = new Map();
  for (const service of withBookingCatalogAdditions(services)) {
    const key = serviceKey(service.name);
    if (!key || key === "crowns") continue;
    const existing = byName.get(key);
    if (!existing || existing.active === false || service.active !== false) byName.set(key, service);
  }
  return [...byName.values()];
}

export function isOrthodonticService(service) {
  return /\b(braces?|orthodont\w*|ortho|aligners?)\b/.test(serviceKey(service.name))
    || /^(orthodont\w*|ortho)$/.test(serviceKey(service.category));
}

export function isBracesPackage(service) {
  const name = serviceKey(service.name);
  return /\bbraces?\b/.test(name)
    && !/\b(consult\w*|adjust\w*|remov\w*|repair\w*|retainer\w*|follow[ -]?up)\b/.test(name);
}

export function isBracesPackageInclusion(service) {
  return /\b(cleaning|prophylaxis|restoration\w*|filling\w*|extraction\w*|x[ -]?rays?|panoramic|periapical)\b/.test(serviceKey(service.name));
}

export function canBookService(service, patientType) {
  return /\b(ortho|orthodont\w*)\b/.test(serviceKey(patientType)) || !isOrthodonticService(service);
}

export function getBookingSelectionError(services, patientType) {
  if (services.length > MAX_BOOKING_SERVICES) return "Choose up to three services per appointment.";
  if (new Set(services.map((service) => serviceKey(service.name))).size !== services.length) {
    return "Choose each service only once.";
  }
  if (patientType !== undefined && services.some((service) => !canBookService(service, patientType))) {
    return "Braces and orthodontic services are available to Ortho patients only.";
  }
  const packages = services.filter(isBracesPackage);
  if (packages.length > 1) return "Choose only one braces package per appointment.";
  if (packages.length && services.some(isBracesPackageInclusion)) {
    return "Cleaning, restoration or extraction, and dental X-ray are already included in the braces package.";
  }
  return "";
}

export function selectBookingService(selectedNames, option, options) {
  if (selectedNames.includes(option.name)) return selectedNames.filter((name) => name !== option.name);
  const selected = options.filter((service) => selectedNames.includes(service.name));
  const retained = isBracesPackage(option) ? selected.filter((service) => !isBracesPackageInclusion(service)) : selected;
  const next = [...retained, option];
  return getBookingSelectionError(next) ? selectedNames : next.map((service) => service.name);
}
