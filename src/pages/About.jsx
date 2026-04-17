import clinicPhoto from "../assets/about-clinic.jpg";

export default function About() {
  return (
    <div className="container bookingPage">
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
            <div className="bookingSummaryCard">
              <span className="detailLabel">Since</span>
              <strong>2022</strong>
            </div>
            <div className="bookingSummaryCard">
              <span className="detailLabel">Clinic Focus</span>
              <strong>Reliable and patient-focused dental care</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="grid aboutGrid" style={{ marginTop: 18 }}>
        <div className="card bookingFormCard aboutStoryCard">
          <div className="cardHeader">
            <div>
              <h3 className="title">TopDent Story</h3>
              <p className="sub">A clinic experience designed to feel modern, calm, and welcoming for every patient.</p>
            </div>
          </div>

          <div className="detailNote historyPanel">
            <span className="detailLabel">Clinic Mission</span>
            <p>
              We focus on creating a dependable dental experience where patients feel informed, comfortable, and genuinely cared for from booking to treatment.
            </p>
          </div>

          <div className="detailNote historyPanel" style={{ marginTop: 12 }}>
            <span className="detailLabel">What Patients Experience</span>
            <p>
              Patients can expect attentive service, organized appointments, modern dental support, and a clinic environment built around comfort and trust.
            </p>
          </div>
        </div>

        <div className="card bookingDetailsCard aboutPhotoCard">
          <div className="cardHeader">
            <div>
              <h3 className="title">Inside the Clinic</h3>
              <p className="sub">A warm and welcoming waiting area that reflects the clinic’s patient-first approach.</p>
            </div>
          </div>

          <div className="aboutPhotoFrame">
            <img className="aboutClinicImage" src={clinicPhoto} alt="TopDent clinic interior" />

            <div className="aboutPhotoOverlay">
              <span className="detailLabel">Clinic Principles</span>
              <ul className="aboutPrinciplesList">
                <li>Patient comfort comes first in every visit.</li>
                <li>Modern dental care should still feel personal and friendly.</li>
                <li>Reliable service starts with clear communication and trust.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="stackSections">
        <div className="card adminRecordsCard aboutTermsCard">
          <div className="cardHeader">
            <div>
              <h3 className="title">Terms and Conditions</h3>
              <p className="sub">A quick guide to how bookings and patient information are handled through the TopDent website.</p>
            </div>
          </div>

          <div className="detailGrid">
            <div className="detailBox luxeBox">
              <span className="detailLabel">Appointments</span>
              <strong>Requests are reviewed by the clinic</strong>
              <p className="sub">
                Booking requests are subject to review and availability and are only confirmed after clinic approval.
              </p>
            </div>

            <div className="detailBox luxeBox">
              <span className="detailLabel">Patient Information</span>
              <strong>Accurate information is required</strong>
              <p className="sub">
                Patients are expected to provide accurate details so records, schedules, and communication remain organized.
              </p>
            </div>

            <div className="detailBox luxeBox">
              <span className="detailLabel">Clinic Rights</span>
              <strong>The clinic may adjust bookings</strong>
              <p className="sub">
                The clinic may reschedule, decline, or cancel requests when availability changes or submitted information is incomplete.
              </p>
            </div>
          </div>
        </div>

        <div className="card adminRecordsCard">
          <div className="cardHeader">
            <div>
              <h3 className="title">Privacy Policy</h3>
              <p className="sub">This explains how patient information is collected, stored, and used in the TopDent system.</p>
            </div>
          </div>

          <div className="detailGrid">
            <div className="detailBox luxeBox">
              <span className="detailLabel">Collected Data</span>
              <strong>Clinic and booking information</strong>
              <p className="sub">
                The system may collect names, phone numbers, email addresses, booking preferences, and patient record details needed for appointment handling and treatment history.
              </p>
            </div>

            <div className="detailBox luxeBox">
              <span className="detailLabel">Use of Information</span>
              <strong>Used for care and operations</strong>
              <p className="sub">
                Information is used to manage bookings, maintain patient records, coordinate dentist schedules, and support clinic communication related to appointments and treatment.
              </p>
            </div>

            <div className="detailBox luxeBox">
              <span className="detailLabel">Access and Protection</span>
              <strong>Restricted to authorized staff</strong>
              <p className="sub">
                Sensitive records should only be managed by authorized clinic personnel. The clinic is responsible for protecting patient data stored in connected services.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
