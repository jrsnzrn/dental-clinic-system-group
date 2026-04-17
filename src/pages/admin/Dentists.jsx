import { useEffect, useMemo, useState } from "react";
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
  formatScheduleSummary,
  getDentistScheduleStatus,
  normalizeScheduleExceptions,
  normalizeSchedule,
} from "../../utils/schedule";
import { logAdminAction } from "../../utils/audit";

const todayKey = DAY_ORDER[(new Date().getDay() + 6) % 7].key;

export default function Dentists() {
  const [dentists, setDentists] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [expandedDentistId, setExpandedDentistId] = useState("");
  const [detailDrafts, setDetailDrafts] = useState({});
  const [draftSchedules, setDraftSchedules] = useState({});
  const [exceptionDrafts, setExceptionDrafts] = useState({});

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [specialization, setSpecialization] = useState("");

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
    async function loadBookings() {
      const snap = await getDocs(collection(db, "bookings"));
      setBookings(snap.docs.map((d) => d.data()));
    }

    loadBookings();
  }, []);

  async function addDentist(e) {
    e.preventDefault();
    if (!name.trim()) return;

    const schedule = createDefaultSchedule();

    await addDoc(collection(db, "dentists"), {
      name: name.trim(),
      email: email.trim(),
      specialization: specialization.trim(),
      schedule,
      status: getDentistScheduleStatus({ schedule }, new Date().toISOString().slice(0, 10)),
      createdAt: serverTimestamp(),
    });

    await logAdminAction({
      action: "add_dentist",
      targetType: "dentist",
      targetLabel: name.trim(),
      details: {
        email: email.trim(),
        specialization: specialization.trim(),
      },
    });

    setName("");
    setEmail("");
    setSpecialization("");
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
    };

    const nextEmail = draft.email.trim();
    const nextSpecialization = draft.specialization.trim();

    await updateDoc(doc(db, "dentists", dentist.id), {
      email: nextEmail,
      specialization: nextSpecialization,
    });

    setDentists((current) =>
      current.map((entry) =>
        entry.id === dentist.id
          ? {
              ...entry,
              email: nextEmail,
              specialization: nextSpecialization,
            }
          : entry
      )
    );

    setDetailDrafts((current) => ({
      ...current,
      [dentist.id]: {
        email: nextEmail,
        specialization: nextSpecialization,
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

  return (
    <div className="container">
      <div className="hero">
        <h1>Dentists Management</h1>
        <p>Tap a dentist card to adjust weekly availability. A dentist is marked active only on days enabled in the schedule, and users cannot book them on inactive days.</p>
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
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            <input
              className="input"
              placeholder="Specialization (e.g. Orthodontist)"
              value={specialization}
              onChange={(e) => setSpecialization(e.target.value)}
            />

            <button className="btn">Add Dentist</button>
          </form>
        </div>

        <div className="card">
          <div className="cardHeader">
            <div>
              <h3 className="title">Schedule Overview</h3>
              <p className="sub">Current-day activity comes directly from the weekly scheduler below.</p>
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

      <ul className="list" style={{ marginTop: 20 }}>
        {visibleDentists.map((dentist) => {
          const isOpen = expandedDentistId === dentist.id;
          const detailDraft = detailDrafts[dentist.id] || {
            email: dentist.email || "",
            specialization: dentist.specialization || "",
          };
          const schedule = normalizeSchedule(draftSchedules[dentist.id] || dentist.schedule);
          const scheduleExceptions = normalizeScheduleExceptions(dentist.scheduleExceptions);
          const isActiveToday = schedule[todayKey]?.active;

          return (
            <li
              key={dentist.id}
              className={`item dentistCard ${isOpen ? "expanded" : ""}`}
              onClick={() => setExpandedDentistId(isOpen ? "" : dentist.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setExpandedDentistId(isOpen ? "" : dentist.id);
                }
              }}
            >
              <div className="detailContent" style={{ width: "100%" }}>
                <div className="detailTopRow">
                  <div>
                    <strong className="detailTitle">{dentist.name}</strong>
                    <p className="detailSubtitle">
                      {dentist.specialization || "No specialization"} • {dentist.email || "No email"}
                    </p>
                  </div>
                  <div className="statusStack">
                    <span className={`statusPill ${isActiveToday ? "approved" : "cancelled"}`}>
                      {isActiveToday ? "Active" : "Inactive"}
                    </span>
                    <span className="badge">{getBookingCount(dentist.name)} bookings</span>
                  </div>
                </div>

                <div className="detailNote">
                  <span className="detailLabel">Weekly schedule</span>
                  <p>{formatScheduleSummary(schedule)}</p>
                </div>

                <div className="detailNote">
                  <span className="detailLabel">Schedule exceptions</span>
                  <p>{formatExceptionSummary(scheduleExceptions)}</p>
                </div>

                <div
                  className="schedulerActions dentistQuickActions"
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    className="btn archiveButton"
                    type="button"
                    onClick={() => archiveDentist(dentist.id)}
                  >
                    Archive Dentist
                  </button>
                </div>

                {isOpen ? (
                  <div
                    className="schedulerPanel"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="cardHeader" style={{ marginBottom: 8 }}>
                      <div>
                        <h3 className="title">Dentist Details</h3>
                        <p className="sub">Update the clinic-facing email and specialization shown in the dentist management list.</p>
                      </div>
                    </div>

                    <div className="bookingFlowGrid">
                      <input
                        className="input"
                        type="email"
                        placeholder="Dentist email"
                        value={detailDraft.email}
                        onChange={(event) => updateDetailDraft(dentist.id, "email", event.target.value)}
                      />
                      <input
                        className="input"
                        placeholder="Specialization"
                        value={detailDraft.specialization}
                        onChange={(event) => updateDetailDraft(dentist.id, "specialization", event.target.value)}
                      />
                    </div>

                    <div className="inlineActionRow">
                      <button className="btn btnShine" type="button" onClick={() => saveDentistDetails(dentist)}>
                        Save Dentist Details
                      </button>
                      <button
                        className="btn secondary"
                        type="button"
                        onClick={() =>
                          setDetailDrafts((current) => ({
                            ...current,
                            [dentist.id]: {
                              email: dentist.email || "",
                              specialization: dentist.specialization || "",
                            },
                          }))
                        }
                      >
                        Reset Details
                      </button>
                    </div>

                    <div className="cardHeader" style={{ marginBottom: 8, marginTop: 16 }}>
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
                              checked={schedule[day.key].active}
                              onChange={(event) =>
                                updateDraftSchedule(dentist.id, day.key, "active", event.target.checked)
                              }
                            />
                            <span>{day.label}</span>
                          </label>

                          <input
                            className="input"
                            type="time"
                            value={schedule[day.key].start}
                            disabled={!schedule[day.key].active}
                            onChange={(event) =>
                              updateDraftSchedule(dentist.id, day.key, "start", event.target.value)
                            }
                          />

                          <input
                            className="input"
                            type="time"
                            value={schedule[day.key].end}
                            disabled={!schedule[day.key].active}
                            onChange={(event) =>
                              updateDraftSchedule(dentist.id, day.key, "end", event.target.value)
                            }
                          />
                        </div>
                      ))}
                    </div>

                    <div className="schedulerActions">
                      <button className="btn" type="button" onClick={() => saveSchedule(dentist)}>
                        Save Schedule
                      </button>
                      <button
                        className="btn secondary"
                        type="button"
                        onClick={() =>
                          setDraftSchedules((current) => ({
                            ...current,
                            [dentist.id]: normalizeSchedule(dentist.schedule),
                          }))
                        }
                      >
                        Reset Changes
                      </button>
                    </div>

                    <div className="card adminRecordsCard" style={{ marginTop: 14 }}>
                      <div className="cardHeader">
                        <div>
                          <h3 className="title">Schedule Exceptions</h3>
                          <p className="sub">Use date-specific overrides for leave, half-days, holidays, or emergency changes.</p>
                        </div>
                      </div>

                      <div className="bookingFlowGrid">
                        <input className="input" type="date" value={exceptionDrafts[dentist.id]?.date || ""} onChange={(event) => updateExceptionDraft(dentist.id, "date", event.target.value)} />
                        <input className="input" placeholder="Label (e.g. Leave, Half-day)" value={exceptionDrafts[dentist.id]?.label || ""} onChange={(event) => updateExceptionDraft(dentist.id, "label", event.target.value)} />
                      </div>

                      <div className="bookingFlowGrid" style={{ marginTop: 12 }}>
                        <select className="input" value={String(exceptionDrafts[dentist.id]?.active || false)} onChange={(event) => updateExceptionDraft(dentist.id, "active", event.target.value === "true")}>
                          <option value="false">Unavailable all day</option>
                          <option value="true">Available with custom hours</option>
                        </select>
                        <input className="input" type="time" value={exceptionDrafts[dentist.id]?.start || "09:00"} disabled={!exceptionDrafts[dentist.id]?.active} onChange={(event) => updateExceptionDraft(dentist.id, "start", event.target.value)} />
                        <input className="input" type="time" value={exceptionDrafts[dentist.id]?.end || "18:00"} disabled={!exceptionDrafts[dentist.id]?.active} onChange={(event) => updateExceptionDraft(dentist.id, "end", event.target.value)} />
                      </div>

                      <div className="inlineActionRow">
                        <button className="btn btnShine" type="button" onClick={() => addException(dentist)}>
                          Save Exception
                        </button>
                      </div>

                      {scheduleExceptions.length ? (
                        <ul className="list" style={{ marginTop: 14 }}>
                          {scheduleExceptions.map((entry) => (
                            <li key={`${dentist.id}-${entry.date}`} className="item">
                              <div className="kv">
                                <strong>{entry.date} • {entry.label}</strong>
                                <span>{entry.active ? `${entry.start} - ${entry.end}` : "Unavailable all day"}</span>
                              </div>
                              <button className="btn danger" type="button" onClick={() => removeException(dentist, entry.date)}>
                                Remove
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
