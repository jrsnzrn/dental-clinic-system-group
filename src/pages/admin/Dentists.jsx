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
  formatScheduleSummary,
  getDentistScheduleStatus,
  normalizeSchedule,
} from "../../utils/schedule";

const todayKey = DAY_ORDER[(new Date().getDay() + 6) % 7].key;

export default function Dentists() {
  const [dentists, setDentists] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [expandedDentistId, setExpandedDentistId] = useState("");
  const [draftSchedules, setDraftSchedules] = useState({});

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

    setName("");
    setEmail("");
    setSpecialization("");
  }

  function getBookingCount(dentistName) {
    return bookings.filter((b) => b.selectedDentist === dentistName).length;
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
          const schedule = normalizeSchedule(draftSchedules[dentist.id] || dentist.schedule);
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

                {isOpen ? (
                  <div
                    className="schedulerPanel"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="cardHeader" style={{ marginBottom: 8 }}>
                      <div>
                        <h3 className="title">Adjust Schedule</h3>
                        <p className="sub">Turn each day on or off and set the dentist’s working hours.</p>
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
                        onClick={() => archiveDentist(dentist.id)}
                      >
                        Archive Dentist
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
