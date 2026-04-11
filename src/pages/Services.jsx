import { useEffect, useMemo, useState } from "react";

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
  const items = useMemo(
    () => [
      { name: "Cleaning", desc: "Gentle scaling and polishing.", img: cleaningImg },
      { name: "Restoration", desc: "Tooth-colored restorations.", img: restorationImg },
      { name: "Extraction", desc: "Safe and comfortable removal.", img: extractionImg },
      { name: "Braces Consultation", desc: "Orthodontic assessment.", img: bracesImg },
      { name: "Root Canal", desc: "Save infected teeth.", img: rootImg },
      { name: "Whitening", desc: "Brighten your smile.", img: whiteningImg },
      { name: "Oral Surgery", desc: "Minor surgical dental procedures.", img: oralsurgeryImg },
      { name: "Crowns", desc: "Restore strength and shape of teeth.", img: crownsImg },
      { name: "Dentures", desc: "Custom removable tooth replacement.", img: denturesImg },
      { name: "X-ray", desc: "Dental imaging for diagnosis and planning.", img: xrayImg },
    ],
    []
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

  const prev = () => setIndex((i) => (i - 1 + items.length) % items.length);
  const next = () => setIndex((i) => (i + 1) % items.length);

  const gap = 18;
  const offset = (cardWidth + gap) * index;

  return (
    <div className="container">
      <div className="hero">
        <h1 style={{ marginBottom: 10 }}>Services</h1>
        <p style={{ marginTop: 0 }}>Use the arrows to browse our treatments.</p>
      </div>

      <div className="carouselWrap">
        <button className="carouselBtn left" onClick={prev} aria-label="Previous">
          ◀
        </button>

        <button className="carouselBtn right" onClick={next} aria-label="Next">
          ▶
        </button>

        <div className="carouselViewport">
          <div
            className="carouselTrack"
            style={{
              transform: `translateX(calc(50% - ${cardWidth / 2}px - ${offset}px))`,
            }}
          >
            {items.map((s, i) => (
              <div
                key={s.name}
                className={`serviceCard ${i === index ? "isActive" : "isInactive"}`}
              >
                <div className="serviceMedia">
                  <img src={s.img} alt={s.name} loading="eager" />
                </div>

                <div className="serviceBody">
                  <h3 className="serviceName">{s.name}</h3>
                  <p className="serviceDesc">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid" style={{ marginTop: 18 }}>
        <div className="card">
          <div className="cardHeader">
            <div>
              <h3 className="title">Selected Service</h3>
              <p className="sub">
                Details for: <b>{items[index].name}</b>
              </p>
            </div>
            <span className="badge">Info</span>
          </div>

          <p className="sub" style={{ marginTop: 0 }}>
            {items[index].desc}
          </p>

          <ul className="note" style={{ marginTop: 12, lineHeight: 1.6 }}>
            <li>Professional sterilization and hygiene</li>
            <li>Comfort-first procedure</li>
            <li>Clear explanation before treatment</li>
          </ul>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
            <a className="btn" href="/book">
              Book this service
            </a>
            <a className="btn secondary" href="/contact">
              Ask a question
            </a>
          </div>
        </div>

        <div className="card">
          <h3 className="title">What’s Included</h3>
          <p className="sub">A modern clinic workflow for better patient experience.</p>

          <div className="list" style={{ marginTop: 10 }}>
            <div className="item">
              <div className="kv">
                <strong>Smart Scheduling</strong>
                <span>Fast booking and confirmation</span>
              </div>
              <span className="badge">Fast</span>
            </div>

            <div className="item">
              <div className="kv">
                <strong>Secure Records</strong>
                <span>Patient history stored safely</span>
              </div>
              <span className="badge">Secure</span>
            </div>

            <div className="item">
              <div className="kv">
                <strong>Modern Care</strong>
                <span>Clean, premium experience</span>
              </div>
              <span className="badge">Premium</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
