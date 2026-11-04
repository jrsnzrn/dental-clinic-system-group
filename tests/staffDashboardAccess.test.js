import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/hooks/useStaffDashboard.js", import.meta.url), "utf8");
const body = source.slice(source.indexOf("export default function")).replace("export default ", "");
function harness(role) {
  let state = {};
  let cleanup;
  const listeners = [];
  const useState = () => [state, update => { state = typeof update === "function" ? update(state) : update; }];
  const onSnapshot = (reference, next, error) => {
    const listener = { reference, next, error, stopped: false };
    listeners.push(listener);
    return () => { listener.stopped = true; };
  };
  const hook = new Function("useEffect", "useState", "collection", "doc", "onSnapshot", "query", "where", "db", "ROLES", `${body}; return useStaffDashboard;`)(
    callback => { cleanup = callback(); }, useState,
    (_db, path) => ({ path }), (_db, path, id) => ({ path, id }), onSnapshot,
    (reference, ...filters) => ({ ...reference, filters }), (field, operator, value) => ({ field, operator, value }), {},
    { DENTIST: "dentist", RECEPTIONIST: "receptionist" },
  );
  hook("staff-uid", role, 0);
  return { listeners, state: () => state, cleanup: () => cleanup?.() };
}
const snapshot = records => ({ size: records.length, docs: records.map(([id, data]) => ({ id, data: () => data })) });

test("dentist dashboard only subscribes to bookings for profiles linked to the signed-in UID", () => {
  const h = harness("dentist");
  const profiles = h.listeners.find(entry => entry.reference.path === "dentists");
  assert.deepEqual(profiles.reference.filters, [{ field: "linkedStaffUid", operator: "==", value: "staff-uid" }]);
  assert.equal(h.listeners.filter(entry => entry.reference.path === "bookings").length, 0);
  profiles.next(snapshot([["dentist-one", {}]]));
  const bookings = h.listeners.find(entry => entry.reference.path === "bookings");
  assert.deepEqual(bookings.reference.filters, [{ field: "dentistId", operator: "==", value: "dentist-one" }]);
  bookings.next(snapshot([["assigned", { dentistId: "dentist-one" }]]));
  assert.equal(h.state().bookings[0].id, "assigned");
  assert.ok(h.listeners.every(entry => !["payments", "bracesPayments", "patients", "auditLogs"].includes(entry.reference.path)));
  h.cleanup();
  assert.ok(h.listeners.every(entry => entry.stopped));
});

test("removing a dentist link clears bookings and ignores delayed responses from the old subscription", () => {
  const h = harness("dentist");
  const profiles = h.listeners.find(entry => entry.reference.path === "dentists");
  profiles.next(snapshot([["old-dentist", {}]]));
  const old = h.listeners.find(entry => entry.reference.path === "bookings");
  old.next(snapshot([["old-booking", {}]]));
  profiles.next(snapshot([]));
  assert.equal(old.stopped, true);
  assert.equal(h.state().linked, false);
  old.next(snapshot([["late-booking", {}]]));
  assert.deepEqual(h.state().bookings, []);
  h.cleanup();
});

test("receptionist dashboard reads bookings without requesting restricted financial collections", () => {
  const h = harness("receptionist");
  assert.deepEqual(h.listeners.map(entry => entry.reference.path), ["admins", "bookings"]);
  h.listeners[1].next(snapshot([["booking", { status: "pending_payment" }]]));
  assert.equal(h.state().bookings.length, 1);
  h.cleanup();
});
