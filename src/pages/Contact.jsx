import CursorAura from "../components/CursorAura";

export default function Contact() {
  const [clinicName, streetAddress, cityAddress] = [
    "TopDent Dental Clinic",
    "67 MacArthur Hwy, Banga",
    "Meycauayan, Bulacan",
  ];

  const addressText = `${clinicName}, ${streetAddress}, ${cityAddress}`;
  const satelliteMapUrl =
    "https://www.google.com/maps?q=" +
    encodeURIComponent(addressText) +
    "&t=k&z=19&output=embed";

  return (
    <div className="container">
      <CursorAura />

      <div className="contactGrid">
        <div className="contactMapCard">
          <div className="contactMapFrame">
            <iframe
              className="mapFrame"
              src={satelliteMapUrl}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              title="TopDent satellite map"
            />
          </div>
        </div>

        <div className="contactInfo">
          <div className="iconRow">
            <div className="iconBubble">📍</div>
            <div>
              <div><b>Address</b></div>
              <div className="smallMuted">{streetAddress}</div>
              <div className="smallMuted">{cityAddress}</div>
            </div>
          </div>

          <div className="iconRow">
            <div className="iconBubble">☎</div>
            <div>
              <div><b>Phone</b></div>
              <a className="smallMuted contactLink" href="tel:+639693980336">
                +63 969 398 0336
              </a>
            </div>
          </div>

          <div className="iconRow">
            <div className="iconBubble">✉</div>
            <div>
              <div><b>Email</b></div>
              <a className="smallMuted contactLink" href="mailto:TopDent@gmail.com">
                TopDent@gmail.com
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
