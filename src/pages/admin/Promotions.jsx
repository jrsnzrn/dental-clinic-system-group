import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { logAdminAction } from "../../utils/audit";

const blank = { title: "", description: "", imageUrl: "", discountType: "percentage", discountValue: "", services: [], startDate: "", endDate: "", status: "draft" };
const today = () => new Date().toISOString().slice(0, 10);
function statusOf(item) {
  if (item.status === "draft") return "Draft";
  if (item.endDate && item.endDate < today()) return "Expired";
  if (item.startDate && item.startDate > today()) return "Scheduled";
  return "Active";
}

export default function Promotions() {
  const [promotions, setPromotions] = useState([]);
  const [services, setServices] = useState([]);
  const [draft, setDraft] = useState(blank);
  const [editingId, setEditingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const [promoSnap, serviceSnap] = await Promise.all([
      getDocs(query(collection(db, "promotions"), orderBy("createdAt", "desc"))),
      getDocs(collection(db, "clinicServices")),
    ]);
    setPromotions(promoSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    setServices(serviceSnap.docs.map((entry) => entry.data()).filter((entry) => entry.active !== false));
  }

  useEffect(() => { load().catch((loadError) => setError(loadError.message)); }, []);
  const counts = useMemo(() => promotions.reduce((result, item) => { result[statusOf(item)] += 1; return result; }, { Active: 0, Scheduled: 0, Expired: 0, Draft: 0 }), [promotions]);

  function toggleService(name) {
    setDraft((current) => ({ ...current, services: current.services.includes(name) ? current.services.filter((item) => item !== name) : [...current.services, name] }));
  }

  async function save(event) {
    event.preventDefault();
    setError("");
    if (!draft.title.trim() || !draft.discountValue || !draft.startDate || !draft.endDate || !draft.services.length) {
      setError("Enter a title, discount, date range, and at least one applicable service.");
      return;
    }
    if (draft.endDate < draft.startDate || Number(draft.discountValue) <= 0 || (draft.discountType === "percentage" && Number(draft.discountValue) > 100)) {
      setError("Check the date range and discount value. Percentage discounts must be 1–100%.");
      return;
    }
    setSaving(true);
    try {
      const payload = { ...draft, title: draft.title.trim(), description: draft.description.trim(), discountValue: Number(draft.discountValue), services: [...new Set(draft.services)], updatedAt: serverTimestamp() };
      if (editingId) {
        await updateDoc(doc(db, "promotions", editingId), payload);
        await logAdminAction({ action: "update_promotion", targetType: "promotion", targetId: editingId, targetLabel: payload.title });
      } else {
        const created = await addDoc(collection(db, "promotions"), { ...payload, createdAt: serverTimestamp(), usageCount: 0 });
        await logAdminAction({ action: "create_promotion", targetType: "promotion", targetId: created.id, targetLabel: payload.title });
      }
      setDraft(blank); setEditingId(""); await load();
    } catch (saveError) { setError(saveError.message || "Could not save this promotion."); }
    finally { setSaving(false); }
  }

  function edit(item) {
    setEditingId(item.id);
    setDraft({ ...blank, ...item, discountValue: String(item.discountValue ?? ""), services: item.services || [] });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function remove(item) {
    if (!window.confirm(`Delete promotion “${item.title}”?`)) return;
    try { await deleteDoc(doc(db, "promotions", item.id)); await load(); }
    catch (deleteError) { setError(deleteError.message || "Could not delete the promotion."); }
  }

  return <section className="container adminSurface pageSection adminPage promotionsPage">
    <div className="pageHeader"><div><span className="pill">Marketing</span><h1>Promotions</h1><p>Create promotions and track their dates and booking usage.</p></div></div>
    <div className="statsGrid promoStats">
      {Object.entries(counts).map(([label, value]) => <div className="statCard" key={label}><span className="statLabel">{label}</span><strong className="statValue">{value}</strong></div>)}
    </div>
    <div className="card promoEditor">
      <div className="cardHeader"><div><h2>{editingId ? "Edit promotion" : "Create promotion"}</h2><p className="sub">Choose the discount, eligible services, dates, and optional poster.</p></div></div>
      <form className="form" onSubmit={save}>
        <div className="promoFormGrid">
          <label className="bookingFieldCard"><span className="detailLabel">Promotion title</span><input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={100} required /></label>
          <label className="bookingFieldCard"><span className="detailLabel">Discount type</span><select className="input" value={draft.discountType} onChange={(e) => setDraft({ ...draft, discountType: e.target.value })}><option value="percentage">Percentage</option><option value="fixed">Fixed amount (PHP)</option></select></label>
          <label className="bookingFieldCard"><span className="detailLabel">Discount value</span><input className="input" type="number" min="1" max={draft.discountType === "percentage" ? 100 : undefined} value={draft.discountValue} onChange={(e) => setDraft({ ...draft, discountValue: e.target.value })} required /></label>
        </div>
        <label className="bookingFieldCard"><span className="detailLabel">Description</span><textarea className="input" rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} maxLength={1000} /></label>
        <label className="bookingFieldCard"><span className="detailLabel">Banner / poster image URL</span><input className="input" type="url" placeholder="https://…" value={draft.imageUrl} onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })} /></label>
        <div className="promoFormGrid">
          <label className="bookingFieldCard"><span className="detailLabel">Starts</span><input className="input" type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} required /></label>
          <label className="bookingFieldCard"><span className="detailLabel">Expires</span><input className="input" type="date" value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} required /></label>
          <label className="bookingFieldCard"><span className="detailLabel">State</span><select className="input" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}><option value="draft">Draft</option><option value="active">Active</option></select></label>
        </div>
        <fieldset className="bookingConsentCard"><legend className="detailLabel">Applicable services</legend><div className="bookingServiceChips">{services.map((service) => <label key={service.name}><input type="checkbox" checked={draft.services.includes(service.name)} onChange={() => toggleService(service.name)} /> {service.name}</label>)}</div></fieldset>
        {error && <div className="error">{error}</div>}
        <div className="inlineActionRow"><button className="btn btnShine" disabled={saving}>{saving ? "Saving…" : editingId ? "Save changes" : "Create promotion"}</button>{editingId && <button className="btn btnGhost" type="button" onClick={() => { setEditingId(""); setDraft(blank); }}>Cancel edit</button>}</div>
      </form>
    </div>
    <div className="card"><div className="cardHeader"><div><h2>Promotion list</h2><p className="sub">Status is calculated from the start and expiration dates.</p></div></div>
      {!promotions.length ? <p>No promotions created yet.</p> : <div className="adminList">{promotions.map((item) => <article className="historyRow promoRow" key={item.id}>
        {item.imageUrl && <img className="promoImage" src={item.imageUrl} alt="" />}
        <div className="promoDetails"><span className="detailLabel">{statusOf(item)} · {item.startDate} to {item.endDate}</span><h3>{item.title}</h3><p>{item.description}</p><p>{item.discountType === "percentage" ? `${item.discountValue}% off` : `₱${Number(item.discountValue).toLocaleString()} off`} · {(item.services || []).join(", ")} · {item.usageCount || 0} booking uses</p></div>
        <div className="inlineActionRow promoActions"><button className="btn btnGhost" type="button" onClick={() => edit(item)}>Edit</button><button className="btn btnGhost" type="button" onClick={() => remove(item)}>Delete</button></div>
      </article>)}</div>}
    </div>
  </section>;
}
