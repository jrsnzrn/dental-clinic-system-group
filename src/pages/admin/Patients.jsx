import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { auth, db } from "../../firebase";
import { useNavigate, useParams } from "react-router-dom";
import ConfirmDialog from "../../components/ConfirmDialog";
import EmptyState from "../../components/EmptyState";
import { SkeletonList } from "../../components/LoadingSkeleton";
import { logAdminAction } from "../../utils/audit";
import {
  buildBracesAccount,
  formatCurrency,
  getBracesAccountForPatient,
  getBracesPaymentsForPatient,
} from "../../utils/braces";
import { buildFullName, splitFullName } from "../../utils/names";
import { buildPatientTimeline, buildTreatmentProgress, getLatestBooking, isInactivePatient, normalizeName } from "../../utils/appointments";
import { formatDateLabel, formatTimeLabel, formatTimestamp } from "../../utils/schedule";
import {
  createEmptyDentalChart,
  DENTAL_CHART_IMAGE,
  TOOTH_IDS,
  TOOTH_LABELS,
  TOOTH_MARKERS,
} from "../../utils/teeth";
import { getAdminProfile, ROLES } from "../../utils/rbac";

const PATIENT_TYPES = ["Regular", "Ortho"];
const TYPE_FILTERS = ["All", ...PATIENT_TYPES];

const PATIENT_VIEWS = {
  DETAILS: "details",
  CHART: "chart",
  PLAN: "plan",
  TIMELINE: "timeline",
};

const RECORD_TABS = [
  { id: PATIENT_VIEWS.DETAILS, label: "Patient Details" },
  { id: PATIENT_VIEWS.CHART, label: "Dental Chart" },
  { id: PATIENT_VIEWS.PLAN, label: "Clinical Plan" },
  { id: PATIENT_VIEWS.TIMELINE, label: "Visit Timeline" },
];

function getEmptyDraft() {
  return {
    id: "",
    firstName: "",
    middleName: "",
    lastName: "",
    name: "",
    age: "",
    phone: "",
    email: "",
    patientType: "Regular",
    status: "Active",
  };
}

function buildDraftFromPatient(patient) {
  const parts = splitFullName(patient.name || "");
  return {
    id: patient.id,
    firstName: patient.firstName || parts.firstName || "",
    middleName: patient.middleName || parts.middleName || "",
    lastName: patient.lastName || parts.lastName || "",
    name: patient.name || "",
    age: patient.age || "",
    phone: patient.phone || "",
    email: patient.email || "",
    patientType: normalizePatientType(patient.patientType),
    status: patient.status || "Active",
  };
}

function getEmptyAddDraft() {
  return {
    firstName: "",
    middleName: "",
    lastName: "",
    age: "",
    phone: "",
    email: "",
    patientType: "Regular",
    preferredDentist: "",
  };
}

function emptyTreatmentDraft() {
  return {
    title: "",
    targetDate: "",
    status: "Planned",
    instructions: "",
    patientSummary: "",
    beforeImageUrl: "",
    afterImageUrl: "",
    patientVisible: false,
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read image file."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load image preview."));
    image.src = src;
  });
}

async function compressImageFile(file) {
  if (!file) return "";

  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  const maxWidth = 800;
  const scale = image.width > maxWidth ? maxWidth / image.width : 1;

  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));

  const context = canvas.getContext("2d");
  if (!context) return dataUrl;

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.65);
}

function emptyCareDraft() {
  return {
    recommendation: "",
    followUpDate: "",
    prescription: "",
  };
}

function getPatientVisibleTreatmentPlans(plans = []) {
  return plans
    .filter((plan) => plan.patientVisible === true)
    .map((plan) => ({
      title: plan.title || "",
      targetDate: plan.targetDate || "",
      status: plan.status || "Planned",
      instructions: plan.patientSummary || plan.instructions || "",
      beforeImageUrl: plan.beforeImageUrl || "",
      afterImageUrl: plan.afterImageUrl || "",
      createdAt: plan.createdAt || "",
    }));
}

function getPatientCareRecommendations(recommendations = []) {
  return recommendations.map((care) => ({
    recommendation: care.recommendation || "",
    followUpDate: care.followUpDate || "",
    prescription: care.prescription || "",
    createdAt: care.createdAt || "",
  }));
}

function getPatientHistory(bookings, patient, options = {}) {
  const { includeArchived = false } = options;

  return bookings
    .filter((booking) => {
      if (patient.uid && booking.uid) return patient.uid === booking.uid;
      return normalizeName(booking.fullName || booking.patientKey) === normalizeName(patient.name);
    })
    .filter((booking) => includeArchived || booking.archiveStatus !== "Archived")
    .sort((a, b) => {
      const aTime = a.appointmentAt?.seconds || a.createdAt?.seconds || 0;
      const bTime = b.appointmentAt?.seconds || b.createdAt?.seconds || 0;
      return bTime - aTime;
    });
}

function getTimestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value.seconds) return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatStatusLabel(status) {
  return String(status || "")
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getStatusClass(status) {
  return String(status || "").toLowerCase().trim().replace(/[\s_]+/g, "-");
}

function normalizePatientType(value) {
  return String(value || "").toLowerCase().includes("ortho") ? "Ortho" : "Regular";
}

async function exportPatientPdf(patient) {
  const nameParts = splitFullName(patient.name || "");
  const firstName = patient.firstName || nameParts.firstName || "";
  const middleName = patient.middleName || nameParts.middleName || "";
  const lastName = patient.lastName || nameParts.lastName || "";
  const latestVisit = patient.latestOverall || patient.latest || null;
  const careRows = (patient.careRecommendations || [])
    .map(
      (care) => `
          <tr>
            <td>${care.recommendation || "No recommendation"}</td>
            <td>${care.followUpDate ? formatDateLabel(care.followUpDate) : "No follow-up date"}</td>
            <td>${care.prescription || "No prescription note"}</td>
          </tr>
        `
    )
    .join("");

  const historyRows = (patient.history || [])
    .map(
      (booking) => `
          <tr>
            <td>${booking.fullName || patient.name || "Not set"}</td>
            <td>${booking.service || "Not set"}</td>
            <td>${formatDateLabel(booking.date)}</td>
            <td>${formatTimeLabel(booking.time)}</td>
            <td>${booking.selectedDentist || "No dentist"}</td>
            <td>${booking.status || "pending"}</td>
            <td>${booking.latestBookedAt ? formatTimestamp(booking.latestBookedAt) : booking.createdAt ? formatTimestamp(booking.createdAt) : "Not logged"}</td>
            <td>${booking.checkedInAt ? formatTimestamp(booking.checkedInAt) : patient.lastCheckedInAt ? formatTimestamp(patient.lastCheckedInAt) : "Not checked in"}</td>
          </tr>
        `
    )
    .join("");

  const progressRows = (patient.progress || [])
    .map(
      (entry) => `
          <tr>
            <td>${entry.service}</td>
            <td>${entry.totalSessions}</td>
            <td>${entry.progressLabel}</td>
            <td>${entry.completionState}</td>
          </tr>
        `
    )
    .join("");

  const treatmentPlanCards = (patient.treatmentPlans || [])
    .map(
      (plan) => `
          <div class="treatment-card">
            <div class="treatment-top">
              <div>
                <div class="label">Procedure</div>
                <strong>${plan.title || "Untitled procedure"}</strong>
              </div>
              <span class="status-chip">${plan.status || "Planned"}</span>
            </div>
            <p class="treatment-copy">${plan.instructions || "No clinical notes added."}</p>
            <div class="treatment-meta">
              <div><span class="label">Target date</span><strong>${plan.targetDate || "No target date"}</strong></div>
            </div>
            ${
              plan.beforeImageUrl || plan.afterImageUrl
                ? `
                  <div class="photo-grid">
                    ${
                      plan.beforeImageUrl
                        ? `
                          <div class="photo-card">
                            <div class="label">Before Photo</div>
                            <img src="${plan.beforeImageUrl}" alt="${plan.title || "Treatment"} before photo" />
                          </div>
                        `
                        : ""
                    }
                    ${
                      plan.afterImageUrl
                        ? `
                          <div class="photo-card">
                            <div class="label">After Photo</div>
                            <img src="${plan.afterImageUrl}" alt="${plan.title || "Treatment"} after photo" />
                          </div>
                        `
                        : ""
                    }
                  </div>
                `
                : ""
            }
          </div>
        `
    )
    .join("");

  let bracesSummary = null;
  if (patient.id) {
    const [bracesAccountsSnap, paymentsSnap] = await Promise.all([
      getDocs(collection(db, "bracesAccounts")),
      getDocs(collection(db, "bracesPayments")),
    ]);
    const bracesAccounts = bracesAccountsSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    const matchedAccount = getBracesAccountForPatient(bracesAccounts, patient);

    if (matchedAccount) {
      const matchingPayments = getBracesPaymentsForPatient(
        paymentsSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() })),
        patient,
        matchedAccount
      );
      bracesSummary = buildBracesAccount(matchedAccount, matchingPayments);
    }
  }

  const bracesPaymentRows = (bracesSummary?.payments || [])
    .map(
      (payment) => `
          <tr>
            <td>${payment.paymentDate ? formatDateLabel(payment.paymentDate) : "No date"}</td>
            <td>${formatCurrency(payment.amount)}</td>
            <td>${payment.method || "Cash"}</td>
            <td>${payment.note || payment.notes || "No note"}</td>
          </tr>
        `
    )
    .join("");

  let dentalChart = createEmptyDentalChart(patient.uid || "");
  if (patient.uid) {
    const chartSnap = await getDoc(doc(db, "dentalCharts", patient.uid));
    if (chartSnap.exists()) {
      dentalChart = {
        uid: patient.uid,
        generalNotes: chartSnap.data().generalNotes || "",
        teeth: chartSnap.data().teeth || {},
      };
    }
  }

  const toothNotes = Object.entries(dentalChart.teeth || {}).filter(([, note]) => String(note || "").trim());
  const chartMarkers = toothNotes
    .map(
      ([tooth]) => `
          <div class="chart-marker" style="top:${TOOTH_MARKERS[tooth]?.top};left:${TOOTH_MARKERS[tooth]?.left};">${tooth}</div>
        `
    )
    .join("");

  const toothNotesRows = toothNotes
    .map(
      ([tooth, note]) => `
          <tr>
            <td>${tooth}</td>
            <td>${TOOTH_LABELS[tooth] || "-"}</td>
            <td>${String(note)}</td>
          </tr>
        `
    )
    .join("");

  const printWindow = window.open("", "_blank", "width=980,height=720");
  if (!printWindow) return false;

  printWindow.document.write(`
      <html>
        <head>
          <title>${patient.name} Patient Record</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 18px; color: #1f2937; }
            h1, h2 { page-break-after: avoid; }
            .header-copy { color: #475569; margin: 8px 0 0; line-height: 1.6; }
            .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 20px 0; }
            .meta.metaWide { grid-template-columns: repeat(3, minmax(0, 1fr)); }
            .card { border: 1px solid #d7e3f4; border-radius: 16px; padding: 14px; }
            .label { font-size: 12px; text-transform: uppercase; color: #64748b; margin-bottom: 6px; }
            table { width: 100%; border-collapse: collapse; margin-top: 18px; }
            th, td { border: 1px solid #d1d5db; padding: 10px; text-align: left; }
            th { background: #eff6ff; }
            .chart-wrap { position: relative; margin-top: 18px; border: 1px solid #d7e3f4; border-radius: 18px; overflow: hidden; }
            .chart-wrap img { width: 100%; display: block; }
            .chart-marker { position: absolute; transform: translate(-50%, -50%); min-width: 34px; height: 34px; border-radius: 999px; background: rgba(11, 18, 32, 0.88); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; }
            .section { margin-top: 22px; }
            .treatment-stack { display: grid; gap: 14px; margin-top: 14px; }
            .treatment-card { border: 1px solid #d7e3f4; border-radius: 18px; padding: 14px; background: linear-gradient(180deg, #ffffff, #f8fbff); page-break-inside: avoid; }
            .treatment-top { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
            .treatment-copy { margin: 10px 0 0; line-height: 1.6; color: #475569; }
            .treatment-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 12px; }
            .status-chip { display: inline-flex; align-items: center; justify-content: center; min-height: 28px; padding: 4px 10px; border-radius: 999px; background: #e0f2fe; color: #0f172a; font-size: 12px; font-weight: 700; }
            .photo-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-top: 14px; }
            .photo-card { border: 1px solid #dbe6f5; border-radius: 16px; padding: 10px; background: #fff; }
            .photo-card img { width: 100%; height: auto; max-height: 260px; object-fit: cover; border-radius: 12px; display: block; }
            .summary-banner { border: 1px solid #d7e3f4; border-radius: 22px; padding: 18px; background: linear-gradient(135deg, #fff8e8, #ffffff); }
            .summary-title { margin: 0; font-size: 28px; }
            .summary-sub { margin: 8px 0 0; color: #475569; }
            @media print {
              body { padding: 10px; }
              .photo-card img { max-height: 220px; }
            }
          </style>
        </head>
        <body>
          <div class="summary-banner">
            <h1 class="summary-title">TopDent Patient Record</h1>
            <p class="summary-sub">Updated clinic summary including patient identity, appointments, follow-up notes, braces payments, and dental chart details.</p>
          </div>
          <div class="section">
            <h2>Patient Summary</h2>
            <div class="meta metaWide">
              <div class="card"><div class="label">Last name</div><strong>${lastName || "-"}</strong></div>
              <div class="card"><div class="label">First name</div><strong>${firstName || "-"}</strong></div>
              <div class="card"><div class="label">Middle name</div><strong>${middleName || "-"}</strong></div>
            </div>
          </div>
      <div class="meta">
            <div class="card"><div class="label">Full name</div><strong>${patient.name || "-"}</strong></div>
            <div class="card"><div class="label">Age</div><strong>${patient.age || "-"}</strong></div>
            <div class="card"><div class="label">Phone</div><strong>${patient.phone || "-"}</strong></div>
            <div class="card"><div class="label">Email</div><strong>${patient.email || "-"}</strong></div>
            <div class="card"><div class="label">Patient type</div><strong>${normalizePatientType(patient.patientType)}</strong></div>
            <div class="card"><div class="label">Record status</div><strong>${patient.status || "Active"}</strong></div>
            <div class="card"><div class="label">Preferred dentist</div><strong>${patient.preferredDentist || latestVisit?.selectedDentist || "No dentist yet"}</strong></div>
            <div class="card"><div class="label">Latest service</div><strong>${patient.latestService || latestVisit?.service || "No service yet"}</strong></div>
            <div class="card"><div class="label">Last visit day</div><strong>${patient.lastAppointmentDate ? formatDateLabel(patient.lastAppointmentDate) : latestVisit?.date ? formatDateLabel(latestVisit.date) : "No visit yet"}</strong></div>
            <div class="card"><div class="label">Booked at</div><strong>${patient.latestBookedAt ? formatTimestamp(patient.latestBookedAt) : "No booking timestamp"}</strong></div>
            <div class="card"><div class="label">Checked in at</div><strong>${patient.lastCheckedInAt ? formatTimestamp(patient.lastCheckedInAt) : "Not checked in"}</strong></div>
            <div class="card"><div class="label">Approved visits</div><strong>${patient.totalApproved || 0}</strong></div>
          </div>
          <h2>Appointment History</h2>
          <table>
            <thead><tr><th>Patient</th><th>Service</th><th>Date</th><th>Time</th><th>Dentist</th><th>Status</th><th>Booked at</th><th>Checked in at</th></tr></thead>
            <tbody>${historyRows || '<tr><td colspan="8">No appointment history yet.</td></tr>'}</tbody>
          </table>
          <h2>Treatment Progress</h2>
          <table>
            <thead><tr><th>Service</th><th>Sessions</th><th>Progress</th><th>State</th></tr></thead>
            <tbody>${progressRows || '<tr><td colspan="4">No treatment progress yet.</td></tr>'}</tbody>
          </table>
          <div class="section">
            <h2>Care Recommendations</h2>
            <table>
              <thead><tr><th>Recommendation</th><th>Follow-up date</th><th>Prescription / Note</th></tr></thead>
              <tbody>${careRows || '<tr><td colspan="3">No care recommendations saved yet.</td></tr>'}</tbody>
            </table>
          </div>
          ${
            bracesSummary
              ? `
                <div class="section">
                  <h2>Braces Payment Summary</h2>
                  <div class="meta metaWide">
                    <div class="card"><div class="label">Plan state</div><strong>${bracesSummary.planState || "Active"}</strong></div>
                    <div class="card"><div class="label">Payment status</div><strong>${bracesSummary.paymentState || "Payment Plan Ready"}</strong></div>
                    <div class="card"><div class="label">Start date</div><strong>${bracesSummary.startDate ? formatDateLabel(bracesSummary.startDate) : "No start date"}</strong></div>
                    <div class="card"><div class="label">Total treatment cost</div><strong>${formatCurrency(bracesSummary.totalCost)}</strong></div>
                    <div class="card"><div class="label">Expected down payment</div><strong>${formatCurrency(bracesSummary.downPaymentExpected)}</strong></div>
                    <div class="card"><div class="label">Monthly payment</div><strong>${formatCurrency(bracesSummary.monthlyAmount)}</strong></div>
                    <div class="card"><div class="label">Plan duration</div><strong>${bracesSummary.planMonths || 0} months</strong></div>
                    <div class="card"><div class="label">Amount paid</div><strong>${formatCurrency(bracesSummary.amountPaid)}</strong></div>
                    <div class="card"><div class="label">Remaining balance</div><strong>${formatCurrency(bracesSummary.remainingBalance)}</strong></div>
                    <div class="card"><div class="label">Expected by now</div><strong>${formatCurrency(bracesSummary.expectedPaidByNow)}</strong></div>
                    <div class="card"><div class="label">Progress</div><strong>${bracesSummary.progressPercent || 0}% paid</strong></div>
                    <div class="card"><div class="label">Plan notes</div><strong>${bracesSummary.notes || "No braces notes saved."}</strong></div>
                  </div>
                  <table>
                    <thead><tr><th>Payment date</th><th>Amount</th><th>Method</th><th>Note</th></tr></thead>
                    <tbody>${bracesPaymentRows || '<tr><td colspan="4">No braces payments logged yet.</td></tr>'}</tbody>
                  </table>
                </div>
              `
              : ""
          }
          <div class="section">
            <h2>Procedure Roadmap</h2>
            <div class="treatment-stack">${treatmentPlanCards || '<div class="card">No procedure plans saved yet.</div>'}</div>
          </div>
          <h2>Dental Chart</h2>
          <div class="chart-wrap">
            <img src="${DENTAL_CHART_IMAGE}" alt="Dental numbering system chart" />
            ${chartMarkers}
          </div>
          <table>
            <thead><tr><th>Tooth</th><th>Description</th><th>Dentist Note</th></tr></thead>
            <tbody>${toothNotesRows || '<tr><td colspan="3">No tooth-specific notes saved yet.</td></tr>'}</tbody>
          </table>
          <div class="card" style="margin-top:18px;">
            <div class="label">General dentist notes</div>
            <strong>${dentalChart.generalNotes || "No general notes saved yet."}</strong>
          </div>
          <script>window.onload=()=>setTimeout(()=>window.print(),250);</script>
        </body>
      </html>
    `);
  printWindow.document.close();
  return true;
}

export default function Patients() {
  const navigate = useNavigate();
  const { patientId = "" } = useParams();
  const patientListScrollPosition = useRef(0);
  const wasPatientDetails = useRef(Boolean(patientId));
  const [patients, setPatients] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [dentistProfiles, setDentistProfiles] = useState([]);
  const selectedPatientId = patientId;
  const [draft, setDraft] = useState(getEmptyDraft());
  const [isEditing, setIsEditing] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const [notice, setNotice] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [addOpen, setAddOpen] = useState(false);
  const [addDraft, setAddDraft] = useState(getEmptyAddDraft());
  const [addSaving, setAddSaving] = useState(false);
  const [chartDraft, setChartDraft] = useState(createEmptyDentalChart());
  const [selectedTeeth, setSelectedTeeth] = useState([]);
  const [hoveredTooth, setHoveredTooth] = useState("");
  const [adminRole, setAdminRole] = useState(ROLES.ADMIN);
  const [loadingPatients, setLoadingPatients] = useState(true);
  const [confirmState, setConfirmState] = useState(null);
  const [treatmentDraft, setTreatmentDraft] = useState(emptyTreatmentDraft());
  const [careDraft, setCareDraft] = useState(emptyCareDraft());
  const [activePatientView, setActivePatientView] = useState(PATIENT_VIEWS.DETAILS);
  const [currentDentistIdentity, setCurrentDentistIdentity] = useState({
    uid: "",
    email: "",
  });

  function toggleToothSelection(tooth) {
    setSelectedTeeth((current) => {
      if (current.includes(tooth)) {
        return current.filter((entry) => entry !== tooth);
      }

      return [...current, tooth];
    });
  }

  async function load(role = adminRole) {
    const [patientsResult, bookingsResult, dentistsResult] = await Promise.allSettled([
      getDocs(query(collection(db, "patients"), orderBy("createdAt", "desc"))),
      role === ROLES.DENTIST ? Promise.resolve({ docs: [] }) : getDocs(collection(db, "bookings")),
      getDocs(collection(db, "dentists")),
    ]);

    const patientList =
      patientsResult.status === "fulfilled"
        ? patientsResult.value.docs.map((entry) => ({ id: entry.id, ...entry.data() }))
        : [];
    const bookingList =
      bookingsResult.status === "fulfilled"
        ? bookingsResult.value.docs.map((entry) => ({ id: entry.id, ...entry.data() }))
        : [];
    const nextDentistProfiles =
      dentistsResult.status === "fulfilled"
        ? dentistsResult.value.docs.map((entry) => ({
            id: entry.id,
            ...entry.data(),
          }))
        : [];

    setPatients(patientList);
    setBookings(bookingList);
    setDentistProfiles(nextDentistProfiles);

    setLoadingPatients(false);
  }

  useEffect(() => {
    async function loadAdminRole() {
      const currentUser = auth.currentUser;
      if (!currentUser) return;
      setCurrentDentistIdentity({
        uid: currentUser.uid,
        email: String(currentUser.email || "").trim().toLowerCase(),
      });

      const adminSnap = await getDoc(doc(db, "admins", currentUser.uid));
      if (adminSnap.exists()) {
        const role = getAdminProfile(adminSnap.data()).role;
        setAdminRole(role);
        await load(role);
      }
    }

    loadAdminRole();
  }, []);

  const linkedDentistProfile = useMemo(() => {
    if (adminRole !== ROLES.DENTIST) return null;

    return (
      dentistProfiles.find((dentist) => dentist.linkedStaffUid === currentDentistIdentity.uid) ||
      dentistProfiles.find(
        (dentist) =>
          String(dentist.linkedStaffEmail || "").trim().toLowerCase() === currentDentistIdentity.email
      ) ||
      null
    );
  }, [adminRole, currentDentistIdentity.email, currentDentistIdentity.uid, dentistProfiles]);

  const patientCards = useMemo(() => {
    const filteredBookings = bookings;

    return patients
      .filter((patient) => patient.status !== "Archived")
      .map((patient) => {
        const history = getPatientHistory(filteredBookings, patient);
        const allHistory = getPatientHistory(filteredBookings, patient, { includeArchived: true });
        const latest = getLatestBooking(history);
        const latestOverall = getLatestBooking(allHistory);

        return {
          ...patient,
          history,
          allHistory,
          latest,
          latestOverall,
          inactiveFlag: isInactivePatient(patient, latest),
          progress: buildTreatmentProgress(history),
          timeline: buildPatientTimeline(allHistory),
        };
      })
      .filter((patient) => {
        if (adminRole !== ROLES.DENTIST) return true;
        if (!linkedDentistProfile?.name) return false;

        return normalizeName(patient.preferredDentist) === normalizeName(linkedDentistProfile.name);
      });
  }, [adminRole, bookings, linkedDentistProfile?.name, patients]);

  const filteredPatientCards = useMemo(() => {
    const term = normalizeName(search);

    return patientCards.filter((patient) => {
      if (typeFilter !== "All" && normalizePatientType(patient.patientType) !== typeFilter) return false;
      if (!term) return true;
      return normalizeName(patient.name).includes(term);
    });
  }, [patientCards, search, typeFilter]);

  const selectedPatient = useMemo(
    () => patientCards.find((patient) => patient.id === selectedPatientId) || null,
    [patientCards, selectedPatientId]
  );

  const sortedTimeline = useMemo(() => {
    if (!selectedPatient) return [];
    return [...(selectedPatient.timeline || [])].sort(
      (a, b) => getTimestampMillis(a.timestamp) - getTimestampMillis(b.timestamp)
    );
  }, [selectedPatient]);

  const bookingSummary = useMemo(() => {
    const history = selectedPatient?.allHistory || [];
    const counts = new Map();
    history.forEach((booking) => {
      const name = booking.service || "Service not set";
      counts.set(name, (counts.get(name) || 0) + 1);
    });
    const latest = selectedPatient?.latestOverall || null;

    return {
      total: history.length,
      services: [...counts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      recent: history.slice(0, 8),
      latestService: latest?.service || "No bookings yet",
      lastVisit: latest?.date ? formatDateLabel(latest.date) : "No visit yet",
      dentist: selectedPatient?.preferredDentist || latest?.selectedDentist || "No dentist yet",
    };
  }, [selectedPatient]);

  useEffect(() => {
    if (!addOpen) return undefined;
    function handleKey(e) {
      if (e.key === "Escape") setAddOpen(false);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [addOpen]);

  useEffect(() => {
    if (!notice || notice.type !== "success") return undefined;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    setActivePatientView(PATIENT_VIEWS.DETAILS);
  }, [selectedPatientId]);

  useLayoutEffect(() => {
    if (patientId) {
      window.scrollTo(0, 0);
      wasPatientDetails.current = true;
    } else if (wasPatientDetails.current) {
      window.scrollTo(0, patientListScrollPosition.current);
      wasPatientDetails.current = false;
    }
  }, [patientId]);

  useEffect(() => {
    if (!selectedPatient) {
      setDraft(getEmptyDraft());
      setIsEditing(false);
      setChartDraft(createEmptyDentalChart());
      setSelectedTeeth([]);
      setHoveredTooth("");
      setTreatmentDraft(emptyTreatmentDraft());
      setCareDraft(emptyCareDraft());
      setActivePatientView(PATIENT_VIEWS.DETAILS);
      return;
    }

    setSelectedTeeth([]);
    setHoveredTooth("");
    setDraft(buildDraftFromPatient(selectedPatient));
    setTreatmentDraft(emptyTreatmentDraft());
    setCareDraft(emptyCareDraft());

    async function loadDentalChart() {
      if (!selectedPatient.uid) {
        setChartDraft(createEmptyDentalChart());
        return;
      }

      const chartSnap = await getDoc(doc(db, "dentalCharts", selectedPatient.uid));
      if (chartSnap.exists()) {
        setChartDraft({
          uid: selectedPatient.uid,
          generalNotes: chartSnap.data().generalNotes || "",
          teeth: chartSnap.data().teeth || {},
        });
      } else {
        setChartDraft(createEmptyDentalChart(selectedPatient.uid));
      }
    }

    loadDentalChart();
  }, [selectedPatient?.id]);

  function openPatientRecord(patientId) {
    setNotice(null);
    setIsEditing(false);
    setActivePatientView(PATIENT_VIEWS.DETAILS);
    patientListScrollPosition.current = window.scrollY;
    navigate(`/admin/patients/${encodeURIComponent(patientId)}`);
  }

  function closePatientRecord() {
    setIsEditing(false);
    navigate("/admin/patients");
  }

  function startEditing() {
    if (!selectedPatient) return;
    setNotice(null);
    setDraft(buildDraftFromPatient(selectedPatient));
    setActivePatientView(PATIENT_VIEWS.DETAILS);
    setIsEditing(true);
  }

  function cancelEditing() {
    if (selectedPatient) setDraft(buildDraftFromPatient(selectedPatient));
    setNotice(null);
    setIsEditing(false);
  }

  function updateDraft(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateAddDraft(key, value) {
    setAddDraft((current) => ({ ...current, [key]: value }));
  }

  async function addPatient(e) {
    e.preventDefault();
    if (addSaving || !addDraft.firstName.trim() || !addDraft.lastName.trim()) return;

    setAddSaving(true);

    try {
      const fullName = buildFullName(addDraft);
      const created = await addDoc(collection(db, "patients"), {
        firstName: addDraft.firstName.trim(),
        middleName: addDraft.middleName.trim(),
        lastName: addDraft.lastName.trim(),
        name: fullName,
        age: String(addDraft.age).trim(),
        phone: addDraft.phone.trim(),
        email: addDraft.email.trim(),
        patientType: addDraft.patientType,
        preferredDentist: addDraft.preferredDentist,
        status: "Active",
        createdAt: serverTimestamp(),
      });

      await logAdminAction({
        action: "add_patient",
        targetType: "patient",
        targetId: created.id,
        targetLabel: fullName,
        details: { patientType: addDraft.patientType },
      });

      setAddOpen(false);
      setAddDraft(getEmptyAddDraft());
      setNotice({ type: "success", text: `${fullName} was added to the patient list.` });
      await load();
    } catch (error) {
      console.error(error);
      setNotice({ type: "error", text: "Could not add the patient. Please try again." });
    } finally {
      setAddSaving(false);
    }
  }

  async function savePatientDetails(e) {
    e.preventDefault();
    if (savingDetails || !draft.id) return;

    if (!draft.firstName.trim() || !draft.lastName.trim()) {
      setNotice({ type: "error", text: "First name and last name are required." });
      return;
    }

    setSavingDetails(true);
    setNotice(null);

    try {
      const fullName = buildFullName(draft);

      await updateDoc(doc(db, "patients", draft.id), {
        firstName: draft.firstName.trim(),
        middleName: draft.middleName.trim(),
        lastName: draft.lastName.trim(),
        name: fullName,
        age: String(draft.age).trim(),
        phone: draft.phone.trim(),
        email: draft.email.trim(),
        patientType: draft.patientType,
        status: draft.status,
      });

      if (selectedPatient?.uid) {
        await setDoc(
          doc(db, "patientProfiles", selectedPatient.uid),
          {
            firstName: draft.firstName.trim(),
            middleName: draft.middleName.trim(),
            lastName: draft.lastName.trim(),
            fullName: fullName,
            age: String(draft.age).trim(),
            phone: draft.phone.trim(),
            email: draft.email.trim(),
            patientType: draft.patientType,
          },
          { merge: true }
        );
      }

      await logAdminAction({
        action: "update_patient_profile",
        targetType: "patient",
        targetId: draft.id,
        targetLabel: fullName,
        details: {
          patientType: draft.patientType,
          status: draft.status,
        },
      });

      await load();
      setIsEditing(false);
      setNotice({ type: "success", text: "Patient details saved." });
    } catch (error) {
      console.error(error);
      setNotice({ type: "error", text: "Could not save changes. Please try again." });
    } finally {
      setSavingDetails(false);
    }
  }

  async function saveDentalChart() {
    if (!selectedPatient?.uid) return;

    await setDoc(
      doc(db, "dentalCharts", selectedPatient.uid),
      {
        uid: selectedPatient.uid,
        patientName: selectedPatient.name || "",
        patientEmail: selectedPatient.email || "",
        generalNotes: chartDraft.generalNotes || "",
        teeth: chartDraft.teeth || {},
        toothConditions: chartDraft.toothConditions || {},
      },
      { merge: true }
    );

    await logAdminAction({
      action: "save_dental_chart",
      targetType: "dental_chart",
      targetId: selectedPatient.uid,
      targetLabel: selectedPatient.name || selectedPatient.email || "Dental chart",
      details: {
        selectedTeeth,
        generalNotesLength: String(chartDraft.generalNotes || "").length,
      },
    });

    await load();
    setNotice({ type: "success", text: "Dental chart notes saved." });
  }

  async function addTreatmentPlan() {
    if (!selectedPatient || !treatmentDraft.title.trim()) return;
    const nextPlans = [
      ...(selectedPatient.treatmentPlans || []),
      {
        ...treatmentDraft,
        title: treatmentDraft.title.trim(),
        instructions: treatmentDraft.instructions.trim(),
        patientSummary: treatmentDraft.patientSummary.trim(),
        createdAt: new Date().toISOString(),
      },
    ];

    await updateDoc(doc(db, "patients", selectedPatient.id), {
      treatmentPlans: nextPlans,
    });
    await publishPatientRecord(nextPlans, selectedPatient.careRecommendations || []);

    await logAdminAction({
      action: "add_treatment_plan",
      targetType: "patient",
      targetId: selectedPatient.id,
      targetLabel: selectedPatient.name || "Patient",
      details: { title: treatmentDraft.title.trim(), targetDate: treatmentDraft.targetDate || "" },
    });

    setTreatmentDraft(emptyTreatmentDraft());
    await load();
  }

  async function publishPatientRecord(treatmentPlans, careRecommendations) {
    if (!selectedPatient?.uid) return;

    await setDoc(
      doc(db, "dentalCharts", selectedPatient.uid),
      {
        uid: selectedPatient.uid,
        patientName: selectedPatient.name || "",
        patientEmail: selectedPatient.email || "",
        patientTreatmentPlans: getPatientVisibleTreatmentPlans(treatmentPlans),
        patientCareRecommendations: getPatientCareRecommendations(careRecommendations),
      },
      { merge: true }
    );
  }

  async function syncPatientPortalRecord() {
    if (!selectedPatient) return;

    await publishPatientRecord(selectedPatient.treatmentPlans || [], selectedPatient.careRecommendations || []);

    await logAdminAction({
      action: "sync_patient_portal_record",
      targetType: "patient",
      targetId: selectedPatient.id,
      targetLabel: selectedPatient.name || "Patient",
      details: {
        visibleTreatmentPlans: getPatientVisibleTreatmentPlans(selectedPatient.treatmentPlans || []).length,
        careRecommendations: (selectedPatient.careRecommendations || []).length,
      },
    });

    await load();
  }

  async function setTreatmentPlanPatientVisible(indexToUpdate, patientVisible) {
    if (!selectedPatient) return;
    const nextPlans = (selectedPatient.treatmentPlans || []).map((plan, index) =>
      index === indexToUpdate
        ? {
            ...plan,
            patientVisible,
          }
        : plan
    );

    await updateDoc(doc(db, "patients", selectedPatient.id), {
      treatmentPlans: nextPlans,
    });
    await publishPatientRecord(nextPlans, selectedPatient.careRecommendations || []);

    await logAdminAction({
      action: patientVisible ? "share_treatment_plan_with_patient" : "hide_treatment_plan_from_patient",
      targetType: "patient",
      targetId: selectedPatient.id,
      targetLabel: selectedPatient.name || "Patient",
      details: { updatedIndex: indexToUpdate },
    });

    await load();
  }

  async function removeTreatmentPlan(indexToRemove) {
    if (!selectedPatient) return;
    const nextPlans = (selectedPatient.treatmentPlans || []).filter((_, index) => index !== indexToRemove);

    await updateDoc(doc(db, "patients", selectedPatient.id), {
      treatmentPlans: nextPlans,
    });
    await publishPatientRecord(nextPlans, selectedPatient.careRecommendations || []);

    await logAdminAction({
      action: "remove_treatment_plan",
      targetType: "patient",
      targetId: selectedPatient.id,
      targetLabel: selectedPatient.name || "Patient",
      details: { removedIndex: indexToRemove },
    });

    await load();
  }

  async function clearTreatmentPlanImages(indexToUpdate) {
    if (!selectedPatient) return;
    const nextPlans = (selectedPatient.treatmentPlans || []).map((plan, index) =>
      index === indexToUpdate
        ? {
            ...plan,
            beforeImageUrl: "",
            afterImageUrl: "",
          }
        : plan
    );

    await updateDoc(doc(db, "patients", selectedPatient.id), {
      treatmentPlans: nextPlans,
    });
    await publishPatientRecord(nextPlans, selectedPatient.careRecommendations || []);

    await logAdminAction({
      action: "clear_treatment_plan_images",
      targetType: "patient",
      targetId: selectedPatient.id,
      targetLabel: selectedPatient.name || "Patient",
      details: { updatedIndex: indexToUpdate },
    });

    await load();
  }

  async function handleTreatmentImageUpload(field, file) {
    if (!file) return;

    const optimizedImage = await compressImageFile(file);
    setTreatmentDraft((current) => ({
      ...current,
      [field]: optimizedImage,
    }));
  }

  async function addCareRecommendation() {
    if (!selectedPatient || !careDraft.recommendation.trim()) return;
    const nextRecommendations = [
      ...(selectedPatient.careRecommendations || []),
      {
        ...careDraft,
        recommendation: careDraft.recommendation.trim(),
        createdAt: new Date().toISOString(),
      },
    ];

    await updateDoc(doc(db, "patients", selectedPatient.id), {
      careRecommendations: nextRecommendations,
    });
    await publishPatientRecord(selectedPatient.treatmentPlans || [], nextRecommendations);

    await logAdminAction({
      action: "add_care_recommendation",
      targetType: "patient",
      targetId: selectedPatient.id,
      targetLabel: selectedPatient.name || "Patient",
      details: { followUpDate: careDraft.followUpDate || "" },
    });

    setCareDraft(emptyCareDraft());
    await load();
  }

  async function removeCareRecommendation(indexToRemove) {
    if (!selectedPatient) return;
    const nextRecommendations = (selectedPatient.careRecommendations || []).filter((_, index) => index !== indexToRemove);

    await updateDoc(doc(db, "patients", selectedPatient.id), {
      careRecommendations: nextRecommendations,
    });
    await publishPatientRecord(selectedPatient.treatmentPlans || [], nextRecommendations);

    await logAdminAction({
      action: "remove_care_recommendation",
      targetType: "patient",
      targetId: selectedPatient.id,
      targetLabel: selectedPatient.name || "Patient",
      details: { removedIndex: indexToRemove },
    });

    await load();
  }

  async function toggleArchive(patient) {
    await updateDoc(doc(db, "patients", patient.id), {
      status: patient.status === "Archived" ? "Active" : "Archived",
    });

    await logAdminAction({
      action: patient.status === "Archived" ? "restore_patient" : "archive_patient",
      targetType: "patient",
      targetId: patient.id,
      targetLabel: patient.name || patient.email || "Patient",
    });

    await load();
  }

  // Archive only changes the status. The patient's bookings, chart and plans stay in the database.
  async function archiveFromRecord(patient) {
    try {
      await toggleArchive(patient);
      setIsEditing(false);
      navigate("/admin/patients");
      setNotice({ type: "success", text: `${patient.name || "Patient"} was moved to the archive.` });
    } catch (error) {
      console.error(error);
      setNotice({ type: "error", text: "Could not archive this patient. Please try again." });
    }
  }

  function openConfirm(config) {
    setConfirmState(config);
  }

  async function handleConfirmAction() {
    if (!confirmState?.action) return;
    const action = confirmState.action;
    setConfirmState(null);
    await action();
  }

  async function handleDownloadPdf() {
    if (!selectedPatient || pdfBusy) return;
    setPdfBusy(true);
    try {
      const opened = await exportPatientPdf(selectedPatient);
      if (!opened) {
        setNotice({ type: "error", text: "The PDF window was blocked. Allow pop-ups for this site and try again." });
      }
    } catch (error) {
      console.error(error);
      setNotice({ type: "error", text: "Could not generate the PDF. Please try again." });
    } finally {
      setPdfBusy(false);
    }
  }

  const focusedTooth = hoveredTooth || selectedTeeth[selectedTeeth.length - 1] || "";
  const selectedToothValues = selectedTeeth.map((tooth) => chartDraft.teeth?.[tooth] || "");
  const selectedToothConditions = selectedTeeth.map((tooth) => chartDraft.toothConditions?.[tooth] || "healthy");
  const selectedToothEntries = selectedTeeth.map((tooth) => ({
    tooth,
    label: TOOTH_LABELS[tooth],
    note: chartDraft.teeth?.[tooth] || "",
    condition: chartDraft.toothConditions?.[tooth] || "healthy",
  }));
  const selectedToothComment = selectedToothValues.every((note) => note === selectedToothValues[0])
    ? selectedToothValues[0] || ""
    : "";
  const selectedToothCondition = selectedToothConditions.every((value) => value === selectedToothConditions[0])
    ? selectedToothConditions[0]
    : "healthy";
  const isDentist = adminRole === ROLES.DENTIST;
  const canEditDentalChart = adminRole === ROLES.ADMIN || adminRole === ROLES.DENTIST;
  const canEditPatientProfile = adminRole === ROLES.ADMIN || adminRole === ROLES.RECEPTIONIST;

  const patientStatus = selectedPatient?.status || "Active";

  return (
    <div className="container adminSurface">
      {notice ? (
        <div className={`notice notice-${notice.type}`} role={notice.type === "error" ? "alert" : "status"}>
          <span>{notice.text}</span>
          <button type="button" className="noticeClose" aria-label="Dismiss message" onClick={() => setNotice(null)}>
            &times;
          </button>
        </div>
      ) : null}

      {/* ---------------- Patient list ---------------- */}
      {!patientId ? (
      <div className="patientListPage">
        <section className="panel patientListPanel">
          <div className="panelHead patientPanelHead">
            <div className="patientPanelIntro">
              <h2 className="panelTitle">Patient Records</h2>
              <p className="panelSub">Select a patient to open their record.</p>
              <span className="countLabel">{filteredPatientCards.length} records</span>
            </div>
            <div className="patientToolbar">
              <div className="topSearchBar">
                <svg className="topSearchIcon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <input
                  className="input topSearchInput"
                  placeholder="Search patient name"
                  aria-label="Search patients by name"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search ? (
                  <button type="button" className="searchClearBtn" onClick={() => setSearch("")}>
                    Clear
                  </button>
                ) : null}
              </div>

              <div className="patientTypeFilter">
                <select
                  className="input typeSelect"
                  aria-label="Filter by patient type"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                >
                  {TYPE_FILTERS.map((filter) => (
                    <option key={filter} value={filter}>{filter}</option>
                  ))}
                </select>
              </div>

              {canEditPatientProfile ? (
                <button type="button" className="btn btnPrimary" onClick={() => setAddOpen(true)}>
                  Add New Patient
                </button>
              ) : null}
            </div>
          </div>

          {loadingPatients ? (
            <SkeletonList count={3} />
          ) : filteredPatientCards.length ? (
            <div className="patientTableWrap">
              <table className="patientTable">
                <thead>
                  <tr>
                    <th>Patient Name</th>
                    <th>Email</th>
                    <th>Type of Patient</th>
                    <th>Age</th>
                    <th>Contact Number</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPatientCards.map((patient) => {
                    const type = normalizePatientType(patient.patientType);
                    return (
                      <tr
                        key={patient.id}
                        className="patientRow"
                        tabIndex={0}
                        onClick={() => openPatientRecord(patient.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openPatientRecord(patient.id);
                          }
                        }}
                      >
                        <td data-label="Patient Name">
                          <span className="patientName">{patient.name || "Unnamed patient"}</span>
                        </td>
                        <td data-label="Email">{patient.email || "—"}</td>
                        <td data-label="Type of Patient">
                          <span className={`typeBadge ${type === "Ortho" ? "ortho" : "regular"}`}>{type}</span>
                        </td>
                        <td data-label="Age">{patient.age || "-"}</td>
                        <td data-label="Contact Number">{patient.phone || "No number"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title={isDentist ? "No patients available yet" : "No matching patient records"}
              message={
                isDentist
                  ? "Patients will appear here once approved records are available for dentist review."
                  : "Try another patient name or clear the search to see the full active list."
              }
            />
          )}
        </section>
      </div>
      ) : null}

      {/* ---------------- Patient record workspace ---------------- */}
      {patientId ? (
        <main className="patientDetailsPage">
          <div className="recordPage">
            <button type="button" className="backLink" onClick={closePatientRecord}>
              Back to Patients
            </button>
          {loadingPatients && !selectedPatient ? (
            <SkeletonList count={2} />
          ) : !selectedPatient ? (
            <EmptyState
              title="Patient not found"
              message="This patient may have been archived or is no longer available. Return to the patient list to choose another record."
            />
          ) : (
            <>
              <header className="recordHeader">
                <div className="recordIdentity">
                  <h1 className="recordName">{selectedPatient.name || "Unnamed patient"}</h1>
                  <div className="recordBadges">
                    <span className={`typeBadge ${normalizePatientType(selectedPatient.patientType) === "Ortho" ? "ortho" : "regular"}`}>
                      {normalizePatientType(selectedPatient.patientType)}
                    </span>
                    <span className={`statusPill ${getStatusClass(patientStatus)}`}>{patientStatus}</span>
                  </div>
                </div>
                {canEditPatientProfile && !isEditing ? (
                  <button type="button" className="btn btnPrimary" onClick={startEditing}>
                    Edit Patient
                  </button>
                ) : null}
              </header>

              <div className="recordTabs" role="tablist" aria-label="Patient record sections">
                {RECORD_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    id={`tab-${tab.id}`}
                    aria-selected={activePatientView === tab.id}
                    aria-controls={`panel-${tab.id}`}
                    className={`recordTab ${activePatientView === tab.id ? "active" : ""}`}
                    onClick={() => setActivePatientView(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {activePatientView === PATIENT_VIEWS.DETAILS ? (
                <section
                  className="pdl"
                  role="tabpanel"
                  id={`panel-${PATIENT_VIEWS.DETAILS}`}
                  aria-labelledby={`tab-${PATIENT_VIEWS.DETAILS}`}
                >
                  {isEditing ? (
                    <form onSubmit={savePatientDetails} className="pdlForm">
                      <label className="field">
                        <span className="fieldLabel">First name</span>
                        <input className="input" value={draft.firstName} onChange={(e) => updateDraft("firstName", e.target.value)} required />
                      </label>
                      <label className="field">
                        <span className="fieldLabel">Middle name</span>
                        <input className="input" value={draft.middleName} onChange={(e) => updateDraft("middleName", e.target.value)} />
                      </label>
                      <label className="field">
                        <span className="fieldLabel">Last name</span>
                        <input className="input" value={draft.lastName} onChange={(e) => updateDraft("lastName", e.target.value)} required />
                      </label>
                      <label className="field">
                        <span className="fieldLabel">Age</span>
                        <input className="input" type="number" min="1" value={draft.age} onChange={(e) => updateDraft("age", e.target.value)} />
                      </label>
                      <label className="field">
                        <span className="fieldLabel">Type of patient</span>
                        <select className="input" value={draft.patientType} onChange={(e) => updateDraft("patientType", e.target.value)}>
                          {PATIENT_TYPES.map((type) => (
                            <option key={type} value={type}>{type}</option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span className="fieldLabel">Contact number</span>
                        <input className="input" value={draft.phone} onChange={(e) => updateDraft("phone", e.target.value)} />
                      </label>
                      <label className="field pdlFull">
                        <span className="fieldLabel">Gmail</span>
                        <input className="input" type="email" value={draft.email} onChange={(e) => updateDraft("email", e.target.value)} />
                      </label>

                      <div className="pdlActions pdlFull">
                        <button type="submit" className="btn btnSuccess" disabled={savingDetails}>
                          {savingDetails ? "Saving" : "Save changes"}
                        </button>
                        <button type="button" className="btn btnSecondary" onClick={cancelEditing} disabled={savingDetails}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <dl className="pdlList">
                      <div className="pdlRow">
                        <dt>Age</dt>
                        <dd>{selectedPatient.age || "Not provided"}</dd>
                      </div>
                      <div className="pdlRow">
                        <dt>Phone</dt>
                        <dd>{selectedPatient.phone || "Not provided"}</dd>
                      </div>
                      <div className="pdlRow">
                        <dt>Email</dt>
                        <dd>{selectedPatient.email || "Not provided"}</dd>
                      </div>
                      <div className="pdlRow">
                        <dt>Dentist</dt>
                        <dd>{bookingSummary.dentist}</dd>
                      </div>
                      <div className="pdlRow">
                        <dt>Appointments</dt>
                        <dd>{bookingSummary.total}</dd>
                      </div>
                      <div className="pdlRow">
                        <dt>Last visit</dt>
                        <dd>
                          {bookingSummary.total
                            ? `${bookingSummary.lastVisit} \u00b7 ${bookingSummary.latestService}`
                            : "No visit yet"}
                        </dd>
                      </div>
                    </dl>
                  )}
                </section>
              ) : null}

              {activePatientView === PATIENT_VIEWS.CHART ? (
                <section className="panel" role="tabpanel" id={`panel-${PATIENT_VIEWS.CHART}`} aria-labelledby={`tab-${PATIENT_VIEWS.CHART}`}>
                  <div className="panelHead">
                    <div>
                      <h2 className="panelTitle">Dental Chart</h2>
                      <p className="panelSub">
                        {canEditDentalChart
                          ? "Select one or more teeth, then add notes and conditions."
                          : "You can review the chart and existing dentist notes. Editing is limited to dentists and admins."}
                      </p>
                    </div>
                    <span className="countLabel">{canEditDentalChart ? "Editable" : "Read only"}</span>
                  </div>

                  {selectedPatient.uid ? (
                    <div className="chartLayout">
                      <div className="chartCol">
                        <div className="toothViewer">
                          <div className="toothChartFrame">
                            <div className="toothImageSurface" aria-label="Select a tooth marker to choose one or more teeth">
                              <img className="toothReferenceImage" src={DENTAL_CHART_IMAGE} alt="Dental numbering system" />
                              <div className="toothViewerOverlay">
                                {TOOTH_IDS.map((tooth) => (
                                  <button
                                    key={tooth}
                                    type="button"
                                    className={`toothMarker ${selectedTeeth.includes(tooth) ? "active" : ""} ${focusedTooth === tooth ? "focused" : ""} ${chartDraft.teeth?.[tooth]?.trim() ? "hasNote" : ""}`}
                                    style={{ top: TOOTH_MARKERS[tooth]?.top, left: TOOTH_MARKERS[tooth]?.left }}
                                    onClick={() => toggleToothSelection(tooth)}
                                    onMouseEnter={() => setHoveredTooth(tooth)}
                                    onMouseLeave={() => setHoveredTooth("")}
                                    onFocus={() => setHoveredTooth(tooth)}
                                    onBlur={() => setHoveredTooth("")}
                                    aria-pressed={selectedTeeth.includes(tooth)}
                                    aria-label={`Tooth ${tooth} ${TOOTH_LABELS[tooth]}`}
                                  />
                                ))}
                              </div>
                            </div>
                          </div>
                          {focusedTooth ? (
                            <div className="toothViewerLegend">
                              <span>{selectedTeeth.length > 1 ? "Focused tooth" : "Selected tooth"}</span>
                              <strong>{focusedTooth}</strong>
                              <small>{TOOTH_LABELS[focusedTooth]}</small>
                            </div>
                          ) : null}
                        </div>

                        <div className="toothSelectedChips">
                          {selectedTeeth.map((tooth) => (
                            <button key={tooth} type="button" className={`toothSelectedChip ${focusedTooth === tooth ? "active" : ""}`} onClick={() => setSelectedTeeth([tooth])}>
                              Tooth {tooth}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="chartForm">
                        {selectedTeeth.length ? (
                          <div className="infoBlock">
                            <span className="detailLabel">{selectedTeeth.length > 1 ? "Selected teeth" : "Selected tooth"}</span>
                            <p><strong>{selectedTeeth.join(", ")}</strong></p>
                            <p>{selectedTeeth.length === 1 ? TOOTH_LABELS[selectedTeeth[0]] : "These teeth are updated together with the same note."}</p>
                            {selectedTeeth.length > 1 ? (
                              <div className="selectedToothNotesList">
                                {selectedToothEntries.map(({ tooth, label, note }) => (
                                  <div key={tooth} className="selectedToothNoteItem">
                                    <strong>Tooth {tooth}</strong>
                                    <span>{label}: {chartDraft.toothConditions?.[tooth] || "healthy"}</span>
                                    <p>{note || "No note saved for this tooth yet."}</p>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p>{selectedToothComment || "No note saved for the selected tooth yet."}</p>
                            )}
                          </div>
                        ) : null}

                        {canEditDentalChart ? (
                          <>
                            {selectedTeeth.length ? (
                              <>
                                <label className="field">
                                  <span className="fieldLabel">{selectedTeeth.length > 1 ? "Shared note for selected teeth" : "Tooth note"}</span>
                                  <textarea
                                    className="input"
                                    rows={4}
                                    value={selectedToothComment}
                                    onChange={(e) =>
                                      setChartDraft((current) => ({
                                        ...current,
                                        uid: selectedPatient.uid,
                                        teeth: {
                                          ...(current.teeth || {}),
                                          ...selectedTeeth.reduce((accumulator, tooth) => {
                                            accumulator[tooth] = e.target.value;
                                            return accumulator;
                                          }, {}),
                                        },
                                      }))
                                    }
                                  />
                                </label>

                                <label className="field">
                                  <span className="fieldLabel">Condition</span>
                                  <select
                                    className="input"
                                    value={selectedToothCondition}
                                    onChange={(e) =>
                                      setChartDraft((current) => ({
                                        ...current,
                                        uid: selectedPatient.uid,
                                        toothConditions: {
                                          ...(current.toothConditions || {}),
                                          ...selectedTeeth.reduce((accumulator, tooth) => {
                                            accumulator[tooth] = e.target.value;
                                            return accumulator;
                                          }, {}),
                                        },
                                      }))
                                    }
                                  >
                                    <option value="healthy">Healthy</option>
                                    <option value="observation">For Observation</option>
                                    <option value="treated">Treated</option>
                                    <option value="missing">Missing</option>
                                    <option value="decayed">Decayed</option>
                                    <option value="extraction_needed">Extraction Needed</option>
                                  </select>
                                </label>
                              </>
                            ) : null}

                            <label className="field">
                              <span className="fieldLabel">General dentist notes</span>
                              <textarea
                                className="input"
                                rows={5}
                                value={chartDraft.generalNotes || ""}
                                onChange={(e) => setChartDraft((current) => ({ ...current, uid: selectedPatient.uid, generalNotes: e.target.value }))}
                              />
                            </label>

                            <div className="formActions">
                              <button className="btn btnSuccess" type="button" onClick={saveDentalChart}>
                                Save Dental Chart Notes
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="infoBlock">
                            <span className="detailLabel">General dentist notes</span>
                            <p>{chartDraft.generalNotes || "No general dentist notes saved yet."}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <EmptyState
                      compact
                      title="No linked patient account yet"
                      message="This patient record is not linked to a signed-in patient account yet, so the dental chart cannot appear in the patient portal."
                    />
                  )}
                </section>
              ) : null}

              {activePatientView === PATIENT_VIEWS.PLAN ? (
                <section className="panel" role="tabpanel" id={`panel-${PATIENT_VIEWS.PLAN}`} aria-labelledby={`tab-${PATIENT_VIEWS.PLAN}`}>
                  <div className="panelHead">
                    <div>
                      <h2 className="panelTitle">Clinical Plan</h2>
                      <p className="panelSub">Procedures, treatment details, and follow-up guidance for this patient.</p>
                    </div>
                    <div className="panelHeadActions">
                      {canEditDentalChart ? (
                        <button className="btn btnTeal" type="button" onClick={syncPatientPortalRecord}>
                          Sync patient portal
                        </button>
                      ) : null}
                      <span className="countLabel">{(selectedPatient.treatmentPlans || []).length + (selectedPatient.careRecommendations || []).length} saved items</span>
                    </div>
                  </div>

                  {canEditDentalChart ? (
                    <div className="planForms">
                      <div className="planForm">
                        <h3 className="blockTitle">Add procedure</h3>
                        <label className="field">
                          <span className="fieldLabel">Procedure or treatment title</span>
                          <input className="input" value={treatmentDraft.title} onChange={(e) => setTreatmentDraft((current) => ({ ...current, title: e.target.value }))} />
                        </label>
                        <div className="twoCol">
                          <label className="field">
                            <span className="fieldLabel">Target date</span>
                            <input className="input" type="date" value={treatmentDraft.targetDate} onChange={(e) => setTreatmentDraft((current) => ({ ...current, targetDate: e.target.value }))} />
                          </label>
                          <label className="field">
                            <span className="fieldLabel">Status</span>
                            <select className="input" value={treatmentDraft.status} onChange={(e) => setTreatmentDraft((current) => ({ ...current, status: e.target.value }))}>
                              <option>Planned</option>
                              <option>In Progress</option>
                              <option>Completed</option>
                            </select>
                          </label>
                        </div>
                        <label className="field">
                          <span className="fieldLabel">Clinical notes (staff only)</span>
                          <textarea className="input" rows={3} value={treatmentDraft.instructions} onChange={(e) => setTreatmentDraft((current) => ({ ...current, instructions: e.target.value }))} />
                        </label>
                        <label className="field">
                          <span className="fieldLabel">Patient-friendly version</span>
                          <textarea className="input" rows={3} value={treatmentDraft.patientSummary} onChange={(e) => setTreatmentDraft((current) => ({ ...current, patientSummary: e.target.value }))} />
                        </label>
                        <label className="checkField">
                          <input
                            type="checkbox"
                            checked={treatmentDraft.patientVisible}
                            onChange={(e) => setTreatmentDraft((current) => ({ ...current, patientVisible: e.target.checked }))}
                          />
                          <span>Show the patient-friendly version in the patient portal</span>
                        </label>
                        <div className="twoCol">
                          <label className="field">
                            <span className="fieldLabel">Before photo</span>
                            <input className="input" type="file" accept="image/*" onChange={(e) => handleTreatmentImageUpload("beforeImageUrl", e.target.files?.[0])} />
                          </label>
                          <label className="field">
                            <span className="fieldLabel">After photo</span>
                            <input className="input" type="file" accept="image/*" onChange={(e) => handleTreatmentImageUpload("afterImageUrl", e.target.files?.[0])} />
                          </label>
                        </div>
                        {(treatmentDraft.beforeImageUrl || treatmentDraft.afterImageUrl) ? (
                          <div className="photoGrid">
                            {treatmentDraft.beforeImageUrl ? (
                              <figure className="photoCard">
                                <figcaption>Before preview</figcaption>
                                <img src={treatmentDraft.beforeImageUrl} alt="Before treatment preview" />
                              </figure>
                            ) : null}
                            {treatmentDraft.afterImageUrl ? (
                              <figure className="photoCard">
                                <figcaption>After preview</figcaption>
                                <img src={treatmentDraft.afterImageUrl} alt="After treatment preview" />
                              </figure>
                            ) : null}
                            <div className="photoGridActions">
                              <button className="btn btnWarning" type="button" onClick={() => setTreatmentDraft((current) => ({ ...current, beforeImageUrl: "", afterImageUrl: "" }))}>
                                Clear selected photos
                              </button>
                            </div>
                          </div>
                        ) : null}
                        <div className="formActions">
                          <button className="btn btnSuccess" type="button" onClick={addTreatmentPlan}>Save Procedure Plan</button>
                        </div>
                      </div>

                      <div className="planForm">
                        <h3 className="blockTitle">Add home care and return visit</h3>
                        <label className="field">
                          <span className="fieldLabel">Aftercare advice or next steps</span>
                          <textarea className="input" rows={3} value={careDraft.recommendation} onChange={(e) => setCareDraft((current) => ({ ...current, recommendation: e.target.value }))} />
                        </label>
                        <div className="twoCol">
                          <label className="field">
                            <span className="fieldLabel">Follow-up date</span>
                            <input className="input" type="date" value={careDraft.followUpDate} onChange={(e) => setCareDraft((current) => ({ ...current, followUpDate: e.target.value }))} />
                          </label>
                          <label className="field">
                            <span className="fieldLabel">Prescription or instruction</span>
                            <input className="input" value={careDraft.prescription} onChange={(e) => setCareDraft((current) => ({ ...current, prescription: e.target.value }))} />
                          </label>
                        </div>
                        <div className="formActions">
                          <button className="btn btnSuccess" type="button" onClick={addCareRecommendation}>Save Follow-Up Guidance</button>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="planLists">
                    <div className="planColumn">
                      <div className="blockHead">
                        <h3 className="blockTitle">Procedures</h3>
                        <span className="countLabel">{(selectedPatient.treatmentPlans || []).length}</span>
                      </div>
                      {(selectedPatient.treatmentPlans || []).length ? (
                        <div className="itemList">
                          {selectedPatient.treatmentPlans.map((plan, index) => (
                            <article key={`${plan.title}-${index}`} className="itemCard">
                              <div className="itemTop">
                                <strong>{plan.title}</strong>
                                <span className={`statusPill ${getStatusClass(plan.status || "Planned")}`}>{plan.status || "Planned"}</span>
                              </div>
                              <p className="itemMeta">
                                {plan.targetDate || "No target date yet"} &nbsp;|&nbsp; {plan.patientVisible ? "Visible to patient" : "Staff only"}
                              </p>
                              <p className="itemText">{plan.instructions || "No clinical instructions added yet."}</p>
                              {plan.patientSummary ? (
                                <div className="infoBlock">
                                  <span className="detailLabel">Patient-friendly version</span>
                                  <p>{plan.patientSummary}</p>
                                </div>
                              ) : null}
                              {(plan.beforeImageUrl || plan.afterImageUrl) ? (
                                <div className="photoGrid compact">
                                  {plan.beforeImageUrl ? (
                                    <figure className="photoCard">
                                      <figcaption>Before</figcaption>
                                      <img src={plan.beforeImageUrl} alt={`${plan.title} before`} />
                                    </figure>
                                  ) : null}
                                  {plan.afterImageUrl ? (
                                    <figure className="photoCard">
                                      <figcaption>After</figcaption>
                                      <img src={plan.afterImageUrl} alt={`${plan.title} after`} />
                                    </figure>
                                  ) : null}
                                </div>
                              ) : null}
                              {canEditDentalChart ? (
                                <div className="itemActions">
                                  <button
                                    className={`btn btnSmall ${plan.patientVisible ? "btnWarning" : "btnTeal"}`}
                                    type="button"
                                    onClick={() =>
                                      openConfirm({
                                        title: plan.patientVisible ? "Hide from patient?" : "Show to patient?",
                                        message: plan.patientVisible
                                          ? "This treatment step will be removed from the patient's My Dental Record page."
                                          : "This will publish the patient-friendly version of this treatment step to the patient's My Dental Record page.",
                                        confirmLabel: plan.patientVisible ? "Hide from Patient" : "Show to Patient",
                                        action: () => setTreatmentPlanPatientVisible(index, !plan.patientVisible),
                                      })
                                    }
                                  >
                                    {plan.patientVisible ? "Hide from patient" : "Show to patient"}
                                  </button>
                                  {(plan.beforeImageUrl || plan.afterImageUrl) ? (
                                    <button
                                      className="btn btnWarning btnSmall"
                                      type="button"
                                      onClick={() =>
                                        openConfirm({
                                          title: "Remove treatment photos?",
                                          message: "The before and after photos will be removed from this plan and from the patient portal copy if this plan is shared.",
                                          confirmLabel: "Remove Photos",
                                          tone: "danger",
                                          action: () => clearTreatmentPlanImages(index),
                                        })
                                      }
                                    >
                                      Remove photos
                                    </button>
                                  ) : null}
                                  <button
                                    className="btn btnDanger btnSmall"
                                    type="button"
                                    onClick={() =>
                                      openConfirm({
                                        title: "Delete this plan?",
                                        message: "This procedure will be deleted from the staff record and removed from the patient portal copy if it was shared.",
                                        confirmLabel: "Delete Plan",
                                        tone: "danger",
                                        action: () => removeTreatmentPlan(index),
                                      })
                                    }
                                  >
                                    Delete plan
                                  </button>
                                </div>
                              ) : null}
                            </article>
                          ))}
                        </div>
                      ) : (
                        <div className="emptyBlock">
                          <strong>No procedures yet</strong>
                          <p>Planned, active, and completed procedures will be listed here.</p>
                        </div>
                      )}
                    </div>

                    <div className="planColumn">
                      <div className="blockHead">
                        <h3 className="blockTitle">Care guidance</h3>
                        <span className="countLabel">{(selectedPatient.careRecommendations || []).length}</span>
                      </div>
                      {(selectedPatient.careRecommendations || []).length ? (
                        <div className="itemList">
                          {selectedPatient.careRecommendations.map((entry, index) => (
                            <article key={`${entry.recommendation}-${index}`} className="itemCard">
                              <div className="itemTop">
                                <strong>{entry.recommendation}</strong>
                                <span className="statusPill active">{entry.followUpDate || "No follow-up date"}</span>
                              </div>
                              <p className="itemText">{entry.prescription || "No prescription or extra instruction added yet."}</p>
                              {canEditDentalChart ? (
                                <div className="itemActions">
                                  <button
                                    className="btn btnDanger btnSmall"
                                    type="button"
                                    onClick={() =>
                                      openConfirm({
                                        title: "Delete this guidance?",
                                        message: "This follow-up guidance will be removed from the staff record and from the patient's My Dental Record page.",
                                        confirmLabel: "Delete Guidance",
                                        tone: "danger",
                                        action: () => removeCareRecommendation(index),
                                      })
                                    }
                                  >
                                    Delete guidance
                                  </button>
                                </div>
                              ) : null}
                            </article>
                          ))}
                        </div>
                      ) : (
                        <div className="emptyBlock">
                          <strong>No care guidance yet</strong>
                          <p>Aftercare instructions, return dates, and prescription notes will be listed here.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              ) : null}

              {activePatientView === PATIENT_VIEWS.TIMELINE ? (
                <section className="panel" role="tabpanel" id={`panel-${PATIENT_VIEWS.TIMELINE}`} aria-labelledby={`tab-${PATIENT_VIEWS.TIMELINE}`}>
                  <div className="panelHead">
                    <div>
                      <h2 className="panelTitle">Visit Timeline</h2>
                      <p className="panelSub">Bookings, approvals, reschedules, and check-ins, from the earliest to the latest.</p>
                    </div>
                    <span className="countLabel">{sortedTimeline.length} events</span>
                  </div>

                  {sortedTimeline.length ? (
                    <ol className="timelineStack">
                      {sortedTimeline.map((entry) => (
                        <li key={entry.id} className="timelineRow">
                          <span className={`timelineDot ${getStatusClass(entry.status) || "active"}`} aria-hidden="true" />
                          <div className="timelineBody">
                            <div className="timelineTopRow">
                              <strong>{entry.title}</strong>
                              <span className="timelineTime">{formatTimestamp(entry.timestamp)}</span>
                            </div>
                            <p>{entry.subtitle}</p>
                            {entry.status ? (
                              <span className={`statusPill ${getStatusClass(entry.status)}`}>{formatStatusLabel(entry.status)}</span>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <EmptyState
                      compact
                      title="No timeline events yet"
                      message="Bookings, approvals, reschedules, and check-ins will appear here once this patient starts visiting the clinic."
                    />
                  )}
                </section>
              ) : null}

              <footer className="recordFooter">
                <button
                  type="button"
                  className="btn btnWarning"
                  onClick={() =>
                    openConfirm({
                      title: "Archive this patient?",
                      message:
                        "The patient will be removed from the active patient list. Their appointments, dental chart, and treatment history are kept.",
                      confirmLabel: "Archive Patient",
                      tone: "archive",
                      action: () => archiveFromRecord(selectedPatient),
                    })
                  }
                >
                  Archive
                </button>
                <button type="button" className="btn btnInfo" onClick={handleDownloadPdf} disabled={pdfBusy}>
                  {pdfBusy ? "Preparing PDF" : "Download PDF"}
                </button>
              </footer>
            </>
          )}
          </div>
        </main>
      ) : null}

      {addOpen ? (
        <div className="modalOverlay addPatientModalOverlay" onClick={() => setAddOpen(false)} role="presentation">
          <form
            className="modalCard addPatientModal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-patient-title"
            onClick={(e) => e.stopPropagation()}
            onSubmit={addPatient}
          >
            <div className="modalHead">
              <h2 id="add-patient-title" className="modalTitle">Add New Patient</h2>
              <button type="button" className="iconBtn" aria-label="Close" onClick={() => setAddOpen(false)}>
                &times;
              </button>
            </div>

            <div className="modalBody addPatientModalBody">
              <label className="field">
                <span className="fieldLabel">First name</span>
                <input className="input" required value={addDraft.firstName} onChange={(e) => updateAddDraft("firstName", e.target.value)} />
              </label>
              <label className="field">
                <span className="fieldLabel">Middle name</span>
                <input className="input" value={addDraft.middleName} onChange={(e) => updateAddDraft("middleName", e.target.value)} />
              </label>
              <label className="field">
                <span className="fieldLabel">Last name</span>
                <input className="input" required value={addDraft.lastName} onChange={(e) => updateAddDraft("lastName", e.target.value)} />
              </label>
              <label className="field">
                <span className="fieldLabel">Age</span>
                <input className="input" type="number" min="1" value={addDraft.age} onChange={(e) => updateAddDraft("age", e.target.value)} />
              </label>
              <label className="field">
                <span className="fieldLabel">Contact number</span>
                <input className="input" value={addDraft.phone} onChange={(e) => updateAddDraft("phone", e.target.value)} />
              </label>
              <label className="field">
                <span className="fieldLabel">Gmail</span>
                <input className="input" type="email" value={addDraft.email} onChange={(e) => updateAddDraft("email", e.target.value)} />
              </label>
              <label className="field">
                <span className="fieldLabel">Type of patient</span>
                <select className="input" value={addDraft.patientType} onChange={(e) => updateAddDraft("patientType", e.target.value)}>
                  {PATIENT_TYPES.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="fieldLabel">Preferred dentist (optional)</span>
                <select className="input" value={addDraft.preferredDentist} onChange={(e) => updateAddDraft("preferredDentist", e.target.value)}>
                  <option value="">No preference</option>
                  {dentistProfiles.map((dentist) => (
                    <option key={dentist.id} value={dentist.name}>{dentist.name}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="modalFoot">
              <button type="button" className="btn btnSecondary" onClick={() => setAddOpen(false)}>Cancel</button>
              <button className="btn btnSuccess" type="submit" disabled={addSaving}>
                {addSaving ? "Saving" : "Add Patient"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(confirmState)}
        title={confirmState?.title}
        message={confirmState?.message}
        confirmLabel={confirmState?.confirmLabel}
        tone={confirmState?.tone}
        onClose={() => setConfirmState(null)}
        onConfirm={handleConfirmAction}
      />
    </div>
  );
}