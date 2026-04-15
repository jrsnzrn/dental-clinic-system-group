const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const nodemailer = require("nodemailer");

admin.initializeApp();

const db = admin.firestore();
const auth = admin.auth();
const gmailEmail = defineSecret("GMAIL_EMAIL");
const gmailAppPassword = defineSecret("GMAIL_APP_PASSWORD");

const ALLOWED_ROLES = ["admin", "receptionist", "dentist"];

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
