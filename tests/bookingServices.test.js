import test from "node:test";
import assert from "node:assert/strict";
import {
  canBookService,
  canRecordBracesFreeProcedure,
  getBookableCatalog,
  getKnownBracesType,
  isCrownTypeService,
  getBookingSelectionError,
  selectBookingService,
  withBookingCatalogAdditions,
} from "../functions/bookingServices.mjs";

const service = (name) => ({ name });
const cleaning = service("Dental Cleaning");
const filling = service("Fillings");
const extraction = service("Tooth Extraction");
const xray = service("Panoramic X-Ray");
const metal = service("Metal Braces");
const ceramic = service("Ceramic Braces");
const whitening = service("Whitening");
const rootCanal = service("Root Canal");

test("regular patients can choose Consultation while orthodontic services require Ortho status", () => {
  assert.equal(canBookService(service("Consultation"), "Regular Patient"), true);
  assert.equal(canBookService(service("Braces Consultation"), "New Patient"), false);
  assert.equal(canBookService(metal, "Orthodontic Patient"), true);
  assert.match(getBookingSelectionError([metal], "Regular"), /Ortho patients only/);
});

test("choosing a braces package drops its included services and leaves unrelated selections", () => {
  const options = [cleaning, filling, extraction, xray, metal, ceramic, whitening];
  assert.deepEqual(selectBookingService([cleaning.name, filling.name, whitening.name], metal, options), [whitening.name, metal.name]);
  for (const inclusion of [cleaning, filling, extraction, xray]) {
    assert.match(getBookingSelectionError([metal, inclusion], "Ortho"), /already included/);
  }
  assert.match(getBookingSelectionError([metal, ceramic], "Ortho"), /only one/);
});

test("three selections are allowed and duplicate names cannot bypass the limit", () => {
  assert.equal(getBookingSelectionError([metal, whitening, rootCanal], "Ortho"), "");
  assert.match(getBookingSelectionError([cleaning, whitening, rootCanal, extraction], "Regular"), /up to three/);
  assert.match(getBookingSelectionError([cleaning, service("dental cleaning")]), /only once/);
});

test("catalog additions provide Consultation and crown pricing and respect managed overrides", () => {
  const consultation = { name: "Consultation", active: false };
  const catalog = withBookingCatalogAdditions([consultation]);
  assert.equal(catalog.filter((entry) => entry.name === consultation.name).length, 1);
  assert.equal(catalog[0], consultation);
  assert.deepEqual(catalog.slice(1).map((entry) => entry.startingRate), [
    "PHP 8,000 each", "PHP 11,000 each", "PHP 15,000 each", "PHP 25,000 each", "PHP 10,000 each",
  ]);
});

test("an inactive duplicate does not hide a live service in the booking catalog", () => {
  const active = { name: "Dental X-ray", active: true };
  const disabled = { name: "Dental X-ray", active: false };
  for (const records of [[active, disabled], [disabled, active]]) {
    assert.equal(getBookableCatalog(records).find((entry) => entry.name === active.name), active);
  }
});

test("crown choices are available to Regular and Ortho patients under the same service limit", () => {
  const crown = service("Emax Crown");
  assert.equal(isCrownTypeService(crown), true);
  assert.equal(canBookService(crown, "Regular"), true);
  assert.equal(canBookService(crown, "Ortho"), true);
  assert.equal(getBookingSelectionError([metal, crown], "Ortho"), "");
  assert.match(getBookingSelectionError([metal, crown, cleaning], "Ortho"), /already included/);
});

test("walk-in braces types support prior labels and use the same names as online booking", () => {
  assert.equal(getKnownBracesType("Sapphire Braces"), "Sapphire Plastic");
  assert.equal(getKnownBracesType("Metal Braces"), "Metal");
  assert.equal(getKnownBracesType("Self-Ligating"), "Self-Ligating");
  assert.equal(getKnownBracesType("unknown"), "");
});

test("general Consultation stays available to both patient types", () => {
  const consultation = service("Consultation");
  assert.equal(canBookService(consultation, "Regular"), true);
  assert.equal(canBookService(consultation, "Ortho"), true);
});

test("the free procedure can be recorded only for a checked-in or treated braces package", () => {
  const booking = { services: ["Metal Braces"], status: "approved", checkedInAt: true };
  assert.equal(canRecordBracesFreeProcedure(booking), true);
  assert.equal(canRecordBracesFreeProcedure({ ...booking, checkedInAt: false }), false);
  assert.equal(canRecordBracesFreeProcedure({ ...booking, status: "completed" }), true);
  assert.equal(canRecordBracesFreeProcedure({ ...booking, status: "cancelled" }), false);
  assert.equal(canRecordBracesFreeProcedure({ ...booking, archiveStatus: "Archived" }), false);
  assert.equal(canRecordBracesFreeProcedure({ ...booking, services: ["Braces Consultation"] }), false);
});
