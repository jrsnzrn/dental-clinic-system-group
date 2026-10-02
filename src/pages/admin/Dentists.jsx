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
  formatExceptionSummary,
  formatTimeLabel,
  getDentistScheduleStatus,
  normalizeScheduleExceptions,
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
  const [exceptionDrafts, setExceptionDrafts] = useState({});

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
      setExceptionDrafts((current) => {
        const next = { ...current };
        nextDentists.forEach((dentist) => {
          next[dentist.id] = current[dentist.id] || {
            date: "",
            label: "",
            active: false,
            start: "09:00",
            end: "18:00",
          };
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
    if (!expandedDentistId) return;

    const onKeyDown = (event) => {
      if (event.key === "Escape") setExpandedDentistId("");
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expandedDentistId]);

  async function addDentist(e) {
    e.preventDefault();
    if (!name.trim()) return;

    const schedule = createDefaultSchedule();
    const linkedStaff = staffAccounts.find((entry) => entry.id === linkedStaffUid) || null;

    await addDoc(collection(db, "dentists"), {
      name: name.trim(),
      email: linkedStaff?.email || "",
      specialization: specialization.trim(),
      linkedStaffUid: linkedStaff?.id || "",
      linkedStaffEmail: linkedStaff?.email || "",
      linkedStaffName: linkedStaff?.name || "",
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
  }

  function getBookingCount(dentistName) {
    return bookings.filter((b) => b.selectedDentist === dentistName).length;
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
      specialization: nextSpecialization,
      linkedStaffUid: linkedStaff?.id || "",
      linkedStaffEmail: linkedStaff?.email || "",
      linkedStaffName: linkedStaff?.name || "",
    });

    setDentists((current) =>
      current.map((entry) =>
        entry.id === dentist.id
          ? {
              ...entry,
              email: nextEmail,
              specialization: nextSpecialization,
              linkedStaffUid: linkedStaff?.id || "",
              linkedStaffEmail: linkedStaff?.email || "",
              linkedStaffName: linkedStaff?.name || "",
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

  function updateExceptionDraft(dentistId, field, value) {
    setExceptionDrafts((current) => ({
      ...current,
      [dentistId]: {
        ...current[dentistId],
        [field]: value,
      },
    }));
  }

  async function addException(dentist) {
    const draft = exceptionDrafts[dentist.id];
    if (!draft?.date || !draft?.label) return;

    const currentExceptions = normalizeScheduleExceptions(dentist.scheduleExceptions);
    const nextExceptions = [
      ...currentExceptions.filter((entry) => entry.date !== draft.date),
      {
        date: draft.date,
        label: draft.label,
        type: "exception",
        active: draft.active,
        start: draft.start,
        end: draft.end,
      },
    ];

    await updateDoc(doc(db, "dentists", dentist.id), {
      scheduleExceptions: nextExceptions,
    });

    await logAdminAction({
      action: "add_dentist_schedule_exception",
      targetType: "dentist",
      targetId: dentist.id,
      targetLabel: dentist.name || "Dentist",
      details: {
        date: draft.date,
        label: draft.label,
        active: draft.active,
      },
    });

    setExceptionDrafts((current) => ({
      ...current,
      [dentist.id]: {
        date: "",
        label: "",
        active: false,
        start: "09:00",
        end: "18:00",
      },
    }));
  }

  async function removeException(dentist, date) {
    const nextExceptions = normalizeScheduleExceptions(dentist.scheduleExceptions).filter(
      (entry) => entry.date !== date
    );
    await updateDoc(doc(db, "dentists", dentist.id), { scheduleExceptions: nextExceptions });
  }

  const summary = useMemo(() => {
    const activeDentists = dentists.filter((dentist) => dentist.archiveStatus !== "Archived");
    return {
      total: activeDentists.length,
      activeToday: activeDentists.filter((dentist) => normalizeSchedule(dentist.schedule)[todayKey]?.active).length,
    };
  }, [dentists]);

  const visibleDentists = useMemo(
    () => dentists.filter((dentist) => dentist.archiveStatus !== "Archived"),
    [dentists]
  );

  async function archiveDentist(dentistId) {
    await updateDoc(doc(db, "dentists", dentistId), {
      archiveStatus: "Archived",
    });

    const dentist = dentists.find((entry) => entry.id === dentistId);
    await logAdminAction({
      action: "archive_dentist",
      targetType: "dentist",
      targetId: dentistId,
      targetLabel: dentist?.name || "Dentist",
    });
  }

  // The dentist currently open in the modal (if any)
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
  const openExceptions = openDentist ? normalizeScheduleExceptions(openDentist.scheduleExceptions) : [];

  return (
    <div className="container adminSurface">
      <div className="hero">
        <h1>Dentists Management</h1>
        <p>Click a dentist to adjust weekly availability. A dentist is marked active only on days enabled in the schedule, and users cannot book them on inactive days.</p>
      </div>

      <div className="grid" style={{ marginTop: 18 }}>
        <div className="card">
          <div className="cardHeader">
            <div>
              <h3 className="title">Add Dentist</h3>
              <p className="sub">New dentists start with a Mon-Sat 9:00 AM to 6:00 PM schedule.</p>
            </div>
          </div>

          <form onSubmit={addDentist} className="form">
            <input
              className="input"
              placeholder="Dentist Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />

            <input
              className="input"
              placeholder="Specialization (e.g. Orthodontist)"
              value={specialization}
              onChange={(e) => setSpecialization(e.target.value)}
            />
            <select
              className="input"
              value={linkedStaffUid}
              onChange={(e) => setLinkedStaffUid(e.target.value)}
            >
              <option value="">Link dentist staff account</option>
              {staffAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name || account.email} {account.email ? `- ${account.email}` : ""}
                </option>
              ))}
            </select>

            <button className="btn">Add Dentist</button>
          </form>
        </div>

        <div className="card">
          <div className="cardHeader">
            <div>
              <h3 className="title">Schedule Overview</h3>
              <p className="sub">Current-day activity comes directly from the weekly scheduler.</p>
            </div>
          </div>

          <div className="statsGrid compact">
            <div className="statCard">
              <span className="statLabel">Dentists</span>
              <strong className="statValue">{summary.total}</strong>
            </div>
            <div className="statCard">
              <span className="statLabel">Active today</span>
              <strong className="statValue">{summary.activeToday}</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="card adminRecordsCard" style={{ marginTop: 24 }}>
        <div className="cardHeader">
          <div>
            <h3 className="title">Dentist Records</h3>
            <p className="sub">Click a dentist to review details, adjust the weekly schedule, and manage exceptions.</p>
          </div>
          <span className="badge">{visibleDentists.length} records</span>
        </div>

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
                  <th className="patientTableStatusHead"></th>
                </tr>
              </thead>
              <tbody>
                {visibleDentists.map((dentist) => {
                  const isOpen = expandedDentistId === dentist.id;
                  const rowSchedule = normalizeSchedule(draftSchedules[dentist.id] || dentist.schedule);
                  const isActiveToday = rowSchedule[todayKey]?.active;

                  return (
                    <tr
                      key={dentist.id}
                      className={`patientTableRow ${isOpen ? "selectedRecord" : ""}`}
                      onClick={() => setExpandedDentistId(isOpen ? "" : dentist.id)}
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setExpandedDentistId(isOpen ? "" : dentist.id);
                        }
                      }}
                    >
                      <td className="patientTableNameCell">{dentist.name}</td>
                      <td>{dentist.specialization || "-"}</td>
                      <td>{dentist.email || "No email"}</td>
                      <td>{dentist.linkedStaffName || dentist.linkedStaffEmail || "Not linked"}</td>
                      <td>{getBookingCount(dentist.name)}</td>
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
          </div>
        ) : (
          <div className="emptyEditorState" style={{ marginTop: 16 }}>
            <strong>No dentists yet</strong>
            <p>Add a dentist above and they will appear in this list.</p>
          </div>
        )}
      </div>

      {openDentist
        ? createPortal(
            <>
              <div
                className="dentistModalOverlay"
                onClick={() => setExpandedDentistId("")}
              />
              <div
                className="schedulerPanel dentistModal"
                role="dialog"
                aria-modal="true"
              >
                <div className="patientDrawerHeader">
                  <div>
                    <strong className="detailTitle">{openDentist.name}</strong>
                    <p className="detailSubtitle">
                      {openDentist.specialization || "No specialization"} • {openDentist.email || "No email"}
                    </p>
                    <p className="detailSubtitle">
                      {openDentist.linkedStaffName || openDentist.linkedStaffEmail || "No linked dentist login yet"}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="patientDrawerCloseBtn"
                    onClick={() => setExpandedDentistId("")}
                    aria-label="Close dentist panel"
                  >
                    ×
                  </button>
                </div>

                <div className="detailNote">
                  <span className="detailLabel">Weekly schedule</span>
                  <div className="weekSummary">
                    {DAY_ORDER.map((day) => {
                      const slot = openSchedule[day.key];
                      return (
                        <div
                          key={day.key}
                          className={`weekDay ${slot.active ? "on" : "off"} ${day.key === todayKey ? "today" : ""}`}
                        >
                          <span className="weekDayName">{day.label.slice(0, 3)}</span>
                          {slot.active ? (
                            <>
                              <span className="weekDayTime">{formatTimeLabel(slot.start)}</span>
                              <span className="weekDayTime">{formatTimeLabel(slot.end)}</span>
                            </>
                          ) : (
                            <span className="weekDayOff">Off</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="detailNote">
                  <span className="detailLabel">Schedule exceptions</span>
                  <p>{formatExceptionSummary(openExceptions)}</p>
                </div>

                <div className="cardHeader">
                  <div>
                    <h3 className="title">Dentist Details</h3>
                    <p className="sub">Update the specialization and linked login shown in the dentist list.</p>
                  </div>
                </div>

                <div className="bookingFlowGrid">
                  <input
                    className="input"
                    placeholder="Specialization"
                    value={openDetailDraft.specialization}
                    onChange={(event) => updateDetailDraft(openDentist.id, "specialization", event.target.value)}
                  />
                  <select
                    className="input"
                    value={openDetailDraft.linkedStaffUid || ""}
                    onChange={(event) => updateDetailDraft(openDentist.id, "linkedStaffUid", event.target.value)}
                  >
                    <option value="">No linked dentist login</option>
                    {staffAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name || account.email} {account.email ? `- ${account.email}` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="inlineActionRow">
                  <button className="btn btnShine" type="button" onClick={() => saveDentistDetails(openDentist)}>
                    Save Dentist Details
                  </button>
                  <button
                    className="btn secondary"
                    type="button"
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

                <div className="cardHeader">
                  <div>
                    <h3 className="title">Adjust Schedule</h3>
                    <p className="sub">Turn each day on or off and set the dentist's working hours.</p>
                  </div>
                </div>

                <div className="schedulerGrid">
                  {DAY_ORDER.map((day) => (
                    <div key={day.key} className="schedulerRow">
                      <label className="schedulerDay">
                        <input
                          type="checkbox"
                          checked={openSchedule[day.key].active}
                          onChange={(event) =>
                            updateDraftSchedule(openDentist.id, day.key, "active", event.target.checked)
                          }
                        />
                        <span>{day.label}</span>
                      </label>

                      <input
                        className="input"
                        type="time"
                        value={openSchedule[day.key].start}
                        disabled={!openSchedule[day.key].active}
                        onChange={(event) =>
                          updateDraftSchedule(openDentist.id, day.key, "start", event.target.value)
                        }
                      />

                      <input
                        className="input"
                        type="time"
                        value={openSchedule[day.key].end}
                        disabled={!openSchedule[day.key].active}
                        onChange={(event) =>
                          updateDraftSchedule(openDentist.id, day.key, "end", event.target.value)
                        }
                      />
                    </div>
                  ))}
                </div>

                <div className="schedulerActions">
                  <button className="btn btnShine" type="button" onClick={() => saveSchedule(openDentist)}>
                    Save Schedule
                  </button>
                  <button
                    className="btn secondary"
                    type="button"
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

                <div className="cardHeader">
                  <div>
                    <h3 className="title">Schedule Exceptions</h3>
                    <p className="sub">Use date-specific overrides for leave, half-days, holidays, or emergency changes.</p>
                  </div>
                </div>

                <div className="bookingFlowGrid">
                  <input className="input" type="date" value={exceptionDrafts[openDentist.id]?.date || ""} onChange={(event) => updateExceptionDraft(openDentist.id, "date", event.target.value)} />
                  <input className="input" placeholder="Label (e.g. Leave, Half-day)" value={exceptionDrafts[openDentist.id]?.label || ""} onChange={(event) => updateExceptionDraft(openDentist.id, "label", event.target.value)} />
                </div>

                <div className="bookingFlowGrid">
                  <select className="input" value={String(exceptionDrafts[openDentist.id]?.active || false)} onChange={(event) => updateExceptionDraft(openDentist.id, "active", event.target.value === "true")}>
                    <option value="false">Unavailable all day</option>
                    <option value="true">Available with custom hours</option>
                  </select>
                  <input className="input" type="time" value={exceptionDrafts[openDentist.id]?.start || "09:00"} disabled={!exceptionDrafts[openDentist.id]?.active} onChange={(event) => updateExceptionDraft(openDentist.id, "start", event.target.value)} />
                  <input className="input" type="time" value={exceptionDrafts[openDentist.id]?.end || "18:00"} disabled={!exceptionDrafts[openDentist.id]?.active} onChange={(event) => updateExceptionDraft(openDentist.id, "end", event.target.value)} />
                </div>

                <div className="inlineActionRow">
                  <button className="btn btnShine" type="button" onClick={() => addException(openDentist)}>
                    Save Exception
                  </button>
                </div>

                {openExceptions.length ? (
                  <ul className="list">
                    {openExceptions.map((entry) => (
                      <li key={`${openDentist.id}-${entry.date}`} className="item">
                        <div className="kv">
                          <strong>{entry.date} • {entry.label}</strong>
                          <span>{entry.active ? `${entry.start} - ${entry.end}` : "Unavailable all day"}</span>
                        </div>
                        <button className="btn danger" type="button" onClick={() => removeException(openDentist, entry.date)}>
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="actionColumn actionColumnFriendly">
                  <button
                    className="btn patientActionBtn archiveButton"
                    type="button"
                    onClick={async () => {
                      await archiveDentist(openDentist.id);
                      setExpandedDentistId("");
                    }}
                  >
                    Archive Dentist
                  </button>
                </div>
              </div>
            </>,
            document.body
          )
        : null}
    </div>
  );
}