export function money(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round((Math.max(0, amount) + Number.EPSILON) * 100) / 100 : 0;
}

export function getStartingCharge(rate) {
  const match = /^\s*(?:PHP\s*|₱\s*)([\d,]+(?:\.\d{1,2})?)/i.exec(String(rate || ""));
  return match ? money(match[1].replaceAll(",", "")) : 0;
}

export function calculateCharges(lines, promotion = null, previousDiscount = 0) {
  const eligible = new Set((promotion?.services || []).map(name => name.trim().toLowerCase()));
  const serviceCharges = lines.map(line => ({ name: line.name, amount: money(line.amount) }));
  const grossTotal = money(serviceCharges.reduce((sum, line) => sum + line.amount, 0));
  const eligibleTotal = money(serviceCharges.reduce((sum, line) => sum + (eligible.has(line.name.trim().toLowerCase()) ? line.amount : 0), 0));
  const value = money(promotion?.discountValue);
  const discountAmount = money(Math.min(eligibleTotal, promotion?.discountType === "fixed"
    ? Math.max(0, value - money(previousDiscount))
    : eligibleTotal * Math.min(100, value) / 100));
  return {
    serviceCharges, grossTotal, eligibleTotal, discountAmount,
    totalCost: money(grossTotal - discountAmount),
    promotionId: promotion?.id || "",
    promotionTitle: promotion?.title || "",
    discountType: promotion?.discountType || "",
    discountValue: value,
  };
}
