import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
const handler = source.slice(source.indexOf("exports.cancelPatientBooking ="), source.indexOf("exports.rescheduleBooking ="));

function setup(fields = {}) {
  const booking = { uid: "patient", status: "approved", ...fields };
  const events = [];
  const exports = {};
  class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }
  vm.runInNewContext(handler, {
    exports,
    onCall: (_, callback) => callback,
    HttpsError,
    admin: { firestore: { FieldValue: { serverTimestamp: () => "now" } } },
    db: {
      collection: () => ({ doc: (id) => ({ id }) }),
      runTransaction: (callback) => callback({
        get: async () => ({ data: () => ({ ...booking }) }),
        update: (_, changes) => {
          Object.assign(booking, changes);
          events.push("booking updated");
        },
      }),
    },
    isStoredBookingInPast: () => false,
    getLockSnapshots: async () => ({ lockRefs: [], lockSnaps: [] }),
    deleteOwnedLocks: (_, __, ___, id) => events.push(`released ${id}`),
    syncDentistPatientAccess: async (uid) => events.push(`synced ${uid}`),
  });
  return {
    booking,
    events,
    cancel: (uid = "patient") => exports.cancelPatientBooking({
      auth: { uid },
      data: { bookingId: "visit", reason: "Unavailable" },
    }),
  };
}

test("patients cancel directly and release the reserved slot once", async () => {
  const flow = setup({ cancellationRequest: { status: "pending" } });
  await flow.cancel();
  await flow.cancel();
  assert.equal(flow.booking.status, "cancelled");
  assert.equal(flow.booking.cancellationRequest.status, "cancelled");
  assert.equal(flow.booking.cancellationReason, "Unavailable");
  assert.deepEqual(flow.events, ["released visit", "booking updated", "synced patient", "synced patient"]);
});

test("cancellation rejects other users, checked-in bookings, and pending reschedules", async () => {
  const otherUser = setup();
  const checkedIn = setup({ checkedInAt: "now" });
  const pendingReschedule = setup({ rescheduleRequest: { status: "pending" } });
  await assert.rejects(otherUser.cancel("other"), { code: "permission-denied" });
  await assert.rejects(checkedIn.cancel(), { code: "failed-precondition" });
  await assert.rejects(pendingReschedule.cancel(), { code: "failed-precondition" });
  for (const flow of [otherUser, checkedIn, pendingReschedule]) {
    assert.equal(flow.booking.status, "approved");
    assert.deepEqual(flow.events, []);
  }
});
