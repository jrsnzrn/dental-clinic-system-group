import { BRACES_TYPES, getKnownBracesType } from "../../functions/bookingServices.mjs";

export { BRACES_TYPES };

export const DEFAULT_BRACES_REFERENCE_PRICES = {
  Metal: { downPayment: 5000, totalMin: 50000, totalMax: 60000 },
  "Sapphire Plastic": { downPayment: 20000, totalMin: 100000, totalMax: 120000 },
  Ceramic: { downPayment: 10000, totalMin: 60000, totalMax: 70000 },
  "Self-Ligating": { downPayment: 20000, totalMin: 100000, totalMax: 120000 },
};

export function normalizeBracesType(value) {
  return getKnownBracesType(value) || "Metal";
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
