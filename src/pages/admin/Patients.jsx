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
import { auth, db } from "../../firebase";
import { getAuditActionLabel, logAdminAction } from "../../utils/audit";
import { buildPatientTimeline, buildTreatmentProgress, getLatestBooking, normalizeName } from "../../utils/appointments";
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
    name: "",
    age: "",
    phone: "",
    email: "",
    patientType: "Regular Patient",
    status: "Active",
  };
}

function getPatientHistory(bookings, patient) {
  return bookings
    .filter((booking) => {
      if (patient.uid && booking.uid) return patient.uid === booking.uid;
      return normalizeName(booking.fullName || booking.patientKey) === normalizeName(patient.name);
    })
    .filter((booking) => booking.archiveStatus !== "Archived")
    .sort((a, b) => {
      const aTime = a.appointmentAt?.seconds || a.createdAt?.seconds || 0;
      const bTime = b.appointmentAt?.seconds || b.createdAt?.seconds || 0;
      return bTime - aTime;
    });
}

export default function Patients() {
  const [patients, setPatients] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [draft, setDraft] = useState(getEmptyDraft());
  const [search, setSearch] = useState("");
  const [chartDraft, setChartDraft] = useState(createEmptyDentalChart());
  const [selectedTeeth, setSelectedTeeth] = useState(["11"]);
  const [hoveredTooth, setHoveredTooth] = useState("");
  const [adminRole, setAdminRole] = useState(ROLES.ADMIN);
  const [loadingPatients, setLoadingPatients] = useState(true);

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

    const [patientsResult, bookingsResult, logsResult] = await Promise.allSettled([
      getDocs(query(collection(db, "patients"), orderBy("createdAt", "desc"))),
      role === ROLES.DENTIST ? Promise.resolve({ docs: [] }) : getDocs(collection(db, "bookings")),
      getDocs(query(collection(db, "auditLogs"), orderBy("createdAt", "desc"))),
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

    setPatients(patientList);
    setBookings(bookingList);
    setAuditLogs(nextAuditLogs);

    if (!selectedPatientId && patientList.length) {
      setSelectedPatientId(patientList[0].id);
    }

    setLoadingPatients(false);
  }

  useEffect(() => {
    async function loadAdminRole() {
      const currentUser = auth.currentUser;
      if (!currentUser) return;

      const adminSnap = await getDoc(doc(db, "admins", currentUser.uid));
      if (adminSnap.exists()) {
        const role = getAdminProfile(adminSnap.data()).role;
        setAdminRole(role);
        await load(role);
      }
    }

    loadAdminRole();
  }, []);

  const patientCards = useMemo(() => {
    return patients
      .filter((patient) => patient.status !== "Archived")
      .map((patient) => {
        const history = adminRole === ROLES.DENTIST ? [] : getPatientHistory(bookings, patient);
        const latest = getLatestBooking(history);

        return {
          ...patient,
          history,
          latest,
          progress: buildTreatmentProgress(history),
          timeline: buildPatientTimeline(history, auditLogs, patient),
        };
      });
  }, [adminRole, auditLogs, bookings, patients]);

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
    if (!selectedPatient) {
      setDraft(getEmptyDraft());
      setChartDraft(createEmptyDentalChart());
      setSelectedTeeth(["11"]);
      setHoveredTooth("");
      return;
    }

    setSelectedTeeth(["11"]);
    setHoveredTooth("");
    setDraft({
      id: selectedPatient.id,
      name: selectedPatient.name || "",
      age: selectedPatient.age || "",
      phone: selectedPatient.phone || "",
      email: selectedPatient.email || "",
      patientType: selectedPatient.patientType || "Regular Patient",
      status: selectedPatient.status || "Active",
    });

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
    if (!draft.id || !draft.name.trim()) return;

    await updateDoc(doc(db, "patients", draft.id), {
      name: draft.name.trim(),
      age: String(draft.age).trim(),
      phone: draft.phone.trim(),
      email: draft.email.trim(),
      patientType: draft.patientType,
      status: draft.status,
    });

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

  async function exportPatientPdf(patient) {
    const historyRows = (patient.history || [])
      .map(
        (booking) => `
          <tr>
            <td>${booking.service || "Not set"}</td>
            <td>${formatDateLabel(booking.date)}</td>
            <td>${formatTimeLabel(booking.time)}</td>
            <td>${booking.selectedDentist || "No dentist"}</td>
            <td>${booking.status || "pending"}</td>
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
            .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 20px 0; }
            .card { border: 1px solid #d7e3f4; border-radius: 16px; padding: 14px; }
            .label { font-size: 12px; text-transform: uppercase; color: #64748b; margin-bottom: 6px; }
            table { width: 100%; border-collapse: collapse; margin-top: 18px; }
            th, td { border: 1px solid #d1d5db; padding: 10px; text-align: left; }
            th { background: #eff6ff; }
            .chart-wrap { position: relative; margin-top: 18px; border: 1px solid #d7e3f4; border-radius: 18px; overflow: hidden; }
            .chart-wrap img { width: 100%; display: block; }
            .chart-marker { position: absolute; transform: translate(-50%, -50%); min-width: 34px; height: 34px; border-radius: 999px; background: rgba(11, 18, 32, 0.88); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; }
          </style>
        </head>
        <body>
          <h1>TopDent Patient Record</h1>
          <div class="meta">
            <div class="card"><div class="label">Full name</div><strong>${patient.name || "-"}</strong></div>
            <div class="card"><div class="label">Age</div><strong>${patient.age || "-"}</strong></div>
            <div class="card"><div class="label">Phone</div><strong>${patient.phone || "-"}</strong></div>
            <div class="card"><div class="label">Email</div><strong>${patient.email || "-"}</strong></div>
          </div>
          <h2>Appointment History</h2>
          <table>
            <thead><tr><th>Service</th><th>Date</th><th>Time</th><th>Dentist</th><th>Status</th></tr></thead>
            <tbody>${historyRows || '<tr><td colspan="5">No appointment history yet.</td></tr>'}</tbody>
          </table>
          <h2>Treatment Progress</h2>
          <table>
            <thead><tr><th>Service</th><th>Sessions</th><th>Progress</th><th>State</th></tr></thead>
            <tbody>${progressRows || '<tr><td colspan="4">No treatment progress yet.</td></tr>'}</tbody>
          </table>
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
  const selectedToothEntries = selectedTeeth.map((tooth) => ({
    tooth,
    label: TOOTH_LABELS[tooth],
    note: chartDraft.teeth?.[tooth] || "",
  }));
  const selectedToothComment = selectedToothValues.every((note) => note === selectedToothValues[0])
    ? selectedToothValues[0] || ""
    : "";
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
        <div className="statCard accentRose">
          <span className="statLabel">Timeline events</span>
          <strong className="statValue">{selectedPatient?.timeline.length || 0}</strong>
        </div>
      </div>

      <div className="adminPanelGrid">
        <div className="card adminEditorCard">
          <div className="cardHeader">
            <div>
              <h3 className="title">Edit Patient Details</h3>
              <p className="sub">
                {isDentist
                  ? "Select a patient on the right to review details, treatment progress, and chart notes."
                  : "Select a patient on the right to refine their profile, review the visit timeline, and manage chart notes."}
              </p>
            </div>
            <span className="badge">{selectedPatient ? "Patient selected" : "Choose a patient"}</span>
          </div>

          {selectedPatient ? (
            <>
              <div className="editorPreview">
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

              <form onSubmit={savePatientDetails} className="form">
                <input className="input" placeholder="Full name" value={draft.name} readOnly={!canEditPatientProfile} onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value }))} />
                <input className="input" type="number" min="1" placeholder="Age" value={draft.age} readOnly={!canEditPatientProfile} onChange={(e) => setDraft((current) => ({ ...current, age: e.target.value }))} />
                <input className="input" placeholder="Phone" value={draft.phone} readOnly={!canEditPatientProfile} onChange={(e) => setDraft((current) => ({ ...current, phone: e.target.value }))} />
                <input className="input" placeholder="Email" value={draft.email} readOnly={!canEditPatientProfile} onChange={(e) => setDraft((current) => ({ ...current, email: e.target.value }))} />
                <select className="input" value={draft.patientType} disabled={!canEditPatientProfile} onChange={(e) => setDraft((current) => ({ ...current, patientType: e.target.value }))}>
                  <option>Regular Patient</option>
                  <option>Ortho Patient</option>
                </select>
                <select className="input" value={draft.status} disabled={!canEditPatientProfile} onChange={(e) => setDraft((current) => ({ ...current, status: e.target.value }))}>
                  <option>Active</option>
                  <option>Archived</option>
                </select>
                {canEditPatientProfile ? <button className="btn btnShine">Save Patient Details</button> : null}
              </form>

              <div className="analyticsGrid" style={{ marginTop: 18 }}>
                <div className="card analyticsCard">
                  <span className="detailLabel">Appointments made</span>
                  <strong>{selectedPatient.history.length}</strong>
                  <p>All visits linked to this patient record</p>
                </div>
                <div className="card analyticsCard">
                  <span className="detailLabel">Latest visit</span>
                  <strong>{selectedPatient.latest?.service || "No visit yet"}</strong>
                  <p>{selectedPatient.latest ? formatDateLabel(selectedPatient.latest.date) : "Waiting for first appointment"}</p>
                </div>
                <div className="card analyticsCard">
                  <span className="detailLabel">Preferred dentist</span>
                  <strong>{selectedPatient.preferredDentist || selectedPatient.latest?.selectedDentist || "No dentist yet"}</strong>
                  <p>Latest dentist tied to this record</p>
                </div>
              </div>

              <div className="card adminRecordsCard" style={{ marginTop: 18 }}>
                <div className="cardHeader">
                  <div>
                    <h3 className="title">Treatment Progress Tracker</h3>
                    <p className="sub">Track repeated services as sessions so ongoing treatments are easier to follow.</p>
                  </div>
                  <span className="badge">{selectedPatient.progress.length} services</span>
                </div>

                {selectedPatient.progress.length ? (
                  <div className="progressGrid">
                    {selectedPatient.progress.map((entry) => (
                      <div key={`${entry.service}-${entry.latestDate}`} className="progressCard">
                        <span className="detailLabel">{entry.service}</span>
                        <strong>{entry.progressLabel}</strong>
                        <p>{entry.totalSessions} total sessions • {entry.dentistSummary}</p>
                        <span className={`statusPill ${entry.completionState === "Completed" ? "approved" : entry.completionState === "Paused" ? "cancelled" : "pending"}`}>
                          {entry.completionState}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="emptyEditorState">No treatment progress history yet for this patient.</div>
                )}
              </div>

              <div className="card adminRecordsCard" style={{ marginTop: 18 }}>
                <div className="cardHeader">
                  <div>
                    <h3 className="title">Patient Visit Timeline</h3>
                    <p className="sub">A clean timeline of bookings, check-ins, and staff actions tied to this patient record.</p>
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
                  <div className="emptyEditorState">No timeline events are available for this patient yet.</div>
                )}
              </div>

              <div className="card adminRecordsCard" style={{ marginTop: 18 }}>
                <div className="cardHeader">
                  <div>
                    <h3 className="title">Role-Based Activity Log</h3>
                    <p className="sub">Recent staff actions related to this patient record, including profile edits and chart updates.</p>
                  </div>
                  <span className="badge">
                    {selectedPatient.timeline.filter((entry) => entry.kind === "audit").length} staff actions
                  </span>
                </div>

                {selectedPatient.timeline.filter((entry) => entry.kind === "audit").length ? (
                  <div className="timelineStack">
                    {selectedPatient.timeline
                      .filter((entry) => entry.kind === "audit")
                      .map((entry) => (
                        <div key={entry.id} className="timelineRow">
                          <div className="timelineDot active" />
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
                  <div className="emptyEditorState">No staff activity log entries are available for this patient yet.</div>
                )}
              </div>

              <div className="chartEditorCard">
                <div className="cardHeader" style={{ marginTop: 18 }}>
                  <div>
                    <h3 className="title">{canEditDentalChart ? "Dental Chart Notes" : "Dental Chart Overview"}</h3>
                    <p className="sub">
                      {canEditDentalChart
                        ? "Tap the tooth markers to select one or more teeth, then write a note that applies to every selected area."
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
                              <span>{label}</span>
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
                  <div className="emptyEditorState" style={{ marginTop: 12 }}>
                    This patient does not have a signed-in account linked yet, so the dental chart cannot be shown in the patient portal.
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="emptyEditorState">
              <strong>No patient selected</strong>
              <p>Pick a patient card to view their treatment progress, appointment timeline, and dental chart here.</p>
            </div>
          )}
        </div>
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

          <ul className="list detailedList">
            {filteredPatientCards.map((patient) => (
              <li key={patient.id} className={`item detailedItem patientShowcase ${selectedPatientId === patient.id ? "selectedRecord" : ""}`}>
                <button type="button" className="recordTapArea" onClick={() => setSelectedPatientId(patient.id)}>
                  <div className="detailContent">
                    <div className="detailTopRow">
                      <div>
                        <strong className="detailTitle">{patient.name}</strong>
                        <p className="detailSubtitle">
                          Age {patient.age || "-"} • {patient.patientType || "Regular Patient"} • {patient.phone || "No phone"} • {patient.email || "No email"}
                        </p>
                      </div>
                      <span className={`statusPill ${patient.status === "Archived" ? "cancelled" : "approved"}`}>{patient.status || "Active"}</span>
                    </div>

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
                      <div className="detailBox luxeBox">
                        <span className="detailLabel">Timeline events</span>
                        <strong>{patient.timeline.length}</strong>
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
                  </div>
                </button>

                <div className="actionColumn actionColumnFriendly">
                  <button className="btn patientActionBtn patientEditBtn" onClick={() => setSelectedPatientId(patient.id)}>
                    Open Patient Editor
                  </button>
                  <button className="btn patientActionBtn patientPdfBtn" onClick={() => exportPatientPdf(patient)}>
                    Download Record PDF
                  </button>
                  <button className="btn patientActionBtn archiveButton" onClick={() => toggleArchive(patient)}>
                    Move to Archive
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {!filteredPatientCards.length ? (
            <div className="emptyEditorState">
              {loadingPatients
                ? "Loading patient records..."
                : isDentist
                  ? "No patient records are available for this dentist view yet."
                  : "No active patients matched that name."}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
