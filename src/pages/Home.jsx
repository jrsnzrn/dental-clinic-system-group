export default function Home() {
  return (
    <div className="container">
      <div className="hero">
        <h1>Patient Management + Visual Tooth Tracking</h1>
        <p>
          A web-based dental clinic system for managing patient records, appointments, and per-tooth treatment history.
        </p>
      </div>

      <div className="grid">
        <div className="card">
          <h3 className="title">What we do</h3>
          <p className="sub">Fast workflows for clinic staff, clear history for every patient.</p>
          <ul className="note">
            <li>✔ Patient Records</li>
            <li>✔ Appointments</li>
            <li>✔ Tooth Chart Tracking</li>
          </ul>
        </div>

        <div className="card">
          <h3 className="title">Clinic Hours</h3>
          <p className="sub">Mon–Sat • 9:00 AM – 6:00 PM</p>
          <p className="note">Walk-ins accepted based on availability.</p>
        </div>
      </div>
    </div>
  );
}