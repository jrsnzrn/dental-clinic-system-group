import { NavLink } from "react-router-dom";

export default function Home() {
  return (
    <div className="container">
      <div className="hero homeHero homeHeroGrid">
        <div className="homeHeroCopy">
          <span className="heroEyebrow">TopDent Experience</span>
          <h1 style={{ marginBottom: 10 }}>TopDent Dental Clinic</h1>

          <p style={{ marginTop: 0 }}>
            Modern dental care with easier booking, richer patient records, and a cleaner experience for both patients and clinic staff.
          </p>

          <div className="homeHeroActions">
            <NavLink className="btn btnShine" to="/book">
              Book Appointment
            </NavLink>
            <NavLink className="btn secondary btnSoft" to="/services">
              View Services
            </NavLink>
          </div>

          <div className="homeHeroStats">
            <div className="homeStat">
              <span className="detailLabel">Clinic hours</span>
              <strong>Mon-Sat • 8:00 AM - 6:00 PM</strong>
            </div>
            <div className="homeStat">
              <span className="detailLabel">Patient flow</span>
              <strong>Booking, approval, charting, and follow-up in one system</strong>
            </div>
          </div>
        </div>

        <div className="card homeSplineCard">
          <div className="cardHeader">
            <div>
              <h3 className="title">Clinic Highlights</h3>
              <p className="sub">A simpler home page focus with faster loading and clearer patient guidance.</p>
            </div>
            <span className="badge">TopDent</span>
          </div>

          <div className="homeHighlightPanel">
            <div className="homeHighlightCard">
              <span className="detailLabel">Appointments</span>
              <strong>Book faster with one saved patient identity</strong>
              <p>Repeat bookings stay organized under the same patient record for easier tracking.</p>
            </div>

            <div className="homeHighlightCard">
              <span className="detailLabel">Dental Record</span>
              <strong>View tooth notes and record history online</strong>
              <p>Patients can review dentist comments and chart updates from their own account.</p>
            </div>

            <div className="homeHighlightCard">
              <span className="detailLabel">Clinic Workflow</span>
              <strong>Admin tools built for daily dental operations</strong>
              <p>Manage bookings, patients, dentists, schedules, and archive records in one place.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
