import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import CursorAura from "../components/CursorAura";
import { db } from "../firebase";
import { CLINIC_SERVICE_IMAGES, getBookingServiceOptions, getClinicServiceImage } from "../utils/clinic";
import scaryServiceTooth from "../assets/scary-service-tooth.png";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function normalizeServiceKey(value = "") {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

const key = normalizeServiceKey;

/* ------------------------------------------------------------------ */
/* Images                                                              */
/* ------------------------------------------------------------------ */

const IMG = {
  cleaning: CLINIC_SERVICE_IMAGES.cleaning,
  restoration: CLINIC_SERVICE_IMAGES.fillings,
  extraction: CLINIC_SERVICE_IMAGES.extraction,
  braces: CLINIC_SERVICE_IMAGES.braces,
  rootCanal: CLINIC_SERVICE_IMAGES.rootCanal,
  whitening: CLINIC_SERVICE_IMAGES.whitening,
  oralSurgery: CLINIC_SERVICE_IMAGES.extraction,
  crowns: CLINIC_SERVICE_IMAGES.fillings,
  dentures: CLINIC_SERVICE_IMAGES.cleaning,
  xray: CLINIC_SERVICE_IMAGES.rootCanal,
};

/* ------------------------------------------------------------------ */
/* Descriptive copy per service (badge, highlights, overview)          */
/* ------------------------------------------------------------------ */

const WHITENING_COPY = {
  badge: "Smile brightening",
  highlights: [
    { label: "Best for", value: "Patients aiming to lift surface staining and brighten the overall shade of the smile." },
    { label: "Visit flow", value: "Shade check, whitening cycle preparation, guided treatment, and aftercare reminders." },
    { label: "Planning note", value: "Results vary depending on the current tooth shade and the source of discoloration." },
  ],
  overview: [
    { title: "Before your visit", text: "Avoid starting whitening if your teeth are already highly sensitive without asking the clinic first." },
    { title: "What the team checks", text: "The dentist looks at current shade, sensitivity risk, and whether whitening suits your teeth." },
    { title: "Aftercare", text: "A short white-diet window may be advised while the teeth are still more open to staining." },
  ],
};

const SERVICE_COPY = {
  [key("Cleaning")]: {
    badge: "Routine care",
    highlights: [
      { label: "Best for", value: "Regular maintenance, stain removal, and keeping gums in better shape." },
      { label: "Visit flow", value: "Assessment, gentle scaling, polishing, and home-care reminders before you leave." },
      { label: "Planning note", value: "A simple case usually finishes in one visit, but heavy buildup can take longer." },
    ],
    overview: [
      { title: "Before your visit", text: "Brush normally and mention any areas that bleed or feel sensitive." },
      { title: "What the team checks", text: "The dentist looks at gum condition, tartar buildup, and overall oral hygiene." },
      { title: "Aftercare", text: "You may be asked to avoid strongly colored food or drinks for a short time after polishing." },
    ],
  },
  [key("Fillings")]: {
    badge: "Tooth repair",
    highlights: [
      { label: "Best for", value: "Small to moderate cavities, chipped surfaces, or worn areas that need restoration." },
      { label: "Visit flow", value: "Decay removal, tooth preparation, filling placement, and bite adjustment." },
      { label: "Planning note", value: "Final cost depends on the number of surfaces involved and the tooth condition." },
    ],
    overview: [
      { title: "Before your visit", text: "Tell the clinic if the tooth is sensitive to cold, sweets, or pressure." },
      { title: "What the team checks", text: "The dentist confirms the size of the cavity and whether a filling is still the right option." },
      { title: "Aftercare", text: "Mild sensitivity can happen for a few days while the tooth settles after treatment." },
    ],
  },
  [key("Restoration")]: {
    badge: "Tooth repair",
    highlights: [
      { label: "Best for", value: "Damaged or decayed teeth that still have enough structure to be restored." },
      { label: "Visit flow", value: "Tooth preparation, restorative material placement, shaping, and bite balancing." },
      { label: "Planning note", value: "The exact treatment plan depends on how deep the damaged area goes." },
    ],
    overview: [
      { title: "Before your visit", text: "Share any discomfort you feel while chewing so the team can localize the tooth." },
      { title: "What the team checks", text: "The dentist reviews the tooth surface, bite pressure, and whether further treatment is needed." },
      { title: "Aftercare", text: "Avoid very hard food on the treated side until the bite feels normal again." },
    ],
  },
  [key("Extraction")]: {
    badge: "Tooth removal",
    highlights: [
      { label: "Best for", value: "Teeth that are badly damaged, loose, problematic, or no longer ideal to keep." },
      { label: "Visit flow", value: "Evaluation, numbing, removal, and post-extraction instructions before discharge." },
      { label: "Planning note", value: "Complex extractions may need additional planning and a different final rate." },
    ],
    overview: [
      { title: "Before your visit", text: "Eat ahead if advised by the clinic and disclose any current medications." },
      { title: "What the team checks", text: "The dentist evaluates the tooth position, root condition, and whether imaging is needed." },
      { title: "Aftercare", text: "Expect a focused recovery plan around rest, soft food, and protecting the extraction site." },
    ],
  },
  [key("Braces Consultation")]: {
    badge: "Orthodontic",
    highlights: [
      { label: "Best for", value: "Patients who want to check alignment, bite concerns, spacing, or crowding." },
      { label: "Visit flow", value: "Smile and bite evaluation, treatment discussion, and recommended next steps." },
      { label: "Planning note", value: "Consultation rates are discussed at the clinic because plans vary by case complexity." },
    ],
    overview: [
      { title: "Before your visit", text: "List the alignment concerns you notice so the consultation stays focused on your goals." },
      { title: "What the team checks", text: "The dentist reviews bite pattern, crowding, spacing, and whether braces are the right fit." },
      { title: "After the consult", text: "You may receive a treatment outline, imaging recommendation, or payment guidance for the next step." },
    ],
  },
  [key("Braces")]: {
    badge: "Orthodontic care",
    highlights: [
      { label: "Best for", value: "Long-term alignment, bite correction, and guided movement of teeth over time." },
      { label: "Visit flow", value: "Case review, appliance planning, and a phased treatment setup based on your bite." },
      { label: "Planning note", value: "Our down payment starts at PHP 5,000, depending on the type of braces you choose. This is only the starting point; the full plan depends on treatment length." },
    ],
    overview: [
      { title: "Before your visit", text: "Come ready to talk about your smile goals, bite issues, and timeline expectations." },
      { title: "What the team checks", text: "The dentist reviews spacing, alignment, jaw relationship, and treatment readiness." },
      { title: "After the visit", text: "Expect a step-by-step plan covering appliance setup, follow-ups, and ongoing adjustments." },
    ],
  },
  [key("Root Canal")]: {
    badge: "Tooth-saving care",
    highlights: [
      { label: "Best for", value: "Teeth with deep decay, infection, or prolonged pain where saving the tooth is still possible." },
      { label: "Visit flow", value: "Diagnosis, canal cleaning, disinfection, and sealing based on the tooth involved." },
      { label: "Planning note", value: "Pricing is per canal, so multi-rooted teeth can change the total expected cost." },
    ],
    overview: [
      { title: "Before your visit", text: "Let the clinic know if the tooth has swelling, throbbing pain, or past emergency treatment." },
      { title: "What the team checks", text: "The dentist confirms the infection level, canal involvement, and tooth restorability." },
      { title: "Aftercare", text: "The tooth may need additional restoration after treatment to keep it strong for biting." },
    ],
  },
  [key("Whitening")]: WHITENING_COPY,
  [key("Teeth Whitening")]: WHITENING_COPY,
  [key("Oral Surgery")]: {
    badge: "Advanced procedure",
    highlights: [
      { label: "Best for", value: "Cases that need more involved surgical planning than a routine dental procedure." },
      { label: "Visit flow", value: "Assessment, surgical planning, case discussion, and detailed consent before treatment." },
      { label: "Planning note", value: "Rates vary because surgical complexity and recovery needs differ case by case." },
    ],
    overview: [
      { title: "Before your visit", text: "Bring any prior imaging or referral notes if you already had the area evaluated elsewhere." },
      { title: "What the team checks", text: "The dentist reviews the procedure scope, surgical risks, and healing expectations." },
      { title: "Aftercare", text: "Recovery instructions are more detailed here, especially around swelling, food, and follow-up checks." },
    ],
  },
  [key("Veneers")]: {
    badge: "Cosmetic planning",
    highlights: [
      { label: "Best for", value: "Smile design cases where color, shape, or surface appearance need cosmetic improvement." },
      { label: "Visit flow", value: "Aesthetic assessment, design discussion, and treatment planning based on the chosen material." },
      { label: "Planning note", value: "Pricing changes with veneer type, material choice, and the number of teeth included." },
    ],
    overview: [
      { title: "Before your visit", text: "Bring references or examples if you have a preferred smile shape or brightness in mind." },
      { title: "What the team checks", text: "The dentist reviews tooth condition, bite, smile line, and cosmetic goals." },
      { title: "After the consult", text: "You may move into shade planning, material discussion, or a staged cosmetic treatment plan." },
    ],
  },
  [key("Crowns")]: {
    badge: "Tooth coverage",
    highlights: [
      { label: "Best for", value: "Weak, broken, or heavily restored teeth that need added strength and coverage." },
      { label: "Visit flow", value: "Tooth evaluation, preparation planning, and crown discussion based on support needs." },
      { label: "Planning note", value: "Material choice and whether other procedures are needed can affect the final quote." },
    ],
    overview: [
      { title: "Before your visit", text: "Mention if the tooth already has a large filling, a crack, or recent pain." },
      { title: "What the team checks", text: "The dentist looks at remaining tooth structure and whether the tooth can support a crown." },
      { title: "Aftercare", text: "Long-term success depends on bite fit, oral hygiene, and protecting the restored tooth." },
    ],
  },
  [key("Dentures")]: {
    badge: "Tooth replacement",
    highlights: [
      { label: "Best for", value: "Patients replacing missing teeth to improve support for chewing, speech, and facial balance." },
      { label: "Visit flow", value: "Fit assessment, planning, and discussion of the most suitable denture type." },
      { label: "Planning note", value: "The final fee depends on design, coverage, and whether supporting treatment is needed first." },
    ],
    overview: [
      { title: "Before your visit", text: "Share any problem areas from a current denture or any missing-tooth concerns you want fixed." },
      { title: "What the team checks", text: "The dentist evaluates gum support, missing-tooth pattern, and comfort priorities." },
      { title: "After the visit", text: "Expect guidance around fit steps, adjustment visits, and adapting to chewing with the appliance." },
    ],
  },
  [key("Dental X-ray")]: {
    badge: "Diagnostic imaging",
    highlights: [
      { label: "Best for", value: "Cases that need clearer internal imaging before planning treatment safely." },
      { label: "Visit flow", value: "Image selection, positioning, capture, and review to support the next treatment step." },
      { label: "Planning note", value: "Rates differ between panoramic and periapical imaging depending on what the dentist needs." },
    ],
    overview: [
      { title: "Before your visit", text: "Ask the clinic which type of X-ray was requested so the booking matches the need." },
      { title: "What the team checks", text: "The dentist uses imaging to confirm hidden issues before moving into treatment." },
      { title: "After imaging", text: "The images usually feed directly into the consultation or treatment plan discussed with you." },
    ],
  },
};

const SERVICE_TYPES = {
  [key("Braces")]: ["Metal", "Ceramic", "Sapphire", "Self-ligating"],
};

/* ------------------------------------------------------------------ */
/* Built-in services (shown when the clinic hasn't overridden them)    */
/* ------------------------------------------------------------------ */

const DEFAULT_SERVICES = [
  { name: "Cleaning", desc: "Professional cleaning for healthier gums and a fresher smile.", price: "PHP 800 starting", img: IMG.cleaning },
  { name: "Restoration", desc: "Tooth-colored restoration for damaged or decayed teeth.", price: "PHP 800 starting", img: IMG.restoration },
  { name: "Extraction", desc: "Safe and comfortable tooth removal when needed.", price: "PHP 800 starting", img: IMG.extraction },
  { name: "Teeth Whitening", desc: "Whitening treatment designed to brighten your smile in one session.", price: "PHP 8,000", img: IMG.whitening },
  { name: "Oral Surgery", desc: "Minor oral surgical procedures with proper planning and care.", price: "PHP 5,000 starting", img: IMG.oralSurgery },
  { name: "Veneers", desc: "Cosmetic veneer treatment for smile improvement and tooth enhancement.", price: "Depends on procedure and product", img: IMG.restoration },
  { name: "Crowns", desc: "Dental crowns to restore strength, shape, and appearance of teeth.", price: "PHP 7,000 starting", img: IMG.crowns },
  { name: "Dentures", desc: "Custom removable replacement for missing teeth.", price: "PHP 5,000 starting", img: IMG.dentures },
  { name: "Root Canal", desc: "Treatment for infected canals to help save the tooth.", price: "PHP 8,000 per canal", img: IMG.rootCanal },
  { name: "Braces", desc: "Orthodontic treatment for bite alignment and smile correction.", price: "PHP 5,000 down payment", img: IMG.braces },
  { name: "Dental X-ray", desc: "Diagnostic imaging for treatment planning and case evaluation.", price: "Panoramic: PHP 1,000 • Periapical: PHP 500", img: IMG.xray },
];

/* ------------------------------------------------------------------ */
/* Building the final list                                             */
/* ------------------------------------------------------------------ */

function buildServiceContent(service) {
  const content = SERVICE_COPY[key(service.name)] || null;
  const types = SERVICE_TYPES[key(service.name)] || service.types || [];

  if (content) {
    return {
      ...service,
      types,
      badge: content.badge,
      highlights: content.highlights,
      overview: content.overview,
    };
  }

  return {
    ...service,
    types,
    badge: service.category || "Clinic service",
    highlights: [
      { label: "Best for", value: service.desc || "Clinic-managed treatment available for booking." },
      { label: "Visit flow", value: "Your appointment flow is confirmed by the clinic after the dentist reviews the case." },
      { label: "Planning note", value: `Estimated chair time is ${service.duration || "case-based"}, and final fees may vary by procedure details.` },
    ],
    overview: [
      { title: "Before your visit", text: "Share the concern you want checked so the clinic can prepare the right appointment flow." },
      { title: "What the team checks", text: `This service is currently grouped under ${service.category || "General"} care.` },
      { title: "After the visit", text: "The dentist may confirm a next step, follow-up schedule, or updated treatment recommendation." },
    ],
  };
}

const DEFAULT_ITEMS = DEFAULT_SERVICES.map((service) =>
  buildServiceContent({ ...service, category: "General", duration: "Varies by case" })
);

/** Built-in services, with any clinic-managed services (Firestore) layered on top by name. */
function mergeServices(managedServices) {
  const merged = new Map(DEFAULT_ITEMS.map((item) => [key(item.name), item]));

  getBookingServiceOptions(managedServices).forEach((service) => {
    merged.set(
      key(service.name),
      buildServiceContent({
        name: service.name,
        desc: service.description || "Clinic-managed service available for booking.",
        price: service.startingRate || "Ask the clinic for pricing",
        duration: `${service.durationMinutes} minutes`,
        img: getClinicServiceImage(service),
        category: service.category || "General",
      })
    );
  });

  return Array.from(merged.values());
}

/* ------------------------------------------------------------------ */
/* Hooks                                                               */
/* ------------------------------------------------------------------ */

const DEMONIC_CLASS = "mascotDemonicTheme";

function useDemonicTheme() {
  const [isDemonic, setIsDemonic] = useState(
    () => typeof document !== "undefined" && document.body.classList.contains(DEMONIC_CLASS)
  );

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const body = document.body;
    const sync = () => setIsDemonic(body.classList.contains(DEMONIC_CLASS));

    const observer = new MutationObserver(sync);
    observer.observe(body, { attributes: true, attributeFilter: ["class"] });
    sync();

    return () => observer.disconnect();
  }, []);

  return isDemonic;
}

function useManagedServices() {
  const [services, setServices] = useState([]);

  useEffect(() => {
    const q = query(collection(db, "clinicServices"), orderBy("name", "asc"));
    const unsub = onSnapshot(q, (snapshot) => {
      setServices(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    });
    return () => unsub();
  }, []);

  return services;
}

/* ------------------------------------------------------------------ */
/* Image stage (arrows, counter, dots)                                 */
/* ------------------------------------------------------------------ */

function ServiceStage({ items, index, isDemonic, onPrev, onNext, onSelect }) {
  const selected = items[index];
  const total = items.length;
  const pad = (n) => String(n).padStart(2, "0");

  return (
    <div className="svpStageCol">
      <div className="svpStage" data-mascot-target="selected-service-card">
        <img
          key={selected.name}
          className={`svpStageImg${isDemonic ? " isScary" : ""}`}
          src={isDemonic ? scaryServiceTooth : selected.img}
          alt={isDemonic ? `${selected.name} in demon mode` : selected.name}
          loading="eager"
          onError={(event) => {
            event.currentTarget.src = getClinicServiceImage({ name: selected.name, image: "" });
          }}
        />

        <div className="svpNav">
          <button type="button" className="svpArrow" onClick={onPrev} aria-label="Previous" data-mascot-target="services-nav">
            ‹
          </button>
          <button type="button" className="svpArrow" onClick={onNext} aria-label="Next" data-mascot-target="services-nav">
            ›
          </button>
        </div>

        <span className="svpCount" aria-hidden="true">
          {pad(index + 1)} / {pad(total)}
        </span>
      </div>

      <div className="svpDots">
        {items.map((service, i) => (
          <button
            key={service.name}
            type="button"
            className={`svpDot${i === index ? " isActive" : ""}`}
            aria-label={`Show ${service.name}`}
            aria-current={i === index ? "true" : undefined}
            onClick={() => onSelect(i)}
          />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Details (name, facts, types, notes, actions)                        */
/* ------------------------------------------------------------------ */

function InfoRows({ rows }) {
  return (
    <dl className="svpRows">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ServiceDetails({ service }) {
  const rows = [
    ...service.highlights,
    ...service.overview.map((item) => ({ label: item.title, value: item.text })),
  ];

  return (
    <div className="svpDetail" data-mascot-target="selected-service-details" aria-live="polite">
      <div className="svpDetailInner" key={service.name}>
        <span className="svpKind">{service.badge || service.category || "Clinic service"}</span>

        <h2 className="svpName">{service.name}</h2>
        <p className="svpLead">{service.desc}</p>

        <dl className="svpFacts" data-mascot-target="service-pricing">
          <div>
            <dt>Starting rate</dt>
            <dd>{service.price}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{service.duration || "Varies by case"}</dd>
          </div>
        </dl>

        {service.types?.length > 0 && (
          <p className="svpTypes">
            <span className="svpTypesLabel">Types</span>
            {service.types.join(" · ")}
          </p>
        )}

        <InfoRows rows={rows} />

        <div className="svpActions">
          <a className="btn btnShine bookingPrimaryBtn" href="/book" data-mascot-target="book">
            Book this service
          </a>
          <a className="svpLink" href="/contact">
            Ask a question
          </a>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Services() {
  const isDemonic = useDemonicTheme();
  const managedServices = useManagedServices();
  const items = useMemo(() => mergeServices(managedServices), [managedServices]);

  const [index, setIndex] = useState(0);
  const total = items.length;
  const safeIndex = Math.min(index, total - 1);
  const selected = items[safeIndex];

  const prev = () => setIndex((i) => (i - 1 + total) % total);
  const next = () => setIndex((i) => (i + 1) % total);

  // lets the mascot know which service is on screen
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("topdent:selected-service-change", {
        detail: { index: safeIndex, name: selected?.name || "" },
      })
    );
  }, [safeIndex, selected?.name]);

  return (
    <div className="container bookingPage svpPage">
      <CursorAura />

      <div className="svpLayout">
        <ServiceStage
          items={items}
          index={safeIndex}
          isDemonic={isDemonic}
          onPrev={prev}
          onNext={next}
          onSelect={setIndex}
        />
        <ServiceDetails service={selected} />
      </div>
    </div>
  );
}