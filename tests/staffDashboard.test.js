import test from "node:test";
import assert from "node:assert/strict";
import { getDashboardPatientPath, getDashboardStatus, getStaffDashboardSummary } from "../src/utils/staffDashboard.js";
import { ADMIN_NAV_BY_ROLE, getDefaultAdminPath } from "../src/utils/rbac.js";

const date = "2026-11-05";
test("daily counts distinguish booked patients, arrivals, completed treatments, and cancellations", () => {
  const summary = getStaffDashboardSummary([
    { id: "later", date, time: "14:00", status: "approved" },
    { id: "waiting", date, time: "09:00", status: "approved", checkedInAt: { seconds: 10 } },
    { id: "treated", date, time: "10:00", status: "pending_payment", treatmentCompletedAt: { seconds: 20 }, checkedInAt: { seconds: 10 } },
    { id: "paid", date, time: "11:00", status: "completed", checkedInAt: { seconds: 10 } },
    { id: "cancelled", date, time: "08:00", status: "cancelled", checkedInAt: { seconds: 10 } },
    { id: "absent", date, time: "13:00", status: "no_show" },
  ], date);
  assert.equal(summary.scheduled, 4);
  assert.equal(summary.waiting, 1);
  assert.equal(summary.completed, 2);
  assert.equal(summary.approved, 1);
  assert.deepEqual(summary.appointments.map(entry => entry.id), ["cancelled", "waiting", "treated", "paid", "absent", "later"]);
});

test("pending requests and payment counts span all active dates; the schedule uses only the selected date", () => {
  const summary = getStaffDashboardSummary([
    { id: "past", date: "2026-11-01", status: "pending_payment" },
    { id: "future", date: "2026-11-10", status: "pending" },
    { id: "archived", date, status: "pending", archiveStatus: "Archived" },
  ], date);
  assert.equal(summary.pending, 1);
  assert.equal(summary.pendingPayment, 1);
  assert.equal(summary.appointments.length, 0);
  assert.equal(summary.scheduled, 0);
});

test("checked-in badges do not hide completion or pending payment", () => {
  assert.equal(getDashboardStatus({ status: "approved", checkedInAt: {} }), "checked_in");
  assert.equal(getDashboardStatus({ status: "pending_payment", checkedInAt: {}, treatmentCompletedAt: {} }), "pending_payment");
  assert.equal(getDashboardStatus({ status: "completed", checkedInAt: {} }), "completed");
});

test("patient links support walk-ins and registered patients without placing names in URLs", () => {
  assert.equal(getDashboardPatientPath({ patientId: "walk/in", uid: "user" }), "/admin/patients/walk%2Fin");
  assert.equal(getDashboardPatientPath({ patientProfileId: "profile" }), "/admin/patients/profile");
  assert.equal(getDashboardPatientPath({ uid: "user" }), "/admin/patients/user");
  assert.equal(getDashboardPatientPath({ fullName: "Private patient name" }), "/admin/patients");
});

test("staff land on their dashboard and dentist navigation contains no receptionist-only shortcuts", () => {
  for (const role of ["dentist", "receptionist"]) {
    assert.equal(getDefaultAdminPath(role), "/admin/dashboard");
    assert.equal(ADMIN_NAV_BY_ROLE[role][0].to, "/admin/dashboard");
  }
  assert.equal(getDefaultAdminPath("admin"), "/admin/analytics");
  assert.ok(ADMIN_NAV_BY_ROLE.dentist.every(link => !["/admin/payments", "/admin/queue", "/admin/bookings"].includes(link.to)));
});
