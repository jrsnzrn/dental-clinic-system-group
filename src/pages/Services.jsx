import { useEffect, useMemo, useRef, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import CursorAura from "../components/CursorAura";
import { db } from "../firebase";
import { getActiveServices, getClinicServiceImage, getLocalClinicServiceImage, PUBLIC_SERVICE_CATALOG } from "../utils/clinic";
import scaryServiceTooth from "../assets/scary-service-tooth.png";
import cleaningImg from "../assets/services/cleaning.jpg";
import fillingsImg from "../assets/services/fillings.jpg";
import extractionImg from "../assets/services/extraction.jpg";
import bracesImg from "../assets/services/braces.jpg";
import rootCanalImg from "../assets/services/rootcanal.jpg";
import whiteningImg from "../assets/services/whitening.jpg";
import crownsImg from "../assets/services/crowns.jpg";
import denturesImg from "../assets/services/dentures.jpg";
import oralSurgeryImg from "../assets/services/oralsurgery.jpg";
import veneersImg from "../assets/services/veneers.jpg";
import xrayImg from "../assets/services/xray.jpg";

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
  cleaning: cleaningImg,
  restoration: fillingsImg,
  extraction: extractionImg,
  braces: bracesImg,
  rootCanal: rootCanalImg,
  whitening: whiteningImg,
  oralSurgery: oralSurgeryImg,
  veneers: veneersImg,
  crowns: crownsImg,
  dentures: denturesImg,
  xray: xrayImg,
};

const SERVICE_IMAGES = {
  [key("Cleaning")]: IMG.cleaning,
  [key("Fillings")]: IMG.restoration,
  [key("Extraction")]: IMG.extraction,
  [key("Braces")]: IMG.braces,
  [key("Root Canal")]: IMG.rootCanal,
  [key("Teeth Whitening")]: IMG.whitening,
  [key("Oral Surgery")]: IMG.oralSurgery,
  [key("Veneers")]: IMG.veneers,
  [key("Crowns")]: IMG.crowns,
  [key("Dentures")]: IMG.dentures,
  [key("Dental X-ray")]: IMG.xray,
};

const LEGACY_SERVICE_PRICE_FALLBACKS = {
  [key("Braces Consultation")]: "Consultation pricing available at clinic",
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
      { label: "Planning note", value: "Appointment length is confirmed by the clinic based on the treatment plan and case details." },
    ],
    overview: [
      { title: "Before your visit", text: "Share the concern you want checked so the clinic can prepare the right appointment flow." },
      { title: "What the team checks", text: `This service is currently grouped under ${service.category || "General"} care.` },
      { title: "After the visit", text: "The dentist may confirm a next step, follow-up schedule, or updated treatment recommendation." },
    ],
  };
}

const DEFAULT_ITEMS = PUBLIC_SERVICE_CATALOG.map((service) =>
  buildServiceContent({
    name: service.name,
    desc: service.description,
    price: service.startingRate,
    img: SERVICE_IMAGES[key(service.name)] || getClinicServiceImage(service),
    category: service.category,
  })
);

/** Use the Firestore catalog for membership while retaining curated presentation fallbacks. */
function mergeServices(managedServices) {
  const catalogOrder = new Map(PUBLIC_SERVICE_CATALOG.map((service, index) => [key(service.name), index]));
  const activeServices = getActiveServices(managedServices).sort((left, right) => {
    const leftOrder = catalogOrder.get(key(left.name));
    const rightOrder = catalogOrder.get(key(right.name));
    if (leftOrder !== undefined && rightOrder !== undefined) return leftOrder - rightOrder;
    if (leftOrder !== undefined) return -1;
    if (rightOrder !== undefined) return 1;
    return left.name.localeCompare(right.name);
  });

  return activeServices.map((service) => {
    const serviceKey = key(service.name);
    const existing = DEFAULT_ITEMS.find((item) => key(item.name) === serviceKey);
    const source = managedServices.find((entry) => entry.id === service.id) || {};

    return buildServiceContent({
      name: service.name,
      desc: Object.prototype.hasOwnProperty.call(source, "description")
        ? service.description
        : existing?.desc ?? "Clinic-managed service available for booking.",
      price: Object.prototype.hasOwnProperty.call(source, "startingRate")
        ? service.startingRate
        : existing?.price ?? LEGACY_SERVICE_PRICE_FALLBACKS[serviceKey] ?? "Ask the clinic for pricing",
      img: service.image
        ? getClinicServiceImage(service)
        : SERVICE_IMAGES[serviceKey] || existing?.img || getClinicServiceImage(service),
      category: service.category || "General",
    });
  });
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

function ServiceImage({ service, isDemonic }) {
  return (
    <img
      className={`svxImg${isDemonic ? " isScary" : ""}`}
      src={isDemonic ? scaryServiceTooth : service.img}
      alt={isDemonic ? `${service.name} in demon mode` : service.name}
      loading="lazy"
      onError={(event) => {
        event.currentTarget.onerror = null;
        event.currentTarget.src = getLocalClinicServiceImage({ name: service.name });
      }}
    />
  );
}

function ServiceCard({ service, isActive, isDemonic, onSelect }) {
  const types = service.types || [];

  return (
    <article
      className="svxCard"
      data-mascot-target={isActive ? "selected-service-card" : undefined}
      onMouseEnter={onSelect}
      onFocus={onSelect}
      onClick={onSelect}
    >
      <h3 className="svxCardName">{service.name}</h3>

      <div className="svxCardMedia">
        <ServiceImage service={service} isDemonic={isDemonic} />
      </div>

      <p className="svxCardDesc" data-mascot-target={isActive ? "selected-service-details" : undefined}>
        {service.desc}
      </p>

      {types.length > 0 && <p className="svxCardTypes">{types.join(" · ")}</p>}

      <p className="svxCardPrice" data-mascot-target={isActive ? "service-pricing" : undefined}>
        {service.price}
      </p>

      <a className="svxPill" href="/book" data-mascot-target={isActive ? "book" : undefined}>
        Book now
      </a>
    </article>
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
  const [carouselState, setCarouselState] = useState({
    canScroll: false,
    progress: 0,
    thumbWidth: 100,
  });
  const carouselRef = useRef(null);

  const total = items.length;
  const safeIndex = Math.min(index, total - 1);
  const selected = items[safeIndex];

  useEffect(() => {
    const track = carouselRef.current;
    if (!track) return undefined;

    const updateCarouselState = () => {
      const maxScroll = track.scrollWidth - track.clientWidth;
      const canScroll = maxScroll > 6;
      const progress = canScroll ? track.scrollLeft / maxScroll : 0;
      setCarouselState({
        canScroll,
        progress,
        thumbWidth: canScroll ? (track.clientWidth / track.scrollWidth) * 100 : 100,
      });
    };

    updateCarouselState();
    track.addEventListener("scroll", updateCarouselState, { passive: true });
    window.addEventListener("resize", updateCarouselState);

    return () => {
      track.removeEventListener("scroll", updateCarouselState);
      window.removeEventListener("resize", updateCarouselState);
    };
  }, [total]);

  function scrollServices(direction) {
    const track = carouselRef.current;
    const firstCard = track?.querySelector(".svxCard");
    if (!track || !firstCard || total < 2) return;

    setIndex((currentIndex) => (currentIndex + direction + total) % total);

    if (!carouselState.canScroll) return;

    const gap = Number.parseFloat(window.getComputedStyle(track).columnGap) || 0;
    const maxScroll = track.scrollWidth - track.clientWidth;
    const atStart = track.scrollLeft <= 1;
    const atEnd = track.scrollLeft >= maxScroll - 1;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

    if (direction < 0 && atStart) {
      track.scrollTo({ left: maxScroll, behavior });
    } else if (direction > 0 && atEnd) {
      track.scrollTo({ left: 0, behavior });
    } else {
      track.scrollBy({
        left: direction * (firstCard.getBoundingClientRect().width + gap),
        behavior,
      });
    }
  }

  // lets the mascot know which service is on screen
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("topdent:selected-service-change", {
        detail: { index: safeIndex, name: selected?.name || "" },
      })
    );
  }, [safeIndex, selected?.name]);

  const indicatorProgress = carouselState.canScroll
    ? carouselState.progress
    : total > 1 ? safeIndex / (total - 1) : 0;
  const indicatorThumbWidth = carouselState.canScroll
    ? carouselState.thumbWidth
    : 100 / Math.max(total, 1);

  return (
    <div className="svxPage">
      <CursorAura />

      <header className="svxHeader">
        <h1 className="svxTitle">Dental care for every smile</h1>
      </header>

      <div className="svxCarousel">
        <button
          className="svxCarouselArrow"
          type="button"
          aria-label="Scroll to previous services"
          onClick={() => scrollServices(-1)}
          disabled={total < 2}
        >
          <span aria-hidden="true">&lt;</span>
        </button>
        <div className="svxTrack" ref={carouselRef}>
          {items.map((item, i) => (
            <ServiceCard
              key={item.name}
              service={item}
              isActive={i === safeIndex}
              isDemonic={isDemonic}
              onSelect={() => setIndex(i)}
            />
          ))}
        </div>
        <button
          className="svxCarouselArrow"
          type="button"
          aria-label="Scroll to next services"
          onClick={() => scrollServices(1)}
          disabled={total < 2}
        >
          <span aria-hidden="true">&gt;</span>
        </button>
        <div
          className="svxScrollIndicator"
          role="progressbar"
          aria-label="Services carousel position"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(indicatorProgress * 100)}
        >
          <span
            className="svxScrollIndicatorThumb"
            style={{
              width: `${indicatorThumbWidth}%`,
              left: `${indicatorProgress * (100 - indicatorThumbWidth)}%`,
            }}
          />
        </div>
      </div>
    </div>
  );
}