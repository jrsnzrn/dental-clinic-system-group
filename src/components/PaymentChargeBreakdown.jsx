import { formatCurrency } from "../utils/braces";

export default function PaymentChargeBreakdown({ breakdown, paid = 0, received = 0 }) {
  if (!breakdown) return null;
  const due = Math.max(0, breakdown.totalCost - paid);
  return (
    <section className="paymentsChargeBreakdown" aria-label="Service charges and promotion calculation">
      <h3>Charge calculation</h3>
      <dl className="appointmentPaymentDetails">
        {(breakdown.serviceCharges || []).map(line => (
          <div className="detailRow" key={line.name}><dt>{line.name}</dt><dd>{formatCurrency(line.amount)}</dd></div>
        ))}
        <div className="detailRow"><dt>Service charges</dt><dd>{formatCurrency(breakdown.grossTotal)}</dd></div>
        <div className="detailRow"><dt>{breakdown.promotionTitle || "Promotion"}{breakdown.promotionId && breakdown.discountType === "percentage" ? ` (${breakdown.discountValue}%)` : ""}</dt><dd>−{formatCurrency(breakdown.discountAmount)}</dd></div>
        {breakdown.promotionId ? <div className="detailRow"><dt>Eligible service charges</dt><dd>{formatCurrency(breakdown.eligibleTotal)}</dd></div> : null}
        <div className="detailRow"><dt>Net fee after discount</dt><dd>{formatCurrency(breakdown.totalCost)}</dd></div>
        <div className="detailRow"><dt>Previously paid</dt><dd>{formatCurrency(paid)}</dd></div>
        <div className="detailRow"><dt>Amount due</dt><dd>{formatCurrency(due)}</dd></div>
        {received > 0 ? <>
          <div className="detailRow"><dt>Amount received</dt><dd>{formatCurrency(received)}</dd></div>
          <div className="detailRow"><dt>Balance after payment</dt><dd>{formatCurrency(Math.max(0, due - received))}</dd></div>
        </> : null}
      </dl>
    </section>
  );
}
