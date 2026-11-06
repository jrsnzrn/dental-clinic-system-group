export function getPaymentReference(method, referenceNumber, amount) {
  if (method === "Cash" || !(Number(amount) > 0)) return "";

  const reference = String(referenceNumber || "").trim();
  if (!reference) throw new Error("Enter the reference number for this payment.");
  if (reference.length > 100) throw new Error("The reference number must be 100 characters or fewer.");
  return reference;
}
