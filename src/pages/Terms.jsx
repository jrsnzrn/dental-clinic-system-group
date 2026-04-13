export default function Terms() {
  return (
    <div className="container">
      <div className="hero policyHero">
        <span className="heroEyebrow">TopDent Policy</span>
        <h1>Terms and Conditions</h1>
        <p>
          These terms explain how appointment requests, clinic communication, and patient information are handled through the TopDent website.
        </p>
      </div>

      <div className="grid" style={{ marginTop: 18 }}>
        <div className="card policyCard">
          <h3 className="title">Appointments</h3>
          <p className="sub">
            Booking requests sent through the website are subject to clinic review and availability. Submitting a request does not automatically confirm an appointment until it is approved by the clinic.
          </p>
        </div>

        <div className="card policyCard">
          <h3 className="title">Patient Information</h3>
          <p className="sub">
            Patients are expected to provide accurate name, age, phone number, email address, and appointment details so the clinic can manage records and follow-up communication properly.
          </p>
        </div>

        <div className="card policyCard">
          <h3 className="title">Clinic Rights</h3>
          <p className="sub">
            The clinic may reschedule, decline, or cancel requests when dentist availability changes, operating hours are affected, or the submitted information is incomplete.
          </p>
        </div>
      </div>
    </div>
  );
}
