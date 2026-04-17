import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../firebase";
import EmptyState from "../../components/EmptyState";
import { DEFAULT_CLINIC_SERVICES, formatClosureLabel, getActiveServices, getClinicServiceImage, normalizeClosure, normalizeService } from "../../utils/clinic";
import { logAdminAction } from "../../utils/audit";

function emptyServiceDraft() {
  return {
    name: "",
    description: "",
    durationMinutes: 60,
    startingRate: "",
    category: "General",
    image: "",
  };
}

function emptyClosureDraft() {
  return {
    date: "",
    label: "",
    type: "holiday",
    notes: "",
  };
}

export default function ServicesAdmin() {
  const [services, setServices] = useState([]);
  const [closures, setClosures] = useState([]);
  const [serviceDraft, setServiceDraft] = useState(emptyServiceDraft());
  const [closureDraft, setClosureDraft] = useState(emptyClosureDraft());

  useEffect(() => {
    const unsubServices = onSnapshot(
      query(collection(db, "clinicServices"), orderBy("name", "asc")),
      (snapshot) => {
        setServices(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
      }
    );

    const unsubClosures = onSnapshot(
      query(collection(db, "clinicClosures"), orderBy("date", "asc")),
      (snapshot) => {
        setClosures(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
      }
    );

    return () => {
      unsubServices();
      unsubClosures();
    };
  }, []);

  const activeServices = useMemo(() => getActiveServices(services), [services]);
  const normalizedClosures = useMemo(() => closures.map((entry) => ({ id: entry.id, ...normalizeClosure(entry) })), [closures]);

  async function addService(event) {
    event.preventDefault();
    const payload = normalizeService(serviceDraft);
    if (!payload.name) return;

    await addDoc(collection(db, "clinicServices"), {
      ...payload,
      createdAt: serverTimestamp(),
    });

    await logAdminAction({
      action: "add_clinic_service",
      targetType: "clinic_service",
      targetLabel: payload.name,
      details: { category: payload.category, durationMinutes: payload.durationMinutes, startingRate: payload.startingRate || "" },
    });

    setServiceDraft(emptyServiceDraft());
  }

  async function seedDefaults() {
    for (const service of DEFAULT_CLINIC_SERVICES) {
      await addDoc(collection(db, "clinicServices"), {
        ...service,
        createdAt: serverTimestamp(),
      });
    }
  }

  async function toggleService(service) {
    await updateDoc(doc(db, "clinicServices", service.id), {
      active: service.active === false,
    });

    await logAdminAction({
      action: "toggle_clinic_service",
      targetType: "clinic_service",
      targetId: service.id,
      targetLabel: service.name,
      details: { active: service.active === false },
    });
  }

  async function addClosure(event) {
    event.preventDefault();
    const payload = normalizeClosure(closureDraft);
    if (!payload.date || !payload.label) return;

    await addDoc(collection(db, "clinicClosures"), {
      ...payload,
      createdAt: serverTimestamp(),
    });

    await logAdminAction({
      action: "add_clinic_closure",
      targetType: "clinic_closure",
      targetLabel: payload.label,
      details: { date: payload.date, type: payload.type },
    });

    setClosureDraft(emptyClosureDraft());
  }

  async function toggleClosure(closure) {
    await updateDoc(doc(db, "clinicClosures", closure.id), {
      active: !closure.active,
    });

    await logAdminAction({
      action: "toggle_clinic_closure",
      targetType: "clinic_closure",
      targetId: closure.id,
      targetLabel: closure.label,
      details: { active: !closure.active, date: closure.date },
    });
  }

  return (
    <div className="container adminSurface">
      <div className="hero adminHero">
        <div className="adminHeroGlow" />
        <div className="adminHeroContent">
          <span className="heroEyebrow">Clinic Controls</span>
          <h1>Services and Closures</h1>
          <p>Manage clinic services, holiday blocking, and full-day closures without editing the codebase.</p>
        </div>
      </div>

      <div className="grid" style={{ marginTop: 18 }}>
        <div className="card adminEditorCard">
          <div className="cardHeader">
            <div>
              <h3 className="title">Clinic Service Management</h3>
              <p className="sub">Create and toggle services that appear in the patient booking form.</p>
            </div>
            <span className="badge">{activeServices.length} active</span>
          </div>

          <form className="form" onSubmit={addService}>
            <input className="input" placeholder="Service name" value={serviceDraft.name} onChange={(e) => setServiceDraft((current) => ({ ...current, name: e.target.value }))} />
            <input className="input" placeholder="Description" value={serviceDraft.description} onChange={(e) => setServiceDraft((current) => ({ ...current, description: e.target.value }))} />
            <div className="bookingFlowGrid">
              <input className="input" type="number" min="15" step="15" placeholder="Duration in minutes" value={serviceDraft.durationMinutes} onChange={(e) => setServiceDraft((current) => ({ ...current, durationMinutes: Number(e.target.value) || 60 }))} />
              <input className="input" placeholder="Starting rate" value={serviceDraft.startingRate} onChange={(e) => setServiceDraft((current) => ({ ...current, startingRate: e.target.value }))} />
            </div>
            <input className="input" placeholder="Category" value={serviceDraft.category} onChange={(e) => setServiceDraft((current) => ({ ...current, category: e.target.value }))} />
            <input
              className="input"
              type="url"
              placeholder="Service image URL (optional)"
              value={serviceDraft.image}
              onChange={(e) => setServiceDraft((current) => ({ ...current, image: e.target.value }))}
            />
            <p className="sub" style={{ marginTop: -4 }}>
              Paste a direct image link to show the exact service picture on the Services page and booking summary. If left blank, the system uses a smart default image.
            </p>
            <div className="inlineActionRow">
              <button className="btn btnShine" type="submit">Add Service</button>
              {!services.length ? (
                <button className="btn secondary btnSoft" type="button" onClick={seedDefaults}>
                  Load Default Services
                </button>
              ) : null}
            </div>
          </form>

          {services.length ? (
            <ul className="list detailedList" style={{ marginTop: 18 }}>
              {services.map((service) => {
                const normalized = normalizeService(service);
                return (
                  <li key={service.id} className="item detailedItem bookingShowcase">
                    <div className="detailContent">
                      <div className="detailTopRow">
                        <div>
                          <strong className="detailTitle">{normalized.name}</strong>
                          <p className="detailSubtitle">{normalized.description || "No description"} • {normalized.category}</p>
                        </div>
                        <span className={`statusPill ${normalized.active ? "approved" : "archived"}`}>
                          {normalized.active ? "active" : "inactive"}
                        </span>
                      </div>
                      <div className="detailGrid">
                        <div className="detailBox luxeBox serviceImageDetailBox">
                          <span className="detailLabel">Service image</span>
                          <div className="serviceAdminPreviewFrame">
                            <img src={getClinicServiceImage(normalized)} alt={normalized.name} className="serviceAdminPreviewImage" />
                          </div>
                        </div>
                        <div className="detailBox luxeBox">
                          <span className="detailLabel">Starting rate</span>
                          <strong>{normalized.startingRate || "Not set yet"}</strong>
                        </div>
                        <div className="detailBox luxeBox">
                          <span className="detailLabel">Duration</span>
                          <strong>{normalized.durationMinutes} minutes</strong>
                        </div>
                        <div className="detailBox luxeBox">
                          <span className="detailLabel">Category</span>
                          <strong>{normalized.category}</strong>
                        </div>
                        <div className="detailBox luxeBox">
                          <span className="detailLabel">Image source</span>
                          <strong className="serviceImageUrlValue">{normalized.image || "Smart default image"}</strong>
                        </div>
                      </div>
                    </div>
                    <div className="actionColumn">
                      <button className="btn patientEditBtn" type="button" onClick={() => toggleService(service)}>
                        {normalized.active ? "Disable Service" : "Enable Service"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title="No clinic services yet" message="Add a service or load the default set so patients can choose services from Firestore instead of hardcoded options." compact />
          )}
        </div>

        <div className="card adminRecordsCard">
          <div className="cardHeader">
            <div>
              <h3 className="title">Holiday Blocking</h3>
              <p className="sub">Add full-day clinic closures for holidays, leave, or emergency closures.</p>
            </div>
            <span className="badge">{normalizedClosures.filter((entry) => entry.active).length} active closures</span>
          </div>

          <form className="form" onSubmit={addClosure}>
            <input className="input" type="date" value={closureDraft.date} onChange={(e) => setClosureDraft((current) => ({ ...current, date: e.target.value }))} />
            <input className="input" placeholder="Closure label" value={closureDraft.label} onChange={(e) => setClosureDraft((current) => ({ ...current, label: e.target.value }))} />
            <div className="bookingFlowGrid">
              <select className="input" value={closureDraft.type} onChange={(e) => setClosureDraft((current) => ({ ...current, type: e.target.value }))}>
                <option value="holiday">Holiday</option>
                <option value="leave">Leave</option>
                <option value="emergency">Emergency Closure</option>
              </select>
              <input className="input" placeholder="Notes" value={closureDraft.notes} onChange={(e) => setClosureDraft((current) => ({ ...current, notes: e.target.value }))} />
            </div>
            <button className="btn btnShine" type="submit">Add Closure</button>
          </form>

          {normalizedClosures.length ? (
            <ul className="list detailedList" style={{ marginTop: 18 }}>
              {normalizedClosures.map((closure) => (
                <li key={closure.id} className="item detailedItem bookingShowcase">
                  <div className="detailContent">
                    <div className="detailTopRow">
                      <div>
                        <strong className="detailTitle">{closure.label}</strong>
                        <p className="detailSubtitle">{closure.date} • {formatClosureLabel(closure)}</p>
                      </div>
                      <span className={`statusPill ${closure.active ? "archived" : "cancelled"}`}>
                        {closure.active ? "blocking" : "inactive"}
                      </span>
                    </div>
                    {closure.notes ? (
                      <div className="detailNote"><span className="detailLabel">Notes</span><p>{closure.notes}</p></div>
                    ) : null}
                  </div>
                  <div className="actionColumn">
                    <button className="btn archiveButton" type="button" onClick={() => toggleClosure(closure)}>
                      {closure.active ? "Disable Closure" : "Re-enable Closure"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No clinic closures yet" message="Add holidays or emergency closures here so booking is automatically blocked on those dates." compact />
          )}
        </div>
      </div>
    </div>
  );
}
