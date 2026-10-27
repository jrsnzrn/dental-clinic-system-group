export const BRACES_TYPES = [
  "Metal",
  "Sapphire Plastic",
  "Ceramic",
  "Self-Ligating",
];

export const DEFAULT_BRACES_REFERENCE_PRICES = {
  Metal: { downPayment: 5000, totalMin: 50000, totalMax: 60000 },
  "Sapphire Plastic": { downPayment: 20000, totalMin: 100000, totalMax: 120000 },
  Ceramic: { downPayment: 10000, totalMin: 60000, totalMax: 70000 },
  "Self-Ligating": { downPayment: 20000, totalMin: 100000, totalMax: 120000 },
};

export function normalizeBracesType(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "");
  if (normalized === "metalbraces") return "Metal";
  if (normalized === "ceramicbraces") return "Ceramic";
  if (normalized === "sapphire" || normalized === "sapphireplastic") return "Sapphire Plastic";
  if (normalized === "sapphirebraces") return "Sapphire Plastic";
  if (normalized === "selfligating" || normalized === "selfligatingbraces") return "Self-Ligating";
  return BRACES_TYPES.find((type) => type.toLowerCase().replace(/[\s-]+/g, "") === normalized) || "Metal";
}

export function normalizeBracesReferencePrices(value = {}) {
  return Object.fromEntries(BRACES_TYPES.map((type) => {
    const reference = value[type] || {};
    const defaults = DEFAULT_BRACES_REFERENCE_PRICES[type];
    return [type, {
      downPayment: Number.isFinite(Number(reference.downPayment)) ? Number(reference.downPayment) : defaults.downPayment,
      totalMin: Number.isFinite(Number(reference.totalMin)) ? Number(reference.totalMin) : defaults.totalMin,
      totalMax: Number.isFinite(Number(reference.totalMax)) ? Number(reference.totalMax) : defaults.totalMax,
    }];
  }));
}
