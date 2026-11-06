import { useEffect, useId, useRef, useState } from "react";
import PaginatedRecords from "./PaginatedRecords";
import { formatCurrency } from "../utils/braces";
import { formatDateLabel, formatTimestamp } from "../utils/schedule";
import PaymentChargeBreakdown from "./PaymentChargeBreakdown";
import { groupBookingReceipts } from "../utils/bookingPayments";

export default function PaymentReceipts({ payments: rawPayments, patientName, booking, bookings = [], showReceiptPhotos = true }) {
  const payments = groupBookingReceipts(rawPayments);
  const [preview, setPreview] = useState(null);
  const dialogRef = useRef(null);
  const previewTitleId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (preview && !dialog.open) dialog.showModal();
    if (!preview && dialog.open) dialog.close();
  }, [preview]);

  return (
    <section className="paymentReceipts" aria-label="Payment receipts">
      <header className="receiptSectionHeader">
        <div><h3>Payment receipts</h3><p>View payment details and transaction references.</p></div>
        <span className="receiptCount">{payments.length} receipt{payments.length === 1 ? "" : "s"}</span>
      </header>
      {payments.length ? <PaginatedRecords items={payments} resetKey={booking?.id || patientName} label="receipts" hideSinglePageControls>{payment => {
        const receiptBooking = bookings.find(entry => entry.id === payment.appointmentId) || booking;
        const service = payment.treatmentName || receiptBooking?.service || receiptBooking?.services?.join(", ") || (payment.accountId ? "Braces installment" : "Dental payment");
        const date = payment.paymentDate ? formatDateLabel(payment.paymentDate) : payment.createdAt ? formatTimestamp(payment.createdAt) : "Date not recorded";
        const method = payment.method || payment.paymentMethod || "Method not recorded";
        const photos = showReceiptPhotos && Array.isArray(payment.receiptPhotos) ? payment.receiptPhotos : [];
        return (
          <article className="paymentReceiptCard" key={`${payment.receiptSource || "payment"}-${payment.id}`} aria-label={`Receipt for ${service}`}>
            <header className="paymentReceiptHeader">
              <div className="paymentReceiptIdentity"><span className="receiptEyebrow">{payment.receiptSource || "Payment receipt"}</span><h4>{service}</h4><p>{date}</p></div>
              <div className="paymentReceiptAmount"><span>Amount received</span><strong>{formatCurrency(Number(payment.amount ?? payment.paid) || 0)}</strong><span className="receiptMethod">{method}</span></div>
            </header>
            <dl className="paymentReceiptFacts">
              {[
                ["Patient", payment.patientName || patientName || "Patient"],
                ["Appointment", receiptBooking?.date ? formatDateLabel(receiptBooking.date) : ""],
                ["Dentist", receiptBooking?.selectedDentist || ""],
                ["Reference number", method.trim().toLowerCase() === "cash" ? "" : payment.referenceNumber || "Not provided"],
                ["Additional services", Array.isArray(payment.additionalServices) ? payment.additionalServices.join(", ") : ""],
              ].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            </dl>
            {payment.chargeBreakdown ? <details className="receiptDetails">
              <summary>View service charges and discount</summary>
              <PaymentChargeBreakdown breakdown={payment.chargeBreakdown} paid={Number(payment.amountPaidBefore) || 0} received={Number(payment.amount) || 0} />
            </details> : null}
            {photos.length ? <section className="receiptAttachments" aria-label="Uploaded proof of payment">
              <div className="receiptAttachmentsHeading"><h5>Proof of payment</h5><span>{photos.length} photo{photos.length === 1 ? "" : "s"}</span></div>
              <div className="receiptPhotoGrid">{photos.map((photo, index) => (
                <figure className="receiptPhotoCard" key={`${payment.id}-${index}`}>
                  <button type="button" className="receiptPhotoPreview" onClick={() => setPreview({ ...photo, patientName: payment.patientName || patientName, index })} aria-label={`View receipt photo ${index + 1}`}>
                    <img src={photo.dataUrl} alt={`Proof of payment ${index + 1}`} loading="lazy" />
                    <span>View photo</span>
                  </button>
                  <figcaption><span>Receipt photo {index + 1}</span><a href={photo.dataUrl} download={photo.name || `receipt-${payment.id}-${index + 1}.jpg`}>Download</a></figcaption>
                </figure>
              ))}</div>
            </section> : null}
            <details className="receiptDetails receiptIdentifiers"><summary>Receipt and booking IDs</summary>
              <dl className="paymentReceiptFacts">{[
                ["Receipt ID", payment.id], ["Booking ID", payment.appointmentId || receiptBooking?.id || "Not linked"], ["Braces account", payment.accountId || ""],
              ].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
            </details>
          </article>
        );
      }}</PaginatedRecords> : <div className="receiptEmptyState"><strong>No payment receipts yet</strong><p>Recorded payments will appear here.</p></div>}
      {showReceiptPhotos ? <dialog ref={dialogRef} className="receiptPhotoDialog" aria-labelledby={previewTitleId} onCancel={() => setPreview(null)} onClose={() => setPreview(null)} onClick={event => { if (event.target === event.currentTarget) setPreview(null); }}>
        {preview ? <>
          <header><h3 id={previewTitleId}>Receipt photo {preview.index + 1}</h3><button type="button" className="btn secondary" onClick={() => setPreview(null)}>Close</button></header>
          <img src={preview.dataUrl} alt={`Payment receipt for ${preview.patientName || "patient"}`} />
          <footer><a className="btn" href={preview.dataUrl} download={preview.name || "payment-receipt.jpg"}>Download photo</a></footer>
        </> : null}
      </dialog> : null}
    </section>
  );
}
