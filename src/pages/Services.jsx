import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import CursorAura from "../components/CursorAura";
import { db } from "../firebase";
import { getBookingServiceOptions, getClinicServiceImage } from "../utils/clinic";
import scaryServiceTooth from "../assets/scary-service-tooth.png";

const cleaningImg = "/services/cleaning.png";
const restorationImg = "/services/fillings.png";
const extractionImg = "/services/extraction.png";
const bracesImg = "/services/braces.png";
const rootImg = "/services/rootcanal.png";
const whiteningImg = "/services/whitening.png";
const oralsurgeryImg = "/services/extraction.png";
const crownsImg = "/services/fillings.png";
const denturesImg = "/services/cleaning.png";
const xrayImg = "/services/rootcanal.png";

function normalizeServiceKey(value = "") {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

const SERVICE_COPY = {
  [normalizeServiceKey("Cleaning")]: {
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
  [normalizeServiceKey("Fillings")]: {
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
  [normalizeServiceKey("Restoration")]: {
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
  [normalizeServiceKey("Extraction")]: {
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
  [normalizeServiceKey("Braces Consultation")]: {
    badge: "Orthodontic consult",
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
  [normalizeServiceKey("Braces")]: {
    badge: "Orthodontic care",
    highlights: [
      { label: "Best for", value: "Long-term alignment, bite correction, and guided movement of teeth over time." },
      { label: "Visit flow", value: "Case review, appliance planning, and a phased treatment setup based on your bite." },
      { label: "Planning note", value: "The down payment is only the starting point; the full plan depends on treatment length." },
    ],
    overview: [
      { title: "Before your visit", text: "Come ready to talk about your smile goals, bite issues, and timeline expectations." },
      { title: "What the team checks", text: "The dentist reviews spacing, alignment, jaw relationship, and treatment readiness." },
      { title: "After the visit", text: "Expect a step-by-step plan covering appliance setup, follow-ups, and ongoing adjustments." },
    ],
  },
  [normalizeServiceKey("Root Canal")]: {
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
  [normalizeServiceKey("Whitening")]: {
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
  },
  [normalizeServiceKey("Teeth Whitening")]: {
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
  },
  [normalizeServiceKey("Oral Surgery")]: {
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
  [normalizeServiceKey("Veneers")]: {
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
  [normalizeServiceKey("Crowns")]: {
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
  [normalizeServiceKey("Dentures")]: {
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
  [normalizeServiceKey("Dental X-ray")]: {
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

function buildServiceContent(service) {
  const content = SERVICE_COPY[normalizeServiceKey(service.name)] || null;

  if (content) {
    return {
      ...service,
      badge: content.badge,
      highlights: content.highlights,
      overview: content.overview,
    };
  }

  return {
    ...service,
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

export default function Services() {
  const [isDemonicTheme, setIsDemonicTheme] = useState(() =>
    typeof document !== "undefined" && document.body.classList.contains("mascotDemonicTheme")
  );
  const defaultItems = useMemo(
    () => [
      {
        name: "Cleaning",
        desc: "Professional cleaning for healthier gums and a fresher smile.",
        price: "PHP 800 starting",
        img: cleaningImg,
        notes: [
          "Gentle scaling and polishing",
          "Good for routine oral maintenance",
          "Starting price may vary depending on case",
        ],
      },
      {
        name: "Restoration",
        desc: "Tooth-colored restoration for damaged or decayed teeth.",
        price: "PHP 800 starting",
        img: restorationImg,
        notes: [
          "Restores shape and function",
          "Tooth-colored material",
          "Starting price depends on the tooth condition",
        ],
      },
      {
        name: "Extraction",
        desc: "Safe and comfortable tooth removal when needed.",
        price: "PHP 800 starting",
        img: extractionImg,
        notes: [
          "Case assessment before procedure",
          "Simple extraction starting rate",
          "Complex cases may have different pricing",
        ],
      },
      {
        name: "Teeth Whitening",
        desc: "Whitening treatment designed to brighten your smile in one session.",
        price: "PHP 8,000",
        img: whiteningImg,
        notes: [
          "Includes 4 cycles in 1 session",
          "Ideal for cosmetic smile enhancement",
          "Best result depends on tooth condition",
        ],
      },
      {
        name: "Oral Surgery",
        desc: "Minor oral surgical procedures with proper planning and care.",
        price: "PHP 5,000 starting",
        img: oralsurgeryImg,
        notes: [
          "For more advanced dental cases",
          "Price depends on surgical complexity",
          "Clinic assessment required first",
        ],
      },
      {
        name: "Veneers",
        desc: "Cosmetic veneer treatment for smile improvement and tooth enhancement.",
        price: "Depends on procedure and product",
        img: restorationImg,
        notes: [
          "Customized per patient case",
          "Depends on veneer type and materials used",
          "Best discussed through consultation",
        ],
      },
      {
        name: "Crowns",
        desc: "Dental crowns to restore strength, shape, and appearance of teeth.",
        price: "PHP 7,000 starting",
        img: crownsImg,
        notes: [
          "Used for damaged or weakened teeth",
          "Starting price varies by material and case",
          "Restores both function and appearance",
        ],
      },
      {
        name: "Dentures",
        desc: "Custom removable replacement for missing teeth.",
        price: "PHP 5,000 starting",
        img: denturesImg,
        notes: [
          "Designed per patient need",
          "Can support comfort and chewing ability",
          "Final rate depends on denture type",
        ],
      },
      {
        name: "Root Canal",
        desc: "Treatment for infected canals to help save the tooth.",
        price: "PHP 8,000 per canal",
        img: rootImg,
        notes: [
          "Per canal pricing",
          "Includes unli-shot X-ray",
          "Best for saving infected teeth when possible",
        ],
      },
      {
        name: "Braces",
        desc: "Orthodontic treatment for bite alignment and smile correction.",
        price: "PHP 5,000 down payment",
        img: bracesImg,
        notes: [
          "Down payment starts at PHP 5,000",
          "Case evaluation required before treatment",
          "Payment terms may vary depending on plan",
        ],
      },
      {
        name: "Dental X-ray",
        desc: "Diagnostic imaging for treatment planning and case evaluation.",
        price: "Panoramic: PHP 1,000 • Periapical: PHP 500",
        img: xrayImg,
        notes: [
          "Panoramic X-ray: PHP 1,000",
          "Periapical X-ray: PHP 500",
          "Used for diagnosis and treatment planning",
        ],
      },
    ],
    []
  );
  const [managedServices, setManagedServices] = useState([]);

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, "clinicServices"), orderBy("name", "asc")), (snapshot) => {
      setManagedServices(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const body = document.body;
    const observer = new MutationObserver(() => {
      setIsDemonicTheme(body.classList.contains("mascotDemonicTheme"));
    });

    observer.observe(body, { attributes: true, attributeFilter: ["class"] });
    setIsDemonicTheme(body.classList.contains("mascotDemonicTheme"));

    return () => observer.disconnect();
  }, []);

  const items = useMemo(() => {
    const services = getBookingServiceOptions(managedServices);
    if (!services.length) {
      return defaultItems.map((service) =>
        buildServiceContent({
          ...service,
          category: "General",
          duration: service.duration || "Varies by case",
        })
      );
    }
    return services.map((service) =>
      buildServiceContent({
        name: service.name,
        desc: service.description || "Clinic-managed service available for booking.",
        price: service.startingRate || "Ask the clinic for pricing",
        duration: `${service.durationMinutes} minutes`,
        img: getClinicServiceImage(service),
        category: service.category || "General",
      })
    );
  }, [defaultItems, managedServices]);

  const fallbackItems = useMemo(
    () => defaultItems.map((service) => buildServiceContent({ ...service, category: "General", duration: service.duration || "Varies by case" })),
    [defaultItems]
  );

  const [index, setIndex] = useState(0);
  const [cardWidth, setCardWidth] = useState(() =>
    window.matchMedia("(max-width: 640px)").matches ? 250 : 300
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const update = () => setCardWidth(mq.matches ? 250 : 300);

    update();

    if (mq.addEventListener) mq.addEventListener("change", update);
    else mq.addListener(update);

    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", update);
      else mq.removeListener(update);
    };
  }, []);

  const serviceItems = items.length ? items : fallbackItems;

  const prev = () => setIndex((i) => (i - 1 + serviceItems.length) % serviceItems.length);
  const next = () => setIndex((i) => (i + 1) % serviceItems.length);

  const gap = 18;
  const offset = (cardWidth + gap) * index;
  const selected = serviceItems[index];

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("topdent:selected-service-change", {
        detail: {
          index,
          name: selected?.name || "",
        },
      })
    );
  }, [index, selected?.name]);

  return (
    <div className="container bookingPage">
      <CursorAura />

      <div className="hero bookingHero">
        <div className="bookingHeroGlow" />
        <div className="bookingHeroGrid">
          <div>
            <span className="heroEyebrow">Dental Services</span>
            <h1>Clinic Services</h1>
            <p>
              Browse our available dental treatments, starting rates, and service information before booking your appointment.
            </p>
          </div>

          <div className="bookingHeroSummary">
            <div className="bookingSummaryCard">
              <span className="detailLabel">Dentist hours</span>
              <strong>9:00 AM - 6:00 PM</strong>
            </div>
            <div className="bookingSummaryCard">
              <span className="detailLabel">Front desk hours</span>
              <strong>8:00 AM - 6:00 PM</strong>
            </div>
            <div className="bookingSummaryCard">
              <span className="detailLabel">Pricing note</span>
              <strong>Some services have starting rates and final fees may depend on the case</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="carouselWrap">
        <button className="carouselBtn left" onClick={prev} aria-label="Previous" data-mascot-target="services-nav">
          ‹
        </button>

        <button className="carouselBtn right" onClick={next} aria-label="Next" data-mascot-target="services-nav">
          ›
        </button>

        <div className="carouselViewport">
          <div
            className="carouselTrack"
            style={{
              transform: `translateX(calc(50% - ${cardWidth / 2}px - ${offset}px))`,
            }}
          >
            {serviceItems.map((service, i) => (
              <div
                key={service.name}
                className={`serviceCard ${i === index ? "isActive" : "isInactive"}`}
                data-mascot-target={i === index ? "selected-service-card" : undefined}
                role="button"
                tabIndex={0}
                aria-pressed={i === index}
                aria-label={`Select ${service.name}`}
                onClick={() => setIndex(i)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setIndex(i);
                  }
                }}
              >
                <div className="serviceMedia">
                  <img
                    src={isDemonicTheme ? scaryServiceTooth : service.img}
                    alt={isDemonicTheme ? `${service.name} in demon mode` : service.name}
                    loading="eager"
                    className={isDemonicTheme ? "serviceMediaScary" : ""}
                  />
                </div>

                <div className="serviceBody">
                  <h3 className="serviceName">{service.name}</h3>
                  <p className="serviceDesc">{service.desc}</p>
                  <div className="servicePriceTag">{service.price}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid" style={{ marginTop: 18 }}>
        <div className="card bookingFormCard" data-mascot-target="selected-service-details">
          <div className="cardHeader">
            <div className="serviceDetailHeader">
              <span className="badge serviceTypeBadge">{selected.badge || selected.category || "Clinic service"}</span>
              <h3 className="title">{selected.name}</h3>
              <p className="sub">{selected.desc}</p>
            </div>
            <span className="badge">Price guide</span>
          </div>

          <div className="serviceFeaturePanel" data-mascot-target="service-pricing">
            <div className="servicePriceCard">
              <span className="detailLabel">Starting rate</span>
              <strong>{selected.price}</strong>
            </div>

            <div className="servicePriceCard">
              <span className="detailLabel">Estimated duration</span>
              <strong>{selected.duration || "Varies by case"}</strong>
            </div>

            <div className="detailNote historyPanel">
              <span className="detailLabel">Visit summary</span>
              <p>{selected.desc}</p>
            </div>
          </div>

          <div className="serviceInsightGrid">
            {selected.highlights.map((item) => (
              <div key={item.label} className="serviceInsightCard">
                <span className="detailLabel">{item.label}</span>
                <p>{item.value}</p>
              </div>
            ))}
          </div>

          <div className="historyList serviceOverviewList" style={{ marginTop: 14 }}>
            {selected.overview.map((item) => (
              <div key={item.title} className="historyRow">
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.text}</p>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
            <a className="btn btnShine bookingPrimaryBtn" href="/book" data-mascot-target="book">
              Book this service
            </a>
            <a className="btn secondary btnSoft bookingSecondaryBtn" href="/contact">
              Ask a question
            </a>
          </div>
        </div>

        <div className="card bookingDetailsCard" data-mascot-target="service-planning">
          <div className="cardHeader">
            <div>
              <h3 className="title">Appointment Planning</h3>
              <p className="sub">Quick booking notes for this service and the clinic schedule.</p>
            </div>
          </div>

          <div className="servicePlanningPanel">
            <div className="servicePlanningBlock">
              <span className="detailLabel">Clinic hours</span>
              <strong>Front desk: 8:00 AM - 6:00 PM</strong>
              <p>Dentist chair time runs from 9:00 AM to 6:00 PM, Monday to Saturday.</p>
            </div>

            <div className="servicePlanningBlock">
              <span className="detailLabel">Pricing note</span>
              <strong>{selected.price}</strong>
              <p>Starting rates help with planning, but the final fee can still shift after the dentist checks the case.</p>
            </div>

            <div className="servicePlanningBlock">
              <span className="detailLabel">Booking note</span>
              <strong>{selected.duration || "Varies by case"}</strong>
              <p>Appointment length affects available time slots, especially when you combine several services in one visit.</p>
            </div>
          </div>

          <ul className="serviceChecklist">
            <li>Choose a dentist first so the available time slots match that provider&apos;s schedule.</li>
            <li>For case-based services, the clinic may confirm or adjust the exact treatment after evaluation.</li>
            <li>Need more than one treatment in one visit? The booking page can total the expected chair time for you.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
