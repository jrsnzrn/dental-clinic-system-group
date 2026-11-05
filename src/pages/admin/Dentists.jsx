import RecordPagination from "../../components/RecordPagination";
import LoadingIndicator from "../../components/LoadingIndicator";
import { linkedDentistNameFields, formatStaffDisplayName } from "../../utils/staffProfile";
import useRecordPagination from "../../hooks/useRecordPagination";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  getDocs,
  doc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../firebase";
import {
  DAY_ORDER,
  createDefaultSchedule,
  getDentistScheduleStatus,
  normalizeSchedule,
} from "../../utils/schedule";
import { logAdminAction } from "../../utils/audit";
import { ROLES } from "../../utils/rbac";

const todayKey = DAY_ORDER[(new Date().getDay() + 6) % 7].key;

export default function Dentists() {
  const [dentists, setDentists] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [staffAccounts, setStaffAccounts] = useState([]);
  const [expandedDentistId, setExpandedDentistId] = useState("");
  const [detailDrafts, setDetailDrafts] = useState({});
  const [draftSchedules, setDraftSchedules] = useState({});
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [savingAction, setSavingAction] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState("");
  const saving = Boolean(savingAction);

  const [name, setName] = useState("");
  const [specialization, setSpecialization] = useState("");
  const [linkedStaffUid, setLinkedStaffUid] = useState("");

  useEffect(() => {
    const q = query(collection(db, "dentists"), orderBy("createdAt", "desc"));

    const unsub = onSnapshot(q, (snap) => {
      const nextDentists = snap.docs.map((entry) => ({
        id: entry.id,
        ...entry.data(),
      }));

      setDentists(nextDentists);
      setDetailDrafts((current) => {
        const next = { ...current };
        nextDentists.forEach((dentist) => {
          next[dentist.id] = current[dentist.id] || {
            email: dentist.email || "",
            specialization: dentist.specialization || "",
            linkedStaffUid: dentist.linkedStaffUid || "",
          };
        });
        return next;
      });
      setDraftSchedules((current) => {
        const next = { ...current };
        nextDentists.forEach((dentist) => {
          next[dentist.id] = current[dentist.id] || normalizeSchedule(dentist.schedule);
        });
        return next;
      });
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    const staffQuery = query(collection(db, "admins"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(staffQuery, (snap) => {
      setStaffAccounts(
        snap.docs
          .map((entry) => ({ id: entry.id, ...entry.data() }))
          .filter((entry) => entry.role === ROLES.DENTIST && entry.archiveStatus !== "Archived")
      );
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    async function loadBookings() {
      const snap = await getDocs(collection(db, "bookings"));
      setBookings(snap.docs.map((d) => d.data()));
    }

    loadBookings();
  }, []);

  // Close the dentist modal with the Escape key
  useEffect(() => {
    if (!expandedDentistId && !addModalOpen) return;

    const onKeyDown = (event) => {
      if (event.key === "Escape" && !saving) {
        setExpandedDentistId("");
        setAddModalOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [addModalOpen, expandedDentistId, saving]);

  function clearSaveFeedback() {
    setSaveError("");
    setSaveSuccess("");
  }

  async function runSave(action, save, successMessage) {
    if (saving) return;
    setSavingAction(action);
    clearSaveFeedback();
    try {
      await save();
      setSaveSuccess(successMessage);
    } catch (error) {
      console.error("Dentist changes could not be saved:", error);
      setSaveError(error?.message || "Could not save. Please try again.");
    } finally {
      setSavingAction("");
    }
  }

  async function addDentist() {
    const schedule = createDefaultSchedule();
    const linkedStaff = staffAccounts.find((entry) => entry.id === linkedStaffUid) || null;

    await addDoc(collection(db, "dentists"), {
      name: name.trim(),
      ...linkedDentistNameFields(linkedStaff),
      email: linkedStaff?.email || "",
      specialization: specialization.trim(),
      linkedStaffUid: linkedStaff?.id || "",
      linkedStaffEmail: linkedStaff?.email || "",
      linkedStaffName: linkedStaff ? formatStaffDisplayName(linkedStaff) : "",
      schedule,
      status: getDentistScheduleStatus({ schedule }, new Date().toISOString().slice(0, 10)),
      createdAt: serverTimestamp(),
    });

    await logAdminAction({
      action: "add_dentist",
      targetType: "dentist",
      targetLabel: name.trim(),
      details: {
        email: linkedStaff?.email || "",
        specialization: specialization.trim(),
        linkedStaffUid: linkedStaff?.id || "",
      },
    });

    setName("");
    setSpecialization("");
    setLinkedStaffUid("");
    setAddModalOpen(false);
  }

  function getBookingCount(dentist) {
    return bookings.filter(booking => booking.dentistId
      ? booking.dentistId === dentist.id
      : booking.selectedDentist === dentist.name).length;
  }

  function updateDetailDraft(dentistId, field, value) {
    setDetailDrafts((current) => ({
      ...current,
      [dentistId]: {
        ...current[dentistId],
        [field]: value,
      },
    }));
  }

  async function saveDentistDetails(dentist) {
    const draft = detailDrafts[dentist.id] || {
      email: dentist.email || "",
      specialization: dentist.specialization || "",
      linkedStaffUid: dentist.linkedStaffUid || "",
    };

    const nextEmail = draft.email.trim();
    const nextSpecialization = draft.specialization.trim();
    const linkedStaff = staffAccounts.find((entry) => entry.id === draft.linkedStaffUid) || null;

    await updateDoc(doc(db, "dentists", dentist.id), {
      email: nextEmail,
      ...linkedDentistNameFields(linkedStaff),
      specialization: nextSpecialization,
      linkedStaffUid: linkedStaff?.id || "",
      linkedStaffEmail: linkedStaff?.email || "",
      linkedStaffName: linkedStaff ? formatStaffDisplayName(linkedStaff) : "",
    });

    setDentists((current) =>
      current.map((entry) =>
        entry.id === dentist.id
          ? {
              ...entry,
              ...linkedDentistNameFields(linkedStaff),
              email: nextEmail,
              specialization: nextSpecialization,
              linkedStaffUid: linkedStaff?.id || "",
              linkedStaffEmail: linkedStaff?.email || "",
              linkedStaffName: linkedStaff ? formatStaffDisplayName(linkedStaff) : "",
            }
          : entry
      )
    );

    setDetailDrafts((current) => ({
      ...current,
      [dentist.id]: {
        email: nextEmail,
        specialization: nextSpecialization,
        linkedStaffUid: linkedStaff?.id || "",
      },
    }));

    await logAdminAction({
      action: "update_dentist_profile",
      targetType: "dentist",
      targetId: dentist.id,
      targetLabel: dentist.name || "Dentist",
      details: {
        email: nextEmail,
        specialization: nextSpecialization,
        linkedStaffUid: linkedStaff?.id || "",
      },
    });
  }

  function updateDraftSchedule(dentistId, dayKey, field, value) {
    setDraftSchedules((current) => ({
      ...current,
      [dentistId]: {
        ...normalizeSchedule(current[dentistId]),
        [dayKey]: {
          ...normalizeSchedule(current[dentistId])[dayKey],
          [field]: value,
        },
      },
    }));
  }

  async function saveSchedule(dentist) {
    const nextSchedule = normalizeSchedule(draftSchedules[dentist.id]);
    const todayDate = new Date().toISOString().slice(0, 10);

    await updateDoc(doc(db, "dentists", dentist.id), {
      schedule: nextSchedule,
      status: getDentistScheduleStatus({ schedule: nextSchedule }, todayDate),
    });

    await logAdminAction({
      action: "update_dentist_schedule",
      targetType: "dentist",
      targetId: dentist.id,
      targetLabel: dentist.name || "Dentist",
    });
  }

  const visibleDentists = useMemo(
    () => dentists.filter((dentist) => dentist.archiveStatus !== "Archived"),
    [dentists]
  );

  // The dentist currently open in the modal (if any)
  const dentistPage = useRecordPagination(visibleDentists);
  const openDentist = visibleDentists.find((entry) => entry.id === expandedDentistId) || null;
  const openDetailDraft = openDentist
    ? detailDrafts[openDentist.id] || {
        email: openDentist.email || "",
        specialization: openDentist.specialization || "",
        linkedStaffUid: openDentist.linkedStaffUid || "",
      }
    : null;
  const openSchedule = openDentist
    ? normalizeSchedule(draftSchedules[openDentist.id] || openDentist.schedule)
    : null;

  return (
    <div className="container adminSurface dentistManagementPage">
      <section className="card adminRecordsCard dentistRecordsCard">
        <div className="cardHeader dentistRecordsHeader">
          <div className="dentistRecordsActions">
            <span className="badge">{visibleDentists.length} records</span>
            <button className="btn dentistAddButton" type="button" disabled={saving} onClick={() => {
              clearSaveFeedback();
              setAddModalOpen(true);
            }}>
              + Add Dentist
            </button>
          </div>
        </div>

        {!addModalOpen && !openDentist && saveSuccess ? <p role="status">{saveSuccess}</p> : null}

        {visibleDentists.length ? (
          <div className="dentistTableWrap">
            <table className="patientTable">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Specialization</th>
                  <th>Email</th>
                  <th>Linked Login</th>
                  <th>Bookings</th>
                  <th className="patientTableStatusHead">Status</th>
                </tr>
              </thead>
              <tbody>
                {dentistPage.items.map((dentist) => {
                  const isOpen = expandedDentistId === dentist.id;
                  const rowSchedule = normalizeSchedule(draftSchedules[dentist.id] || dentist.schedule);
                  const isActiveToday = rowSchedule[todayKey]?.active;

                  return (
                    <tr
                      key={dentist.id}
                      className={`patientTableRow ${isOpen ? "selectedRecord" : ""}`}
                      onClick={() => {
                        clearSaveFeedback();
                        setExpandedDentistId(isOpen ? "" : dentist.id);
                      }}
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          clearSaveFeedback();
                          setExpandedDentistId(isOpen ? "" : dentist.id);
                        }
                      }}
                    >
                      <td className="patientTableNameCell">{dentist.name}</td>
                      <td>{dentist.specialization || "-"}</td>
                      <td>{dentist.email || "No email"}</td>
                      <td>{dentist.linkedStaffName || dentist.linkedStaffEmail || "Not linked"}</td>
                      <td>{getBookingCount(dentist)}</td>
                      <td className="patientTableStatusCell">
                        <span className={`statusPill ${isActiveToday ? "approved" : "cancelled"}`}>
                          {isActiveToday ? "Active" : "Inactive"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
              {dentistPage.pageCount > 1 ? <RecordPagination pagination={dentistPage} /> : null}
          </div>
        ) : (
          <div className="emptyEditorState" style={{ marginTop: 16 }}>
            <strong>No dentists yet</strong>
            <p>Add a dentist to see their record here.</p>
          </div>
        )}
      </section>

      {addModalOpen
        ? createPortal(
            <>
              <div className="dentistModalOverlay" onClick={() => { if (!saving) setAddModalOpen(false); }} />
              <form
                className="schedulerPanel dentistModal addDentistDialog"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (name.trim()) runSave("add", addDentist, "Dentist added.");
                }}
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="addDentistTitle"
              >
                <div className="patientDrawerHeader">
                  <div>
                    <strong className="detailTitle" id="addDentistTitle">Add Dentist</strong>
                    <p className="detailSubtitle">New dentists start with a Mon-Sat 9:00 AM to 6:00 PM schedule.</p>
                  </div>
                  <button
                    type="button"
                    className="patientDrawerCloseBtn"
                    onClick={() => setAddModalOpen(false)}
                    aria-label="Close Add Dentist form"
                    disabled={saving}
                  >
                    ×
                  </button>
                </div>

                <div className="form addDentistForm">
                  <input
                    className="input"
                    aria-label="Dentist Name"
                    placeholder="Dentist Name"
                    value={name}
                    required
                    disabled={saving}
                    onChange={(event) => setName(event.target.value)}
                  />
                  <input
                    className="input"
                    aria-label="Specialization"
                    placeholder="Specialization (e.g. Orthodontist)"
                    value={specialization}
                    disabled={saving}
                    onChange={(event) => setSpecialization(event.target.value)}
                  />
                  <select
                    className="input"
                    aria-label="Link dentist staff account"
                    value={linkedStaffUid}
                    disabled={saving}
                    onChange={(event) => setLinkedStaffUid(event.target.value)}
                  >
                    <option value="">Link dentist staff account</option>
                    {staffAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name || account.email} {account.email ? `- ${account.email}` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                {saveError ? <p className="formError" role="alert">{saveError}</p> : null}
                <div className="addDentistActions">
                  <button className="btn btnShine" type="submit" disabled={saving}>
                    {savingAction === "add" ? <LoadingIndicator>Adding dentist…</LoadingIndicator> : "Add"}
                  </button>
                  <button className="btn secondary" type="button" disabled={saving} onClick={() => setAddModalOpen(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            </>,
            document.body
          )
        : null}

      {openDentist
        ? createPortal(
            <>
              <div
                className="dentistModalOverlay"
                onClick={() => { if (!saving) setExpandedDentistId(""); }}
              />
              <div
                className="schedulerPanel dentistModal"
                role="dialog"
                aria-modal="true"
              >
                <div className="patientDrawerHeader dentistProfileHeader">
                  <div className="dentistProfileInfo">
                    <strong className="detailTitle">{openDentist.name}</strong>
                    <div className="dentistProfileMeta">
                      <span><strong>Specialization</strong>{openDentist.specialization || "Not specified"}</span>
                      <span><strong>Email</strong>{openDentist.email || "No email"}</span>
                      <span><strong>Linked account</strong>{openDentist.linkedStaffName || openDentist.linkedStaffEmail || "Not linked"}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="patientDrawerCloseBtn"
                    onClick={() => setExpandedDentistId("")}
                    aria-label="Close dentist panel"
                    disabled={saving}
                  >
                    ×
                  </button>
                </div>

                {saveError ? <p className="formError" role="alert">{saveError}</p> : null}
                {saveSuccess ? <p role="status">{saveSuccess}</p> : null}

                <section className="dentistEditorSection">
                  <div className="cardHeader dentistEditorSectionHeader">
                    <div>
                      <h3 className="title">Dentist Details</h3>
                      <p className="sub">Update the specialization and linked login shown in the dentist list.</p>
                    </div>
                  </div>

                  <div className="dentistDetailFields">
                    <label>
                      <span>Specialization</span>
                      <input
                        className="input"
                        placeholder="Specialization"
                        value={openDetailDraft.specialization}
                        disabled={saving}
                        onChange={(event) => updateDetailDraft(openDentist.id, "specialization", event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Linked staff account</span>
                      <select
                        className="input"
                        value={openDetailDraft.linkedStaffUid || ""}
                        disabled={saving}
                        onChange={(event) => updateDetailDraft(openDentist.id, "linkedStaffUid", event.target.value)}
                      >
                        <option value="">No linked dentist login</option>
                        {staffAccounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name || account.email} {account.email ? `- ${account.email}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="inlineActionRow dentistEditorActions">
                    <button className="btn btnShine" type="button" disabled={saving}
                      onClick={() => runSave("details", () => saveDentistDetails(openDentist), "Dentist details saved.")}>
                      {savingAction === "details" ? <LoadingIndicator>Saving details…</LoadingIndicator> : "Save Dentist Details"}
                    </button>
                    <button
                      className="btn secondary"
                      type="button"
                      disabled={saving}
                      onClick={() =>
                        setDetailDrafts((current) => ({
                          ...current,
                          [openDentist.id]: {
                            email: openDentist.email || "",
                            specialization: openDentist.specialization || "",
                            linkedStaffUid: openDentist.linkedStaffUid || "",
                          },
                        }))
                      }
                    >
                      Reset Details
                    </button>
                  </div>
                </section>

                <section className="dentistEditorSection">
                  <div className="cardHeader dentistEditorSectionHeader">
                    <div>
                      <h3 className="title">Adjust Schedule</h3>
                      <p className="sub">Turn each day on or off and set the dentist's working hours.</p>
                    </div>
                  </div>

                  <div className="schedulerGrid">
                    {DAY_ORDER.map((day) => (
                      <div key={day.key} className={`schedulerRow ${openSchedule[day.key].active ? "isEnabled" : "isDisabled"}`}>
                        <label className="schedulerDay">
                          <input
                            type="checkbox"
                            checked={openSchedule[day.key].active}
                            disabled={saving}
                            onChange={(event) =>
                              updateDraftSchedule(openDentist.id, day.key, "active", event.target.checked)
                            }
                          />
                          <span>{day.label}</span>
                        </label>

                        <input
                          className="input"
                          type="time"
                          aria-label={`${day.label} start time`}
                          value={openSchedule[day.key].start}
                          disabled={saving || !openSchedule[day.key].active}
                          onChange={(event) =>
                            updateDraftSchedule(openDentist.id, day.key, "start", event.target.value)
                          }
                        />

                        <input
                          className="input"
                          type="time"
                          aria-label={`${day.label} end time`}
                          value={openSchedule[day.key].end}
                          disabled={saving || !openSchedule[day.key].active}
                          onChange={(event) =>
                            updateDraftSchedule(openDentist.id, day.key, "end", event.target.value)
                          }
                        />
                      </div>
                    ))}
                  </div>

                  <div className="schedulerActions dentistEditorActions">
                    <button className="btn btnShine" type="button" disabled={saving}
                      onClick={() => runSave("schedule", () => saveSchedule(openDentist), "Schedule saved.")}>
                      {savingAction === "schedule" ? <LoadingIndicator>Saving schedule…</LoadingIndicator> : "Save Schedule"}
                    </button>
                    <button
                      className="btn secondary"
                      type="button"
                      disabled={saving}
                      onClick={() =>
                        setDraftSchedules((current) => ({
                          ...current,
                          [openDentist.id]: normalizeSchedule(openDentist.schedule),
                        }))
                      }
                    >
                      Reset Changes
                    </button>
                  </div>
                </section>

              </div>
            </>,
            document.body
          )
        : null}
    </div>
  );
}
