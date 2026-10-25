import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { NavLink } from "react-router-dom";
import CursorAura from "../components/CursorAura";
import { db } from "../firebase";
import homebg from "../assets/home-clinic-treatment.jpg";
import clinicLobby from "../assets/home-clinic-lobby-wide.jpg";
import recepArea from "../assets/recepArea.png";
import waitingArea from "../assets/waitingarea.jpg";
import waitingArea2 from "../assets/wa1.jpg";
import treatmentRoom from "../assets/treatmentroom.jpg";
import dentist1 from "../assets/dentist1.png";
import dentist2 from "../assets/dentist2.jpg";
import dentist3 from "../assets/dentist3.jpg";
import dentist4 from "../assets/dentist4.jpg";
import prevIcon from "../assets/prev.png";
import restorIcon from "../assets/restor.png";
import cosmeticIcon from "../assets/cosmetic.png";
import orthoIcon from "../assets/ortho.png";
import kidIcon from "../assets/kid.png";
import results1 from "../assets/results1.jpg";
import results2 from "../assets/results2.jpg";
import results3 from "../assets/results3.png";

const clinicGallery = [
  { image: recepArea, caption: "Receptionist Area" },
  { image: waitingArea, caption: "Waiting Area" },
  { image: treatmentRoom, caption: "Treatment Room" },
  { image: waitingArea2, caption: "Waiting Area" },
];

const smileResults = [
  { image: results1, alt: "Before and after result 1" },
  { image: results2, alt: "Before and after result 2" },
  { image: results3, alt: "Before and after result 3" },
];

const services = [
  {
    title: "General Dentistry",
    description: "All-inclusive oral health care with regular checkups, professional cleanings, and preventive procedures.",
    icon: <img src={prevIcon} alt="Preventive Care" />,
  },
  {
    title: "Oral Surgery",
    description: "Fillings, crowns, and repairs that bring damaged teeth back to full function.",
    icon: <img src={restorIcon} alt="Restorative Dentistry" />,
  },
  {
    title: "Cosmetic Dentistry",
    description: "Whitening, veneers, and smile makeovers designed around how you want to look.",
    icon: <img src={cosmeticIcon} alt="Cosmetic Dentistry" />,
  },
  {
    title: "Orthodontics",
    description: "Straighten your teeth with traditional braces, self ligating braces or modern clear aligners.",
    icon: <img src={orthoIcon} alt="Specialized Treatments" />,
  },
  {
    title: "Pediatric Dentistry",
    description: "Gentle, kid-friendly checkups and treatments that help little ones feel at ease.",
    icon: <img src={kidIcon} alt="Kid Care" />,
  },
];

const doctors = [
  {
    photo: dentist1,
    name: "Dr. Kael",
    specialty: "General & Cosmetic Dentistry",
    bio: "Ten years of turning nervous first visits into easy, comfortable ones.",
  },
  {
    photo: dentist2,
    name: "Dr. Mira",
    specialty: "Orthodontics",
    bio: "Believes a great bite shouldn't take forever — or feel like it.",
  },
  {
    photo: dentist3,
    name: "Dr. Paul",
    specialty: "Pediatric Dentistry",
    bio: "Makes kids actually look forward to the dentist. Parents too.",
  },
];

const feedback = [
  {
    name: "Morrissete",
    quote: "Highly recommended po ang clinic nato. Sobrang babait ng staff and doctors. Thankyouuu at naibsan ang sakit na nararamdaman ng baby ko. Sa uulitin po ulit TopDent clinic.",
    link: "https://www.facebook.com/share/p/1SHXAGW9Q1/",
  },
  {
    name: "Lorraine",
    quote: "Highly recommended! The staff are approachable, the clinic is clean, and the doctor is very kind and professional. I had a great experience here.",
    link: "https://www.facebook.com/share/p/1DJbW4mwmX/",
  },
  {
    name: "Sophia",
    quote: "I highly recommend this dental clinic. The doctor and staff are very kind, professional, and accommodating. I'm truly grateful for the wonderful experience! 🫶🏻",
    link: "https://www.facebook.com/share/p/1HCPHSiejz/",
  },
  {
    name: "Manichelda",
    quote: "Sobrang bait ng mga staff at accommodating nung nag-assist pagpasok mo palang. The best thing is equal and pareho ang trato nila sa lahat ng patients. Si Doc naman ay very caring at sinisigurado na komportable ka. Highly recommended po ito! #bakatopdentdentalyern 😁",
    link: "https://www.facebook.com/share/p/1DLKMaJB5p/",
  },
  {
    name: "Mary Rose",
    quote: "Highly Recommended Dental Clinic! The dentist and staff are very professional. They are also approachable, kind, and helpful. They offer affordable dental procedures.",
    link: "https://www.facebook.com/share/p/1GRdEd9yEr/",
  },
  {
    name: "Kathleen",
    quote: "Recommendable po ang TopDent Dental Clinic. Bukod sa malinis po ang clinic, mababait po ang mga staff at dentist. Magaan din po ang kamay kapag tooth extraction.",
    link: "https://www.facebook.com/share/p/19MDvbD9Ta/",
  },
];

const FACEBOOK_URL = "https://www.facebook.com/TopdentDentalClinic";
const PHONE_DISPLAY = "+63 994 376 6421";
const PHONE_HREF = "tel:+639943766421";

function formatPromoDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

function PromoSection({ promotions }) {
  if (!promotions || promotions.length === 0) return null;

  return (
    <section className="homeOffers" aria-label="Promotions">
      <div className="innerWrap">
        <div className="homeOffersGrid">
          {promotions.map((item) => {
            const amount = item.discountType === "percentage" ? `${item.discountValue}%` : `₱${Number(item.discountValue || 0).toLocaleString()}`;
            const services = item.services && item.services.length ? item.services : ["Selected services"];

            return (
              <article className="homeOfferCard" key={item.id} aria-label={item.title}>
                <div className="promoBanner">
                  <div className="promoVisual">
                    {item.imageUrl && <img className="homeOfferImage" src={item.imageUrl} alt={`${item.title} promotion`} loading="lazy" />}
                  </div>

                  <div className="homeOfferContent">
                    <span className="promoLabel">{item.promoLabel || "Dental Care Promo"}</span>
                    <h3 className="promoHeadline">
                      {item.headlineMain || "Smile"}{" "}
                      <span>{item.headlineAccent || "Brighter"}</span>
                    </h3>
                     <span className="homeOfferDiscount" data-long={amount.length > 4 ? "true" : undefined}>
                    <small>Off</small>{amount}
                  </span>
                    <p className="promoScript">{item.tagline || "Your Smile’s Best Deal"}</p>
                    {item.description && <p className="promoDesc">{item.description}</p>}
                    <ul className="promoServices">
                      {services.slice(0, 3).map((name) => <li key={name}>{name}</li>)}
                      {services.length > 3 && <li>+{services.length - 3} more</li>}
                    </ul>
                    <NavLink to="/book" className="btnPrimary16 promoCta">Book now</NavLink>
                  </div>

                  <div className="promoFooter">
                    <div className="promoSocials">
                      <a href={FACEBOOK_URL} target="_blank" rel="noopener noreferrer" aria-label="Facebook">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" /></svg>
                      </a>
                    </div>

                    <a className="promoPhone" href={PHONE_HREF}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
                      {PHONE_DISPLAY}
                    </a>

                    {(item.startDate || item.endDate) && (
                      <span className="homeOfferDates">
                        Valid {formatPromoDate(item.startDate) || "now"} – {formatPromoDate(item.endDate) || "while available"}
                      </span>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const [promotions, setPromotions] = useState([]);

  useEffect(() => {
    let active = true;
    getDocs(query(collection(db, "promotions"), where("status", "==", "active")))
      .then((snapshot) => {
        if (!active) return;
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        setPromotions(snapshot.docs
          .map((entry) => ({ id: entry.id, ...entry.data() }))
          .filter((item) => (!item.startDate || item.startDate <= today) && (!item.endDate || item.endDate >= today))
          .sort((a, b) => String(a.endDate || "9999-12-31").localeCompare(String(b.endDate || "9999-12-31"))));
      })
      .catch((error) => console.error("Could not load public promotions:", error));
    return () => { active = false; };
  }, []);

  return (
    <div className="homePage">
      <CursorAura />

      <section className="homeLanding" data-mascot-target="home-hero">
        <div className="innerWrap homeLandingInner">
          <div className="homeLandingCopy">
            <span className="heroEyebrow">Welcome to TopDent</span>
            <h1>Beautiful <span>Smiles</span> That Last a Lifetime</h1>
            <p>TopDent provides gentle, modern, and personalized dental care for patients of all ages. We're committed to making every visit comfortable and every smile healthier.</p>

            <div className="homeLandingActions">
              <a href="/book" className="btnPrimary16" data-mascot-target="book">Book Appointment</a>
              <NavLink to="/services" className="btnOutline16">Explore Services</NavLink>
            </div>
          </div>

          <div className="homeLandingVisual">
            <article className="homeShowcasePrimary">
              <img src={homebg} alt="TopDent Dental Clinic" />
            </article>
          </div>
        </div>
      </section>

      <PromoSection promotions={promotions} />

      <section className="homeWhyUs" data-mascot-target="home-why">
        <div className="innerWrap homeWhyUsInner">
          <div className="homeWhyUsVisual">
            <img src={clinicLobby} alt="TopDent clinic lobby" />
          </div>

          <div className="homeWhyUsContent">
            <h2>Why Choose <span>TopDent</span> Dental Clinic?</h2>
            <p>At TopDent, we combine modern technology with a gentle touch to make every visit comfortable, affordable, and worth it.</p>

            <div className="homeWhyUsGrid">
              <div className="whyUsCard">
                <div className="whyUsIcon">
                  <svg viewBox="0 0 24 24"><path d="M12 3c-2.2 0-3.6 1.1-4.5 1.1-1 0-2-.6-3-.1C2.7 4.8 2 6.6 2 9c0 3.6 1.8 9.5 3.6 11.4.8.9 1.4-.3 1.7-1.4.3-1.2.6-3.5 1.7-3.5s1.4 2.3 1.7 3.5c.3 1.1.9 2.3 1.7 1.4C14.2 18.5 16 12.6 16 9c0-2.4-.7-4.2-2.5-5C12.5 3.5 12.4 3 12 3z"/><path d="M9.5 4.4C9 3.5 9.7 2 12 2"/></svg>
                </div>
                <div className="whyUsText">
                  <h3>Expert dentists</h3>
                  <p>Our team of licensed professionals brings years of experience in general and cosmetic dentistry.</p>
                </div>
              </div>

              <div className="whyUsCard">
                <div className="whyUsIcon">
                  <svg viewBox="0 0 24 24"><path d="M14.5 3.5 17 6l-8 8-3.5.8L6.3 11z"/><path d="M3 21l2.2-5.2"/><path d="M13.5 4.5l3 3"/><circle cx="19" cy="5" r="1.4"/></svg>
                </div>
                <div className="whyUsText">
                  <h3>Modern equipment</h3>
                  <p>We use the latest dental technology to ensure precise, painless, and efficient treatments every time.</p>
                </div>
              </div>

              <div className="whyUsCard">
                <div className="whyUsIcon">
                  <svg viewBox="0 0 24 24"><path d="M12 20.5s-7-4.4-9-9.2C1.6 8 2.9 5 6 4.4c2-.4 3.6.6 5 2.4 1.4-1.8 3-2.8 5-2.4C19.1 5 20.4 8 19 11.3c-2 4.8-9 9.2-9 9.2z"/></svg>
                </div>
                <div className="whyUsText">
                  <h3>Patient-first approach</h3>
                  <p>We listen, we care, and we make sure you leave with a smile — literally. Your comfort is our priority.</p>
                </div>
              </div>

              <div className="whyUsCard">
                <div className="whyUsIcon">
                  <svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><circle cx="8" cy="14" r="1.4"/></svg>
                </div>
                <div className="whyUsText">
                  <h3>Affordable rates</h3>
                  <p>Quality dental care shouldn't break the bank. We offer flexible payment options to fit your budget.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="homeGalleryBand" data-mascot-target="home-gallery">
        <div className="innerWrap">
          <div className="homeGalleryIntro">
            <h2>Our <span>Dental Clinic</span></h2>
            <p>Our clinic is designed to provide a clean, comfortable, and welcoming space for every patient.</p>
          </div>

          <div className="homeGalleryGrid">
            {clinicGallery.map((item) => (
              <figure className="homeGalleryCard" key={item.caption + item.image}>
                <img src={item.image} alt={item.caption} />
                <figcaption>{item.caption}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section className="homeSmile" data-mascot-target="home-smile">
        <div className="innerWrap">
          <div className="smileIntro">
            <h2>Smile <span>Gallery</span></h2>
            <p>See the difference a visit to TopDent can make.</p>
          </div>

          <div className="smileGrid">
            {smileResults.map((item, i) => (
              <figure className="smileCard" key={i}>
                <div className="smileCardMedia">
                  {item.image ? (
                    <img src={item.image} alt={item.alt} loading="lazy" />
                  ) : (
                    <>
                      <div className="smilePlaceholder" />
                      <div className="smilePlaceholder" />
                    </>
                  )}
                  <span className="smileTag before">BEFORE</span>
                  <span className="smileTag after">AFTER </span>
                </div>
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section className="homeServices" data-mascot-target="home-services">
        <div className="innerWrap">
          <div className="homeServicesIntro">
            <h2>Our <span>Services</span></h2>
            <p>From routine checkups to complete smile makeovers, TopDent covers the full range of dental care.</p>
          </div>

          <div className="homeServicesGrid">
            {services.map((service) => (
              <div className="serviceCard serviceCardIcon" key={service.title}>
                <div className="serviceIcon">{service.icon}</div>
                <h3>{service.title}</h3>
                <p>{service.description}</p>
              </div>
            ))}
          </div>

          <div className="homeServicesFooter">
            <NavLink to="/services" className="exploreServicesLink">
              Explore services
              <svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </NavLink>
          </div>
        </div>
      </section>

      <section className="homeDoctors" data-mascot-target="home-doctors">
        <div className="innerWrap">
          <div className="homeDoctorsIntro">
            <h2>Our Dental <span>Experts</span></h2>
            <p>Licensed, experienced, and genuinely invested in making your visit comfortable from start to finish.</p>
          </div>
          <div className="homeDoctorsGrid">
            {doctors.map((doc, i) => (
              <article className={`doctorCard${i % 2 ? " reverse" : ""}`} key={doc.name}>
                <div className="doctorInfo">
                  <h3>{doc.name}</h3>
                  <span className="doctorSpecialty">{doc.specialty}</span>
                  <p>{doc.bio}</p>
                </div>
                <div className="doctorPhoto">
                  <img src={doc.photo} alt={doc.name} />
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="homeFeedback" data-mascot-target="home-feedback">
        <div className="innerWrap">
          <div className="homeFeedbackIntro">
            <h2>What Our Patients Say About TopDent</h2>
          </div>

          <div className="homeFeedbackGrid">
            {feedback.map((item) => (
              <a
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                className="feedbackCard feedbackCardText"
                key={item.link}
                aria-label={`Read ${item.name}'s full review on Facebook`}
              >
                <div className="feedbackStars" aria-hidden="true">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <svg key={i} viewBox="0 0 24 24">
                      <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.5 1.3 6.6L12 17l-5.9 3.5 1.3-6.6-4.9-4.5 6.6-.8z" />
                    </svg>
                  ))}
                </div>

                <p className="feedbackQuote">
                  &ldquo;{item.quote}&rdquo;
                </p>

                <span className="feedbackName">
                  — {item.name}
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="homePromo" data-mascot-target="home-promo">
        <div className="innerWrap homePromoInner">
          <p>
            Don't wait until it hurts. <strong>Book your appointment today.</strong>
          </p>
          <a href="/book" className="btnPrimary16">
            Book now
          </a>
        </div>
      </section>

    </div>
  );
}