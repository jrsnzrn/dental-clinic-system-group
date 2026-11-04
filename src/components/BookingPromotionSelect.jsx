import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";

const SET_PROMOTION = httpsCallable(functions, "setBookingPromotion");

export default function BookingPromotionSelect({ booking, disabled = false, onChange, onBusyChange }) {
  const [promotions, setPromotions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => onSnapshot(query(collection(db, "promotions"), where("status", "==", "active")), snapshot => {
    setPromotions(snapshot.docs.map(entry => ({ id: entry.id, ...entry.data() })));
    setLoaded(true);
  }, () => { setError("Promotions could not be loaded. Reopen the booking to retry."); setLoaded(true); }), []);
  if (!booking) return null;
  const services = (booking.services?.length ? booking.services : String(booking.service || "").split(",")).map(name => name.trim().toLowerCase());
  const eligible = promotions.filter(promotion => (!promotion.startDate || booking.date >= promotion.startDate) &&
    (!promotion.endDate || booking.date <= promotion.endDate) &&
    (promotion.services || []).some(name => services.includes(name.trim().toLowerCase())));
  const currentId = booking.promotionId || "";
  async function change(event) {
    const promotionId = event.target.value;
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    try {
      const result = await SET_PROMOTION({ bookingId: booking.id, promotionId });
      onChange?.(result.data.promotion);
    } catch (error) {
      setError(error.message || "The promotion could not be assigned.");
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  return (
    <div className="bookingStaffPromotion">
      <label className="field">
        <span className="fieldLabel">Booking promotion</span>
        <select className="input" value={currentId} disabled={disabled || busy || !loaded} onChange={change}>
          <option value="">No promotion</option>
          {currentId && !eligible.some(promotion => promotion.id === currentId) ? <option value={currentId}>{booking.promotionTitle || "Assigned promotion"}</option> : null}
          {eligible.map(promotion => <option key={promotion.id} value={promotion.id}>{promotion.title} · {promotion.discountType === "fixed" ? `₱${promotion.discountValue} off` : `${promotion.discountValue}% off`}</option>)}
        </select>
      </label>
      <p className="paymentsDetailNote">Choose a promotion for this booking before saving charges or recording payment. Offers must match its appointment date and services.</p>
      {busy ? <p role="status">Saving promotion…</p> : null}
      {error ? <p className="formError" role="alert">{error}</p> : null}
    </div>
  );
}
