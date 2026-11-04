import PaginatedRecords from "./PaginatedRecords";
import { formatCurrency } from "../utils/braces";
import { formatDateLabel, formatTimestamp } from "../utils/schedule";
import PaymentChargeBreakdown from "./PaymentChargeBreakdown";

export default function PaymentReceipts({ payments, patientName, booking }) {
  return (
    <section className="paymentReceipts" aria-label="Payment receipts">
      <h3>Payment receipts</h3>
      {payments.length ? <PaginatedRecords items={payments} resetKey={booking?.id || patientName} label="receipts">{(payment) => (
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
          <PaymentChargeBreakdown breakdown={payment.chargeBreakdown}
            paid={Number(payment.amountPaidBefore) || 0}
            received={Number(payment.amount) || 0} />
          {payment.receiptPhotos?.length ? (
            <div className="paymentsReceiptPhotos">
              {payment.receiptPhotos.map((photo, index) => (
                <figure key={`${payment.id}-${index}`}>
                  <a href={photo.dataUrl} download={photo.name || `receipt-${payment.id}-${index + 1}.jpg`}>
                    <img src={photo.dataUrl} alt={`Payment receipt ${index + 1} for ${payment.patientName || patientName || "patient"}`} loading="lazy" />
                    <span>Download receipt photo {index + 1}</span>
                  </a>
                </figure>
              ))}
            </div>
          ) : null}
        </article>
      )}</PaginatedRecords> : <p>No payment receipts are linked to this record.</p>}
    </section>
  );
}
