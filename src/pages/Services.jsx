import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../firebase";
import { getBookingServiceOptions, getClinicServiceImage } from "../utils/clinic";

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

export default function Services() {
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

  const items = useMemo(() => {
    const services = getBookingServiceOptions(managedServices);
    if (!services.length) return defaultItems;
    return services.map((service) => ({
      name: service.name,
      desc: service.description || "Clinic-managed service available for booking.",
      price: service.startingRate || "Ask the clinic for pricing",
      duration: `${service.durationMinutes} minutes`,
      img: getClinicServiceImage(service),
      notes: [
        service.description || "Clinic-managed service.",
        `Category: ${service.category || "General"}`,
        `Estimated duration: ${service.durationMinutes} minutes`,
      ],
    }));
  }, [defaultItems, managedServices]);

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

  const prev = () => setIndex((i) => (i - 1 + items.length) % items.length);
  const next = () => setIndex((i) => (i + 1) % items.length);

  const gap = 18;
  const offset = (cardWidth + gap) * index;
  const selected = items[index];

  return (
    <div className="container bookingPage">
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
        <button className="carouselBtn left" onClick={prev} aria-label="Previous">
          ‹
        </button>

        <button className="carouselBtn right" onClick={next} aria-label="Next">
          ›
        </button>

        <div className="carouselViewport">
          <div
            className="carouselTrack"
            style={{
              transform: `translateX(calc(50% - ${cardWidth / 2}px - ${offset}px))`,
            }}
          >
            {items.map((service, i) => (
              <div
                key={service.name}
                className={`serviceCard ${i === index ? "isActive" : "isInactive"}`}
              >
                <div className="serviceMedia">
                  <img src={service.img} alt={service.name} loading="eager" />
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
        <div className="card bookingFormCard">
          <div className="cardHeader">
            <div>
              <h3 className="title">Selected Service</h3>
              <p className="sub">
                Details for: <b>{selected.name}</b>
              </p>
            </div>
            <span className="badge">Price Guide</span>
          </div>

          <div className="serviceFeaturePanel">
            <div className="servicePriceCard">
              <span className="detailLabel">Starting rate</span>
              <strong>{selected.price}</strong>
            </div>

            <div className="servicePriceCard">
              <span className="detailLabel">Estimated duration</span>
              <strong>{selected.duration || "Varies by case"}</strong>
            </div>

            <div className="detailNote historyPanel">
              <span className="detailLabel">Service summary</span>
              <p>{selected.desc}</p>
            </div>
          </div>

          <div className="historyList" style={{ marginTop: 14 }}>
            {selected.notes.map((note) => (
              <div key={note} className="historyRow">
                <div>
                  <strong>{selected.name}</strong>
                  <p>{note}</p>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
            <a className="btn btnShine bookingPrimaryBtn" href="/book">
              Book this service
            </a>
            <a className="btn secondary btnSoft bookingSecondaryBtn" href="/contact">
              Ask a question
            </a>
          </div>
        </div>

        <div className="card bookingDetailsCard">
          <div className="cardHeader">
            <div>
              <h3 className="title">Service Overview</h3>
              <p className="sub">Quick guide to clinic hours and pricing information.</p>
            </div>
          </div>

          <ul className="note bookingRules" style={{ marginTop: 0 }}>
            <li>Dentist schedule: 9:00 AM to 6:00 PM.</li>
            <li>Front desk schedule: 8:00 AM to 6:00 PM.</li>
            <li>Cleaning, restoration, and extraction start at PHP 800.</li>
            <li>Teeth whitening is PHP 8,000 for 4 cycles in 1 session.</li>
            <li>Oral surgery starts at PHP 5,000.</li>
            <li>Veneers depend on the procedure and product used.</li>
            <li>Crowns start at PHP 7,000.</li>
            <li>Dentures start at PHP 5,000.</li>
            <li>Root canal is PHP 8,000 per canal with unli-shot X-ray.</li>
            <li>Braces start with PHP 5,000 down payment.</li>
            <li>Dental X-ray rates: PHP 1,000 panoramic and PHP 500 periapical.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
