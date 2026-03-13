import Spline from "@splinetool/react-spline";
import { NavLink } from "react-router-dom";

export default function Home() {
  return (
    <div className="container">
      <div className="hero homeHeroGrid">
        {/* LEFT SIDE */}
        <div style={{ textAlign: "left" }}>
          <h1 style={{ marginBottom: 10 }}>TopDent Dental Clinic</h1>

          <p style={{ marginTop: 0 }}>
            Modern dental care with easy online booking and patient tracking.
            Explore our interactive 3D tooth.
          </p>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
            <NavLink className="btn" to="/book">
              Book Appointment
            </NavLink>

            <NavLink className="btn secondary" to="/services">
              View Services
            </NavLink>
          </div>

          <div className="note" style={{ marginTop: 14 }}>
            Clinic Hours: <b>Mon–Sat • 8:00 AM – 6:00 PM</b>
          </div>
        </div>

        {/* RIGHT SIDE — 3D */}
        <div className="card" style={{ padding: 12 }}>
          <div className="cardHeader">
            <div>
              <h3 className="title">3D Tooth Viewer</h3>
              <p className="sub">Drag to rotate • Scroll to zoom</p>
            </div>
            <span className="badge">Interactive</span>
          </div>

          <div
            style={{
              height: 380,
              borderRadius: 14,
              overflow: "hidden",
              border: "1px solid var(--line)",
            }}
          >
            <Spline scene="https://prod.spline.design/nwQB61UEGw-Pns9v/scene.splinecode" />
          </div>
        </div>
      </div>
    </div>
  );
}