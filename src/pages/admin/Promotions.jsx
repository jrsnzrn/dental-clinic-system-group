import { useCallback, useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, getDocs, orderBy, query, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { logAdminAction } from "../../utils/audit";

const blank = {
  title: "",
  promoLabel: "",
  headlineMain: "",
  headlineAccent: "",
  tagline: "",
  description: "",
  imageUrl: "",
  discountType: "percentage",
  discountValue: "",
  services: [],
  startDate: "",
  endDate: "",
  status: "draft",
};

const MAX_IMAGE_WIDTH = 1400;
const MAX_IMAGE_CHARS = 700000;

// Resizes and compresses a picked image to a JPEG data URL small enough to store in the Firestore document.
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let scale = Math.min(1, MAX_IMAGE_WIDTH / img.width);
      let quality = 0.85;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const data = canvas.toDataURL("image/jpeg", quality);
        if (data.length <= MAX_IMAGE_CHARS) {
          resolve(data);
          return;
        }
        scale *= 0.85;
        quality = Math.max(0.6, quality - 0.05);
      }
      reject(new Error("That image is too large. Try a smaller picture."));
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read that image file."));
    };
    img.src = objectUrl;
  });
}

// Local date (YYYY-MM-DD). toISOString() is UTC and shows yesterday in the Philippines before 8 AM.
function todayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function statusOf(item) {
  if (item.status === "draft") return "Draft";
  const today = todayISO();
  if (item.endDate && item.endDate < today) return "Expired";
  if (item.startDate && item.startDate > today) return "Scheduled";
  return "Active";
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

function formatDiscount(item) {
  const value = Number(item.discountValue || 0);
  return item.discountType === "percentage" ? `${value}% off` : `₱${value.toLocaleString()} off`;
}

function Field({ label, children }) {
  return (
    <label className="promoField">
      <span className="detailLabel">{label}</span>
      {children}
    </label>
  );
}

export default function Promotions() {
  const [promotions, setPromotions] = useState([]);
  const [serviceNames, setServiceNames] = useState([]);
  const [draft, setDraft] = useState(blank);
  const [editingId, setEditingId] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Only one seasonal promotion is managed: the newest one.
  const current = promotions[0] || null;

  const load = useCallback(async () => {
    const [promoSnap, serviceSnap] = await Promise.all([
      getDocs(query(collection(db, "promotions"), orderBy("createdAt", "desc"))),
      getDocs(collection(db, "clinicServices")),
    ]);
    setPromotions(promoSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    setServiceNames([...new Set(
      serviceSnap.docs.map((entry) => entry.data()).filter((entry) => entry.active !== false).map((entry) => entry.name).filter(Boolean)
    )].sort());
  }, []);

  useEffect(() => {
    load()
      .catch((loadError) => setError(loadError.message || "Could not load promotions."))
      .finally(() => setLoading(false));
  }, [load]);

  // Includes services already on the promotion even if they were deactivated later
  const serviceOptions = useMemo(
    () => [...new Set([...serviceNames, ...draft.services])].sort(),
    [serviceNames, draft.services]
  );

  const setField = (key) => (event) => setDraft((current) => ({ ...current, [key]: event.target.value }));

  function toggleService(name) {
    setDraft((current) => ({
      ...current,
      services: current.services.includes(name) ? current.services.filter((item) => item !== name) : [...current.services, name],
    }));
  }

  async function handleImageFile(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    setError("");
    try {
      const data = await compressImage(file);
      setDraft((current) => ({ ...current, imageUrl: data }));
    } catch (imageError) {
      setError(imageError.message || "Could not use that image.");
    }
  }

  // Only used when no promotion exists yet, so there is something to edit.
  function openFirst() {
    setError("");
    setEditingId("");
    setDraft(blank);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId("");
    setDraft(blank);
    setError("");
  }

  function edit(item) {
    setError("");
    setEditingId(item.id);
    setDraft({
      title: item.title || "",
      promoLabel: item.promoLabel || "",
      headlineMain: item.headlineMain || "",
      headlineAccent: item.headlineAccent || "",
      tagline: item.tagline || "",
      description: item.description || "",
      imageUrl: item.imageUrl || "",
      discountType: item.discountType || "percentage",
      discountValue: String(item.discountValue ?? ""),
      services: item.services || [],
      startDate: item.startDate || "",
      endDate: item.endDate || "",
      status: item.status || "draft",
    });
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save(event) {
    event.preventDefault();
    setError("");
    const value = Number(draft.discountValue);
    if (!draft.title.trim() || !value || !draft.startDate || !draft.endDate || !draft.services.length) {
      setError("Enter a title, discount, date range, and at least one applicable service.");
      return;
    }
    if (draft.endDate < draft.startDate || value <= 0 || (draft.discountType === "percentage" && value > 100)) {
      setError("Check the date range and discount value. Percentage discounts must be 1–100%.");
      return;
    }
    setSaving(true);
    try {
      // Only editable fields are written, so usageCount and createdAt are never overwritten.
      const payload = {
        title: draft.title.trim(),
        promoLabel: draft.promoLabel.trim(),
        headlineMain: draft.headlineMain.trim(),
        headlineAccent: draft.headlineAccent.trim(),
        tagline: draft.tagline.trim(),
        description: draft.description.trim(),
        imageUrl: draft.imageUrl.trim(),
        discountType: draft.discountType,
        discountValue: value,
        services: [...new Set(draft.services)],
        startDate: draft.startDate,
        endDate: draft.endDate,
        status: draft.status,
        updatedAt: serverTimestamp(),
      };
      if (editingId) {
        await updateDoc(doc(db, "promotions", editingId), payload);
        await logAdminAction({ action: "update_promotion", targetType: "promotion", targetId: editingId, targetLabel: payload.title });
        // Keep a single live promotion: any older entries are hidden, not deleted.
        await Promise.all(
          promotions
            .filter((item) => item.id !== editingId && item.status !== "draft")
            .map((item) => updateDoc(doc(db, "promotions", item.id), { status: "draft", updatedAt: serverTimestamp() }))
        );
      } else {
        const created = await addDoc(collection(db, "promotions"), { ...payload, createdAt: serverTimestamp(), usageCount: 0 });
        await logAdminAction({ action: "create_promotion", targetType: "promotion", targetId: created.id, targetLabel: payload.title });
      }
      closeForm();
      await load();
    } catch (saveError) {
      setError(saveError.message || "Could not save this promotion.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="container adminSurface pageSection adminPage promotionsPage">
      {!formOpen && !loading && !promotions.length && (
        <div className="pageHeader">
          <div />
          <button className="btn btnShine" type="button" onClick={openFirst}>Set up promotion</button>
        </div>
      )}

      {error && <div className="error" role="alert">{error}</div>}

      {formOpen && (
        <div className="card promoEditor">
          <div className="cardHeader">
            <div>
              <h2>Edit promotion</h2>
              <p className="sub">Set the discount, eligible services, dates, and an optional poster.</p>
            </div>
          </div>
          <form className="promoForm" onSubmit={save}>
            <div className="promoGrid">
              <Field label="Title">
                <input className="input" value={draft.title} onChange={setField("title")} maxLength={100} required />
              </Field>
              <Field label="Discount type">
                <select className="input" value={draft.discountType} onChange={setField("discountType")}>
                  <option value="percentage">Percentage (%)</option>
                  <option value="fixed">Fixed amount (₱)</option>
                </select>
              </Field>
              <Field label={draft.discountType === "percentage" ? "Discount (%)" : "Discount (₱)"}>
                <input className="input" type="number" min="1" max={draft.discountType === "percentage" ? 100 : undefined} value={draft.discountValue} onChange={setField("discountValue")} required />
              </Field>
            </div>

            <div className="promoGrid">
              <Field label="Banner label (optional)">
                <input className="input" placeholder="Dental Care Promo" value={draft.promoLabel} onChange={setField("promoLabel")} maxLength={40} />
              </Field>
              <Field label="Headline (optional)">
                <input className="input" placeholder="Smile" value={draft.headlineMain} onChange={setField("headlineMain")} maxLength={24} />
              </Field>
              <Field label="Highlighted word (optional)">
                <input className="input" placeholder="Brighter" value={draft.headlineAccent} onChange={setField("headlineAccent")} maxLength={24} />
              </Field>
              <Field label="Tagline (optional)">
                <input className="input" placeholder="Your Smile’s Best Deal" value={draft.tagline} onChange={setField("tagline")} maxLength={50} />
              </Field>
            </div>

            <Field label="Description">
              <textarea className="input" rows={3} value={draft.description} onChange={setField("description")} maxLength={1000} />
            </Field>

            <Field label="Poster image (optional)">
              <input className="input" type="file" accept="image/*" onChange={handleImageFile} />
            </Field>
            {!draft.imageUrl.startsWith("data:") && (
              <Field label="Or paste an image URL">
                <input className="input" type="url" placeholder="https://…" value={draft.imageUrl} onChange={setField("imageUrl")} />
              </Field>
            )}
            {draft.imageUrl.trim() && (
              <>
                <img
                  key={draft.imageUrl.length}
                  className="promoPreview"
                  src={draft.imageUrl.trim()}
                  alt="Poster preview"
                  onError={(event) => { event.currentTarget.style.display = "none"; }}
                />
                <div className="inlineActionRow">
                  <button className="btn btnGhost" type="button" onClick={() => setDraft((current) => ({ ...current, imageUrl: "" }))}>Remove image</button>
                </div>
              </>
            )}

            <div className="promoGrid">
              <Field label="Starts">
                <input className="input" type="date" value={draft.startDate} onChange={setField("startDate")} required />
              </Field>
              <Field label="Expires">
                <input className="input" type="date" min={draft.startDate || undefined} value={draft.endDate} onChange={setField("endDate")} required />
              </Field>
              <Field label="State">
                <select className="input" value={draft.status} onChange={setField("status")}>
                  <option value="draft">Draft (hidden)</option>
                  <option value="active">Published</option>
                </select>
              </Field>
            </div>

            <fieldset className="promoField promoServices">
              <legend className="detailLabel">Applicable services</legend>
              {serviceOptions.length ? (
                <div className="promoChips">
                  {serviceOptions.map((name) => (
                    <label key={name} className="promoChip">
                      <input type="checkbox" checked={draft.services.includes(name)} onChange={() => toggleService(name)} />
                      <span>{name}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="sub">No active services found. Add services first.</p>
              )}
            </fieldset>

            <div className="inlineActionRow">
              <button className="btn btnShine" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
              <button className="btn btnGhost" type="button" onClick={closeForm} disabled={saving}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        <div className="cardHeader">
          <div>
            <h2>Current promotion</h2>
            <p className="sub">Status is calculated from the start and expiration dates.</p>
          </div>
        </div>

        {loading ? (
          <p className="sub">Loading promotion…</p>
        ) : !current ? (
          <p className="sub">No promotion set up yet.</p>
        ) : (
          <div className="promoList">
            <article className="promoItem">
              {current.imageUrl ? (
                <img className="promoThumb" src={current.imageUrl} alt="" loading="lazy" />
              ) : (
                <div className="promoThumb promoThumbEmpty" aria-hidden="true">
                  {current.discountType === "percentage" ? `${Number(current.discountValue || 0)}%` : `₱${Number(current.discountValue || 0).toLocaleString()}`}
                </div>
              )}
              <div className="promoBody">
                <span className="promoBadge" data-status={statusOf(current)}>{statusOf(current)}</span>
                <h3>{current.title}</h3>
                {current.description && <p className="promoDesc">{current.description}</p>}
                <ul className="promoMeta">
                  <li>{formatDiscount(current)}</li>
                  <li>{formatDate(current.startDate)} – {formatDate(current.endDate)}</li>
                  <li>{(current.services || []).join(", ") || "No services"}</li>
                  <li>{current.usageCount || 0} booking uses</li>
                </ul>
              </div>
              <div className="promoActions">
                <button className="btn btnGhost" type="button" onClick={() => edit(current)}>Edit</button>
              </div>
            </article>
          </div>
        )}
      </div>
    </section>
  );
}