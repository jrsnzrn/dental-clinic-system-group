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

      <div className="hero">
        <h1>Contact</h1>
        <p>Reach the clinic fast with the direct details on the left and a live satellite map on the right.</p>
      </div>

      <div className="contactGrid">
        <div className="contactCard" data-mascot-target="contact">
          <div className="cardHeader">
            <div>
              <h3 className="title">Clinic Details</h3>
              <p className="sub">Everything you need to call, email, or locate the clinic right away.</p>
            </div>
            <span className="badge">TopDent</span>
          </div>

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
              <div className="smallMuted">+63 994 376 6421</div>
            </div>
          </div>

          <div className="iconRow">
            <div className="iconBubble">✉</div>
            <div>
              <div><b>Email</b></div>
              <div className="smallMuted">TopDent@gmail.com</div>
            </div>
          </div>
        </div>

        <div className="contactCard contactMapCard" data-mascot-target="contact">
          <div className="cardHeader">
            <div>
              <h3 className="title">Satellite Map</h3>
              <p className="sub">A live map view of the clinic area so patients can find the exact location more easily.</p>
            </div>
            <span className="badge">Live View</span>
          </div>

          <div className="contactMapFrame" data-mascot-target="map">
            <button
              type="button"
              className="mascotCurseCollectible mascotCurseCollectible-crown"
              aria-label="Return the hidden crown"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent("topdent:curse-item-found", {
                    detail: { item: "crown", source: "contact" },
                  })
                );
              }}
            >
              <span className="mascotCurseCollectibleCrown">
                <span />
                <span />
                <span />
              </span>
            </button>
            <iframe
              className="mapFrame"
              src={satelliteMapUrl}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              title="TopDent satellite map"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
