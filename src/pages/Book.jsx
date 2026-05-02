import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { onAuthStateChanged, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "../firebase";
import ConfirmDialog from "../components/ConfirmDialog";
import EmptyState from "../components/EmptyState";
import { SkeletonList } from "../components/LoadingSkeleton";
import { getActiveClosureForDate, getBookingServiceOptions, getClinicServiceImage } from "../utils/clinic";
import { buildFullName, splitFullName } from "../utils/names";
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

function timeToMinutes(timeStr = "") {
  const [hourText = "0", minuteText = "0"] = String(timeStr).split(":");
  return Number(hourText) * 60 + Number(minuteText);
}

function minutesToTime(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${pad(hours)}:${pad(minutes)}`;
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
    firstName: "",
    middleName: "",
    lastName: "",
    fullName: "",
    age: "",
    phone: "",
    patientType: "New Patient",
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

function getMonthStart(dateStr) {
  const base = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
  return new Date(base.getFullYear(), base.getMonth(), 1);
}

function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

export default function Book() {
  const [user, setUser] = useState(null);
  const [patientProfile, setPatientProfile] = useState(null);
  const [profileDraft, setProfileDraft] = useState(getEmptyProfile());
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [loadingDentists, setLoadingDentists] = useState(true);
  const [editingProfile, setEditingProfile] = useState(false);

  const [selectedServices, setSelectedServices] = useState(["Cleaning"]);
  const [clinicServices, setClinicServices] = useState([]);
  const [clinicClosures, setClinicClosures] = useState([]);
  const [dentists, setDentists] = useState([]);
  const [selectedDentistId, setSelectedDentistId] = useState("");
  const [servicePreviewIndex, setServicePreviewIndex] = useState(0);
  const [date, setDate] = useState(toLocalISODate(new Date()));
  const [time, setTime] = useState("09:00");
  const [notes, setNotes] = useState("");
  const [agreedToPrivacyConsent, setAgreedToPrivacyConsent] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [recentlySubmitted, setRecentlySubmitted] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => getMonthStart(toLocalISODate(new Date())));
  const [datePageStart, setDatePageStart] = useState(toLocalISODate(new Date()));
  const [slotOptions, setSlotOptions] = useState([]);
  const [blockedRanges, setBlockedRanges] = useState([]);
  const [duplicateWarning, setDuplicateWarning] = useState(false);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");
  const [bookingConfirmation, setBookingConfirmation] = useState(null);
  const [successModalOpen, setSuccessModalOpen] = useState(false);

  const todayStr = toLocalISODate(new Date());
  const getBookingAvailability = useMemo(
    () => httpsCallable(functions, "getBookingAvailability"),
    []
  );
  const createBooking = useMemo(
    () => httpsCallable(functions, "createBooking"),
    []
  );
  const upcomingDates = useMemo(() => generateUpcomingDates(new Date(`${datePageStart}T00:00:00`), 8), [datePageStart]);
  const activeServiceOptions = useMemo(() => getBookingServiceOptions(clinicServices), [clinicServices]);
  const selectedClosure = useMemo(() => getActiveClosureForDate(clinicClosures, date), [clinicClosures, date]);
  const selectedServiceRecords = useMemo(
    () => selectedServices
      .map((name) => activeServiceOptions.find((entry) => entry.name === name))
      .filter(Boolean),
    [activeServiceOptions, selectedServices]
  );
  const selectedServiceRecord = selectedServiceRecords[0] || null;
  const previewServiceRecord = selectedServiceRecords[servicePreviewIndex] || selectedServiceRecord;
  const service = selectedServices.join(", ");
  const serviceDurationMinutes = selectedServiceRecords.reduce(
    (total, entry) => total + Number(entry.durationMinutes || 0),
    0
  );
  const appointmentDurationMinutes = serviceDurationMinutes || selectedServiceRecord?.durationMinutes || 60;
  const selectedTimeEnd = time ? minutesToTime(timeToMinutes(time) + appointmentDurationMinutes) : "";
  const selectedTimeRange = time ? `${formatTimeLabel(time)} - ${formatTimeLabel(selectedTimeEnd)}` : "";

  useEffect(() => {
    if (selectedServiceRecords.length <= 1) {
      setServicePreviewIndex(0);
      return undefined;
    }

    const timer = setInterval(() => {
      setServicePreviewIndex((current) => (current + 1) % selectedServiceRecords.length);
    }, 2400);

    return () => clearInterval(timer);
  }, [selectedServiceRecords.length]);

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
        setSlotOptions([]);
        setBlockedRanges([]);
        setDuplicateWarning(false);
        setAvailabilityError("");
        setBookingConfirmation(null);
        setSuccessModalOpen(false);
        setSelectedDentistId("");
        return;
      }

      setLoadingProfile(true);
      try {
        const profileRef = doc(db, "patientProfiles", u.uid);
        const snap = await getDoc(profileRef);

        if (snap.exists()) {
          const data = snap.data();
          const parsedName = splitFullName(data.fullName || "");
          const nextProfile = {
            firstName: data.firstName || parsedName.firstName || "",
            middleName: data.middleName || parsedName.middleName || "",
            lastName: data.lastName || parsedName.lastName || "",
            fullName: buildFullName({
              firstName: data.firstName || parsedName.firstName || "",
              middleName: data.middleName || parsedName.middleName || "",
              lastName: data.lastName || parsedName.lastName || "",
              fallback: data.fullName || "",
            }),
            age: data.age || "",
            phone: data.phone || "",
            patientType: data.patientType || "New Patient",
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

    return () => {
      unsubServices();
      unsubClosures();
    };
  }, []);

  useEffect(() => {
    if (!activeServiceOptions.length) return;

    setSelectedServices((current) => {
      const stillAvailable = current.filter((name) =>
        activeServiceOptions.some((entry) => entry.name === name)
      );
      return stillAvailable.length ? stillAvailable : [activeServiceOptions[0].name];
    });
  }, [activeServiceOptions]);

  function toggleService(serviceName) {
    setSelectedServices((current) => {
      if (current.includes(serviceName)) {
        return current.length === 1 ? current : current.filter((entry) => entry !== serviceName);
      }
      return [...current, serviceName];
    });
  }

  const availableDentists = useMemo(() => {
    return dentists.filter(
      (dentist) =>
        dentist.archiveStatus !== "Archived" &&
        getClinicAvailability(dentist, date, clinicClosures).available
    );
  }, [clinicClosures, date, dentists]);

  const selectedDentistRecord = useMemo(() => {
    return dentists.find((dentist) => dentist.id === selectedDentistId) || null;
  }, [dentists, selectedDentistId]);
  const selectedDentist = selectedDentistRecord?.name || "";

  const selectedDaySchedule = getDentistDaySchedule(selectedDentistRecord, date);
  const selectedAvailability = getClinicAvailability(selectedDentistRecord, date, clinicClosures);
  const calendarCells = useMemo(() => {
    const firstDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    const startOffset = firstDay.getDay();
    const start = new Date(firstDay);
    start.setDate(firstDay.getDate() - startOffset);

    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      const iso = toLocalISODate(day);
      const isCurrentMonth = day.getMonth() === calendarMonth.getMonth();
      const closure = getActiveClosureForDate(clinicClosures, iso);
      const hasDentist = selectedDentistRecord
        ? getClinicAvailability(selectedDentistRecord, iso, clinicClosures).available
        : dentists.some(
            (dentist) =>
              dentist.archiveStatus !== "Archived" &&
              getClinicAvailability(dentist, iso, clinicClosures).available
          );

      return {
        iso,
        dayNumber: day.getDate(),
        isCurrentMonth,
        isSelected: iso === date,
        isPast: iso < todayStr,
        isSunday: isSunday(iso),
        closure,
        isAvailable: isCurrentMonth && iso >= todayStr && !isSunday(iso) && !closure && hasDentist,
      };
    });
  }, [calendarMonth, clinicClosures, date, dentists, selectedDentistRecord, todayStr]);
  const calendarMonthLabel = calendarMonth.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  useEffect(() => {
    setCalendarMonth(getMonthStart(date));
  }, [date]);

  useEffect(() => {
    if (!availableDentists.length) {
      setSelectedDentistId("");
      return;
    }

    const stillAvailable = availableDentists.some((dentist) => dentist.id === selectedDentistId);
    if (!stillAvailable) {
      setSelectedDentistId(availableDentists[0].id);
    }
  }, [availableDentists, selectedDentistId]);

  const availableSlots = useMemo(
    () => slotOptions.filter((slot) => !slot.disabled).map((slot) => slot.value),
    [slotOptions]
  );

  useEffect(() => {
    if (!availableSlots.includes(time)) {
      setTime(availableSlots[0] || "09:00");
    }
  }, [availableSlots, time]);

  useEffect(() => {
    if (!user || !selectedDentistRecord?.id || !selectedServices.length || !date || isSunday(date) || selectedClosure) {
      setSlotOptions([]);
      setBlockedRanges([]);
      setDuplicateWarning(false);
      setAvailabilityError("");
      setLoadingAvailability(false);
      return undefined;
    }

    let cancelled = false;

    async function loadAvailability() {
      setLoadingAvailability(true);
      setAvailabilityError("");

      try {
        await user.getIdToken();
        const response = await getBookingAvailability({
          dentistId: selectedDentistRecord.id,
          date,
          selectedServices,
        });
        if (cancelled) return;

        const data = response.data || {};
        setSlotOptions(Array.isArray(data.slotOptions) ? data.slotOptions : []);
        setBlockedRanges(Array.isArray(data.blockedRanges) ? data.blockedRanges : []);
        setDuplicateWarning(Boolean(data.duplicateWarning));
      } catch (availabilityLoadError) {
        if (cancelled) return;
        console.error(availabilityLoadError);
        setSlotOptions([]);
        setBlockedRanges([]);
        setDuplicateWarning(false);
        if (availabilityLoadError?.code === "functions/resource-exhausted") {
          setAvailabilityError("You're checking availability too quickly. Please wait a moment.");
        } else if (availabilityLoadError?.code === "functions/unauthenticated") {
          setAvailabilityError("Your secure booking session was not accepted. Please refresh the page or sign in again.");
        } else {
          setAvailabilityError("Could not load live appointment availability right now. Please try again.");
        }
      } finally {
        if (!cancelled) setLoadingAvailability(false);
      }
    }

    loadAvailability();

    return () => {
      cancelled = true;
    };
  }, [date, getBookingAvailability, selectedClosure, selectedDentistRecord, selectedServices, user]);

  function chooseCalendarDate(cell) {
    if (!cell.isAvailable || saving || !user) return;
    setDatePageStart(cell.iso);
    setDate(cell.iso);
  }

  function moveCalendarMonth(amount) {
    const nextMonth = addMonths(calendarMonth, amount);
    const currentMonth = getMonthStart(todayStr);
    if (nextMonth < currentMonth) return;
    setCalendarMonth(nextMonth);
  }

  function moveSuggestedDates(amount) {
    const nextStart = new Date(`${datePageStart}T00:00:00`);
    nextStart.setDate(nextStart.getDate() + amount);
    const nextIso = toLocalISODate(nextStart);
    setDatePageStart(nextIso < todayStr ? todayStr : nextIso);
  }

  function getCalendarCellLabel(cell) {
    if (cell.closure) return cell.closure.label;
    if (cell.isSunday) return "Closed";
    if (cell.isPast) return "Past";
    if (!cell.isCurrentMonth) return "";
    return cell.isAvailable ? "Available" : "Unavailable";
  }

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
    if (!profileDraft.firstName.trim()) {
      setError("Please enter the first name.");
      return;
    }
    if (!profileDraft.lastName.trim()) {
      setError("Please enter the last name.");
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

    const normalizedFullName = buildFullName(profileDraft);
    const baseProfile = {
      email: user.email || profileDraft.email || "",
      firstName: profileDraft.firstName.trim(),
      middleName: profileDraft.middleName.trim(),
      lastName: profileDraft.lastName.trim(),
      fullName: normalizedFullName,
      age: String(profileDraft.age).trim(),
      phone: profileDraft.phone.trim(),
      updatedAt: serverTimestamp(),
    };
    const nextProfile = patientProfile
      ? baseProfile
      : {
          ...baseProfile,
          uid: user.uid,
          patientType: "New Patient",
          createdAt: serverTimestamp(),
        };

    try {
      await setDoc(doc(db, "patientProfiles", user.uid), nextProfile, { merge: true });

      const savedProfile = {
        firstName: baseProfile.firstName,
        middleName: baseProfile.middleName,
        lastName: baseProfile.lastName,
        fullName: baseProfile.fullName,
        age: baseProfile.age,
        phone: baseProfile.phone,
        patientType: patientProfile?.patientType || "New Patient",
        email: baseProfile.email,
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
    if (!patientProfile?.firstName || !patientProfile?.lastName) return setError("Please complete your patient profile first.");
    if (!patientProfile?.age) return setError("Please complete your patient profile first.");
    if (!patientProfile?.phone) return setError("Please complete your patient profile first.");
    if (!date) return setError("Please choose a date.");
    if (date < todayStr) return setError("You cannot book before today.");
    if (isSunday(date)) return setError("Clinic is closed on Sundays. Please choose Monday to Saturday.");
    if (selectedClosure) return setError(`${selectedClosure.label} blocks booking on ${formatDateLabel(date)}. Please choose another day.`);
    if (!selectedServices.length) return setError("Please choose at least one service.");
    if (!time) return setError("Please choose a time.");
    if (!agreedToPrivacyConsent) {
      return setError("Please confirm the confidentiality and clinic-use consent before submitting.");
    }
    if (!selectedDentistId) return setError("No dentist is available on that day. Please choose another date.");
    if (!selectedDentistRecord || !selectedAvailability.available) {
      return setError("That dentist is inactive on the selected day. Please choose another dentist or date.");
    }

    const appointmentDate = new Date(`${date}T${time}:00`);
    const requestedEnd = timeToMinutes(time) + appointmentDurationMinutes;
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

    if (!availableSlots.includes(time)) {
      return setError("That appointment slot is no longer available. Please choose another time.");
    }

    setBookingConfirmation({
      appointmentDate,
      requestedEnd,
      requestedTimeRange: selectedTimeRange,
      hasDuplicateWarning: duplicateWarning,
    });
  }

  async function confirmBookingSubmission() {
    if (!bookingConfirmation || !user || !patientProfile || !selectedDentistRecord) return;

    setError("");
    setSuccess("");
    setSaving(true);
    try {
      await createBooking({
        dentistId: selectedDentistRecord?.id || "",
        date,
        time,
        selectedServices,
        notes: notes.trim(),
        privacyConsentAccepted: true,
      });

      setBookingConfirmation(null);
      setNotes("");
      setAgreedToPrivacyConsent(false);
      setSuccess("Booking submitted successfully. Your request is now waiting for admin approval.");
      setSuccessModalOpen(true);
      setRecentlySubmitted(true);
    } catch (bookingError) {
      console.error(bookingError);
      if (bookingError?.code === "functions/already-exists") {
        setError("That appointment slot was just taken. Please choose another time.");
      } else if (bookingError?.code === "functions/resource-exhausted") {
        setError("You're submitting too quickly. Please wait a moment.");
      } else if (bookingError?.code === "functions/unauthenticated") {
        setError("Please sign in again before submitting your booking.");
      } else {
        setError(bookingError?.message || "Booking failed. Please try again.");
      }
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
    <>
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
            <button className="btn btnShine bookingPrimaryBtn" onClick={loginGoogle} type="button" data-mascot-target="booking-auth">
              Sign in with Google to Start
            </button>
          ) : null}

          {user && loadingProfile ? <SkeletonList count={1} /> : null}

          {user && !loadingProfile && (editingProfile || !patientProfile) ? (
            <form className="form" onSubmit={saveProfile} style={{ marginTop: 12 }} data-mascot-target="book-profile">
              <input
                className="input"
                placeholder="First name"
                data-mascot-target="book-name"
                value={profileDraft.firstName}
                onChange={(e) => setProfileDraft((current) => ({ ...current, firstName: e.target.value }))}
                disabled={saving || loadingProfile}
              />

              <input
                className="input"
                placeholder="Middle name"
                value={profileDraft.middleName}
                onChange={(e) => setProfileDraft((current) => ({ ...current, middleName: e.target.value }))}
                disabled={saving || loadingProfile}
              />

              <input
                className="input"
                placeholder="Last name"
                value={profileDraft.lastName}
                onChange={(e) => setProfileDraft((current) => ({ ...current, lastName: e.target.value }))}
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

              <label className="bookingFieldCard">
                <span className="detailLabel">Patient type</span>
                <input className="input" value={profileDraft.patientType || "New Patient"} disabled />
                <span className="bookingFieldHint">Assigned by clinic staff after your profile is reviewed.</span>
              </label>

              <button className="btn btnShine bookingPrimaryBtn" disabled={saving || loadingProfile} data-mascot-target="book-profile-save">
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
                    Age {patientProfile.age || "-"} • Clinic-assigned type: {patientProfile.patientType} • {patientProfile.phone} • {patientProfile.email}
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

              <form className="form bookingAppointmentForm" onSubmit={submit} style={{ marginTop: 12 }}>
                <div className="bookingFieldCard bookingServiceSelector" data-mascot-target="book-service">
                  <div className="bookingFieldHeader">
                    <div className="bookingServiceHeaderText">
                      <span className="detailLabel">Choose services</span>
                      <p className="bookingFieldHint">Select one or more services for this appointment.</p>
                    </div>
                    <strong className="bookingServiceCount">
                      {selectedServices.length} selected
                    </strong>
                  </div>

                  <div className="bookingServiceOptionGrid">
                    {activeServiceOptions.map((option) => {
                      const active = selectedServices.includes(option.name);

                      return (
                        <button
                          key={option.name}
                          type="button"
                          className={`bookingServiceOption ${active ? "active" : ""}`}
                          onClick={() => toggleService(option.name)}
                          disabled={!user || saving}
                          aria-pressed={active}
                        >
                          <span>{option.name}</span>
                          <strong>{option.durationMinutes || 60} min</strong>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="bookingDatePanel" data-mascot-target="book-date">
                  <div className="bookingDatePanelHeader">
                    <div>
                      <span className="detailLabel">Choose appointment day</span>
                      <strong className="detailTitle">{formatDateLabel(date)}</strong>
                      <p className="detailSubtitle">
                        Use the arrows to browse suggested clinic days, or choose from the summary calendar.
                      </p>
                    </div>
                    <div className="bookingDateHighlight">
                      <span>Clinic days</span>
                      <strong>{selectedClosure ? selectedClosure.label : "Monday to Saturday"}</strong>
                    </div>
                  </div>

                  <div className="bookingDateNavigator">
                    <button
                      type="button"
                      className="bookingDateNavButton"
                      onClick={() => moveSuggestedDates(-7)}
                      disabled={!user || saving || datePageStart <= todayStr}
                      aria-label="Previous suggested appointment days"
                    >
                      <span>Prev</span>
                    </button>

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

                    <button
                      type="button"
                      className="bookingDateNavButton"
                      onClick={() => moveSuggestedDates(7)}
                      disabled={!user || saving}
                      aria-label="Next suggested appointment days"
                    >
                      <span>Next</span>
                    </button>
                  </div>
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
                      You already have another booking for one of the selected services on <strong>{formatDateLabel(date)}</strong>. The clinic may review duplicate requests more carefully.
                    </p>
                  </div>
                ) : null}
                {availabilityError ? <div className="error">{availabilityError}</div> : null}

                <div className="bookingFlowGrid">
                  <label className="bookingFieldCard" data-mascot-target="book-dentist">
                    <span className="detailLabel">Available dentist</span>
                    <div className="bookingSelectShell">
                      <select
                        className="input bookingInputSpecial"
                        value={selectedDentistId}
                        onChange={(e) => setSelectedDentistId(e.target.value)}
                        disabled={!user || saving || isSunday(date) || Boolean(selectedClosure) || !availableDentists.length}
                      >
                        {availableDentists.length ? (
                          availableDentists.map((dentist) => (
                            <option key={dentist.id} value={dentist.id}>
                              {dentist.name}
                            </option>
                          ))
                        ) : (
                          <option value="">No dentist available on this day</option>
                        )}
                      </select>
                    </div>
                  </label>

                  <label className="bookingFieldCard" data-mascot-target="book-time">
                    <span className="detailLabel">Choose time slot</span>
                    <div className="bookingSelectShell">
                      <select
                        className="input bookingInputSpecial"
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                        disabled={!user || saving || loadingAvailability || isSunday(date) || Boolean(selectedClosure) || !selectedDentistId}
                      >
                        {slotOptions.length ? (
                          slotOptions.map((slot) => (
                            <option key={slot.value} value={slot.value} disabled={slot.disabled}>
                              {slot.disabled
                                ? `${slot.label} (${slot.disabledReason})`
                                : slot.label}
                            </option>
                          ))
                        ) : (
                          <option value="">No available times today</option>
                        )}
                      </select>
                    </div>
                    <span className="bookingFieldHint">
                      {loadingAvailability
                        ? "Loading live slot availability..."
                        : `${availableSlots.length} open start time${availableSlots.length === 1 ? "" : "s"} for a ${appointmentDurationMinutes}-minute appointment`}
                    </span>
                  </label>
                </div>

                {!loadingDentists && !availableDentists.length && !isSunday(date) && !selectedClosure ? (
                  <EmptyState
                    compact
                    title="No dentist available on this day"
                    message="Try another clinic day or choose a different date so the booking can continue."
                  />
                ) : null}

                {!loadingDentists && selectedDentistId && !availableSlots.length && !isSunday(date) ? (
                  <EmptyState
                    compact
                    title="No available time slots"
                    message="This dentist has no open slots left on the selected day. Pick another date or another dentist."
                  />
                ) : null}

                {blockedRanges.length ? (
                  <div className="detailNote historyPanel">
                    <span className="detailLabel">Taken times for {selectedDentist || "this dentist"}</span>
                    <div className="inlineActionRow" style={{ marginTop: 10 }}>
                      {blockedRanges.map((range, index) => (
                        <span key={`${range.start}-${range.end}-${index}`} className="statusPill active">
                          {formatTimeLabel(range.start)} - {formatTimeLabel(range.end)}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="bookingMiniSummary">
                  <div className="bookingMiniSummaryCard">
                    <span className="detailLabel">Services</span>
                    <strong>
                      {selectedServices.length} service{selectedServices.length === 1 ? "" : "s"}
                    </strong>
                  </div>
                  <div className="bookingMiniSummaryCard">
                    <span className="detailLabel">Time slot</span>
                    <strong>{selectedTimeRange || "Choose time"}</strong>
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

                <label className="bookingConsentCard" data-mascot-target="book-consent">
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
                  data-mascot-target="book-submit"
                  disabled={!user || saving || loadingAvailability || recentlySubmitted || isSunday(date) || Boolean(selectedClosure) || !selectedDentistId || !agreedToPrivacyConsent}
                >
                  {saving ? "Submitting..." : recentlySubmitted ? "Booking Submitted" : "Submit Booking"}
                </button>
              </form>
            </>
          ) : null}

          {error ? <div className="error">{error}</div> : null}
        </div>

        <div className="card bookingDetailsCard" data-mascot-target="booking-summary">
          <div className="cardHeader">
            <div>
              <h3 className="title">Appointment Summary</h3>
              <p className="sub">Review the key appointment details before you submit.</p>
            </div>
          </div>

          <button
            type="button"
            className="mascotCurseCollectible mascotCurseCollectible-wand"
            aria-label="Return the hidden wand"
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent("topdent:curse-item-found", {
                  detail: { item: "wand", source: "book" },
                })
              );
            }}
          >
            <span className="mascotCurseCollectibleStick" />
            <span className="mascotCurseCollectibleStar" />
          </button>

          {loadingProfile ? (
            <SkeletonList count={1} />
          ) : (
          <>
            <div className="bookingServicePreviewCard">
              <div className="bookingServicePreviewMedia">
                <img
                  src={getClinicServiceImage(previewServiceRecord || { name: selectedServices[0] || service })}
                  alt={previewServiceRecord?.name || service}
                />
              </div>
              <div className="bookingServicePreviewContent">
                <span className="detailLabel">Selected services</span>
                <strong>{previewServiceRecord?.name || "Choose service"}</strong>
                <p>
                  {previewServiceRecord?.description || "These services are currently available for booking through the clinic scheduler."}
                </p>
                {selectedServiceRecords.length > 1 ? (
                  <span className="bookingPreviewCounter">
                    Showing {servicePreviewIndex + 1} of {selectedServiceRecords.length} selected services
                  </span>
                ) : null}
                <div className="bookingServiceChips">
                  {selectedServices.map((serviceName) => (
                    <span
                      key={serviceName}
                      className={previewServiceRecord?.name === serviceName ? "active" : ""}
                    >
                      {serviceName}
                    </span>
                  ))}
                </div>
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
                <span className="detailLabel">Services</span>
                <strong>{selectedServices.length} selected</strong>
              </div>
              <div className="detailBox luxeBox bookingRatesBox">
                <span className="detailLabel">Starting rates</span>
                <div className="bookingRateList">
                  {selectedServiceRecords.length ? (
                    selectedServiceRecords.map((entry) => (
                      <div key={entry.name} className="bookingRateItem">
                        <span>{entry.name}</span>
                        <strong>{entry.startingRate || "Ask clinic"}</strong>
                      </div>
                    ))
                  ) : (
                    <strong>Ask clinic</strong>
                  )}
                </div>
              </div>
              <div className="detailBox luxeBox">
                <span className="detailLabel">Estimated duration</span>
                <strong>{appointmentDurationMinutes} minutes</strong>
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
                <strong>{selectedTimeRange || "Choose time"}</strong>
              </div>
              <div className="detailBox luxeBox">
                <span className="detailLabel">Dentist status</span>
                <strong>{selectedDentistId && selectedDaySchedule?.active ? "Active" : "Inactive"}</strong>
              </div>
            </div>

            <div className="bookingCalendar summaryCalendar" data-mascot-target="booking-calendar">
              <div className="bookingCalendarHeader">
                <div>
                  <span className="detailLabel">
                    {selectedDentist ? `${selectedDentist} availability` : "Dentist availability"}
                  </span>
                  <strong>{calendarMonthLabel}</strong>
                </div>
                <div className="bookingCalendarControls">
                  <button
                    type="button"
                    onClick={() => moveCalendarMonth(-1)}
                    disabled={getMonthStart(todayStr).getTime() === calendarMonth.getTime()}
                  >
                    Prev
                  </button>
                  <button type="button" onClick={() => moveCalendarMonth(1)}>
                    Next
                  </button>
                </div>
              </div>

              <div className="bookingCalendarWeekdays">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((dayName) => (
                  <span key={dayName}>{dayName}</span>
                ))}
              </div>

              <div className="bookingCalendarGrid">
                {calendarCells.map((cell) => (
                  <button
                    key={cell.iso}
                    type="button"
                    className={`bookingCalendarDay ${cell.isSelected ? "active" : ""} ${!cell.isCurrentMonth ? "muted" : ""} ${cell.isAvailable ? "available" : "blocked"}`}
                    onClick={() => chooseCalendarDate(cell)}
                    disabled={!user || saving || !cell.isAvailable}
                    title={getCalendarCellLabel(cell)}
                  >
                    <strong>{cell.dayNumber}</strong>
                    <span>{getCalendarCellLabel(cell)}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
          )}
        </div>
      </div>
    </div>
    <ConfirmDialog
      open={Boolean(bookingConfirmation)}
      title="Submit booking request?"
      message={
        bookingConfirmation
          ? `Patient: ${patientProfile?.fullName || "Patient"} | Services: ${service} | Dentist: ${selectedDentist || "Selected dentist"} | Date: ${formatDateLabel(date)} | Time: ${bookingConfirmation.requestedTimeRange}.${bookingConfirmation.hasDuplicateWarning ? " You already have another booking for one of these services on this day, so the clinic may review this request more carefully." : ""}`
          : ""
      }
      confirmLabel={saving ? "Submitting..." : "Submit Booking"}
      cancelLabel="Review Details"
      onClose={() => {
        if (!saving) setBookingConfirmation(null);
      }}
      onConfirm={saving ? undefined : confirmBookingSubmission}
    />
    {successModalOpen ? (
      <div className="modalOverlay" onClick={() => setSuccessModalOpen(false)}>
        <div className="modalCard bookingSuccessModal" onClick={(e) => e.stopPropagation()}>
          <div className="modalHeader">
            <div className="modalTitleGroup">
              <span className="modalToneLabel">Booking sent</span>
              <h3>Appointment request submitted</h3>
            </div>
            <button
              className="modalClose"
              type="button"
              onClick={() => setSuccessModalOpen(false)}
              aria-label="Close booking success dialog"
            >
              x
            </button>
          </div>
          <div className="bookingSuccessBody">
            <div>
              <strong>Your request is waiting for admin approval.</strong>
              <p>The clinic can now review the appointment details and update its status from the admin dashboard.</p>
            </div>
            <div className="bookingSuccessDetails">
              <span>{formatDateLabel(date)}</span>
              <span>{selectedTimeRange || "Selected time"}</span>
              <span>{selectedDentist || "Selected dentist"}</span>
              <span>{service || "Selected services"}</span>
            </div>
            <button className="btn btnShine" type="button" onClick={() => setSuccessModalOpen(false)}>
              Done
            </button>
          </div>
        </div>
      </div>
    ) : null}
    </>
  );
}
