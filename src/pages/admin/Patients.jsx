import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { auth, db } from "../../firebase";
import ConfirmDialog from "../../components/ConfirmDialog";
import EmptyState from "../../components/EmptyState";
import { SkeletonList } from "../../components/LoadingSkeleton";
import { getAuditActionLabel, logAdminAction } from "../../utils/audit";
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
    patientType: "New Patient",
    status: "Active",
  };
}

function emptyTreatmentDraft() {
  return {
    title: "",
    targetDate: "",
    status: "Planned",
    instructions: "",
    beforeImageUrl: "",
    afterImageUrl: "",
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
  const maxWidth = 1280;
  const scale = image.width > maxWidth ? maxWidth / image.width : 1;

  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));

  const context = canvas.getContext("2d");
  if (!context) return dataUrl;

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.78);
}

function emptyCareDraft() {
  return {
    recommendation: "",
    followUpDate: "",
    prescription: "",
  };
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

export default function Patients() {
  const PATIENT_VIEWS = {
    DETAILS: "details",
    CHART: "chart",
    PLAN: "plan",
    TIMELINE: "timeline",
  };
  const [patients, setPatients] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [dentistProfiles, setDentistProfiles] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [patientWorkspaceOpen, setPatientWorkspaceOpen] = useState(false);
  const [draft, setDraft] = useState(getEmptyDraft());
  const [search, setSearch] = useState("");
  const [chartDraft, setChartDraft] = useState(createEmptyDentalChart());
  const [selectedTeeth, setSelectedTeeth] = useState(["11"]);
  const [hoveredTooth, setHoveredTooth] = useState("");
  const [adminRole, setAdminRole] = useState(ROLES.ADMIN);
  const [loadingPatients, setLoadingPatients] = useState(true);
  const [confirmState, setConfirmState] = useState(null);
  const [treatmentDraft, setTreatmentDraft] = useState(emptyTreatmentDraft());
  const [careDraft, setCareDraft] = useState(emptyCareDraft());
  const [activePatientView, setActivePatientView] = useState("details");
  const [currentDentistIdentity, setCurrentDentistIdentity] = useState({
    uid: "",
    email: "",
  });

  function toggleToothSelection(tooth) {
    setSelectedTeeth((current) => {
      if (current.includes(tooth)) {
        return current.length === 1 ? current : current.filter((entry) => entry !== tooth);
      }

      return [...current, tooth];
    });
  }

  async function load(role = adminRole) {
    setLoadingPatients(true);

    const [patientsResult, bookingsResult, logsResult, dentistsResult] = await Promise.allSettled([
      getDocs(query(collection(db, "patients"), orderBy("createdAt", "desc"))),
      role === ROLES.DENTIST ? Promise.resolve({ docs: [] }) : getDocs(collection(db, "bookings")),
      getDocs(query(collection(db, "auditLogs"), orderBy("createdAt", "desc"))),
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
    const nextAuditLogs =
      logsResult.status === "fulfilled"
        ? logsResult.value.docs.map((entry) => ({
            id: entry.id,
            ...entry.data(),
            actionLabel: getAuditActionLabel(entry.data().action),
          }))
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
    setAuditLogs(nextAuditLogs);
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
  }, [adminRole, auditLogs, bookings, linkedDentistProfile?.name, patients]);

  const filteredPatientCards = useMemo(() => {
    const term = normalizeName(search);
    if (!term) return patientCards;
    return patientCards.filter((patient) => normalizeName(patient.name).includes(term));
  }, [patientCards, search]);

  const selectedPatient = useMemo(
    () => patientCards.find((patient) => patient.id === selectedPatientId) || null,
    [patientCards, selectedPatientId]
  );

  useEffect(() => {
    setPatientWorkspaceOpen(false);
  }, [selectedPatientId]);

  useEffect(() => {
    if (!selectedPatient) {
      setDraft(getEmptyDraft());
      setChartDraft(createEmptyDentalChart());
      setSelectedTeeth(["11"]);
      setHoveredTooth("");
      setTreatmentDraft(emptyTreatmentDraft());
      setCareDraft(emptyCareDraft());
      setActivePatientView(PATIENT_VIEWS.DETAILS);
      return;
    }

    setActivePatientView(PATIENT_VIEWS.DETAILS);
    setSelectedTeeth(["11"]);
    setHoveredTooth("");
    setDraft({
      id: selectedPatient.id,
      firstName: selectedPatient.firstName || splitFullName(selectedPatient.name || "").firstName || "",
      middleName: selectedPatient.middleName || splitFullName(selectedPatient.name || "").middleName || "",
      lastName: selectedPatient.lastName || splitFullName(selectedPatient.name || "").lastName || "",
      name: selectedPatient.name || "",
      age: selectedPatient.age || "",
      phone: selectedPatient.phone || "",
      email: selectedPatient.email || "",
      patientType: selectedPatient.patientType || "New Patient",
      status: selectedPatient.status || "Active",
    });
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
  }, [selectedPatient]);

  async function savePatientDetails(e) {
    e.preventDefault();
    if (!draft.id || !draft.firstName.trim() || !draft.lastName.trim()) return;

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
      targetLabel: draft.name.trim(),
      details: {
        patientType: draft.patientType,
        status: draft.status,
      },
    });

    await load();
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
  }

  async function addTreatmentPlan() {
    if (!selectedPatient || !treatmentDraft.title.trim()) return;
    const nextPlans = [
      ...(selectedPatient.treatmentPlans || []),
      {
        ...treatmentDraft,
        title: treatmentDraft.title.trim(),
        instructions: treatmentDraft.instructions.trim(),
        createdAt: new Date().toISOString(),
      },
    ];

    await updateDoc(doc(db, "patients", selectedPatient.id), {
      treatmentPlans: nextPlans,
    });

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

  function openConfirm(config) {
    setConfirmState(config);
  }

  async function handleConfirmAction() {
    if (!confirmState?.action) return;
    const action = confirmState.action;
    setConfirmState(null);
    await action();
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
    if (!printWindow) return;

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
            <div class="card"><div class="label">Patient type</div><strong>${patient.patientType || "New Patient"}</strong></div>
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
  }

  const focusedTooth = hoveredTooth || selectedTeeth[selectedTeeth.length - 1] || "11";
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
  const isReceptionist = adminRole === ROLES.RECEPTIONIST;
  const isDentist = adminRole === ROLES.DENTIST;
  const canEditDentalChart = adminRole === ROLES.ADMIN || adminRole === ROLES.DENTIST;
  const canEditPatientProfile = adminRole === ROLES.ADMIN || adminRole === ROLES.RECEPTIONIST;
  const pageEyebrow = isReceptionist ? "Reception Desk" : isDentist ? "Dentist Workspace" : "Patient Intelligence";
  const pageTitle = isReceptionist ? "Reception Patient Desk" : isDentist ? "Dentist Patient View" : "Patients Management";

  return (
    <div className="container adminSurface">
      <div className="hero adminHero">
        <div className="adminHeroGlow" />
        <div className="adminHeroContent">
          <span className="heroEyebrow">{pageEyebrow}</span>
          <h1>{pageTitle}</h1>
          <p>
            {isReceptionist
              ? "Track patient details, review appointment history, and keep the front-desk view organized."
              : isDentist
                ? "Review patient details, inspect the treatment timeline, and manage clinical chart notes."
                : "Track patient history, visualize treatment progress, and review role-based activity from one patient workspace."}
          </p>
        </div>
      </div>
      <div className="statsGrid adminStats">
        <div className="statCard accentTeal">
          <span className="statLabel">Registered</span>
          <strong className="statValue">{patientCards.length}</strong>
        </div>
        <div className="statCard accentBlue">
          <span className="statLabel">With history</span>
          <strong className="statValue">{patientCards.filter((patient) => patient.history.length).length}</strong>
        </div>
        <div className="statCard accentGold">
          <span className="statLabel">Archived</span>
          <strong className="statValue">{patients.filter((patient) => patient.status === "Archived").length}</strong>
        </div>
      </div>

      <div className={`adminPanelGrid ${patientWorkspaceOpen ? "workspaceMode" : "recordsOnlyMode"}`}>
        {patientWorkspaceOpen ? (
        <div className="card adminEditorCard">
          <div className="cardHeader">
            <div>
              <h3 className="title">Patient Details</h3>
              <p className="sub">
                {isDentist
                  ? "Select a patient on the right to review details, treatment progress, and chart notes."
                  : "Select a patient on the right to refine their profile, review the visit timeline, and manage chart notes."}
              </p>
            </div>
            <span className="badge">{selectedPatient ? "Patient selected" : "Choose a patient"}</span>
          </div>

          {loadingPatients ? (
            <SkeletonList count={2} />
          ) : selectedPatient ? (
            <>
              <div className="editorPreview" style={{ display: "none" }}>
                <div>
                  <span className="detailLabel">Current patient</span>
                  <strong className="detailTitle">{selectedPatient.name}</strong>
                  <p className="detailSubtitle">
                    Age {selectedPatient.age || "-"} • {selectedPatient.latest?.service || "No recent service"} • {selectedPatient.latest?.selectedDentist || "No preferred dentist yet"}
                  </p>
                </div>
                <span className={`statusPill ${draft.status === "Archived" ? "cancelled" : "approved"}`}>
                  {draft.status}
                </span>
              </div>

              <div className="analyticsGrid" style={{ display: "none" }}>
                <div className="card analyticsCard">
                  <span className="detailLabel">Appointments made</span>
                  <strong>{selectedPatient.allHistory.length}</strong>
                  <p>All bookings linked to this patient record, including archived ones</p>
                </div>
                <div className="card analyticsCard">
                  <span className="detailLabel">Latest visit</span>
                  <strong>{selectedPatient.latestOverall?.service || "No visit yet"}</strong>
                  <p>{selectedPatient.latestOverall ? formatDateLabel(selectedPatient.latestOverall.date) : "Waiting for first appointment"}</p>
                </div>
                <div className="card analyticsCard">
                  <span className="detailLabel">Preferred dentist</span>
                  <strong>{selectedPatient.preferredDentist || selectedPatient.latestOverall?.selectedDentist || "No dentist yet"}</strong>
                  <p>Latest dentist tied to this record, even if the booking was archived later</p>
                </div>
              </div>

              {false ? (
                <div className="workspaceLaunchCard" style={{ marginTop: 18 }}>
                  <div className="editorPreview">
                    <div>
                      <span className="detailLabel">Selected patient</span>
                      <strong className="detailTitle">{selectedPatient.name}</strong>
                      <p className="detailSubtitle">
                        Age {selectedPatient.age || "-"} • {selectedPatient.latestOverall?.service || "No recent service"} • {selectedPatient.latestOverall?.selectedDentist || "No preferred dentist yet"}
                      </p>
                    </div>
                    <span className={`statusPill ${draft.status === "Archived" ? "archived" : "approved"}`}>
                      {draft.status}
                    </span>
                  </div>

                  <div className="analyticsGrid workspacePreviewStats" style={{ marginTop: 18 }}>
                    <div className="card analyticsCard">
                      <span className="detailLabel">Appointments made</span>
                      <strong>{selectedPatient.allHistory.length}</strong>
                      <p>All bookings linked to this patient record, including archived ones</p>
                    </div>
                    <div className="card analyticsCard">
                      <span className="detailLabel">Latest visit</span>
                      <strong>{selectedPatient.latestOverall?.service || "No visit yet"}</strong>
                      <p>{selectedPatient.latestOverall ? formatDateLabel(selectedPatient.latestOverall.date) : "Waiting for first appointment"}</p>
                    </div>
                    <div className="card analyticsCard">
                      <span className="detailLabel">Preferred dentist</span>
                      <strong>{selectedPatient.preferredDentist || selectedPatient.latestOverall?.selectedDentist || "No dentist yet"}</strong>
                      <p>Latest dentist tied to this record, even if the booking was archived later</p>
                    </div>
                  </div>

                  <div className="workspaceLaunchActions">
                    <button
                      type="button"
                      className="btn btnShine patientActionBtn patientEditBtn"
                      onClick={() => {
                        setActivePatientView(PATIENT_VIEWS.DETAILS);
                        setPatientWorkspaceOpen(true);
                      }}
                    >
                      Open Patient Workspace
                    </button>
                  </div>
                </div>
              ) : null}

              {patientWorkspaceOpen ? (
              <>
              <div className="workspaceTopBar">
                <button
                  type="button"
                  className="btn secondary workspaceBackBtn"
                  onClick={() => setPatientWorkspaceOpen(false)}
                >
                  Back to Patient List
                </button>
                <span className="badge">Workspace Open</span>
              </div>

              <div className="patientWorkspaceTabs">
                <button type="button" className={`workspaceTab ${activePatientView === PATIENT_VIEWS.DETAILS ? "active" : ""}`} onClick={() => setActivePatientView(PATIENT_VIEWS.DETAILS)}>
                  Patient Details
                </button>
                <button type="button" className={`workspaceTab ${activePatientView === PATIENT_VIEWS.CHART ? "active" : ""}`} onClick={() => setActivePatientView(PATIENT_VIEWS.CHART)}>
                  Dental Chart
                </button>
                <button type="button" className={`workspaceTab ${activePatientView === PATIENT_VIEWS.PLAN ? "active" : ""}`} onClick={() => setActivePatientView(PATIENT_VIEWS.PLAN)}>
                  Clinical Plan
                </button>
                <button type="button" className={`workspaceTab ${activePatientView === PATIENT_VIEWS.TIMELINE ? "active" : ""}`} onClick={() => setActivePatientView(PATIENT_VIEWS.TIMELINE)}>
                  Visit Timeline
                </button>
              </div>
              </>
              ) : null}

              {patientWorkspaceOpen && activePatientView === PATIENT_VIEWS.CHART ? (
              <div className="card adminRecordsCard patientPrimaryChartCard" style={{ marginTop: 18 }}>
                <div className="cardHeader">
                  <div>
                    <h3 className="title">{canEditDentalChart ? "Dental Chart" : "Dental Chart Overview"}</h3>
                    <p className="sub">
                      {canEditDentalChart
                        ? "Open the patient chart first, select the teeth you need, and save focused dental notes in a cleaner workflow."
                        : "Reception access can review the patient chart and existing dentist notes here, but note editing stays restricted."}
                    </p>
                  </div>
                  <span className="badge">{canEditDentalChart ? "Editable" : "Read Only"}</span>
                </div>

                {selectedPatient.uid ? (
                  <>
                    <div className="toothViewer3d adminToothChart">
                      <div className="toothChartFrame">
                        <div className="toothViewerHalo" style={{ top: TOOTH_MARKERS[focusedTooth]?.top, left: TOOTH_MARKERS[focusedTooth]?.left }} />
                        <div className="toothImageSurface" aria-label="Tap a tooth marker to select one or more teeth">
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
                              >
                                {tooth}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="toothViewerLegend">
                        <span>{selectedTeeth.length > 1 ? "Focused tooth" : "Selected tooth"}</span>
                        <strong>{focusedTooth}</strong>
                        <small>{TOOTH_LABELS[focusedTooth]}</small>
                      </div>
                    </div>

                    <div className="toothSelectedChips" style={{ marginTop: 12 }}>
                      {selectedTeeth.map((tooth) => (
                        <button key={tooth} type="button" className={`toothSelectedChip ${focusedTooth === tooth ? "active" : ""}`} onClick={() => setSelectedTeeth([tooth])}>
                          Tooth {tooth}
                        </button>
                      ))}
                    </div>

                    <div className="detailNote historyPanel selectedToothPanel" style={{ marginTop: 14 }}>
                      <span className="detailLabel">{selectedTeeth.length > 1 ? "Selected teeth" : "Selected tooth"}</span>
                      <p><strong>{selectedTeeth.join(", ")}</strong></p>
                      <p>{selectedTeeth.length === 1 ? TOOTH_LABELS[selectedTeeth[0]] : "These teeth will be updated together with the same note."}</p>
                      {selectedTeeth.length > 1 ? (
                        <div className="selectedToothNotesList">
                          {selectedToothEntries.map(({ tooth, label, note }) => (
                            <div key={tooth} className="selectedToothNoteItem">
                              <strong>Tooth {tooth}</strong>
                              <span>{label} • {chartDraft.toothConditions?.[tooth] || "healthy"}</span>
                              <p>{note || "No note saved for this tooth yet."}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p>{selectedToothComment || "No note saved for the selected tooth yet."}</p>
                      )}
                    </div>

                    {canEditDentalChart ? (
                      <>
                        <textarea
                          className="input"
                          rows={4}
                          placeholder={selectedTeeth.length > 1 ? "Shared note for all selected teeth" : "Tooth-specific comment"}
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

                        <textarea
                          className="input"
                          rows={5}
                          placeholder="General dentist notes"
                          value={chartDraft.generalNotes || ""}
                          onChange={(e) => setChartDraft((current) => ({ ...current, uid: selectedPatient.uid, generalNotes: e.target.value }))}
                        />

                        <button className="btn btnShine" type="button" onClick={saveDentalChart}>
                          Save Dental Chart Notes
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="detailNote historyPanel" style={{ marginTop: 12 }}>
                          <span className="detailLabel">General dentist notes</span>
                          <p>{chartDraft.generalNotes || "No general dentist notes saved yet."}</p>
                        </div>

                        <div className="emptyEditorState" style={{ marginTop: 12 }}>
                          <strong>Reception view only</strong>
                          <p>Dental notes can be reviewed here for coordination, but only dentist and admin accounts can add or edit chart comments.</p>
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <EmptyState
                    compact
                    title="No linked patient account yet"
                    message="This patient record is not linked to a signed-in patient account yet, so the dental chart cannot appear in the patient portal."
                  />
                )}
              </div>
              ) : null}

              {patientWorkspaceOpen && activePatientView === PATIENT_VIEWS.DETAILS ? (
              <div className="card adminRecordsCard compactOverviewCard" style={{ marginTop: 18 }}>
                <div className="cardHeader">
                  <div>
                    <h3 className="title">Patient Details</h3>
                    <p className="sub">Update the patient profile in the same focused workspace flow as the chart, clinical plan, and visit timeline.</p>
                  </div>
                  <span className="badge">Profile</span>
                </div>

                <div className="editorPreview">
                  <div>
                    <span className="detailLabel">Current patient</span>
                    <strong className="detailTitle">{selectedPatient.name}</strong>
                    <p className="detailSubtitle">
                      Age {selectedPatient.age || "-"} • {selectedPatient.latestOverall?.service || "No recent service"} • {selectedPatient.latestOverall?.selectedDentist || "No preferred dentist yet"}
                    </p>
                  </div>
                  <span className={`statusPill ${draft.status === "Archived" ? "archived" : "approved"}`}>
                    {draft.status}
                  </span>
                </div>

                <div className="analyticsGrid" style={{ marginTop: 18 }}>
                  <div className="card analyticsCard">
                    <span className="detailLabel">Appointments made</span>
                    <strong>{selectedPatient.allHistory.length}</strong>
                    <p>All bookings linked to this patient record, including archived ones</p>
                  </div>
                  <div className="card analyticsCard">
                    <span className="detailLabel">Latest visit</span>
                    <strong>{selectedPatient.latestOverall?.service || "No visit yet"}</strong>
                    <p>{selectedPatient.latestOverall ? formatDateLabel(selectedPatient.latestOverall.date) : "Waiting for first appointment"}</p>
                  </div>
                  <div className="card analyticsCard">
                    <span className="detailLabel">Preferred dentist</span>
                    <strong>{selectedPatient.preferredDentist || selectedPatient.latestOverall?.selectedDentist || "No dentist yet"}</strong>
                    <p>Latest dentist tied to this record, even if the booking was archived later</p>
                  </div>
                </div>

                <form onSubmit={savePatientDetails} className="form">
                  <input className="input" placeholder="First name" value={draft.firstName} readOnly={!canEditPatientProfile} onChange={(e) => setDraft((current) => ({ ...current, firstName: e.target.value, name: buildFullName({ ...current, firstName: e.target.value }) }))} />
                  <input className="input" placeholder="Middle name" value={draft.middleName} readOnly={!canEditPatientProfile} onChange={(e) => setDraft((current) => ({ ...current, middleName: e.target.value, name: buildFullName({ ...current, middleName: e.target.value }) }))} />
                  <input className="input" placeholder="Last name" value={draft.lastName} readOnly={!canEditPatientProfile} onChange={(e) => setDraft((current) => ({ ...current, lastName: e.target.value, name: buildFullName({ ...current, lastName: e.target.value }) }))} />
                  <input className="input" type="number" min="1" placeholder="Age" value={draft.age} readOnly={!canEditPatientProfile} onChange={(e) => setDraft((current) => ({ ...current, age: e.target.value }))} />
                  <input className="input" placeholder="Phone" value={draft.phone} readOnly={!canEditPatientProfile} onChange={(e) => setDraft((current) => ({ ...current, phone: e.target.value }))} />
                  <input className="input" placeholder="Email" value={draft.email} readOnly={!canEditPatientProfile} onChange={(e) => setDraft((current) => ({ ...current, email: e.target.value }))} />
                  <select className="input" value={draft.patientType} disabled={!canEditPatientProfile} onChange={(e) => setDraft((current) => ({ ...current, patientType: e.target.value }))}>
                    <option>New Patient</option>
                    <option>Regular Patient</option>
                    <option>Ortho Patient</option>
                  </select>
                  <select className="input" value={draft.status} disabled={!canEditPatientProfile} onChange={(e) => setDraft((current) => ({ ...current, status: e.target.value }))}>
                    <option>Active</option>
                    <option>Archived</option>
                  </select>
                  {canEditPatientProfile ? <button className="btn btnShine">Save Patient Details</button> : null}
                </form>
              </div>
              ) : null}

              {patientWorkspaceOpen && activePatientView === PATIENT_VIEWS.PLAN ? (
              <div className="card adminRecordsCard" style={{ marginTop: 18 }}>
                <div className="cardHeader">
                  <div>
                    <h3 className="title">Clinical Plan and Follow-Up</h3>
                    <p className="sub">Organize the next treatment steps and home-care instructions in a clearer, easier-to-scan patient summary.</p>
                  </div>
                  <span className="badge">{(selectedPatient.treatmentPlans || []).length + (selectedPatient.careRecommendations || []).length} saved items</span>
                </div>

                {canEditDentalChart ? (
                  <div className="stackSections">
                  <div className="form">
                    <span className="detailLabel">Procedure roadmap</span>
                    <input className="input" placeholder="Procedure, phase, or treatment title" value={treatmentDraft.title} onChange={(e) => setTreatmentDraft((current) => ({ ...current, title: e.target.value }))} />
                    <div className="bookingFlowGrid">
                      <input className="input" type="date" value={treatmentDraft.targetDate} onChange={(e) => setTreatmentDraft((current) => ({ ...current, targetDate: e.target.value }))} />
                      <select className="input" value={treatmentDraft.status} onChange={(e) => setTreatmentDraft((current) => ({ ...current, status: e.target.value }))}>
                        <option>Planned</option>
                        <option>In Progress</option>
                        <option>Completed</option>
                      </select>
                    </div>
                    <textarea className="input" rows={3} placeholder="Clinical notes, session goals, or procedure instructions" value={treatmentDraft.instructions} onChange={(e) => setTreatmentDraft((current) => ({ ...current, instructions: e.target.value }))} />
                    <div className="bookingFlowGrid">
                      <label className="uploadField">
                        <span className="detailLabel">Upload before photo</span>
                        <input
                          className="input"
                          type="file"
                          accept="image/*"
                          onChange={(e) => handleTreatmentImageUpload("beforeImageUrl", e.target.files?.[0])}
                        />
                      </label>
                      <label className="uploadField">
                        <span className="detailLabel">Upload after photo</span>
                        <input
                          className="input"
                          type="file"
                          accept="image/*"
                          onChange={(e) => handleTreatmentImageUpload("afterImageUrl", e.target.files?.[0])}
                        />
                      </label>
                    </div>
                    {(treatmentDraft.beforeImageUrl || treatmentDraft.afterImageUrl) ? (
                      <div className="treatmentPhotoPreviewGrid">
                        {treatmentDraft.beforeImageUrl ? (
                          <div className="treatmentPhotoPreviewCard">
                            <span className="detailLabel">Before preview</span>
                            <img src={treatmentDraft.beforeImageUrl} alt="Before treatment preview" />
                          </div>
                        ) : null}
                        {treatmentDraft.afterImageUrl ? (
                          <div className="treatmentPhotoPreviewCard">
                            <span className="detailLabel">After preview</span>
                            <img src={treatmentDraft.afterImageUrl} alt="After treatment preview" />
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <button className="btn btnShine" type="button" onClick={addTreatmentPlan}>Save Procedure Plan</button>
                  </div>
                  <div className="form">
                    <span className="detailLabel">Home care and return visit</span>
                    <textarea className="input" rows={3} placeholder="Aftercare advice, reminder, or next-step guidance" value={careDraft.recommendation} onChange={(e) => setCareDraft((current) => ({ ...current, recommendation: e.target.value }))} />
                    <div className="bookingFlowGrid">
                      <input className="input" type="date" value={careDraft.followUpDate} onChange={(e) => setCareDraft((current) => ({ ...current, followUpDate: e.target.value }))} />
                      <input className="input" placeholder="Prescription or special instruction" value={careDraft.prescription} onChange={(e) => setCareDraft((current) => ({ ...current, prescription: e.target.value }))} />
                    </div>
                    <button className="btn btnShine" type="button" onClick={addCareRecommendation}>Save Follow-Up Guidance</button>
                  </div>
                  </div>
                ) : null}

                <div className="grid clinicalPlanGrid" style={{ marginTop: 14 }}>
                  <div className="card">
                    <div className="cardHeader">
                      <div>
                        <h3 className="title">Procedure Roadmap</h3>
                        <p className="sub">Planned procedures, active treatment phases, and completed work for this patient.</p>
                      </div>
                      <span className="badge">{(selectedPatient.treatmentPlans || []).length}</span>
                    </div>
                    {(selectedPatient.treatmentPlans || []).length ? (
                      <div className="roadmapCardGrid">
                        {selectedPatient.treatmentPlans.map((plan, index) => (
                          <div key={`${plan.title}-${index}`} className="progressCard roadmapCard">
                            <div className="roadmapCardTop">
                              <div>
                                <span className="detailLabel">Target date</span>
                                <strong>{plan.title}</strong>
                              </div>
                              <span className={`statusPill ${plan.status === "Completed" ? "completed" : plan.status === "In Progress" ? "approved" : "pending"}`}>
                                {plan.status || "Planned"}
                              </span>
                            </div>
                            <div className="roadmapMeta">
                              <span>{plan.targetDate || "No target date yet"}</span>
                            </div>
                            <p>{plan.instructions || "No clinical instructions added yet."}</p>
                            {(plan.beforeImageUrl || plan.afterImageUrl) ? (
                              <div className="treatmentPhotoPreviewGrid compact">
                                {plan.beforeImageUrl ? (
                                  <div className="treatmentPhotoPreviewCard compact">
                                    <span className="detailLabel">Before</span>
                                    <img src={plan.beforeImageUrl} alt={`${plan.title} before`} />
                                  </div>
                                ) : null}
                                {plan.afterImageUrl ? (
                                  <div className="treatmentPhotoPreviewCard compact">
                                    <span className="detailLabel">After</span>
                                    <img src={plan.afterImageUrl} alt={`${plan.title} after`} />
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="emptyEditorState clinicalInfoEmpty">
                        <strong>No procedure roadmap yet</strong>
                        <p>Add the next procedure or treatment phase so the clinical plan stays visible for the team.</p>
                      </div>
                    )}
                  </div>

                  <div className="card">
                    <div className="cardHeader">
                      <div>
                        <h3 className="title">Care Guidance</h3>
                        <p className="sub">Aftercare reminders, follow-up dates, and prescription guidance for this patient.</p>
                      </div>
                      <span className="badge">{(selectedPatient.careRecommendations || []).length}</span>
                    </div>
                    {(selectedPatient.careRecommendations || []).length ? (
                      <div className="careGuidanceList">
                        {selectedPatient.careRecommendations.map((entry, index) => (
                          <div key={`${entry.recommendation}-${index}`} className="careGuidanceCard">
                            <div className="careGuidanceTop">
                              <div>
                                <strong>{entry.recommendation}</strong>
                              </div>
                              <span className="statusPill active">{entry.followUpDate || "No follow-up date"}</span>
                            </div>
                            <p>{entry.prescription || "No prescription or extra instruction added yet."}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="emptyEditorState clinicalInfoEmpty">
                        <strong>No care guidance yet</strong>
                        <p>Add aftercare instructions, a return date, or a prescription note so the patient handoff is clearer.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              ) : null}

              {patientWorkspaceOpen && activePatientView === PATIENT_VIEWS.TIMELINE ? (
              <div className="card adminRecordsCard" style={{ marginTop: 18 }}>
                <div className="cardHeader">
                  <div>
                    <h3 className="title">Patient Visit Timeline</h3>
                    <p className="sub">Visit-related activity only: bookings, approvals, reschedules, and check-ins connected to this patient.</p>
                  </div>
                  <span className="badge">{selectedPatient.timeline.length} events</span>
                </div>

                {selectedPatient.timeline.length ? (
                  <div className="timelineStack">
                    {selectedPatient.timeline.map((entry) => (
                      <div key={entry.id} className="timelineRow">
                        <div className={`timelineDot ${entry.status || "active"}`} />
                        <div className="timelineBody">
                          <div className="timelineTopRow">
                            <strong>{entry.title}</strong>
                            <span>{formatTimestamp(entry.timestamp)}</span>
                          </div>
                          <p>{entry.subtitle}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    compact
                    title="No timeline events yet"
                    message="Bookings, approvals, reschedules, and check-ins will appear here once this patient starts visiting the clinic."
                  />
                )}
              </div>
              ) : null}

            </>
          ) : (
            <EmptyState
              title="No patient selected"
              message="Select a patient card on the right to open their workspace, edit details, and review chart, plan, or visit history."
            />
          )}
        </div>
        ) : null}
        {!patientWorkspaceOpen ? (
        <div className="card adminRecordsCard">
          <div className="cardHeader">
            <div>
              <h3 className="title">Patient Records</h3>
              <p className="sub">Search patients by name, review their history, and open the editor for deeper details.</p>
            </div>
            <span className="badge">{filteredPatientCards.length} records</span>
          </div>

          <div className="patientSearchSpotlight">
            <div className="patientSearchHeader">
              <div>
                <span className="patientSearchEyebrow">Patient Name Search</span>
                <p className="patientSearchHint">Type a first or last name to jump straight to the matching record.</p>
              </div>
              <span className="patientSearchCount">
                {search ? `${filteredPatientCards.length} match${filteredPatientCards.length === 1 ? "" : "es"}` : "Ready to search"}
              </span>
            </div>

            <div className="patientSearchRow">
              <input className="input searchInput patientSearchInput" placeholder="Enter patient name" value={search} onChange={(e) => setSearch(e.target.value)} />
              {search ? (
                <button type="button" className="searchClearBtn" onClick={() => setSearch("")}>
                  Clear
                </button>
              ) : null}
            </div>
          </div>

          {loadingPatients ? <SkeletonList count={3} cardClassName="patientShowcase" /> : <ul className="list detailedList">
            {filteredPatientCards.map((patient) => {
              const isExpanded = selectedPatientId === patient.id;
              return (
              <li key={patient.id} className={`item detailedItem patientShowcase patientRecordCard ${isExpanded ? "selectedRecord expanded" : "collapsed"}`}>
                <button type="button" className="recordTapArea" onClick={() => { setSelectedPatientId(patient.id); setPatientWorkspaceOpen(false); }}>
                  <div className="detailContent">
                    <div className="detailTopRow">
                      <div>
                        <strong className="detailTitle">{patient.name}</strong>
                        <p className="detailSubtitle">
                          Age {patient.age || "-"} • {patient.patientType || "New Patient"} • {patient.phone || "No phone"}
                        </p>
                      </div>
                      <div className="statusStack">
                        {patient.inactiveFlag ? <span className="statusPill archived">inactive patient</span> : null}
                        <span className={`statusPill ${patient.status === "Archived" ? "archived" : "approved"}`}>{patient.status || "Active"}</span>
                      </div>
                    </div>

                    <div className="patientRecordPeek">
                      <span>{patient.latestService || patient.latest?.service || "No bookings yet"}</span>
                      <span>{patient.preferredDentist || patient.latest?.selectedDentist || "No dentist yet"}</span>
                      <span>{formatDateLabel(patient.lastAppointmentDate || patient.latest?.date)}</span>
                    </div>

                    {isExpanded ? (
                      <>
                        <div className="detailGrid">
                          <div className="detailBox luxeBox">
                            <span className="detailLabel">Latest service</span>
                            <strong>{patient.latestService || patient.latest?.service || "No bookings yet"}</strong>
                          </div>
                          <div className="detailBox luxeBox">
                            <span className="detailLabel">Preferred dentist</span>
                            <strong>{patient.preferredDentist || patient.latest?.selectedDentist || "No dentist yet"}</strong>
                          </div>
                          <div className="detailBox luxeBox">
                            <span className="detailLabel">Last visit day</span>
                            <strong>{formatDateLabel(patient.lastAppointmentDate || patient.latest?.date)}</strong>
                          </div>
                        </div>

                        <div className="progressMiniGrid">
                          {patient.progress.slice(0, 3).map((entry) => (
                            <div key={`${patient.id}-${entry.service}`} className="progressMiniCard">
                              <span className="detailLabel">{entry.service}</span>
                              <strong>{entry.progressLabel}</strong>
                              <p>{entry.completionState}</p>
                            </div>
                          ))}
                          {!patient.progress.length ? (
                            <div className="progressMiniCard empty">
                              <span className="detailLabel">Treatment progress</span>
                              <strong>No treatment sessions yet</strong>
                              <p>This patient has no repeated services to track yet.</p>
                            </div>
                          ) : null}
                        </div>
                      </>
                    ) : null}
                  </div>
                </button>

                {isExpanded ? (
                  <div className="actionColumn actionColumnFriendly">
                    <button className="btn patientActionBtn patientEditBtn" onClick={() => { setSelectedPatientId(patient.id); setActivePatientView(PATIENT_VIEWS.DETAILS); setPatientWorkspaceOpen(true); }}>
                      Open Patient Workspace
                    </button>
                    <button className="btn patientActionBtn patientPdfBtn" onClick={() => exportPatientPdf(patient)}>
                      Download Record PDF
                    </button>
                    <button
                      className="btn patientActionBtn archiveButton"
                      onClick={() =>
                        openConfirm({
                          title: patient.status === "Archived" ? "Restore patient record?" : "Move patient to archive?",
                          message: patient.status === "Archived"
                            ? "This patient will return to the active patient list."
                            : "This patient will be moved out of the active patient list and into archive.",
                          confirmLabel: patient.status === "Archived" ? "Restore Patient" : "Move to Archive",
                          tone: "archive",
                          action: () => toggleArchive(patient),
                        })
                      }
                    >
                      Move to Archive
                    </button>
                  </div>
                ) : (
                  <div className="patientRecordHint">
                    <span>Tap to open patient workspace</span>
                  </div>
                )}
              </li>
            )})}
          </ul>}

          {!loadingPatients && !filteredPatientCards.length ? (
            <EmptyState
              title={isDentist ? "No patients available yet" : "No matching patient records"}
              message={
                isDentist
                  ? "Patients will appear here once approved records are available for dentist review."
                  : "Try another patient name or clear the search to see the full active list."
              }
            />
          ) : null}
        </div>
        ) : null}
      </div>

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

