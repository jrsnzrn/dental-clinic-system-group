import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
} from "firebase/firestore";
import { onAuthStateChanged, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { auth, db } from "../firebase";
import EmptyState from "../components/EmptyState";
import { SkeletonList } from "../components/LoadingSkeleton";
import { getActiveClosureForDate, getBookingServiceOptions, getClinicServiceImage, hasPotentialDuplicateBooking } from "../utils/clinic";
import {
  formatDateLabel,
  formatTimeLabel,
  getClinicAvailability,
  getDentistDaySchedule,
} from "../utils/schedule";

function pad(n) {
  return String(n).padStart(2, "0");
}

function toLocalISODate(d) {
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  return `${yyyy}-${mm}-${dd}`;
}

function isSunday(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.getDay() === 0;
}

function generateSlots() {
  const slots = [];
  for (let h = 9; h <= 17; h += 1) {
    slots.push(`${pad(h)}:00`);
    slots.push(`${pad(h)}:30`);
  }
  return slots;
}

function getEmptyProfile(email = "") {
  return {
    fullName: "",
    age: "",
    phone: "",
    patientType: "Regular Patient",
    email,
  };
}

function generateUpcomingDates(startDate, count = 12) {
  const dates = [];
  const cursor = new Date(startDate);

  while (dates.length < count) {
    const iso = toLocalISODate(cursor);
    if (!isSunday(iso)) {
      dates.push(iso);
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

export default function Book() {
  const [user, setUser] = useState(null);
  const [patientProfile, setPatientProfile] = useState(null);
  const [profileDraft, setProfileDraft] = useState(getEmptyProfile());
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [loadingDentists, setLoadingDentists] = useState(true);
  const [editingProfile, setEditingProfile] = useState(false);

  const [service, setService] = useState("Cleaning");
  const [clinicServices, setClinicServices] = useState([]);
  const [clinicClosures, setClinicClosures] = useState([]);
  const [dentists, setDentists] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [selectedDentist, setSelectedDentist] = useState("");
  const [date, setDate] = useState(toLocalISODate(new Date()));
  const [time, setTime] = useState("09:00");
  const [notes, setNotes] = useState("");
  const [agreedToPrivacyConsent, setAgreedToPrivacyConsent] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [recentlySubmitted, setRecentlySubmitted] = useState(false);

  const todayStr = toLocalISODate(new Date());
  const allSlots = useMemo(() => generateSlots(), []);
  const upcomingDates = useMemo(() => generateUpcomingDates(new Date(), 12), []);
  const activeServiceOptions = useMemo(() => getBookingServiceOptions(clinicServices), [clinicServices]);
  const selectedClosure = useMemo(() => getActiveClosureForDate(clinicClosures, date), [clinicClosures, date]);
  const selectedServiceRecord = useMemo(
    () => activeServiceOptions.find((entry) => entry.name === service) || null,
    [activeServiceOptions, service]
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setSuccess("");
      setError("");

      if (!u) {
        setPatientProfile(null);
        setProfileDraft(getEmptyProfile());
        setEditingProfile(false);
        setRecentlySubmitted(false);
        setAgreedToPrivacyConsent(false);
        return;
      }

      setLoadingProfile(true);
      try {
        const profileRef = doc(db, "patientProfiles", u.uid);
        const snap = await getDoc(profileRef);

        if (snap.exists()) {
          const data = snap.data();
          const nextProfile = {
            fullName: data.fullName || "",
            age: data.age || "",
            phone: data.phone || "",
            patientType: data.patientType || "Regular Patient",
            email: data.email || u.email || "",
          };
          setPatientProfile(nextProfile);
          setProfileDraft(nextProfile);
          setEditingProfile(false);
        } else {
          const emptyProfile = getEmptyProfile(u.email || "");
          setPatientProfile(null);
          setProfileDraft(emptyProfile);
          setEditingProfile(true);
        }
      } catch (profileError) {
        console.error(profileError);
        setError("Could not load your patient profile. Please try again.");
      } finally {
        setLoadingProfile(false);
      }
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "dentists"), (snap) => {
      const list = snap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      setDentists(list);
      setLoadingDentists(false);
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    const unsubServices = onSnapshot(query(collection(db, "clinicServices"), orderBy("name", "asc")), (snap) => {
      const nextServices = snap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      setClinicServices(nextServices);
    });

    const unsubClosures = onSnapshot(query(collection(db, "clinicClosures"), orderBy("date", "asc")), (snap) => {
      setClinicClosures(snap.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    });

    const unsubBookings = onSnapshot(collection(db, "bookings"), (snap) => {
      setBookings(snap.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    });

    return () => {
      unsubServices();
      unsubClosures();
      unsubBookings();
    };
  }, []);

  useEffect(() => {
    if (activeServiceOptions.length && !activeServiceOptions.some((entry) => entry.name === service)) {
      setService(activeServiceOptions[0].name);
    }
  }, [activeServiceOptions, service]);

  const availableDentists = useMemo(() => {
    return dentists.filter(
      (dentist) =>
        dentist.archiveStatus !== "Archived" &&
        getClinicAvailability(dentist, date, clinicClosures).available
    );
  }, [clinicClosures, date, dentists]);

  const selectedDentistRecord = useMemo(() => {
    return dentists.find((dentist) => dentist.name === selectedDentist) || null;
  }, [dentists, selectedDentist]);

  const selectedDaySchedule = getDentistDaySchedule(selectedDentistRecord, date);
  const selectedAvailability = getClinicAvailability(selectedDentistRecord, date, clinicClosures);
  const duplicateWarning = useMemo(
    () => hasPotentialDuplicateBooking(bookings, { uid: user?.uid, date, service }),
    [bookings, date, service, user?.uid]
  );

  useEffect(() => {
    if (!availableDentists.length) {
      setSelectedDentist("");
      return;
    }

    const stillAvailable = availableDentists.some((dentist) => dentist.name === selectedDentist);
    if (!stillAvailable) {
      setSelectedDentist(availableDentists[0].name);
    }
  }, [availableDentists, selectedDentist]);

  const availableSlots = useMemo(() => {
    const baseSlots =
      date !== todayStr
        ? allSlots
        : allSlots.filter((slot) => {
            const now = new Date();
            const cur = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
            return slot >= cur;
          });

    if (!selectedDentist || !selectedDaySchedule?.active) return baseSlots;

    return baseSlots.filter(
      (slot) => slot >= selectedDaySchedule.start && slot < selectedDaySchedule.end
    );
  }, [allSlots, date, selectedDaySchedule, selectedDentist, todayStr]);

  useEffect(() => {
    if (!availableSlots.includes(time)) {
      setTime(availableSlots[0] || "09:00");
    }
  }, [availableSlots, time]);

  async function loginGoogle() {
    setError("");
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (e) {
      console.error(e);
      setError("Google sign-in failed. Try again.");
    }
  }

  async function saveProfile(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!user) {
      setError("Please sign in first.");
      return;
    }
    if (!profileDraft.fullName.trim()) {
      setError("Please enter your full name.");
      return;
    }
    if (!String(profileDraft.age).trim()) {
      setError("Please enter your age.");
      return;
    }
    if (!profileDraft.phone.trim()) {
      setError("Please enter your phone number.");
      return;
    }

    const nextProfile = {
      uid: user.uid,
      email: user.email || profileDraft.email || "",
      fullName: profileDraft.fullName.trim(),
      age: String(profileDraft.age).trim(),
      phone: profileDraft.phone.trim(),
      patientType: profileDraft.patientType,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    };

    try {
      await setDoc(doc(db, "patientProfiles", user.uid), nextProfile, { merge: true });

      const savedProfile = {
        fullName: nextProfile.fullName,
        age: nextProfile.age,
        phone: nextProfile.phone,
        patientType: nextProfile.patientType,
        email: nextProfile.email,
      };

      setPatientProfile(savedProfile);
      setProfileDraft(savedProfile);
      setEditingProfile(false);
      setSuccess("Profile saved. You can now book appointments with your saved patient details.");
    } catch (profileError) {
      console.error(profileError);
      setError("Could not save your profile. Check your Firestore rules for patientProfiles.");
    }
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!user) {
      setError("Please sign in with Google to book an appointment.");
      return;
    }
    if (!patientProfile && !editingProfile) {
      setError("Please complete your patient profile before booking.");
      return;
    }
    if (!patientProfile?.fullName) return setError("Please complete your patient profile first.");
    if (!patientProfile?.age) return setError("Please complete your patient profile first.");
    if (!patientProfile?.phone) return setError("Please complete your patient profile first.");
    if (!date) return setError("Please choose a date.");
    if (date < todayStr) return setError("You cannot book before today.");
    if (isSunday(date)) return setError("Clinic is closed on Sundays. Please choose Monday to Saturday.");
    if (selectedClosure) return setError(`${selectedClosure.label} blocks booking on ${formatDateLabel(date)}. Please choose another day.`);
    if (!time) return setError("Please choose a time.");
    if (!agreedToPrivacyConsent) {
      return setError("Please confirm the confidentiality and clinic-use consent before submitting.");
    }
    if (!selectedDentist) return setError("No dentist is available on that day. Please choose another date.");
    if (!selectedDentistRecord || !selectedAvailability.available) {
      return setError("That dentist is inactive on the selected day. Please choose another dentist or date.");
    }

    const appointmentDate = new Date(`${date}T${time}:00`);
    const hour = appointmentDate.getHours();
    const minute = appointmentDate.getMinutes();
    const isBeforeOpen = hour < 9;
    const isAfterClose = hour > 17 || (hour === 17 && minute > 30);
    if (isBeforeOpen || isAfterClose) {
      return setError("Please choose a time between 9:00 AM and 6:00 PM.");
    }

    if (date === todayStr && appointmentDate < new Date()) {
      return setError("That time already passed. Choose a later time.");
    }

    const hasConflict = bookings.some((existing) => {
      return (
        existing.archiveStatus !== "Archived" &&
        existing.status !== "cancelled" &&
        existing.selectedDentist === selectedDentist &&
        existing.date === date &&
        existing.time === time
      );
    });

    if (hasConflict) {
      return setError("That appointment slot is already taken for the selected dentist. Please choose a different time.");
    }

    if (duplicateWarning) {
      const shouldContinue = window.confirm(
        "You already have another booking for the same service on this day. Do you still want to continue?"
      );
      if (!shouldContinue) return;
    }

    const confirmed = window.confirm(
      `Submit this booking?\n\nPatient: ${patientProfile.fullName}\nService: ${service}\nDentist: ${selectedDentist}\nDate: ${formatDateLabel(date)}\nTime: ${formatTimeLabel(time)}`
    );

    if (!confirmed) {
      return;
    }

    setSaving(true);
    try {
      await addDoc(collection(db, "bookings"), {
        uid: user.uid,
        patientProfileId: user.uid,
        email: patientProfile.email || user.email || "",
        fullName: patientProfile.fullName,
        patientKey: patientProfile.fullName.toLowerCase(),
        age: patientProfile.age,
        phone: patientProfile.phone,
        patientType: patientProfile.patientType,
        selectedDentist,
        dentistId: selectedDentistRecord?.id || "",
        service,
        date,
        time,
        notes: notes.trim(),
        privacyConsentAccepted: true,
        privacyConsentText:
          "I agree that my personal and medical information will be kept confidential and used for dental and clinic purposes only.",
        status: "pending",
        checkedInAt: null,
        appointmentAt: Timestamp.fromDate(appointmentDate),
        createdAt: serverTimestamp(),
      });

      setNotes("");
      setAgreedToPrivacyConsent(false);
      setSuccess("Booking submitted successfully. Your request is now waiting for admin approval.");
      setRecentlySubmitted(true);
    } catch (bookingError) {
      console.error(bookingError);
      setError("Booking failed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const profileReady = Boolean(patientProfile && !editingProfile);

  useEffect(() => {
    if (!recentlySubmitted) return;

    const timer = setTimeout(() => {
      setRecentlySubmitted(false);
    }, 5000);

    return () => clearTimeout(timer);
  }, [recentlySubmitted]);

  return (
    <div className="container bookingPage">
      <div className="hero bookingHero">
        <div className="bookingHeroGlow" />
        <div className="bookingHeroGrid">
          <div>
            <span className="heroEyebrow">Smart Booking Flow</span>
            <h1>Book an Appointment</h1>
            <p>
              Sign in with Google, create your patient profile once, and keep every future appointment connected to one clean patient history.
            </p>
          </div>
          <div className="bookingHeroSummary">
            <div className="bookingSummaryCard">
              <span className="detailLabel">Profile status</span>
              <strong>{profileReady ? "Ready to book" : "Sign-up required"}</strong>
            </div>
            <div className="bookingSummaryCard">
              <span className="detailLabel">Clinic schedule</span>
              <strong>{selectedClosure ? selectedClosure.label : "Mon-Sat • 9:00 AM - 6:00 PM"}</strong>
            </div>
            <div className="bookingSummaryCard">
              <span className="detailLabel">Booking identity</span>
              <strong>{patientProfile?.fullName || user?.email || "Google account required"}</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="grid" style={{ marginTop: 18 }}>
        <div className="card bookingFormCard">
          <div className="cardHeader">
            <div>
              <h3 className="title">{profileReady ? "Appointment Form" : "Patient Sign-up First"}</h3>
              <p className="sub">
                {profileReady
                  ? "Your patient details are locked to this Google account for cleaner tracking."
                  : "Before booking, complete your patient profile so the same Gmail cannot create appointments under different names."}
              </p>
            </div>
            <span className="badge">{user ? "Signed in" : "Guest"}</span>
          </div>

          {success ? (
            <div className="successBanner">
              <strong>{success}</strong>
              <span>Your appointment request is now in the pending queue and ready for admin review.</span>
            </div>
          ) : null}

          {!user ? (
            <button className="btn btnShine bookingPrimaryBtn" onClick={loginGoogle} type="button">
              Sign in with Google to Start
            </button>
          ) : null}

          {user && loadingProfile ? <SkeletonList count={1} /> : null}

          {user && !loadingProfile && (editingProfile || !patientProfile) ? (
            <form className="form" onSubmit={saveProfile} style={{ marginTop: 12 }}>
              <input
                className="input"
                placeholder="Full name"
                value={profileDraft.fullName}
                onChange={(e) => setProfileDraft((current) => ({ ...current, fullName: e.target.value }))}
                disabled={saving || loadingProfile}
              />

              <input
                className="input"
                type="number"
                min="1"
                placeholder="Age"
                value={profileDraft.age}
                onChange={(e) => setProfileDraft((current) => ({ ...current, age: e.target.value }))}
                disabled={saving || loadingProfile}
              />

              <input
                className="input"
                placeholder="Phone number"
                value={profileDraft.phone}
                onChange={(e) => setProfileDraft((current) => ({ ...current, phone: e.target.value }))}
                disabled={saving || loadingProfile}
              />

              <input className="input" value={user.email || profileDraft.email} disabled />

              <select
                className="input"
                value={profileDraft.patientType}
                onChange={(e) => setProfileDraft((current) => ({ ...current, patientType: e.target.value }))}
                disabled={saving || loadingProfile}
              >
                <option>Regular Patient</option>
                <option>Ortho Patient</option>
              </select>

              <button className="btn btnShine bookingPrimaryBtn" disabled={saving || loadingProfile}>
                {loadingProfile ? "Loading..." : "Save Patient Profile"}
              </button>
            </form>
          ) : null}

          {profileReady ? (
            <>
              <div className="editorPreview" style={{ marginTop: 12 }}>
                <div>
                  <span className="detailLabel">Signed-in patient</span>
                  <strong className="detailTitle">{patientProfile.fullName}</strong>
                  <p className="detailSubtitle">
                    Age {patientProfile.age || "-"} • {patientProfile.patientType} • {patientProfile.phone} • {patientProfile.email}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn secondary btnSoft bookingSecondaryBtn"
                  onClick={() => setEditingProfile(true)}
                >
                  Update Profile
                </button>
              </div>

              <form className="form" onSubmit={submit} style={{ marginTop: 12 }}>
                <select
                  className="input"
                  value={service}
                  onChange={(e) => setService(e.target.value)}
                  disabled={!user || saving}
                >
                  {activeServiceOptions.length ? (
                    activeServiceOptions.map((option) => (
                      <option key={option.name} value={option.name}>
                        {option.name}
                      </option>
                    ))
                  ) : (
                    <option value="Cleaning">Cleaning</option>
                  )}
                </select>

                <div className="bookingDatePanel">
                  <div className="bookingDatePanelHeader">
                    <div>
                      <span className="detailLabel">Choose appointment day</span>
                      <strong className="detailTitle">{formatDateLabel(date)}</strong>
                      <p className="detailSubtitle">
                        Tap one of the suggested clinic days below or use the calendar for another date.
                      </p>
                    </div>
                    <div className="bookingDateHighlight">
                      <span>Clinic days</span>
                      <strong>{selectedClosure ? selectedClosure.label : "Monday to Saturday"}</strong>
                    </div>
                  </div>

                  <div className="bookingDateScroller">
                    {upcomingDates.map((optionDate) => {
                      const optionDay = new Date(`${optionDate}T00:00:00`);
                      const isSelected = optionDate === date;

                      return (
                        <button
                          key={optionDate}
                          type="button"
                          className={`bookingDateChip ${isSelected ? "active" : ""}`}
                          onClick={() => setDate(optionDate)}
                          disabled={!user || saving}
                        >
                          <span className="bookingDateChipDay">
                            {optionDay.toLocaleDateString("en-US", { weekday: "short" })}
                          </span>
                          <strong>{optionDay.toLocaleDateString("en-US", { day: "2-digit" })}</strong>
                          <span className="bookingDateChipMonth">
                            {optionDay.toLocaleDateString("en-US", { month: "short" })}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <label className="bookingFieldCard">
                    <span className="detailLabel">Pick another date</span>
                    <input
                      className="input bookingInputSpecial"
                      type="date"
                      value={date}
                      min={todayStr}
                      onChange={(e) => setDate(e.target.value)}
                      disabled={!user || saving}
                    />
                  </label>
                </div>

                {date && isSunday(date) ? (
                  <div className="error">Closed on Sundays. Choose Monday to Saturday.</div>
                ) : null}
                {selectedClosure ? (
                  <div className="error">{selectedClosure.label} blocks booking on this date. Please choose another day.</div>
                ) : null}
                {duplicateWarning ? (
                  <div className="detailNote historyPanel reschedulePanel attention">
                    <span className="detailLabel">Duplicate booking warning</span>
                    <p>
                      You already have another <strong>{service}</strong> booking on <strong>{formatDateLabel(date)}</strong>. The clinic may reject same-day duplicate requests.
                    </p>
                  </div>
                ) : null}

                <div className="bookingFlowGrid">
                  <label className="bookingFieldCard">
                    <span className="detailLabel">Available dentist</span>
                    <select
                      className="input bookingInputSpecial"
                      value={selectedDentist}
                      onChange={(e) => setSelectedDentist(e.target.value)}
                      disabled={!user || saving || isSunday(date) || Boolean(selectedClosure) || !availableDentists.length}
                    >
                      {availableDentists.length ? (
                        availableDentists.map((dentist) => (
                          <option key={dentist.id} value={dentist.name}>
                            {dentist.name}
                          </option>
                        ))
                      ) : (
                        <option value="">No dentist available on this day</option>
                      )}
                    </select>
                  </label>

                  <label className="bookingFieldCard">
                    <span className="detailLabel">Choose time slot</span>
                    <select
                      className="input bookingInputSpecial"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      disabled={!user || saving || isSunday(date) || Boolean(selectedClosure) || !selectedDentist}
                    >
                      {availableSlots.length ? (
                        availableSlots.map((slot) => (
                          <option key={slot} value={slot}>
                            {formatTimeLabel(slot)}
                          </option>
                        ))
                      ) : (
                        <option value="">No available times today</option>
                      )}
                    </select>
                  </label>
                </div>

                {!loadingDentists && !availableDentists.length && !isSunday(date) && !selectedClosure ? (
                  <EmptyState
                    compact
                    title="No dentist available on this day"
                    message="Try another clinic day or choose a different date so the booking can continue."
                  />
                ) : null}

                {!loadingDentists && selectedDentist && !availableSlots.length && !isSunday(date) ? (
                  <EmptyState
                    compact
                    title="No available time slots"
                    message="This dentist has no open slots left on the selected day. Pick another date or another dentist."
                  />
                ) : null}

                <div className="bookingMiniSummary">
                  <div className="bookingMiniSummaryCard">
                    <span className="detailLabel">Selected day</span>
                    <strong>{formatDateLabel(date)}</strong>
                  </div>
                  <div className="bookingMiniSummaryCard">
                    <span className="detailLabel">Time slot</span>
                    <strong>{time ? formatTimeLabel(time) : "Choose time"}</strong>
                  </div>
                  <div className="bookingMiniSummaryCard">
                    <span className="detailLabel">Dentist</span>
                    <strong>{selectedDentist || "Choose dentist"}</strong>
                  </div>
                </div>

                <textarea
                  className="input"
                  rows={4}
                  placeholder="Notes (optional)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={!user || saving}
                />

                <label className="bookingConsentCard">
                  <input
                    type="checkbox"
                    checked={agreedToPrivacyConsent}
                    onChange={(e) => setAgreedToPrivacyConsent(e.target.checked)}
                    disabled={!user || saving}
                  />
                  <span>
                    I agree that my personal and medical information will be kept confidential and used for dental and clinic purposes only.
                  </span>
                </label>

                <button
                  className="btn btnShine bookingPrimaryBtn"
                  disabled={!user || saving || recentlySubmitted || isSunday(date) || Boolean(selectedClosure) || !selectedDentist || !agreedToPrivacyConsent}
                >
                  {saving ? "Submitting..." : recentlySubmitted ? "Booking Submitted" : "Submit Booking"}
                </button>
              </form>
            </>
          ) : null}

          {error ? <div className="error">{error}</div> : null}
        </div>

        <div className="card bookingDetailsCard">
          <div className="cardHeader">
            <div>
              <h3 className="title">Appointment Summary</h3>
              <p className="sub">Review the key appointment details before you submit.</p>
            </div>
          </div>

          {loadingProfile ? (
            <SkeletonList count={1} />
          ) : (
          <>
            <div className="bookingServicePreviewCard">
              <div className="bookingServicePreviewMedia">
                <img
                  src={getClinicServiceImage(selectedServiceRecord || { name: service })}
                  alt={service}
                />
              </div>
              <div className="bookingServicePreviewContent">
                <span className="detailLabel">Selected service</span>
                <strong>{service}</strong>
                <p>
                  {selectedServiceRecord?.description || "This service is currently available for booking through the clinic scheduler."}
                </p>
              </div>
            </div>

            <div className="detailGrid" style={{ marginTop: 18 }}>
              <div className="detailBox luxeBox">
                <span className="detailLabel">Patient name</span>
                <strong>{patientProfile?.fullName || "Complete sign-up first"}</strong>
              </div>
              <div className="detailBox luxeBox">
                <span className="detailLabel">Patient type</span>
                <strong>{patientProfile?.patientType || "Complete sign-up first"}</strong>
              </div>
              <div className="detailBox luxeBox">
                <span className="detailLabel">Age</span>
                <strong>{patientProfile?.age || "Complete sign-up first"}</strong>
              </div>
              <div className="detailBox luxeBox">
                <span className="detailLabel">Service</span>
                <strong>{service}</strong>
              </div>
              <div className="detailBox luxeBox">
                <span className="detailLabel">Preferred dentist</span>
                <strong>{selectedDentist || "No dentist available"}</strong>
              </div>
              <div className="detailBox luxeBox">
                <span className="detailLabel">Appointment day</span>
                <strong>{formatDateLabel(date)}</strong>
              </div>
              <div className="detailBox luxeBox">
                <span className="detailLabel">Appointment time</span>
                <strong>{formatTimeLabel(time)}</strong>
              </div>
              <div className="detailBox luxeBox">
                <span className="detailLabel">Dentist status</span>
                <strong>{selectedDentist && selectedDaySchedule?.active ? "Active" : "Inactive"}</strong>
              </div>
            </div>
          </>
          )}
        </div>
      </div>
    </div>
  );
}
