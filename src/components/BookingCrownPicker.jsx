import { MAX_BOOKING_SERVICES, isCrownTypeService } from "../../functions/bookingServices.mjs";

export default function BookingCrownPicker({ options, selectedServices, onToggle, disabled, serviceLimit = MAX_BOOKING_SERVICES }) {
  const crowns = options.filter(isCrownTypeService);
  if (!crowns.length) return null;

  const selected = crowns.filter((crown) => selectedServices.includes(crown.name));
  const available = crowns.filter((crown) => !selectedServices.includes(crown.name));

  return (
    <div className="bookingBracesPackageDetails">
      <label className="bookingServiceTypeField">
        <strong>Type of Crown</strong>
        <select
          className="input"
          value=""
          disabled={disabled || selectedServices.length >= serviceLimit}
          onChange={(event) => {
            const crown = available.find((option) => option.name === event.target.value);
            if (crown) onToggle(crown);
          }}
        >
          <option value="">{selectedServices.length >= serviceLimit ? "Service limit reached" : "Select a crown type"}</option>
          {available.map((crown) => (
            <option key={crown.name} value={crown.name}>
              {crown.name}{crown.startingRate ? ` · ${crown.startingRate}` : ""}
            </option>
          ))}
        </select>
      </label>
      {selected.length ? (
        <div className="bookingCrownSelections">
          {selected.map((crown) => (
            <button key={crown.name} type="button" className="btn secondary" disabled={disabled} onClick={() => onToggle(crown)} aria-label={`Remove ${crown.name}`}>
              {crown.name} · Remove
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
