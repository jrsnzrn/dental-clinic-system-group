import clinicPhoto from "../assets/about-clinic.jpg";
import treatmentPhoto from "../assets/home-clinic-treatment.jpg";
import dentist1 from "../assets/dentist1.png";
import dentist2 from "../assets/dentist2.jpg";
import dentist3 from "../assets/dentist3.jpg";
import recep1 from "../assets/recep1.jpg";
import recep2 from "../assets/recep2.jpg";
import recep3 from "../assets/recep3.jpg";
import recep4 from "../assets/recep4.jpg";
import CursorAura from "../components/CursorAura";

const doctors = [
  { name: "Dra. Rica", role: "Dentist", photo: dentist1, position: "center 30%" },
  { name: "Dr. Emerson", role: "Dentist", photo: dentist2, position: "center 30%" },
  { name: "Dra. Nessa", role: "Dentist", photo: dentist3, position: "center 38%" },
];

const frontDesk = [
  { name: "Mr. Adrian", role: "Front Desk", photo: recep1, position: "center 38%" },
  { name: "Ms. Chloie", role: "Front Desk", photo: recep2, position: "center 38%" },
  { name: "Mr. Harold", role: "Front Desk", photo: recep3, position: "center 38%" },
  { name: "Ms. Jahna", role: "Front Desk", photo: recep4, position: "center 38%" },
];

const story = [
  "Topdent Clinic was built on a passion for delivering reliable and patient-focused dental services. Our goal has always been to combine modern dental techniques with genuine care, ensuring every visit is a positive and comfortable experience.",
  "Patients can expect attentive service, organized appointments, modern dental support, and a clinic environment built around comfort and trust.",
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

function TeamGroup({ label, people }) {
  return (
    <div className={`aboutTeamGroup${label === "Dentists" ? " aboutTeamGroupDentists" : ""}`}>
      <h3 className="aboutTeamGroupLabel">{label.toUpperCase()}</h3>
      <div className="aboutTeamGrid">
        {people.map((person) => (
          <div
            className="aboutTeamCard"
            key={person.name}
          >
            <div className="aboutTeamCardPhoto">
              <img src={person.photo} alt={person.name} style={{ objectPosition: person.position }} />
            </div>
            <strong>{person.name}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function TeamSection() {
  return (
    <section className="aboutSection aboutTeamSection">
      <h2 className="aboutTeamTitle">Meet the Team</h2>
      <TeamGroup label="Dentists" people={doctors} />
      <TeamGroup label="Front Desk" people={frontDesk} />
    </section>
  );
}

function PolicyRow({ label, heading, body, open }) {
  return (
    <details className="aboutPolicyItem" open={open}>
      <summary>
        <span className="detailLabel">{label}</span>
        <strong>{heading}</strong>
      </summary>
      <p className="aboutPolicyBody">{body}</p>
    </details>
  );
}

function PolicyGroup({ title, intro, items }) {
  return (
    <section className="aboutSection aboutSplit">
      <div className="aboutSplitIntro">
        <h3 className="title">{title}</h3>
        <p className="sub">{intro}</p>
      </div>

      <div className="aboutPolicyList">
        {items.map((item, i) => (
          <PolicyRow key={item.label} open={i === 0} {...item} />
        ))}
      </div>
    </section>
  );
}

export default function About() {
  return (
    <div className="container bookingPage aboutPage">
      <CursorAura />

      <header className="aboutSection aboutHero">
        <div className="aboutHeroText">
          <span className="aboutSince">Since 2022</span>
          <h1>TopDent Story</h1>

          <div className="aboutHeroStory">
            {story.map((text, i) => (
              <p key={i}>{text}</p>
            ))}
          </div>
        </div>

        <div className="aboutPhotos">
          <div className="aboutPhotoFrame">
            <img className="aboutClinicImage" src={clinicPhoto} alt="TopDent clinic interior" />
          </div>
        </div>
      </header>

      <TeamSection />

      <PolicyGroup
        title="Terms and Conditions"
        intro="A quick guide to how bookings and patient information are handled through the TopDent website."
        items={terms}
      />

      <PolicyGroup
        title="Privacy Policy"
        intro="This explains how patient information is collected, stored, and used in the TopDent system."
        items={privacy}
      />
    </div>
  );
}