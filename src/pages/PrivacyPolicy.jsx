export default function PrivacyPolicy() {
  return (
    <div className="container">
      <div className="hero policyHero">
        <span className="heroEyebrow">TopDent Policy</span>
        <h1>Privacy Policy</h1>
        <p>
          This page explains how TopDent collects, stores, and uses patient information submitted through the website and admin system.
        </p>
      </div>

      <div className="grid" style={{ marginTop: 18 }}>
        <div className="card policyCard">
          <h3 className="title">Collected Data</h3>
          <p className="sub">
            The system may collect names, age, phone number, email address, booking preferences, and clinic record information needed for appointment handling and patient history.
          </p>
        </div>

        <div className="card policyCard">
          <h3 className="title">Use of Information</h3>
          <p className="sub">
            Information is used to manage bookings, maintain patient records, coordinate dentist schedules, and support clinic communication related to care and appointments.
          </p>
        </div>

        <div className="card policyCard">
          <h3 className="title">Access and Protection</h3>
          <p className="sub">
            Only authorized clinic administrators should manage sensitive records. The clinic is responsible for protecting patient information stored in its connected database services.
          </p>
        </div>
      </div>
    </div>
  );
}
