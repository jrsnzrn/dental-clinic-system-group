import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/pages/admin/Bookings.jsx", import.meta.url), "utf8");
const body = source.slice(source.indexOf("  async function runBookingAction("), source.indexOf("  async function setStatus("));
function harness() {
  const lock = { current: false };
  const labels = [];
  const errors = [];
  const successes = [];
  const run = new Function("actionInFlight", "setPendingAction", "setActionError", "setActionSuccess", "console", `${body}; return runBookingAction;`)(
    lock, label => labels.push(label), error => errors.push(error), message => successes.push(message), { error() {} },
  );
  return { lock, labels, errors, successes, run };
}

test("approval shows progress immediately and suppresses duplicate requests until the server finishes", async () => {
  const h = harness();
  let finish;
  let calls = 0;
  const pending = h.run(() => { calls++; return new Promise(resolve => { finish = resolve; }); }, "Approving appointment…");
  assert.equal(h.lock.current, true);
  assert.equal(h.labels.at(-1), "Approving appointment…");
  await h.run(() => { calls++; });
  assert.equal(calls, 1);
  finish();
  await pending;
  assert.equal(h.lock.current, false);
  assert.equal(h.labels.at(-1), "");
});

test("failed requests stop the indicator, show the error, and allow retry", async () => {
  const h = harness();
  await h.run(async () => { throw new Error("Connection lost"); });
  assert.equal(h.errors.at(-1), "Connection lost");
  assert.equal(h.labels.at(-1), "");
  assert.equal(h.lock.current, false);
  let retried = false;
  await h.run(async () => { retried = true; });
  assert.equal(retried, true);
  assert.equal(h.errors.at(-1), "");
});


test("completion confirmation is shown only after a successful server response", async () => {
  const h = harness();
  let finish;
  const pending = h.run(() => new Promise(resolve => { finish = resolve; }), "Approving…", "Appointment approved.");
  assert.deepEqual(h.successes, []);
  finish();
  await pending;
  assert.deepEqual(h.successes, ["Appointment approved."]);
  await h.run(async () => { throw new Error("Could not save"); }, "Saving…", "Saved.");
  assert.deepEqual(h.successes, ["Appointment approved."]);
});
