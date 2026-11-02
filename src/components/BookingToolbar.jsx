import { BOOKING_SORT_OPTIONS } from "../utils/bookingSort";

export default function BookingToolbar({
  search,
  onSearchChange,
  sortBy,
  onSortChange,
  className = "",
}) {
  return (
    <div className={`bookingToolbar ${className}`.trim()}>
      <label className="bookingSearch adminSearchField">
        <svg className="adminSearchIcon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          className="input"
          type="text"
          aria-label="Search appointments by patient name, patient ID, appointment ID, or service"
          placeholder="Search patient, ID, or service"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
        {search ? (
          <button type="button" className="bookingClearSearch" onClick={() => onSearchChange("")}>
            Clear
          </button>
        ) : null}
      </label>
      <label className="bookingSortControl">
        <span aria-hidden="true">
          {BOOKING_SORT_OPTIONS.find((option) => option.value === sortBy)?.label}
        </span>
        <select
          aria-label="Sort bookings"
          value={sortBy}
          onChange={(event) => onSortChange(event.target.value)}
        >
          {BOOKING_SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </label>
    </div>
  );
}
