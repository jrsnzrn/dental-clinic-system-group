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
import EmptyState from "../../components/EmptyState";
import { db } from "../../firebase";
import {
  CLINIC_SERVICE_IMAGE_OPTIONS,
  formatClosureLabel,
  getClinicServiceImage,
  getLocalClinicServiceImage,
  normalizeClosure,
  normalizeService,
} from "../../utils/clinic";
import { logAdminAction } from "../../utils/audit";

function emptyServiceDraft() {
  return {
    name: "",
    description: "",
    durationMinutes: 60,
    startingRate: "",
    category: "General",
    image: "",
    active: true,
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
  const [editingServiceId, setEditingServiceId] = useState("");
  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [closureDraft, setClosureDraft] = useState(emptyClosureDraft());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [serviceLoading, setServiceLoading] = useState(true);
  const [closureLoading, setClosureLoading] = useState(true);
  const [serviceLoadError, setServiceLoadError] = useState("");
  const [closureLoadError, setClosureLoadError] = useState("");
  const [serviceError, setServiceError] = useState("");
  const [closureError, setClosureError] = useState("");
  const [savingService, setSavingService] = useState(false);
  const [savingClosure, setSavingClosure] = useState(false);
  const [busyServiceId, setBusyServiceId] = useState("");
  const [busyClosureId, setBusyClosureId] = useState("");

  useEffect(() => {
    const unsubServices = onSnapshot(
      query(collection(db, "clinicServices"), orderBy("name", "asc")),
      (snapshot) => {
        setServices(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
        setServiceLoading(false);
        setServiceLoadError("");
      },
      (error) => {
        console.error("Could not load clinic services:", error);
        setServiceLoading(false);
        setServiceLoadError("Services could not be loaded. Check your access and try again.");
      }
    );

    const unsubClosures = onSnapshot(
      query(collection(db, "clinicClosures"), orderBy("date", "asc")),
      (snapshot) => {
        setClosures(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
        setClosureLoading(false);
        setClosureLoadError("");
      },
      (error) => {
        console.error("Could not load clinic closures:", error);
        setClosureLoading(false);
        setClosureLoadError("Holiday blocking could not be loaded. Check your access and try again.");
      }
    );

    return () => {
      unsubServices();
      unsubClosures();
    };
  }, []);

  useEffect(() => {
    if (!serviceModalOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && !savingService) setServiceModalOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [serviceModalOpen, savingService]);

  const normalizedServices = useMemo(
    () => services.map((service) => ({ ...service, ...normalizeService(service) })),
    [services]
  );
  const normalizedClosures = useMemo(
    () => closures.map((entry) => ({ id: entry.id, ...normalizeClosure(entry) })),
    [closures]
  );
  const filteredServices = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return normalizedServices.filter((service) => {
      const matchesStatus = statusFilter === "all"
        || (statusFilter === "active" ? service.active : !service.active);
      const searchContent = [
        service.name,
        service.description,
        service.category,
        service.startingRate,
      ].join(" ").toLowerCase();
      return matchesStatus && (!normalizedSearch || searchContent.includes(normalizedSearch));
    });
  }, [normalizedServices, search, statusFilter]);
  const selectedBuiltinImage = CLINIC_SERVICE_IMAGE_OPTIONS.find((option) =>
    serviceDraft.image === `local:${option.key}`
    || (editingServiceId && getClinicServiceImage(serviceDraft) === option.image)
  );
  const imageSelectionValue = selectedBuiltinImage?.key
    || (editingServiceId && serviceDraft.image ? "preserve" : "");

  function openAddService() {
    setEditingServiceId("");
    setServiceDraft(emptyServiceDraft());
    setServiceError("");
    setServiceModalOpen(true);
  }

  function editService(service) {
    const normalized = normalizeService(service);
    setEditingServiceId(service.id);
    setServiceDraft({
      name: normalized.name,
      description: normalized.description,
      durationMinutes: normalized.durationMinutes,
      startingRate: normalized.startingRate,
      category: normalized.category || "General",
      image: String(service.image ?? ""),
      active: normalized.active,
    });
    setServiceError("");
    setServiceModalOpen(true);
  }

  function closeServiceModal() {
    if (savingService) return;
    setServiceModalOpen(false);
    setEditingServiceId("");
    setServiceDraft(emptyServiceDraft());
    setServiceError("");
  }

  async function saveService(event) {
    event.preventDefault();
    const payload = normalizeService(serviceDraft);
    setServiceError("");

    const normalizedName = payload.name.toLowerCase().replace(/\s+/g, " ");
    const duplicate = services.find((service) =>
      service.id !== editingServiceId
      && String(service.name || "").trim().toLowerCase().replace(/\s+/g, " ") === normalizedName
    );
    if (duplicate) {
      setServiceError(`A service named "${duplicate.name}" already exists. Edit its existing record instead.`);
      return;
    }

    setSavingService(true);
    try {
      if (editingServiceId) {
        await updateDoc(doc(db, "clinicServices", editingServiceId), {
          name: payload.name,
          description: payload.description,
          durationMinutes: payload.durationMinutes,
          startingRate: payload.startingRate,
          category: payload.category,
          image: serviceDraft.image,
          active: payload.active,
        });
        await logAdminAction({
          action: "update_clinic_service",
          targetType: "clinic_service",
          targetId: editingServiceId,
          targetLabel: payload.name,
          details: {
            category: payload.category,
            durationMinutes: payload.durationMinutes,
            startingRate: payload.startingRate || "",
            active: payload.active,
          },
        });
      } else {
        const created = await addDoc(collection(db, "clinicServices"), {
          ...payload,
          image: serviceDraft.image,
          createdAt: serverTimestamp(),
        });
        await logAdminAction({
          action: "add_clinic_service",
          targetType: "clinic_service",
          targetId: created.id,
          targetLabel: payload.name,
          details: {
            category: payload.category,
            durationMinutes: payload.durationMinutes,
            startingRate: payload.startingRate || "",
          },
        });
      }
      setServiceModalOpen(false);
      setEditingServiceId("");
      setServiceDraft(emptyServiceDraft());
    } catch (error) {
      console.error("Could not save clinic service:", error);
      setServiceError("Could not save this service. Check your access and try again.");
    } finally {
      setSavingService(false);
    }
  }

  async function toggleService(service) {
    const nextActive = !normalizeService(service).active;
    const actionLabel = nextActive ? "activate" : "deactivate";
    if (!window.confirm(`Are you sure you want to ${actionLabel} "${service.name}"?`)) return;

    setBusyServiceId(service.id);
    setServiceError("");
    try {
      await updateDoc(doc(db, "clinicServices", service.id), {
        active: nextActive,
      });
      await logAdminAction({
        action: "toggle_clinic_service",
        targetType: "clinic_service",
        targetId: service.id,
        targetLabel: service.name,
        details: { active: nextActive },
      });
      setServiceDraft((current) => ({ ...current, active: nextActive }));
    } catch (error) {
      console.error("Could not update clinic service status:", error);
      setServiceError("The service status could not be updated. Check your access and try again.");
    } finally {
      setBusyServiceId("");
    }
  }

  async function addClosure(event) {
    event.preventDefault();
    const payload = normalizeClosure(closureDraft);
    if (!payload.date || !payload.label) return;

    setSavingClosure(true);
    setClosureError("");
    try {
      const created = await addDoc(collection(db, "clinicClosures"), {
        ...payload,
        createdAt: serverTimestamp(),
      });
      await logAdminAction({
        action: "add_clinic_closure",
        targetType: "clinic_closure",
        targetId: created.id,
        targetLabel: payload.label,
        details: { date: payload.date, type: payload.type },
      });
      setClosureDraft(emptyClosureDraft());
    } catch (error) {
      console.error("Could not add clinic closure:", error);
      setClosureError("Could not add this closure. Check your access and try again.");
    } finally {
      setSavingClosure(false);
    }
  }

  async function toggleClosure(closure) {
    setBusyClosureId(closure.id);
    setClosureError("");
    try {
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
    } catch (error) {
      console.error("Could not update clinic closure:", error);
      setClosureError("Could not update this closure. Check your access and try again.");
    } finally {
      setBusyClosureId("");
    }
  }

  return (
    <div className="container adminSurface servicesAdminPage">
      <label className="servicesAdminTopSearch adminSearchField">
        <svg className="adminSearchIcon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search services"
          aria-label="Search services"
        />
      </label>

      <section className="servicesAdminSection" aria-label="Services">
        <div className="servicesAdminToolbar">
          <div className="servicesAdminFilters" aria-label="Filter services by status">
            {["all", "active", "inactive"].map((filter) => (
              <button
                key={filter}
                type="button"
                className={statusFilter === filter ? "isSelected" : ""}
                aria-pressed={statusFilter === filter}
                onClick={() => setStatusFilter(filter)}
              >
                {filter[0].toUpperCase() + filter.slice(1)}
              </button>
            ))}
          </div>
          <button className="servicesAdminAddButton" type="button" onClick={openAddService}>
            <span aria-hidden="true">+</span> Add Service
          </button>
        </div>

        {serviceLoadError ? <p className="servicesAdminMessage isError" role="alert">{serviceLoadError}</p> : null}
        {serviceLoading ? (
          <p className="servicesAdminMessage" role="status">Loading services…</p>
        ) : !serviceLoadError && services.length === 0 ? (
          <EmptyState title="No services found" message="Services will appear here when clinic service records are available." compact />
        ) : !serviceLoadError && filteredServices.length === 0 ? (
          <EmptyState title="No matching services" message="Try another search or status filter." compact />
        ) : !serviceLoadError ? (
          <ul className="servicesAdminList">
            {filteredServices.map((service) => (
              <li
                className="servicesAdminRow"
                key={service.id}
                role="button"
                tabIndex={0}
                aria-label={`Edit ${service.name}`}
                onClick={() => editService(service)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    editService(service);
                  }
                }}
              >
                <div className="servicesAdminThumbnail">
                  <img
                    src={getClinicServiceImage(service)}
                    alt=""
                    loading="lazy"
                    onError={(event) => {
                      event.currentTarget.onerror = null;
                      event.currentTarget.src = getLocalClinicServiceImage({ name: service.name });
                    }}
                  />
                </div>
                <div className="servicesAdminRowContent">
                  <div className="servicesAdminNameLine">
                    <h3>{service.name}</h3>
                    <span className={`servicesAdminStatus ${service.active ? "isActive" : "isInactive"}`}>
                      {service.active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <p className="servicesAdminDescription">{service.description || "No description provided."}</p>
                  <div className="servicesAdminMeta">
                    <span>{service.startingRate || "Pricing not set"}</span>
                    {service.durationMinutes > 0 ? <span>{service.durationMinutes} min</span> : null}
                    {service.category ? <span>{service.category}</span> : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="servicesAdminSection servicesAdminClosures" aria-labelledby="holiday-blocking-heading">
        <div className="servicesAdminSectionHeading">
          <div>
            <h2 id="holiday-blocking-heading">Holiday Blocking</h2>
            <p>Manage full-day clinic closures separately from dental treatments.</p>
          </div>
          <span className="servicesAdminClosureCount">
            {normalizedClosures.filter((entry) => entry.active).length} active
          </span>
        </div>
        <form className="servicesAdminClosureForm" onSubmit={addClosure}>
          <label>
            <span>Date</span>
            <input
              type="date"
              required
              value={closureDraft.date}
              onChange={(event) => setClosureDraft((current) => ({ ...current, date: event.target.value }))}
            />
          </label>
          <label>
            <span>Closure name</span>
            <input
              required
              value={closureDraft.label}
              onChange={(event) => setClosureDraft((current) => ({ ...current, label: event.target.value }))}
              placeholder="e.g. Clinic holiday"
            />
          </label>
          <label>
            <span>Type</span>
            <select
              value={closureDraft.type}
              onChange={(event) => setClosureDraft((current) => ({ ...current, type: event.target.value }))}
            >
              <option value="holiday">Holiday</option>
              <option value="leave">Leave</option>
              <option value="emergency">Emergency Closure</option>
            </select>
          </label>
          <label>
            <span>Notes <span className="servicesAdminOptional">(optional)</span></span>
            <input
              value={closureDraft.notes}
              onChange={(event) => setClosureDraft((current) => ({ ...current, notes: event.target.value }))}
              placeholder="Additional details"
            />
          </label>
          <button className="servicesAdminAddButton" type="submit" disabled={savingClosure}>
            {savingClosure ? "Adding…" : "Add closure"}
          </button>
        </form>
        {closureError ? <p className="servicesAdminMessage isError" role="alert">{closureError}</p> : null}
        {closureLoadError ? <p className="servicesAdminMessage isError" role="alert">{closureLoadError}</p> : null}
        {closureLoading ? (
          <p className="servicesAdminMessage" role="status">Loading closures…</p>
        ) : !closureLoadError && normalizedClosures.length === 0 ? (
          <EmptyState title="No clinic closures yet" message="Add holidays or emergency closures here so booking is automatically blocked on those dates." compact />
        ) : !closureLoadError ? (
          <ul className="servicesAdminClosureList">
            {normalizedClosures.map((closure) => (
              <li key={closure.id}>
                <div>
                  <strong>{closure.label}</strong>
                  <span>{closure.date} · {formatClosureLabel(closure)}</span>
                  {closure.notes ? <p>{closure.notes}</p> : null}
                </div>
                <div className="servicesAdminClosureActions">
                  <span className={closure.active ? "isBlocking" : ""}>{closure.active ? "Blocking" : "Inactive"}</span>
                  <button
                    type="button"
                    className="servicesAdminTextButton"
                    onClick={() => toggleClosure(closure)}
                    disabled={busyClosureId === closure.id}
                  >
                    {busyClosureId === closure.id ? "Saving…" : closure.active ? "Disable" : "Re-enable"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {serviceModalOpen ? (
        <div
          className="servicesAdminModalOverlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeServiceModal();
          }}
        >
          <section
            className="servicesAdminModal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="services-admin-modal-title"
          >
            <header className="servicesAdminModalHeader">
              <div>
                <h2 id="services-admin-modal-title">{editingServiceId ? "Edit service" : "Add service"}</h2>
                <p>Service records are shared with the public Services page and booking form.</p>
              </div>
              <button type="button" className="servicesAdminModalClose" onClick={closeServiceModal} aria-label="Close">
                ×
              </button>
            </header>
            <form className="servicesAdminForm" onSubmit={saveService}>
              <div className="servicesAdminFormBody">
                {serviceError ? <p className="servicesAdminMessage isError" role="alert">{serviceError}</p> : null}
                <label>
                  <span>Service name</span>
                  <input
                    required
                    maxLength={100}
                    value={serviceDraft.name}
                    onChange={(event) => setServiceDraft((current) => ({ ...current, name: event.target.value }))}
                  />
                </label>
                <label>
                  <span>Description</span>
                  <textarea
                    required
                    rows={3}
                    maxLength={500}
                    value={serviceDraft.description}
                    onChange={(event) => setServiceDraft((current) => ({ ...current, description: event.target.value }))}
                  />
                </label>
                <label>
                  <span>Service Image</span>
                  <select
                    required={!editingServiceId}
                    value={imageSelectionValue}
                    onChange={(event) => {
                      const option = CLINIC_SERVICE_IMAGE_OPTIONS.find((entry) => entry.key === event.target.value);
                      if (option) {
                        setServiceDraft((current) => ({ ...current, image: `local:${option.key}` }));
                      }
                    }}
                  >
                    {!imageSelectionValue ? <option value="">Select a service image</option> : null}
                    {imageSelectionValue === "preserve" ? (
                      <option value="preserve">Keep current image</option>
                    ) : null}
                    {CLINIC_SERVICE_IMAGE_OPTIONS.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label
                          .replace("Oral surgery", "Oral Surgery")
                          .replace("Root canal", "Root Canal")
                          .replace("Teeth whitening", "Teeth Whitening")}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="servicesAdminFormGrid">
                  <label>
                    <span>Starting rate <span className="servicesAdminOptional">(custom text allowed)</span></span>
                    <input
                      value={serviceDraft.startingRate}
                      onChange={(event) => setServiceDraft((current) => ({ ...current, startingRate: event.target.value }))}
                      placeholder="e.g. PHP 800 starting"
                    />
                  </label>
                  <label>
                    <span>Duration (minutes)</span>
                    <input
                      type="number"
                      required
                      min="1"
                      step="1"
                      value={serviceDraft.durationMinutes}
                      onChange={(event) => setServiceDraft((current) => ({
                        ...current,
                        durationMinutes: event.target.value === "" ? "" : Number(event.target.value),
                      }))}
                    />
                  </label>
                  <label>
                    <span>Category</span>
                    <input
                      required
                      value={serviceDraft.category}
                      onChange={(event) => setServiceDraft((current) => ({ ...current, category: event.target.value }))}
                    />
                  </label>
                </div>
                {editingServiceId || serviceDraft.image ? (
                  <div className="servicesAdminEditPreview">
                    <span>Selected image preview</span>
                    <img
                      src={getClinicServiceImage(serviceDraft)}
                      alt={`${serviceDraft.name || "Service"} preview`}
                      onError={(event) => {
                        event.currentTarget.onerror = null;
                        event.currentTarget.src = getLocalClinicServiceImage({ name: serviceDraft.name });
                      }}
                    />
                  </div>
                ) : null}
              </div>
              <footer className="servicesAdminModalFooter">
                <div className="servicesAdminModalFooterLeft">
                  {editingServiceId ? (
                    <button
                      type="button"
                      className="servicesAdminTextButton servicesAdminModalStatusAction"
                      onClick={() => {
                        const service = services.find((entry) => entry.id === editingServiceId);
                        if (service) void toggleService(service);
                      }}
                      disabled={busyServiceId === editingServiceId || savingService}
                    >
                      {busyServiceId === editingServiceId
                        ? "Saving…"
                        : serviceDraft.active
                          ? "Deactivate"
                          : "Activate"}
                    </button>
                  ) : null}
                </div>
                <div className="servicesAdminModalFooterRight">
                  <button type="button" className="servicesAdminCancelButton" onClick={closeServiceModal} disabled={savingService}>
                    Cancel
                  </button>
                  <button type="submit" className="servicesAdminAddButton" disabled={savingService}>
                    {savingService ? "Saving…" : editingServiceId ? "Save changes" : "Add service"}
                  </button>
                </div>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
