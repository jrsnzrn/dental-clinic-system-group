import { useEffect, useRef } from "react";
import clinicPhoto from "../assets/about-clinic.jpg";
import dentist1 from "../assets/dentist1.png";
import dentist2 from "../assets/dentist2.jpg";
import dentist3 from "../assets/dentist3.jpg";
import recep1 from "../assets/recep1.jpg";
import recep2 from "../assets/recep2.jpg";
import recep3 from "../assets/recep3.jpg";
import recep4 from "../assets/recep4.jpg";
import CursorAura from "../components/CursorAura";

const doctors = [
  { name: "Dentist 1", role: "Dentist", photo: dentist1 },
  { name: "Dentist 2", role: "Dentist", photo: dentist2 },
  { name: "Dentist 3", role: "Dentist", photo: dentist3 },
];

const frontDesk = [
  { name: "Recep 1", role: "Front Desk", photo: recep1 },
  { name: "Recep 2", role: "Front Desk", photo: recep2 },
  { name: "Recep 3", role: "Front Desk", photo: recep3 },
  { name: "Recep 4", role: "Front Desk", photo: recep4 },
];

const terms = [
  {
    label: "Appointments",
    heading: "Requests are reviewed by the clinic",
    body: "Booking requests are subject to review and availability and are only confirmed after clinic approval.",
  },
  {
    label: "Patient Information",
    heading: "Accurate information is required",
    body: "Patients are expected to provide accurate details so records, schedules, and communication remain organized.",
  },
  {
    label: "Clinic Rights",
    heading: "The clinic may adjust bookings",
    body: "The clinic may reschedule, decline, or cancel requests when availability changes or submitted information is incomplete.",
  },
];

const privacy = [
  {
    label: "Collected Data",
    heading: "Clinic and booking information",
    body: "The system may collect names, phone numbers, email addresses, booking preferences, and patient record details needed for appointment handling and treatment history.",
  },
  {
    label: "Use of Information",
    heading: "Used for care and operations",
    body: "Information is used to manage bookings, maintain patient records, coordinate dentist schedules, and support clinic communication related to appointments and treatment.",
  },
  {
    label: "Access and Protection",
    heading: "Restricted to authorized staff",
    body: "Sensitive records should only be managed by authorized clinic personnel. The clinic is responsible for protecting patient data stored in connected services.",
  },
];

function PolicyRow({ label, heading, body }) {
  return (
    <div className="aboutPolicyRow">
      <span className="detailLabel">{label}</span>
      <div>
        <strong>{heading}</strong>
        <p className="sub">{body}</p>
      </div>
    </div>
  );
}

function useRevealOnScroll() {
  const containerRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const targets = el.querySelectorAll(".revealOnScroll");

    if (!("IntersectionObserver" in window)) {
      targets.forEach((t) => t.classList.add("visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );

    targets.forEach((t) => observer.observe(t));
    return () => observer.disconnect();
  }, []);

  return containerRef;
}

export default function About() {
  const teamRef = useRevealOnScroll();

  return (
    <div className="container bookingPage aboutPage">
      <CursorAura />

      <div className="hero bookingHero">
        <div className="bookingHeroGlow" />
        <div className="bookingHeroGrid">
          <div>
            <span className="heroEyebrow">About TopDent</span>
            <h1>About Us</h1>
            <p>
              Topdent Clinic was built on a passion for delivering reliable and patient-focused dental services. Our goal has always been to combine modern dental techniques with genuine care, ensuring every visit is a positive and comfortable experience.
            </p>
          </div>
          <div className="bookingHeroSummary">
            <div className="aboutStat">
              <span className="detailLabel">Since</span>
              <strong>2022</strong>
            </div>
            <div className="aboutStat">
              <span className="detailLabel">Clinic Focus</span>
              <strong>Reliable and patient-focused dental care</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="aboutSection aboutStoryRow">
        <div className="aboutStoryText">
          <h3 className="title">TopDent Story</h3>
          <p className="sub">A clinic experience designed to feel modern, calm, and welcoming for every patient.</p>

          <div className="aboutLine">
            <span className="detailLabel">Clinic Mission</span>
            <p>
              We focus on creating a dependable dental experience where patients feel informed, comfortable, and genuinely cared for from booking to treatment.
            </p>
          </div>

          <div className="aboutLine">
            <span className="detailLabel">What Patients Experience</span>
            <p>
              Patients can expect attentive service, organized appointments, modern dental support, and a clinic environment built around comfort and trust.
            </p>
          </div>
        </div>

        <div className="aboutPhotoFrame">
          <img className="aboutClinicImage" src={clinicPhoto} alt="TopDent clinic interior" />
        </div>
      </div>

      <div className="aboutSection" ref={teamRef}>
        <h3 className="title">Meet the Team</h3>
        <p className="sub">The dentists and front-desk staff who take care of you at every visit.</p>

        <div className="aboutTeamGroup">
          <span className="detailLabel">Dentists</span>
          <div className="aboutTeamGrid">
            {doctors.map((person, i) => (
              <div
                className="aboutTeamCard revealOnScroll"
                style={{ transitionDelay: `${i * 80}ms` }}
                key={person.name}
              >
                <div className="aboutTeamCardPhoto">
                  <img src={person.photo} alt={person.name} />
                </div>
                <strong>{person.name}</strong>
                <span className="detailLabel">{person.role}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="aboutTeamGroup">
          <span className="detailLabel">Front Desk</span>
          <div className="aboutTeamGrid">
            {frontDesk.map((person, i) => (
              <div
                className="aboutTeamCard revealOnScroll"
                style={{ transitionDelay: `${i * 80}ms` }}
                key={person.name}
              >
                <div className="aboutTeamCardPhoto">
                  <img src={person.photo} alt={person.name} />
                </div>
                <strong>{person.name}</strong>
                <span className="detailLabel">{person.role}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="aboutSection">
        <span className="detailLabel">Clinic Principles</span>
        <ul className="aboutPrinciplesList aboutPrinciplesRow">
          <li>Patient comfort comes first in every visit.</li>
          <li>Modern dental care should still feel personal and friendly.</li>
          <li>Reliable service starts with clear communication and trust.</li>
        </ul>
      </div>

      <div className="aboutSection">
        <h3 className="title">Terms and Conditions</h3>
        <p className="sub">A quick guide to how bookings and patient information are handled through the TopDent website.</p>

        <div className="aboutBox">
          {terms.map((item) => (
            <PolicyRow key={item.label} {...item} />
          ))}
        </div>
      </div>

      <div className="aboutSection">
        <h3 className="title">Privacy Policy</h3>
        <p className="sub">This explains how patient information is collected, stored, and used in the TopDent system.</p>

        <div className="aboutBox">
          {privacy.map((item) => (
            <PolicyRow key={item.label} {...item} />
          ))}
        </div>
      </div>
    </div>
  );
}