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
              TopDent Dental Clinic is a local clinic in Meycauayan, Bulacan committed to providing friendly, reliable, and patient-focused dental care for the community.
            </p>
          </div>
        </div>
      </div>

      <div className="grid" style={{ marginTop: 18 }}>
        <div className="card bookingFormCard">
          <div className="cardHeader">
            <div>
              <h3 className="title">Who We Are</h3>
              <p className="sub">A neighborhood dental clinic serving patients and families in Meycauayan, Bulacan.</p>
            </div>
          </div>

          <div className="detailNote historyPanel">
            <span className="detailLabel">About the clinic</span>
            <p>
              We are a local dental clinic focused on making every visit feel approachable, organized, and comfortable. Our goal is to provide quality dental care while building lasting trust with patients in the Meycauayan community.
            </p>
          </div>

          <div className="detailNote historyPanel" style={{ marginTop: 12 }}>
            <span className="detailLabel">What patients can expect</span>
            <p>
              Patients can expect attentive service, clear communication, and support for routine checkups, consultations, and continuing dental care. We aim to create a clinic experience that feels personal, professional, and easy to trust.
            </p>
          </div>
        </div>

        <div className="card bookingDetailsCard">
          <div className="cardHeader">
            <div>
              <h3 className="title">Clinic Principles</h3>
              <p className="sub">Simple rules that guide how the clinic uses the system.</p>
            </div>
          </div>

          <ul className="note bookingRules" style={{ marginTop: 0 }}>
            <li>Patients should use one consistent profile for cleaner tracking.</li>
            <li>Appointments are reviewed by the clinic before they are considered approved.</li>
            <li>Dentist availability follows the weekly schedule set by the clinic.</li>
            <li>Patient data should only be accessed by authorized clinic staff.</li>
          </ul>
        </div>
      </div>

      <div className="stackSections">
        <div className="card adminRecordsCard">
          <div className="cardHeader">
            <div>
              <h3 className="title">Terms and Conditions</h3>
              <p className="sub">These terms explain how bookings, clinic communication, and patient information are handled through the TopDent website.</p>
            </div>
          </div>

          <div className="detailGrid">
            <div className="detailBox luxeBox">
              <span className="detailLabel">Appointments</span>
              <strong>Requests are reviewed by the clinic</strong>
              <p className="sub">
                Booking requests sent through the website are subject to review and availability. Submitting a request does not automatically confirm an appointment until it is approved by the clinic.
              </p>
            </div>

            <div className="detailBox luxeBox">
              <span className="detailLabel">Patient Information</span>
              <strong>Accurate information is required</strong>
              <p className="sub">
                Patients are expected to provide accurate details so the clinic can manage records, schedules, and follow-up communication properly.
              </p>
            </div>

            <div className="detailBox luxeBox">
              <span className="detailLabel">Clinic Rights</span>
              <strong>The clinic may adjust bookings</strong>
              <p className="sub">
                The clinic may reschedule, decline, or cancel requests when dentist availability changes, operating hours are affected, or submitted information is incomplete.
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
