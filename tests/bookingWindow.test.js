import test from "node:test";
import assert from "node:assert/strict";
import { getClinicDate, getLatestBookingDate, isWithinBookingWindow } from "../functions/bookingWindow.mjs";

test("allows today and the final day, rejects past and later dates", () => {
  const today = "2026-11-05";
  assert.equal(getLatestBookingDate(today), "2027-01-05");
  for (const date of [today, "2026-12-25", "2027-01-05"]) assert.ok(isWithinBookingWindow(date, today));
  for (const date of ["2026-11-04", "2027-01-06", "2028-01-05", "bad", "2026-11-31"]) {
    assert.equal(isWithinBookingWindow(date, today), false);
  }
});

test("two calendar months clamp to the last day of February", () => {
  assert.equal(getLatestBookingDate("2026-12-31"), "2027-02-28");
  assert.equal(getLatestBookingDate("2027-12-31"), "2028-02-29");
  assert.equal(getLatestBookingDate("2026-07-31"), "2026-09-30");
});

test("clinic date uses Philippine time even before midnight UTC", () => {
  assert.equal(getClinicDate(new Date("2026-11-04T16:01:00Z")), "2026-11-05");
});
