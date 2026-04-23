const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const nodemailer = require("nodemailer");

admin.initializeApp();

const db = admin.firestore();
const auth = admin.auth();
const gmailEmail = defineSecret("GMAIL_EMAIL");
const gmailAppPassword = defineSecret("GMAIL_APP_PASSWORD");

const ALLOWED_ROLES = ["receptionist", "dentist"];

async function writeAuditLog({
  actorUid = "",
  actorName = "",
  actorEmail = "",
  actorRole = "",
  action,
  targetType,
  targetId = "",
  targetLabel = "",
  details = {},
}) {
  if (!action || !targetType) return;

  await db.collection("auditLogs").add({
    actorUid,
    actorName,
    actorEmail,
    actorRole,
    action,
    targetType,
    targetId,
    targetLabel,
    details,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

function serializeAdminDoc(id, data = {}) {
  const createdAt = data.createdAt;

  return {
    id,
    name: data.name || "",
    email: data.email || "",
    role: data.role || "",
    disabled: Boolean(data.disabled),
    createdBy: data.createdBy || "",
    createdAt:
      createdAt && typeof createdAt.toDate === "function"
        ? createdAt.toDate().toISOString()
        : null,
  };
}

function formatScheduleLabel(booking) {
  const date = booking.date ? String(booking.date) : "To be confirmed";
  const time = booking.time ? String(booking.time) : "To be confirmed";
  return `${date} at ${time}`;
}

function createEmailShell({ eyebrow, title, intro, detailsHtml, closing }) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; background: linear-gradient(180deg, #ecfeff 0%, #f8fafc 100%);">
      <div style="background: white; border-radius: 20px; padding: 34px; border: 1px solid #dbeafe; box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);">
        <div style="margin-bottom: 22px; text-align: center;">
          <p style="margin: 0 0 8px; color: #0f766e; font-size: 12px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;">
            ${eyebrow}
          </p>
          <h1 style="margin: 0; color: #0f172a; font-size: 30px; line-height: 1.2;">
            ${title}
          </h1>
        </div>

        <p style="margin: 0 0 22px; color: #334155; font-size: 15px; line-height: 1.8;">
          ${intro}
        </p>

        <div style="border-radius: 16px; padding: 18px 20px; background: linear-gradient(180deg, #f8fafc, #eff6ff); border: 1px solid #cbd5e1; margin-bottom: 22px;">
          ${detailsHtml}
        </div>

        <p style="margin: 0; color: #334155; font-size: 15px; line-height: 1.8;">
          ${closing}
        </p>
      </div>
    </div>
  `;
}

function createBookingDetailsHtml(booking, statusLabel) {
  const service = booking.service || "Dental appointment";
  const dentist = booking.selectedDentist || "Assigned dentist";
  const schedule = formatScheduleLabel(booking);

  return `
    <p style="margin: 0 0 10px; color: #475569;"><strong>Service:</strong> ${service}</p>
    <p style="margin: 0 0 10px; color: #475569;"><strong>Schedule:</strong> ${schedule}</p>
    <p style="margin: 0 0 10px; color: #475569;"><strong>Dentist:</strong> ${dentist}</p>
    <p style="margin: 0; color: #475569;"><strong>Status:</strong> ${statusLabel}</p>
  `;
}

function createApprovalEmailHtml(booking) {
  const patientName = booking.fullName || "Patient";

  return createEmailShell({
    eyebrow: "TopDent Dental Clinic",
    title: "Your booking has been approved",
    intro: `Hello ${patientName}, your appointment request has been accepted by TopDent Dental Clinic. Here are your confirmed booking details:`,
    detailsHtml: createBookingDetailsHtml(booking, "Approved"),
    closing: "If you need to make changes to your booking, please contact the clinic as soon as possible.<br /><br /><strong>Thank you,<br />TopDent Dental Clinic</strong>",
  });
}

function createSubmittedEmailHtml(booking) {
  const patientName = booking.fullName || "Patient";

  return createEmailShell({
    eyebrow: "TopDent Dental Clinic",
    title: "We received your booking request",
    intro: `Hello ${patientName}, thank you for booking with TopDent Dental Clinic. Your request has been received and is now waiting for clinic approval.`,
    detailsHtml: createBookingDetailsHtml(booking, "Pending review"),
    closing: "We will review your request and send another email once it has been approved. Please wait for confirmation before assuming the appointment is final.<br /><br /><strong>Warm regards,<br />TopDent Dental Clinic</strong>",
  });
}

function createApprovalEmailText(booking) {
  const patientName = booking.fullName || "Patient";
  const service = booking.service || "Dental appointment";
  const dentist = booking.selectedDentist || "Assigned dentist";
  const schedule = formatScheduleLabel(booking);

  return `
Hello ${patientName},

Your appointment request at TopDent Dental Clinic has been approved.

Booking details:
- Service: ${service}
- Schedule: ${schedule}
- Dentist: ${dentist}
- Status: Approved

If you need to make changes to your booking, please contact the clinic as soon as possible.

Thank you,
TopDent Dental Clinic
  `.trim();
}

function createSubmittedEmailText(booking) {
  const patientName = booking.fullName || "Patient";
  const service = booking.service || "Dental appointment";
  const dentist = booking.selectedDentist || "Assigned dentist";
  const schedule = formatScheduleLabel(booking);

  return `
Hello ${patientName},

We received your booking request at TopDent Dental Clinic.

Booking details:
- Service: ${service}
- Schedule: ${schedule}
- Dentist: ${dentist}
- Status: Pending review

We will send another email once your booking has been approved.

Thank you,
TopDent Dental Clinic
  `.trim();
}

function createReminderEmailHtml(booking, reminderLabel) {
  const patientName = booking.fullName || "Patient";

  return createEmailShell({
    eyebrow: "TopDent Appointment Reminder",
    title: `${reminderLabel} reminder`,
    intro: `Hello ${patientName}, this is your ${reminderLabel.toLowerCase()} reminder for your approved appointment at TopDent Dental Clinic.`,
    detailsHtml: createBookingDetailsHtml(booking, "Approved"),
    closing: "Please arrive a little early for your appointment. If you need to reschedule, contact the clinic as soon as possible.<br /><br /><strong>See you soon,<br />TopDent Dental Clinic</strong>",
  });
}

function createReminderEmailText(booking, reminderLabel) {
  const patientName = booking.fullName || "Patient";
  const service = booking.service || "Dental appointment";
  const dentist = booking.selectedDentist || "Assigned dentist";
  const schedule = formatScheduleLabel(booking);

  return `
Hello ${patientName},

This is your ${reminderLabel.toLowerCase()} reminder for your approved appointment at TopDent Dental Clinic.

Booking details:
- Service: ${service}
- Schedule: ${schedule}
- Dentist: ${dentist}
- Status: Approved

Please arrive a little early for your appointment. If you need to reschedule, contact the clinic as soon as possible.

See you soon,
TopDent Dental Clinic
  `.trim();
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeBracesPlanFrequency(value) {
  if (value === "Weekly" || value === "Biweekly" || value === "Monthly") {
    return value;
  }

  return "Monthly";
}

function getBracesDiscountRate(planFrequency = "Monthly") {
  const normalized = normalizeBracesPlanFrequency(planFrequency);
  if (normalized === "Weekly") return 0.03;
  if (normalized === "Biweekly") return 0.025;
  return 0;
}

function getBracesInstallmentCount(planMonths = 0, planFrequency = "Monthly") {
  const normalizedMonths = Math.max(0, Math.round(toNumber(planMonths)));
  const normalized = normalizeBracesPlanFrequency(planFrequency);

  if (normalized === "Weekly") return normalizedMonths * 4;
  if (normalized === "Biweekly") return normalizedMonths * 2;
  return normalizedMonths;
}

function getElapsedBracesCycles(startDate, planFrequency = "Monthly", now = new Date()) {
  if (!startDate) return 0;

  const start = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || start > now) return 0;

  const normalized = normalizeBracesPlanFrequency(planFrequency);
  if (normalized === "Weekly" || normalized === "Biweekly") {
    const diffMs = now.getTime() - start.getTime();
    const cycleDays = normalized === "Weekly" ? 7 : 14;
    return Math.max(0, Math.floor(diffMs / (cycleDays * 24 * 60 * 60 * 1000)));
  }

  let months =
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth());

  if (now.getDate() < start.getDate()) {
    months -= 1;
  }

  return Math.max(0, months);
}

function addBracesCycles(startDate, cycles = 0, planFrequency = "Monthly") {
  if (!startDate) return null;

  const start = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;

  const nextDate = new Date(start);
  const normalized = normalizeBracesPlanFrequency(planFrequency);

  if (normalized === "Weekly") {
    nextDate.setDate(nextDate.getDate() + cycles * 7);
    return nextDate;
  }

  if (normalized === "Biweekly") {
    nextDate.setDate(nextDate.getDate() + cycles * 14);
    return nextDate;
  }

  nextDate.setMonth(nextDate.getMonth() + cycles);
  return nextDate;
}

function summarizeBracesAccount(account = {}, payments = [], now = new Date()) {
  const totalCost = toNumber(account.totalCost);
  const downPaymentExpected = toNumber(account.downPaymentExpected);
  const planFrequency = normalizeBracesPlanFrequency(account.planFrequency || account.paymentSchedule);
  const planMonths = Math.max(0, Math.round(toNumber(account.planCycles || account.planMonths)));
  const installmentCount = getBracesInstallmentCount(planMonths, planFrequency);
  const discountRate = getBracesDiscountRate(planFrequency);
  const discountedInstallmentBase = Math.max(0, totalCost - downPaymentExpected) * (1 - discountRate);
  const installmentAmount =
    installmentCount > 0
      ? discountedInstallmentBase / installmentCount
      : toNumber(account.installmentAmount || account.monthlyAmount);
  const amountPaid = payments.reduce((sum, payment) => sum + toNumber(payment.amount), 0);
  const remainingBalance = Math.max(0, totalCost - amountPaid);
  const cyclesElapsed = getElapsedBracesCycles(account.startDate, planFrequency, now);
  const expectedPaidByNow = Math.min(totalCost, downPaymentExpected + cyclesElapsed * installmentAmount);
  const overdueAmount = Math.max(0, expectedPaidByNow - amountPaid);
  const coveredInstallmentValue = Math.max(0, amountPaid - downPaymentExpected);
  const coveredCycles =
    installmentAmount > 0 ? Math.max(0, Math.floor(coveredInstallmentValue / installmentAmount)) : 0;

  let paymentState = "Payment Plan Ready";
  if (remainingBalance <= 0 && totalCost > 0) {
    paymentState = "Fully Paid";
  } else if (amountPaid <= 0) {
    paymentState = "No Payment Yet";
  } else if (amountPaid >= expectedPaidByNow) {
    paymentState = "On Track";
  } else {
    paymentState = "Overdue";
  }

  let nextDueDate = "";
  if (remainingBalance > 0) {
    if (amountPaid < downPaymentExpected) {
      nextDueDate = account.startDate || "";
    } else {
      const nextDue = addBracesCycles(account.startDate, coveredCycles + 1, planFrequency);
      nextDueDate = nextDue ? nextDue.toISOString().slice(0, 10) : "";
    }
  }

  return {
    amountPaid,
    remainingBalance,
    expectedPaidByNow,
    overdueAmount,
    planFrequency,
    installmentAmount,
    discountRate,
    installmentCount,
    cyclesElapsed,
    paymentState,
    nextDueDate,
  };
}

function createBracesAdjustmentDetailsHtml(adjustment, statusLabel) {
  return `
    <p style="margin: 0 0 10px; color: #475569;"><strong>Adjustment date:</strong> ${adjustment.adjustmentDate || "To be confirmed"}</p>
    <p style="margin: 0 0 10px; color: #475569;"><strong>Adjustment time:</strong> ${adjustment.adjustmentTime || "To be confirmed"}</p>
    <p style="margin: 0 0 10px; color: #475569;"><strong>Dentist:</strong> ${adjustment.dentist || "Assigned dentist"}</p>
    <p style="margin: 0 0 10px; color: #475569;"><strong>Visit note:</strong> ${adjustment.notes || "Braces follow-up adjustment"}</p>
    <p style="margin: 0; color: #475569;"><strong>Status:</strong> ${statusLabel}</p>
  `;
}

function createBracesAdjustmentReminderHtml(adjustment, reminderLabel) {
  const patientName = adjustment.patientName || "Patient";

  return createEmailShell({
    eyebrow: "TopDent Braces Adjustment Reminder",
    title: `${reminderLabel} braces adjustment reminder`,
    intro: `Hello ${patientName}, this is your ${reminderLabel.toLowerCase()} reminder for your braces adjustment visit at TopDent Dental Clinic.`,
    detailsHtml: createBracesAdjustmentDetailsHtml(adjustment, "Scheduled"),
    closing: "Please arrive a little early for your braces adjustment. If you need to reschedule, contact the clinic as soon as possible.<br /><br /><strong>See you soon,<br />TopDent Dental Clinic</strong>",
  });
}

function createBracesAdjustmentReminderText(adjustment, reminderLabel) {
  const patientName = adjustment.patientName || "Patient";

  return `
Hello ${patientName},

This is your ${reminderLabel.toLowerCase()} reminder for your braces adjustment visit at TopDent Dental Clinic.

Adjustment details:
- Date: ${adjustment.adjustmentDate || "To be confirmed"}
- Time: ${adjustment.adjustmentTime || "To be confirmed"}
- Dentist: ${adjustment.dentist || "Assigned dentist"}
- Note: ${adjustment.notes || "Braces follow-up adjustment"}
- Status: Scheduled

Please arrive a little early for your appointment. If you need to reschedule, contact the clinic as soon as possible.

See you soon,
TopDent Dental Clinic
  `.trim();
}

function createBracesPaymentReminderHtml(account, summary) {
  const patientName = account.patientName || "Patient";

  return createEmailShell({
    eyebrow: "TopDent Braces Payment Reminder",
    title: "Your braces payment is overdue",
    intro: `Hello ${patientName}, this is a reminder that your braces payment plan is currently overdue based on the clinic schedule on file.`,
    detailsHtml: `
      <p style="margin: 0 0 10px; color: #475569;"><strong>Payment schedule:</strong> ${summary.planFrequency}</p>
      <p style="margin: 0 0 10px; color: #475569;"><strong>Expected paid by now:</strong> PHP ${summary.expectedPaidByNow.toFixed(2)}</p>
      <p style="margin: 0 0 10px; color: #475569;"><strong>Actual amount paid:</strong> PHP ${summary.amountPaid.toFixed(2)}</p>
      <p style="margin: 0 0 10px; color: #475569;"><strong>Overdue amount:</strong> PHP ${summary.overdueAmount.toFixed(2)}</p>
      <p style="margin: 0; color: #475569;"><strong>Next expected payment date:</strong> ${summary.nextDueDate || "Please contact the clinic"}</p>
    `,
    closing: "Please settle your due amount or contact the clinic if you need help reviewing your braces payment schedule.<br /><br /><strong>Thank you,<br />TopDent Dental Clinic</strong>",
  });
}

function createBracesPaymentReminderText(account, summary) {
  const patientName = account.patientName || "Patient";

  return `
Hello ${patientName},

This is a reminder that your braces payment plan at TopDent Dental Clinic is currently overdue.

Payment details:
- Schedule: ${summary.planFrequency}
- Expected paid by now: PHP ${summary.expectedPaidByNow.toFixed(2)}
- Actual amount paid: PHP ${summary.amountPaid.toFixed(2)}
- Overdue amount: PHP ${summary.overdueAmount.toFixed(2)}
- Next expected payment date: ${summary.nextDueDate || "Please contact the clinic"}

Please settle your due amount or contact the clinic if you need help reviewing your braces payment schedule.

Thank you,
TopDent Dental Clinic
  `.trim();
}

function createTransporter() {
  const senderEmail = gmailEmail.value();
  const senderPassword = gmailAppPassword.value();

  if (!senderEmail || !senderPassword) {
    throw new Error("Missing GMAIL_EMAIL or GMAIL_APP_PASSWORD for booking email.");
  }

  return {
    senderEmail,
    transporter: nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: senderEmail,
        pass: senderPassword,
      },
    }),
  };
}

async function sendReminderWindowEmail({
  booking,
  reminderType,
  reminderLabel,
  sentField,
}) {
  const recipientEmail = String(booking.email || "").trim().toLowerCase();
  if (!recipientEmail) return;
  if (booking.archiveStatus === "Archived") return;
  if (String(booking.status || "").toLowerCase() !== "approved") return;
  if (booking[sentField]) return;

  let mailer;
  try {
    mailer = createTransporter();
  } catch (error) {
    console.error(error.message);
    return;
  }

  await mailer.transporter.sendMail({
    from: mailer.senderEmail,
    to: recipientEmail,
    subject: `TopDent Appointment Reminder: ${reminderLabel}`,
    text: createReminderEmailText(booking, reminderLabel),
    html: createReminderEmailHtml(booking, reminderLabel),
  });

  await db.collection("bookings").doc(booking.id).set(
    {
      [sentField]: admin.firestore.FieldValue.serverTimestamp(),
      latestReminderType: reminderType,
    },
    { merge: true }
  );
}

async function processReminderWindow({
  lowerMinutesAhead,
  upperMinutesAhead,
  sentField,
  reminderType,
  reminderLabel,
}) {
  const now = Date.now();
  const lowerBound = admin.firestore.Timestamp.fromDate(
    new Date(now + lowerMinutesAhead * 60 * 1000)
  );
  const upperBound = admin.firestore.Timestamp.fromDate(
    new Date(now + upperMinutesAhead * 60 * 1000)
  );

  const snapshot = await db
    .collection("bookings")
    .where("status", "==", "approved")
    .where("appointmentAt", ">=", lowerBound)
    .where("appointmentAt", "<=", upperBound)
    .get();

  for (const docSnap of snapshot.docs) {
    await sendReminderWindowEmail({
      booking: { id: docSnap.id, ...docSnap.data() },
      reminderType,
      reminderLabel,
      sentField,
    });
  }
}

async function sendBracesAdjustmentReminderEmail({
  adjustment,
  reminderType,
  reminderLabel,
  sentField,
}) {
  const recipientEmail = String(adjustment.patientEmail || "").trim().toLowerCase();
  const status = String(adjustment.status || "").trim().toLowerCase();
  if (!recipientEmail) return;
  if (status !== "scheduled") return;
  if (adjustment[sentField]) return;

  let mailer;
  try {
    mailer = createTransporter();
  } catch (error) {
    console.error(error.message);
    return;
  }

  await mailer.transporter.sendMail({
    from: mailer.senderEmail,
    to: recipientEmail,
    subject: `TopDent Braces Adjustment Reminder: ${reminderLabel}`,
    text: createBracesAdjustmentReminderText(adjustment, reminderLabel),
    html: createBracesAdjustmentReminderHtml(adjustment, reminderLabel),
  });

  await db.collection("bracesAdjustments").doc(adjustment.id).set(
    {
      [sentField]: admin.firestore.FieldValue.serverTimestamp(),
      latestReminderType: reminderType,
    },
    { merge: true }
  );
}

async function processBracesAdjustmentReminderWindow({
  lowerMinutesAhead,
  upperMinutesAhead,
  sentField,
  reminderType,
  reminderLabel,
}) {
  const now = Date.now();
  const lowerBound = admin.firestore.Timestamp.fromDate(
    new Date(now + lowerMinutesAhead * 60 * 1000)
  );
  const upperBound = admin.firestore.Timestamp.fromDate(
    new Date(now + upperMinutesAhead * 60 * 1000)
  );

  const snapshot = await db
    .collection("bracesAdjustments")
    .where("status", "==", "Scheduled")
    .where("adjustmentAt", ">=", lowerBound)
    .where("adjustmentAt", "<=", upperBound)
    .get();

  for (const docSnap of snapshot.docs) {
    await sendBracesAdjustmentReminderEmail({
      adjustment: { id: docSnap.id, ...docSnap.data() },
      reminderType,
      reminderLabel,
      sentField,
    });
  }
}

async function processOverdueBracesPaymentReminders() {
  const snapshot = await db
    .collection("bracesAccounts")
    .where("planState", "==", "Active")
    .get();

  for (const docSnap of snapshot.docs) {
    const account = { id: docSnap.id, ...docSnap.data() };
    const recipientEmail = String(account.patientEmail || "").trim().toLowerCase();
    if (!recipientEmail) continue;

    const paymentsSnap = await db
      .collection("bracesPayments")
      .where("patientId", "==", account.patientId || docSnap.id)
      .get();

    const payments = paymentsSnap.docs.map((entry) => entry.data());
    const summary = summarizeBracesAccount(account, payments);

    await docSnap.ref.set(
      {
        amountPaid: summary.amountPaid,
        remainingBalance: summary.remainingBalance,
        expectedPaidByNow: summary.expectedPaidByNow,
        overdueAmount: summary.overdueAmount,
        paymentState: summary.paymentState,
        nextDueDate: summary.nextDueDate,
        lastComputedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    if (summary.paymentState !== "Overdue") continue;
    if (account.lastOverdueReminderCycle === summary.cyclesElapsed) continue;

    let mailer;
    try {
      mailer = createTransporter();
    } catch (error) {
      console.error(error.message);
      return;
    }

    await mailer.transporter.sendMail({
      from: mailer.senderEmail,
      to: recipientEmail,
      subject: "TopDent Braces Payment Overdue",
      text: createBracesPaymentReminderText(account, summary),
      html: createBracesPaymentReminderHtml(account, summary),
    });

    await docSnap.ref.set(
      {
        paymentOverdueReminderSentAt: admin.firestore.FieldValue.serverTimestamp(),
        lastOverdueReminderCycle: summary.cyclesElapsed,
      },
      { merge: true }
    );
  }
}

exports.createStaffAccount = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const callerUid = request.auth.uid;
  const callerSnap = await db.collection("admins").doc(callerUid).get();

  if (!callerSnap.exists) {
    throw new HttpsError("permission-denied", "Only admin accounts can create staff.");
  }

  const callerRole = String(callerSnap.data()?.role || "").trim().toLowerCase();
  if (callerRole !== "admin") {
    throw new HttpsError("permission-denied", "Only administrator accounts can create staff.");
  }

  const payload = request.data || {};
  const name = String(payload.name || "").trim();
  const email = String(payload.email || "").trim().toLowerCase();
  const password = String(payload.password || "");
  const role = String(payload.role || "").trim().toLowerCase();

  if (!name) {
    throw new HttpsError("invalid-argument", "Full name is required.");
  }

  if (!email) {
    throw new HttpsError("invalid-argument", "Email is required.");
  }

  if (password.length < 6) {
    throw new HttpsError("invalid-argument", "Password must be at least 6 characters.");
  }

  if (!ALLOWED_ROLES.includes(role)) {
    throw new HttpsError("invalid-argument", "Invalid role.");
  }

  let userRecord;
  try {
    userRecord = await auth.createUser({
      email,
      password,
      displayName: name,
      disabled: false,
    });
  } catch (error) {
    throw new HttpsError("already-exists", error.message || "Could not create auth user.");
  }

  await db.collection("admins").doc(userRecord.uid).set({
    name,
    email,
    role,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: callerUid,
  });

  await writeAuditLog({
    actorUid: callerUid,
    actorName: callerSnap.data()?.name || request.auth.token.email || "Administrator",
    actorEmail: request.auth.token.email || "",
    actorRole: callerRole,
    action: "create_staff_account",
    targetType: "admin_account",
    targetId: userRecord.uid,
    targetLabel: email,
    details: {
      createdRole: role,
      createdName: name,
    },
  });

  return {
    uid: userRecord.uid,
    email,
    role,
    name,
  };
});

exports.getStaffAccounts = onCall(async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be signed in.");
    }

    console.log(`getStaffAccounts called by uid=${request.auth.uid}`);

    const callerSnap = await db.collection("admins").doc(request.auth.uid).get();
    if (!callerSnap.exists) {
      throw new HttpsError("permission-denied", "Only admin accounts can view staff accounts.");
    }

    const callerRole = String(callerSnap.data()?.role || "").trim().toLowerCase();
    if (callerRole !== "admin") {
      throw new HttpsError("permission-denied", "Only administrator accounts can view staff accounts.");
    }

    const snapshot = await db.collection("admins").orderBy("createdAt", "desc").get();
    const accounts = snapshot.docs.map((entry) => serializeAdminDoc(entry.id, entry.data()));

    console.log(`getStaffAccounts returning ${accounts.length} accounts`);
    return accounts;
  } catch (error) {
    console.error("getStaffAccounts failed:", error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError("internal", error?.message || "Could not load staff accounts.");
  }
});

exports.setStaffAccountDisabled = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const callerUid = request.auth.uid;
  const callerSnap = await db.collection("admins").doc(callerUid).get();
  if (!callerSnap.exists) {
    throw new HttpsError("permission-denied", "Only admin accounts can manage staff accounts.");
  }

  const callerRole = String(callerSnap.data()?.role || "").trim().toLowerCase();
  if (callerRole !== "admin") {
    throw new HttpsError("permission-denied", "Only administrator accounts can manage staff accounts.");
  }

  const payload = request.data || {};
  const targetUid = String(payload.uid || "").trim();
  const disabled = Boolean(payload.disabled);

  if (!targetUid) {
    throw new HttpsError("invalid-argument", "Target staff UID is required.");
  }

  await auth.updateUser(targetUid, { disabled });
  await db.collection("admins").doc(targetUid).set({ disabled }, { merge: true });

  const targetSnap = await db.collection("admins").doc(targetUid).get();
  const targetData = targetSnap.exists ? targetSnap.data() : {};

  await writeAuditLog({
    actorUid: callerUid,
    actorName: callerSnap.data()?.name || request.auth.token.email || "Administrator",
    actorEmail: request.auth.token.email || "",
    actorRole: callerRole,
    action: "toggle_staff_account",
    targetType: "admin_account",
    targetId: targetUid,
    targetLabel: targetData?.email || targetData?.name || "Staff account",
    details: {
      disabled,
      role: targetData?.role || "",
    },
  });

  return {
    success: true,
    uid: targetUid,
    disabled,
  };
});

exports.sendApprovedBookingEmail = onDocumentUpdated(
  {
    document: "bookings/{bookingId}",
    secrets: [gmailEmail, gmailAppPassword],
  },
  async (event) => {
    const beforeData = event.data.before.data();
    const afterData = event.data.after.data();

    if (!afterData) return;

    const beforeStatus = String(beforeData?.status || "");
    const afterStatus = String(afterData.status || "");
    const recipientEmail = String(afterData.email || "").trim().toLowerCase();

    if (afterStatus !== "approved" || beforeStatus === "approved") {
      return;
    }

    if (!recipientEmail) {
      console.warn(`Booking ${event.params.bookingId} approved without patient email.`);
      return;
    }

    let mailer;
    try {
      mailer = createTransporter();
    } catch (error) {
      console.error(error.message);
      return;
    }

    await mailer.transporter.sendMail({
      from: mailer.senderEmail,
      to: recipientEmail,
      subject: "TopDent Booking Approved",
      text: createApprovalEmailText(afterData),
      html: createApprovalEmailHtml(afterData),
    });

    await event.data.after.ref.set(
      {
        approvedEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
);

exports.sendSubmittedBookingEmail = onDocumentCreated(
  {
    document: "bookings/{bookingId}",
    secrets: [gmailEmail, gmailAppPassword],
  },
  async (event) => {
    const booking = event.data.data();
    if (!booking) return;

    const recipientEmail = String(booking.email || "").trim().toLowerCase();
    if (!recipientEmail) {
      console.warn(`Booking ${event.params.bookingId} submitted without patient email.`);
      return;
    }

    let mailer;
    try {
      mailer = createTransporter();
    } catch (error) {
      console.error(error.message);
      return;
    }

    await mailer.transporter.sendMail({
      from: mailer.senderEmail,
      to: recipientEmail,
      subject: "TopDent Booking Received",
      text: createSubmittedEmailText(booking),
      html: createSubmittedEmailHtml(booking),
    });

    await event.data.ref.set(
      {
        submittedEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
);

exports.sendDayBeforeBookingReminders = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "Asia/Manila",
    secrets: [gmailEmail, gmailAppPassword],
  },
  async () => {
    await processReminderWindow({
      lowerMinutesAhead: 1425,
      upperMinutesAhead: 1455,
      sentField: "dayBeforeReminderSentAt",
      reminderType: "day_before",
      reminderLabel: "1 day before",
    });
  }
);

exports.sendHourBeforeBookingReminders = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "Asia/Manila",
    secrets: [gmailEmail, gmailAppPassword],
  },
  async () => {
    await processReminderWindow({
      lowerMinutesAhead: 45,
      upperMinutesAhead: 75,
      sentField: "hourBeforeReminderSentAt",
      reminderType: "hour_before",
      reminderLabel: "1 hour before",
    });
  }
);

exports.sendDayBeforeBracesAdjustmentReminders = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "Asia/Manila",
    secrets: [gmailEmail, gmailAppPassword],
  },
  async () => {
    await processBracesAdjustmentReminderWindow({
      lowerMinutesAhead: 1425,
      upperMinutesAhead: 1455,
      sentField: "dayBeforeReminderSentAt",
      reminderType: "day_before",
      reminderLabel: "1 day before",
    });
  }
);

exports.sendHourBeforeBracesAdjustmentReminders = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "Asia/Manila",
    secrets: [gmailEmail, gmailAppPassword],
  },
  async () => {
    await processBracesAdjustmentReminderWindow({
      lowerMinutesAhead: 45,
      upperMinutesAhead: 75,
      sentField: "hourBeforeReminderSentAt",
      reminderType: "hour_before",
      reminderLabel: "1 hour before",
    });
  }
);

exports.sendOverdueBracesPaymentReminders = onSchedule(
  {
    schedule: "every 12 hours",
    timeZone: "Asia/Manila",
    secrets: [gmailEmail, gmailAppPassword],
  },
  async () => {
    await processOverdueBracesPaymentReminders();
  }
);
