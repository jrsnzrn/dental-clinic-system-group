import Spline from "@splinetool/react-spline";
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
              <h3 className="title">3D Smile Viewer</h3>
              <p className="sub">Drag to rotate and explore the new interactive model.</p>
            </div>
            <span className="badge">Live 3D</span>
          </div>

          <div className="homeSplineViewport">
            <Spline scene="https://prod.spline.design/yDUqhqQDbGSX7oy2/scene.splinecode" />
          </div>
        </div>
      </div>
    </div>
  );
}
