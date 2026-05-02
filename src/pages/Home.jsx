import { NavLink } from "react-router-dom";
import CursorAura from "../components/CursorAura";
import frontDeskPhoto from "../assets/home-clinic-frontdesk.jpg";
import treatmentPhoto from "../assets/home-clinic-treatment.jpg";
import lobbyWidePhoto from "../assets/home-clinic-lobby-wide.jpg";
import lobbyPhoto from "../assets/home-clinic-lobby.jpg";

export default function Home() {
  return (
    <div className="container homePage">
      <CursorAura />

      <section className="homeLanding" data-mascot-target="home-hero">
        <div className="homeLandingCopy">
          <span className="heroEyebrow">TopDent Dental Clinic</span>
          <h1>Just a clinic that feels warm, clean, and welcoming.</h1>
          <p>
            TopDent blends a friendlier patient atmosphere with smoother booking and a more organized clinic experience, so every visit feels easier from arrival to treatment.
          </p>

          <div className="homeHeroActions">
            <NavLink className="btn btnShine bookingPrimaryBtn" to="/book" data-mascot-target="book">
              Book Appointment
            </NavLink>
            <NavLink className="btn secondary btnSoft" to="/about">
              See Our Clinic
            </NavLink>
          </div>

          <div className="homeStatRibbon">
            <div className="homeRibbonCard">
              <span className="detailLabel">Clinic hours</span>
              <strong>Mon-Sat • 8:00 AM - 6:00 PM</strong>
            </div>
            <div className="homeRibbonCard">
              <span className="detailLabel">Since</span>
              <strong>Serving patients since 2022</strong>
            </div>
          </div>
        </div>

        <div className="homeLandingVisual">
          <article className="homeShowcasePrimary">
            <img src={frontDeskPhoto} alt="TopDent front desk team" />
            <div className="homeShowcaseBadge top">
              <span className="detailLabel">Reception</span>
              <strong>Friendly welcome and patient assistance</strong>
            </div>
          </article>

          <article className="homeShowcaseSecondary">
            <div className="homeShowcaseSmall">
              <img src={treatmentPhoto} alt="TopDent treatment room" />
              <div className="homeShowcaseBadge">
                <span className="detailLabel">Treatment Room</span>
                <strong>Clean, calm, and organized care</strong>
              </div>
            </div>

            <div className="homeAtmosphereCard">
              <span className="detailLabel">Clinic atmosphere</span>
              <strong>Bright interiors, gentle care, and a more comfortable visit</strong>
              <p>
                Designed to feel less intimidating and more welcoming for patients and families.
              </p>
            </div>
          </article>
        </div>
      </section>

      <section className="homeGalleryBand" data-mascot-target="home-gallery">
        <div className="homeGalleryIntro">
          <span className="heroEyebrow">Inside TopDent</span>
          <h2>A clinic space that feels lively, personal, and easy to return to.</h2>
        </div>

        <div className="homeMosaicGrid">
          <article className="homeMosaicCard wide">
            <img src={lobbyWidePhoto} alt="TopDent clinic waiting area" />
            <div className="homeMosaicOverlay">
              <strong>Comfortable waiting area</strong>
              <span>A brighter lobby that helps patients feel settled before treatment.</span>
            </div>
          </article>

          <article className="homeMosaicCard">
            <img src={lobbyPhoto} alt="TopDent clinic interior seating area" />
            <div className="homeMosaicOverlay">
              <strong>Relaxed clinic corner</strong>
              <span>Warm seating and a calmer clinic mood for everyday visits.</span>
            </div>
          </article>

          <article className="homeMosaicQuote">
            <span className="heroEyebrow">Patient-first feel</span>
            <p>
              From the entrance to the dental chair, the clinic is arranged to feel cleaner, softer, and more reassuring.
            </p>
            <NavLink className="btn secondary btnSoft" to="/contact">
              Visit the Clinic
            </NavLink>
          </article>
        </div>
      </section>
    </div>
  );
}
