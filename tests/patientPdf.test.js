import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { splitFullName } from "../src/utils/names.js";
import { formatDateLabel, formatTimeLabel, formatTimestamp } from "../src/utils/schedule.js";
import { formatAppointmentStatusLabel } from "../src/utils/appointmentStatus.js";
import { createEmptyDentalChart, DENTAL_CHART_IMAGE, TOOTH_LABELS, TOOTH_MARKERS } from "../src/utils/teeth.js";

const source = fs.readFileSync(new URL("../src/pages/admin/Patients.jsx", import.meta.url), "utf8");
const body = source.slice(source.indexOf("async function exportPatientPdf("), source.indexOf("export default function Patients("));

function harness({ denyFinancials = false, savedChart = {} } = {}) {
  const financialReads = [];
  const chartReads = [];
  let html = "";
  const printWindow = { closed: false, document: { write: value => { html += value; }, close: () => {} } };
  const dependencies = {
    splitFullName, formatDateLabel, formatTimeLabel, formatTimestamp, formatAppointmentStatusLabel,
    createEmptyDentalChart, DENTAL_CHART_IMAGE, TOOTH_LABELS, TOOTH_MARKERS,
    formatCurrency: value => `PHP ${value}`, normalizePatientType: () => "Regular",
    getBracesAccountForPatient: () => null, getBracesPaymentsForPatient: () => [], buildBracesAccount: () => ({}),
    db: {}, doc: (_db, collection, id) => ({ collection, id }), collection: (_db, name) => name,
    getDoc: async ref => { chartReads.push(ref); return { exists: () => true, data: () => savedChart }; },
    getDocs: async name => { financialReads.push(name); if (denyFinancials) throw new Error("permission-denied"); return { docs: [] }; },
  };
  const exportPdf = new Function(...Object.keys(dependencies), `${body}; return exportPatientPdf;`)(...Object.values(dependencies));
  return { exportPdf, printWindow, financialReads, chartReads, html: () => html };
}

test("dentist PDF uses authorized chart data and never reads restricted payment collections", async () => {
  const state = harness({ denyFinancials: true });
  const opened = await state.exportPdf({ id: "walkin", name: "Test Patient" }, {
    printWindow: state.printWindow, includeFinancials: false,
    chartData: { generalNotes: "Clinical chart note", patientTreatmentPlans: [{ title: "Restoration", instructions: "Tooth treated", createdAt: "one" }] },
  });
  assert.equal(opened, true);
  assert.deepEqual(state.financialReads, []);
  assert.deepEqual(state.chartReads, []);
  assert.match(state.html(), /Clinical chart note/);
  assert.match(state.html(), /Restoration/);
  assert.doesNotMatch(state.html(), /<h2>Braces Payment Summary/);
});

test("walk-in exports load the chart by patient document ID when no login UID exists", async () => {
  const state = harness({ savedChart: { generalNotes: "Walk-in note" } });
  await state.exportPdf({ id: "walkin", name: "Walk-in" }, { printWindow: state.printWindow, includeFinancials: false });
  assert.deepEqual(state.chartReads, [{ collection: "dentalCharts", id: "walkin" }]);
  assert.match(state.html(), /Walk-in note/);
});

test("admin and receptionist exports can still load braces financial records", async () => {
  const state = harness();
  await state.exportPdf({ id: "patient", name: "Patient" }, { printWindow: state.printWindow, chartData: {} });
  assert.deepEqual(state.financialReads, ["bracesAccounts", "bracesPayments"]);
});

test("a blocked or closed print window does not start database reads", async () => {
  const state = harness();
  assert.equal(await state.exportPdf({ id: "patient" }, { printWindow: null }), false);
  assert.equal(await state.exportPdf({ id: "patient" }, { printWindow: { closed: true } }), false);
  assert.deepEqual(state.financialReads, []);
  assert.deepEqual(state.chartReads, []);
});
