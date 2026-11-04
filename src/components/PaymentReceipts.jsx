import { formatCurrency } from "../utils/braces";
import { formatDateLabel, formatTimestamp } from "../utils/schedule";

export default function PaymentReceipts({ payments, patientName, booking }) {
  return (
    <section className="paymentReceipts" aria-label="Payment receipts">
      <h3>Payment receipts</h3>
      {payments.length ? payments.map((payment) => (
        <article className="drawerNote" key={payment.id} aria-label={`Receipt ${payment.id}`}>
          <dl className="appointmentPaymentDetails">
            {[
              ["Receipt ID", payment.id],
              ["Patient", payment.patientName || patientName || "Patient"],
              ["Booking ID", payment.appointmentId || booking?.id || "Not linked"],
              ["Appointment", booking?.date ? formatDateLabel(booking.date) : ""],
              ["Service", payment.treatmentName || booking?.service || booking?.services?.join(", ") || ""],
              ["Payment date", payment.paymentDate ? formatDateLabel(payment.paymentDate) : payment.createdAt ? formatTimestamp(payment.createdAt) : "Not recorded"],
              ["Method", payment.method || payment.paymentMethod || "Not recorded"],
              ["Reference number", payment.referenceNumber || "Not provided"],
              ["Additional services", Array.isArray(payment.additionalServices) ? payment.additionalServices.join(", ") : ""],
              ["Amount paid", formatCurrency(Number(payment.amount ?? payment.paid) || 0)],
            ].filter(([, value]) => value).map(([label, value]) => (
              <div className="detailRow" key={label}><dt>{label}</dt><dd>{value}</dd></div>
            ))}
          </dl>
        </article>
      )) : <p>No payment receipts are linked to this record.</p>}
    </section>
  );
}
