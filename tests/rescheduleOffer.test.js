import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
const handlers = source.slice(
  source.indexOf("exports.approveReschedule ="),
  source.indexOf("exports.declineReschedule =")
);

function setup({ slotTaken = false, emailFails = false } = {}) {
  const timestamp = (value) => ({ toMillis: () => value, toDate: () => new Date(value) });
  const booking = {
    uid: "patient",
    email: "patient@example.com",
    status: "pending",
    dentistId: "dentist",
    date: "2099-04-10",
    time: "09:00",
    rescheduleRequest: { status: "pending", requestedDate: "2099-04-10", requestedTime: "10:00" },
  };
  const writes = [];
  const emails = [];
  const exports = {};
  class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }
  vm.runInNewContext(handlers, {
    exports,
    HttpsError,
    onCall: (...args) => args.at(-1),
    gmailEmail: {},
    gmailAppPassword: {},
    crypto: { randomUUID: () => "offer" },
    admin: { firestore: { Timestamp: { fromMillis: timestamp }, FieldValue: { serverTimestamp: () => "now" } } },
    db: {
      collection: () => ({ doc: (id) => ({ id }) }),
      runTransaction: async (callback) => callback({
        get: async () => ({ exists: true, data: () => ({ ...booking }) }),
        update: (_, changes) => Object.assign(booking, changes),
        set: (ref) => writes.push(ref.id),
      }),
    },
    getStaffContextFromRequest: async () => ({ uid: "staff" }),
    getLockSnapshots: async () => ({ lockRefs: [], lockSnaps: [] }),
    deleteOwnedLocks: () => writes.push("released original slot"),
    validateStaffBookingSlot: async (_, { nextDate, nextTime }) => {
      if (slotTaken && emails.length) throw new HttpsError("already-exists", "Taken");
      return {
        appointmentAt: timestamp(Date.parse(`${nextDate}T${nextTime}:00+08:00`)),
        lockRefs: [{ id: "alternate slot" }],
        window: { dentistId: booking.dentistId, date: nextDate, time: nextTime },
      };
    },
    createManilaAppointmentDate: (date, time) => new Date(`${date}T${time}:00+08:00`),
    formatScheduleLabel: ({ date, time }) => `${date} at ${time}`,
    createTransporter: () => ({
      senderEmail: "clinic@example.com",
      transporter: { sendMail: async (message) => {
        emails.push(message);
        if (emailFails) throw new Error("SMTP unavailable");
      } },
    }),
    console: { error() {} },
  });
  return {
    booking, writes, emails,
    offer: () => exports.offerReschedule({ data: { bookingId: "booking", date: booking.date, time: "11:00" } }),
    approveRequest: () => exports.approveReschedule({ data: { bookingId: "booking" } }),
    respond: (accept, uid = booking.uid) => exports.respondToRescheduleOffer({
      auth: { uid }, data: { bookingId: "booking", offerId: "offer", accept },
    }),
  };
}

test("an offer emails the booking owner and preserves the original slot until acceptance", async () => {
  const flow = setup();
  assert.equal((await flow.offer()).emailSent, true);
  assert.equal(flow.emails[0].to, flow.booking.email);
  assert.match(flow.emails[0].text, /original appointment.*remains scheduled/);
  assert.equal(flow.booking.time, "09:00");
  assert.deepEqual(flow.writes, []);

  await flow.respond(true);
  await flow.respond(true);
  assert.equal(flow.booking.time, "11:00");
  assert.equal(flow.booking.rescheduleOffer.status, "accepted");
  assert.deepEqual(flow.writes, ["released original slot", "alternate slot"]);
});

test("a conflict or an expired offer keeps the original booking intact", async () => {
  const flow = setup({ slotTaken: true });
  await flow.offer();
  await assert.rejects(flow.respond(true), { code: "already-exists" });
  flow.booking.rescheduleOffer.expiresAt = { toMillis: () => 0 };
  await assert.rejects(flow.respond(true), { code: "failed-precondition" });
  assert.equal(flow.booking.time, "09:00");
  assert.deepEqual(flow.writes, []);
});

test("email failure leaves the in-app offer visible and only the owner can decline it", async () => {
  const flow = setup({ emailFails: true });
  assert.equal((await flow.offer()).emailSent, false);
  await assert.rejects(flow.respond(false, "other-patient"), { code: "permission-denied" });
  await flow.respond(false);
  assert.equal(flow.booking.time, "09:00");
  assert.equal(flow.booking.rescheduleOffer.status, "declined");
  assert.deepEqual(flow.writes, []);
});

test("staff cannot approve a request for the current time or while cancellation is pending", async () => {
  const flow = setup();
  flow.booking.rescheduleRequest.requestedTime = flow.booking.time;
  await assert.rejects(flow.approveRequest(), /same as the current appointment/);
  flow.booking.rescheduleRequest.requestedTime = "10:00";
  flow.booking.cancellationRequest = { status: "pending" };
  await assert.rejects(flow.approveRequest(), { code: "failed-precondition" });
  assert.deepEqual(flow.writes, []);
});
