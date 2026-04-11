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
import { db } from "../../firebase";
import {
  formatDateLabel,
  formatTimeLabel,
  formatTimestamp,
} from "../../utils/schedule";
import { createEmptyDentalChart, getClosestToothFromPoint, TOOTH_LABELS, TOOTH_MARKERS } from "../../utils/teeth";

function normalizeName(value) {
  return String(value ?? "").trim().toLowerCase();
}

function sortBookings(bookings) {
  return [...bookings].sort((a, b) => {
    const aTime = a.appointmentAt?.seconds || a.createdAt?.seconds || 0;
    const bTime = b.appointmentAt?.seconds || b.createdAt?.seconds || 0;
    return bTime - aTime;
  });
}

function getLatestBooking(bookings) {
  return sortBookings(bookings)[0];
}

async function syncPatientRecordFromBooking(bookingData, existingPatients) {
  const match = existingPatients.find((patient) => {
    if (bookingData.uid && patient.uid === bookingData.uid) return true;
    return normalizeName(patient.name) === normalizeName(bookingData.fullName || bookingData.patientKey);
  });

  const payload = {
    uid: bookingData.uid || "",
    name: bookingData.fullName || "Unnamed Patient",
    age: bookingData.age || "",
    phone: bookingData.phone || "",
    email: bookingData.email || "",
    patientType: bookingData.patientType || "Regular Patient",
    preferredDentist: bookingData.selectedDentist || "",
    latestService: bookingData.service || "",
    latestBookedAt: bookingData.createdAt || null,
    lastApprovedAt: bookingData.appointmentAt || null,
    lastAppointmentDate: bookingData.date || "",
    lastAppointmentTime: bookingData.time || "",
    lastCheckedInAt: bookingData.checkedInAt || null,
    status: "Active",
  };

  if (match) {
    await updateDoc(doc(db, "patients", match.id), payload);
    return { ...match, ...payload };
  }

  const ref = doc(collection(db, "patients"));
  await setDoc(ref, {
    ...payload,
    createdAt: bookingData.createdAt || new Date(),
  });
  return { id: ref.id, ...payload };
}

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

export default function Patients() {
  const [patients, setPatients] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [draft, setDraft] = useState(getEmptyDraft());
  const [search, setSearch] = useState("");
  const [chartDraft, setChartDraft] = useState(createEmptyDentalChart());
  const [selectedTooth, setSelectedTooth] = useState("11");
  const [hoveredTooth, setHoveredTooth] = useState("");

  function resolveToothFromEvent(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const xPercent = ((event.clientX - bounds.left) / bounds.width) * 100;
    const yPercent = ((event.clientY - bounds.top) / bounds.height) * 100;
    return getClosestToothFromPoint(xPercent, yPercent);
  }

  async function load() {
    const patientQuery = query(collection(db, "patients"), orderBy("createdAt", "desc"));
    const patientSnap = await getDocs(patientQuery);
    let patientList = patientSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const bookingsSnap = await getDocs(collection(db, "bookings"));
    const bookingList = bookingsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const approvedBookings = bookingList.filter((booking) => booking.status === "approved");
    for (const booking of approvedBookings) {
      const hasMatch = patientList.some((patient) => {
        if (booking.uid && patient.uid === booking.uid) return true;
        return normalizeName(patient.name) === normalizeName(booking.fullName || booking.patientKey);
      });

      if (!hasMatch) {
        const syncedPatient = await syncPatientRecordFromBooking(booking, patientList);
        patientList = [syncedPatient, ...patientList];
      }
    }

    setPatients(patientList);
    setBookings(bookingList);

    if (!selectedPatientId && patientList.length) {
      setSelectedPatientId(patientList[0].id);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const patientCards = useMemo(() => {
    return patients
      .filter((patient) => patient.status !== "Archived")
      .map((patient) => {
        const patientBookings = bookings.filter((booking) => {
          if (patient.uid && booking.uid) {
            return patient.uid === booking.uid;
          }
          return normalizeName(booking.fullName) === normalizeName(patient.name);
        });
        const history = sortBookings(patientBookings);
        const latest = getLatestBooking(history);

        return {
          ...patient,
          history,
          latest,
        };
      });
  }, [bookings, patients]);

  const filteredPatientCards = useMemo(() => {
    const term = normalizeName(search);
    if (!term) return patientCards;
    return patientCards.filter((patient) => normalizeName(patient.name).includes(term));
  }, [patientCards, search]);

  const selectedPatient = useMemo(() => {
    return patientCards.find((patient) => patient.id === selectedPatientId) || null;
  }, [patientCards, selectedPatientId]);

  useEffect(() => {
    if (!selectedPatient) {
      setDraft(getEmptyDraft());
      setChartDraft(createEmptyDentalChart());
      return;
    }

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
  }

  async function toggleArchive(patient) {
    await updateDoc(doc(db, "patients", patient.id), {
      status: patient.status === "Archived" ? "Active" : "Archived",
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
          <div class="chart-marker" style="top:${TOOTH_MARKERS[tooth]?.top};left:${TOOTH_MARKERS[tooth]?.left};">
            ${tooth}
          </div>
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
            @page { size: auto; margin: 10mm; }
            html, body { margin: 0; padding: 0; }
            body {
              font-family: Arial, sans-serif;
              padding: 18px;
              color: #1f2937;
              background: linear-gradient(180deg, #f8fafc, #eef6ff);
            }
            h1, h2 { margin-bottom: 8px; }
            h2 { margin-top: 22px; }
            .page {
              border: 1px solid #d7e3f4;
              border-radius: 24px;
              background: #ffffff;
              padding: 24px;
              box-shadow: 0 18px 38px rgba(15, 23, 42, 0.08);
            }
            .header {
              display: flex;
              justify-content: space-between;
              gap: 16px;
              align-items: flex-start;
              padding-bottom: 18px;
              border-bottom: 1px solid #dbe7f3;
            }
            .brand {
              display: inline-flex;
              align-items: center;
              gap: 10px;
              font-weight: 700;
              color: #0f172a;
            }
            .brand-mark {
              width: 38px;
              height: 38px;
              border-radius: 12px;
              background: linear-gradient(135deg, #0ea5a5, #3b82f6);
              color: white;
              display: grid;
              place-items: center;
              font-size: 18px;
            }
            .header-note {
              color: #475569;
              font-size: 13px;
              max-width: 260px;
              text-align: right;
            }
            .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 20px 0; }
            .card {
              border: 1px solid #d7e3f4;
              border-radius: 16px;
              padding: 14px;
              page-break-inside: avoid;
              break-inside: avoid;
              background: linear-gradient(180deg, #ffffff, #f8fbff);
            }
            .label { font-size: 12px; text-transform: uppercase; color: #64748b; margin-bottom: 6px; letter-spacing: 0.08em; }
            table { width: 100%; border-collapse: collapse; margin-top: 18px; page-break-inside: auto; }
            tr, td, th { page-break-inside: avoid; break-inside: avoid; }
            th, td { border: 1px solid #d1d5db; padding: 10px; text-align: left; }
            th { background: #eff6ff; }
            .chart-wrap {
              position: relative;
              margin-top: 18px;
              border: 1px solid #d7e3f4;
              border-radius: 18px;
              overflow: hidden;
              background: #ffffff;
              page-break-inside: avoid;
              break-inside: avoid;
            }
            .chart-wrap img {
              width: 100%;
              max-height: 820px;
              object-fit: contain;
              display: block;
            }
            .chart-marker {
              position: absolute;
              transform: translate(-50%, -50%);
              min-width: 34px;
              height: 34px;
              padding: 0 8px;
              border-radius: 999px;
              background: rgba(11, 18, 32, 0.88);
              color: #ffffff;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 12px;
              font-weight: 700;
              box-shadow: 0 8px 18px rgba(0,0,0,0.18);
            }
            .section-lead {
              color: #475569;
              margin-top: 4px;
            }
          </style>
        </head>
        <body>
          <div class="page">
            <div class="header">
              <div>
                <div class="brand">
                  <div class="brand-mark">🦷</div>
                  <div>
                    <div>TopDent Patient Record</div>
                    <div class="section-lead">Generated clinic summary for consultation, print, and record keeping.</div>
                  </div>
                </div>
              </div>
              <div class="header-note">
                Exported from the TopDent admin patient database.
              </div>
            </div>

            <div class="meta">
              <div class="card"><div class="label">Full name</div><strong>${patient.name || "-"}</strong></div>
              <div class="card"><div class="label">Age</div><strong>${patient.age || "-"}</strong></div>
              <div class="card"><div class="label">Phone</div><strong>${patient.phone || "-"}</strong></div>
              <div class="card"><div class="label">Email</div><strong>${patient.email || "-"}</strong></div>
              <div class="card"><div class="label">Patient type</div><strong>${patient.patientType || "Regular Patient"}</strong></div>
              <div class="card"><div class="label">Preferred dentist</div><strong>${patient.preferredDentist || patient.latest?.selectedDentist || "-"}</strong></div>
            </div>

            <h2>Appointment History</h2>
            <table>
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Dentist</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${historyRows || '<tr><td colspan="5">No appointment history yet.</td></tr>'}
              </tbody>
            </table>

            <h2>Dental Chart</h2>
            <div class="chart-wrap">
              <img src="/dental-numbering-system.png" alt="Dental numbering system chart" />
              ${chartMarkers}
            </div>

            <table>
              <thead>
                <tr>
                  <th>Tooth</th>
                  <th>Description</th>
                  <th>Dentist Note</th>
                </tr>
              </thead>
              <tbody>
                ${toothNotesRows || '<tr><td colspan="3">No tooth-specific notes saved yet.</td></tr>'}
              </tbody>
            </table>

            <div style="margin-top:18px;" class="card">
              <div class="label">General dentist notes</div>
              <strong>${dentalChart.generalNotes || "No general notes saved yet."}</strong>
            </div>
          </div>
          <script>
            window.onload = () => {
              setTimeout(() => {
                window.print();
              }, 250);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }

  const focusedTooth = hoveredTooth || selectedTooth;
  const selectedToothComment = chartDraft.teeth?.[selectedTooth] || "";

  return (
    <div className="container adminSurface">
      <div className="hero adminHero">
        <div className="adminHeroGlow" />
        <div className="adminHeroContent">
          <span className="heroEyebrow">Patient Intelligence</span>
          <h1>Patients Management</h1>
          <p>Track visit history, refine patient information, manage age and contact data, and let the dentist click directly on the dental chart image to leave notes.</p>
        </div>
      </div>

      <div className="statsGrid adminStats">
        <div className="statCard accentTeal">
          <span className="statLabel">Registered</span>
          <strong className="statValue">{patients.length}</strong>
        </div>
        <div className="statCard accentBlue">
          <span className="statLabel">Active records</span>
          <strong className="statValue">{patientCards.length}</strong>
        </div>
        <div className="statCard accentRose">
          <span className="statLabel">Archived</span>
          <strong className="statValue">{patients.filter((p) => p.status === "Archived").length}</strong>
        </div>
        <div className="statCard accentGold">
          <span className="statLabel">Profiles with email</span>
          <strong className="statValue">{patientCards.filter((patient) => patient.email).length}</strong>
        </div>
      </div>

      <div className="adminPanelGrid">
        <div className="card adminEditorCard">
          <div className="cardHeader">
            <div>
              <h3 className="title">Edit Patient Details</h3>
              <p className="sub">Select a patient card on the right to refine their profile, update age, and keep their chart notes organized.</p>
            </div>
            <span className="badge">{selectedPatient ? "Editing" : "Choose a patient"}</span>
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
                <input
                  className="input"
                  placeholder="Full name"
                  value={draft.name}
                  onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value }))}
                />

                <input
                  className="input"
                  type="number"
                  min="1"
                  placeholder="Age"
                  value={draft.age}
                  onChange={(e) => setDraft((current) => ({ ...current, age: e.target.value }))}
                />

                <input
                  className="input"
                  placeholder="Phone"
                  value={draft.phone}
                  onChange={(e) => setDraft((current) => ({ ...current, phone: e.target.value }))}
                />

                <input
                  className="input"
                  placeholder="Email"
                  value={draft.email}
                  onChange={(e) => setDraft((current) => ({ ...current, email: e.target.value }))}
                />

                <select
                  className="input"
                  value={draft.patientType}
                  onChange={(e) => setDraft((current) => ({ ...current, patientType: e.target.value }))}
                >
                  <option>Regular Patient</option>
                  <option>Ortho Patient</option>
                </select>

                <select
                  className="input"
                  value={draft.status}
                  onChange={(e) => setDraft((current) => ({ ...current, status: e.target.value }))}
                >
                  <option>Active</option>
                  <option>Archived</option>
                </select>

                <button className="btn btnShine">Save Patient Details</button>
              </form>

              <div className="chartEditorCard">
                <div className="cardHeader" style={{ marginTop: 18 }}>
                  <div>
                    <h3 className="title">Dental Chart Notes</h3>
                    <p className="sub">Tap directly on the numbering image below to choose a tooth, then write the dentist note for that specific area.</p>
                  </div>
                </div>

                {selectedPatient.uid ? (
                  <>
                    <div className="toothViewer3d adminToothChart">
                      <div
                        className="toothViewerHalo"
                        style={{
                          top: TOOTH_MARKERS[focusedTooth]?.top,
                          left: TOOTH_MARKERS[focusedTooth]?.left,
                        }}
                      />
                      <button
                        type="button"
                        className="toothImageSurface"
                        onClick={(event) => setSelectedTooth(resolveToothFromEvent(event))}
                        onMouseMove={(event) => setHoveredTooth(resolveToothFromEvent(event))}
                        onMouseLeave={() => setHoveredTooth("")}
                        aria-label="Tap inside the dental chart image to select a tooth"
                      >
                        <img className="toothReferenceImage" src="/dental-numbering-system.png" alt="Dental numbering system" />
                      </button>
                      <div className="toothViewerLegend">
                        <span>Selected tooth</span>
                        <strong>{focusedTooth}</strong>
                      </div>
                    </div>

                    <div className="detailNote historyPanel selectedToothPanel" style={{ marginTop: 14 }}>
                      <span className="detailLabel">Selected tooth</span>
                      <p>
                        <strong>{selectedTooth}</strong> {" - "} {TOOTH_LABELS[selectedTooth]}
                      </p>
                      <p>{selectedToothComment || "No note saved for this tooth yet."}</p>
                    </div>

                    <textarea
                      className="input"
                      rows={4}
                      placeholder="Tooth-specific comment"
                      value={selectedToothComment}
                      onChange={(e) =>
                        setChartDraft((current) => ({
                          ...current,
                          uid: selectedPatient.uid,
                          teeth: {
                            ...(current.teeth || {}),
                            [selectedTooth]: e.target.value,
                          },
                        }))
                      }
                    />

                    <textarea
                      className="input"
                      rows={5}
                      placeholder="General dentist notes"
                      value={chartDraft.generalNotes || ""}
                      onChange={(e) =>
                        setChartDraft((current) => ({
                          ...current,
                          uid: selectedPatient.uid,
                          generalNotes: e.target.value,
                        }))
                      }
                    />

                    <button className="btn btnShine" type="button" onClick={saveDentalChart}>
                      Save Dental Chart Notes
                    </button>
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
              <p>Approved bookings appear in the patient database automatically. Pick a patient card to edit their details, age, history, and dental chart here.</p>
            </div>
          )}
        </div>

        <div className="card adminRecordsCard">
          <div className="cardHeader">
            <div>
              <h3 className="title">Patient Records</h3>
              <p className="sub">Search patients by name, review their full appointment history, and use the action buttons below for quick edits, export, or archive.</p>
            </div>
            <span className="badge">{filteredPatientCards.length} records</span>
          </div>

          <input
            className="input searchInput"
            placeholder="Search patient name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <ul className="list detailedList">
            {filteredPatientCards.map((patient) => (
              <li
                key={patient.id}
                className={`item detailedItem patientShowcase ${selectedPatientId === patient.id ? "selectedRecord" : ""}`}
              >
                <button
                  type="button"
                  className="recordTapArea"
                  onClick={() => setSelectedPatientId(patient.id)}
                >
                  <div className="detailContent">
                    <div className="detailTopRow">
                      <div>
                        <strong className="detailTitle">{patient.name}</strong>
                        <p className="detailSubtitle">
                          Age {patient.age || "-"} • {patient.patientType || "Regular Patient"} • {patient.phone || "No phone"} • {patient.email || "No email"}
                        </p>
                      </div>
                      <span className={`statusPill ${patient.status === "Archived" ? "cancelled" : "approved"}`}>
                        {patient.status || "Active"}
                      </span>
                    </div>

                    <div className="detailGrid">
                      <div className="detailBox luxeBox">
                        <span className="detailLabel">Age</span>
                        <strong>{patient.age || "Not set"}</strong>
                      </div>
                      <div className="detailBox luxeBox">
                        <span className="detailLabel">Preferred dentist</span>
                        <strong>{patient.preferredDentist || patient.latest?.selectedDentist || "No bookings yet"}</strong>
                      </div>
                      <div className="detailBox luxeBox">
                        <span className="detailLabel">Latest service</span>
                        <strong>{patient.latestService || patient.latest?.service || "No bookings yet"}</strong>
                      </div>
                      <div className="detailBox luxeBox">
                        <span className="detailLabel">Booked at</span>
                        <strong>{formatTimestamp(patient.latestBookedAt || patient.latest?.createdAt)}</strong>
                      </div>
                      <div className="detailBox luxeBox">
                        <span className="detailLabel">Checked in at</span>
                        <strong>{formatTimestamp(patient.lastCheckedInAt || patient.latest?.checkedInAt)}</strong>
                      </div>
                      <div className="detailBox luxeBox">
                        <span className="detailLabel">Appointment day</span>
                        <strong>{formatDateLabel(patient.lastAppointmentDate || patient.latest?.date)}</strong>
                      </div>
                      <div className="detailBox luxeBox">
                        <span className="detailLabel">Appointment time</span>
                        <strong>{formatTimeLabel(patient.lastAppointmentTime || patient.latest?.time)}</strong>
                      </div>
                    </div>

                    <div className="detailNote historyPanel">
                      <span className="detailLabel">Appointment History</span>
                      {patient.history?.length ? (
                        <div className="historyList">
                          {patient.history.map((booking) => (
                            <div key={booking.id} className="historyRow">
                              <div>
                                <strong>{booking.service || "Service not set"}</strong>
                                <p>
                                  {formatDateLabel(booking.date)} at {formatTimeLabel(booking.time)}
                                </p>
                              </div>
                              <div className="historyMeta">
                                <span>{booking.selectedDentist || "No dentist"}</span>
                                <span className={`statusPill ${booking.status || "pending"}`}>
                                  {booking.status || "pending"}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p>No appointment history yet.</p>
                      )}
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
            <div className="emptyEditorState">No active patients matched that name.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
