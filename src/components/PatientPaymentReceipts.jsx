import LoadingIndicator from "./LoadingIndicator";
import { useEffect, useState } from "react";
import { collection, onSnapshot, or, query, where } from "firebase/firestore";
import { db } from "../firebase";
import PaymentReceipts from "./PaymentReceipts";

export default function PatientPaymentReceipts({ patientId = "", uid = "", patientName = "", bookings }) {
  const [sources, setSources] = useState({});
  const [retry, setRetry] = useState(0);
  const identity = JSON.stringify([patientId, uid, retry]);
  const loadBookings = bookings === undefined;

  useEffect(() => {
    if (!patientId && !uid) return;
    const filters = [];
    if (patientId) filters.push(where("patientId", "==", patientId));
    if (uid) filters.push(where("uid", "==", uid));
    const patientFilter = filters.length > 1 ? or(...filters) : filters[0];
    const update = (name, value) => setSources(current => ({
      ...(current.identity === identity ? current : { identity }), [name]: value,
    }));
    const subscribe = (name, filter) => onSnapshot(query(collection(db, name), filter), snapshot => {
      update(name, { records: snapshot.docs.map(entry => ({ id: entry.id, ...entry.data() })), error: "" });
    }, error => {
      console.error(`Patient ${name} could not load:`, error);
      update(name, { records: [], error: "Payment receipts could not be fully loaded. Please try again." });
    });
    const unsubscribe = [subscribe("payments", patientFilter), subscribe("bracesPayments", patientFilter)];
    if (loadBookings && uid) unsubscribe.push(subscribe("bookings", where("uid", "==", uid)));
    return () => unsubscribe.forEach(stop => stop());
  }, [patientId, uid, identity, loadBookings]);

  const current = sources.identity === identity ? sources : {};
  const loading = !current.payments || !current.bracesPayments || (loadBookings && uid && !current.bookings);
  const error = [current.payments, current.bracesPayments, current.bookings].find(source => source?.error)?.error;
  const receipts = [
    ...(current.payments?.records || []).map(payment => ({ ...payment, receiptSource: "Treatment payment" })),
    ...(current.bracesPayments?.records || []).map(payment => ({ ...payment, receiptSource: "Braces installment" })),
  ].sort((left, right) => String(right.paymentDate || "").localeCompare(String(left.paymentDate || "")));

  return (
    <div className="patientPaymentReceipts">
      {loading ? <p><LoadingIndicator>Loading payment receipts…</LoadingIndicator></p> : null}
      {error ? <div className="formError" role="alert">{error} <button type="button" className="btn secondary" onClick={() => setRetry(value => value + 1)}>Try again</button></div> : null}
      {!loading ? <PaymentReceipts payments={receipts} patientName={patientName} bookings={bookings || current.bookings?.records || []} /> : null}
    </div>
  );
}
