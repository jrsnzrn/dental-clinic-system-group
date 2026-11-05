import BookingCrownPicker from "../components/BookingCrownPicker";
import LoadingIndicator from "../components/LoadingIndicator";
import { BRACES_PACKAGE_INCLUSIONS, BRACES_TYPES, MAX_BOOKING_SERVICES, canBookService, isBracesPackage, isCrownTypeService, isGenericBracesPackage, isBracesPackageInclusion, selectBookingService } from "../../functions/bookingServices.mjs";
import { formatStaffDisplayName } from "../utils/staffProfile";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { auth, db, functions } from "../firebase";
import EmptyState from "../components/EmptyState";
import { SkeletonList } from "../components/LoadingSkeleton";
import BackArrow from "../components/BackArrow";
import ModalPortal from "../components/ModalPortal";
import { notifySuccess } from "../utils/successDialog";
import BookingLeaveGuard from "../components/BookingLeaveGuard";
import { getClinicDate, getLatestBookingDate, isWithinBookingWindow } from "../../functions/bookingWindow.mjs";
import {
  BOOKING_SLOT_INTERVAL_MINUTES,
  getActiveClosureForDate,
  getBookingServiceOptions,
} from "../utils/clinic";
import { buildFullName, splitFullName } from "../utils/names";
import {
  formatDateLabel,
  formatTimeLabel,
  getClinicAvailability,
} from "../utils/schedule";

const GOOGLE_ICON_URL = "https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg";

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

function isValidPatientAge(value) {
  const age = Number(String(value ?? "").trim());
  return Number.isInteger(age) && age >= 1 && age <= 99;
}

function hasProfileText(value) {
  return String(value ?? "").trim().length > 0;
}

function getPhilippineMobileDigits(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  const nationalNumber = digits.startsWith("63") ? digits.slice(2) : digits;
  return nationalNumber.startsWith("0") ? nationalNumber.slice(1) : nationalNumber;
}

function isValidPhilippineMobile(value) {
  return /^9\d{9}$/.test(getPhilippineMobileDigits(value));
}

function toStoredPhilippineMobile(value) {
  return `0${getPhilippineMobileDigits(value)}`;
}

function generateUpcomingDates(startDate, count, lastDate) {
  const dates = [];
  const cursor = new Date(startDate);

  while (dates.length < count && toLocalISODate(cursor) <= lastDate) {
    const iso = toLocalISODate(cursor);
    if (!isSunday(iso)) {
      dates.push(iso);
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

export default function Book() {
  const navigate = useNavigate();
  const [signingIn, setSigningIn] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState(null);
  const [patientProfile, setPatientProfile] = useState(null);
  const [patientProfileUid, setPatientProfileUid] = useState("");
  const [profileDraft, setProfileDraft] = useState(getEmptyProfile());
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [loadingDentists, setLoadingDentists] = useState(true);
  const [dentistLoadError, setDentistLoadError] = useState("");
  const [searchParams] = useSearchParams();
  const editingProfile = searchParams.get("editProfile") === "1";
  const [savingProfile, setSavingProfile] = useState(false);

  const [selectedServices, setSelectedServices] = useState([]);
  const [bracesType, setBracesType] = useState("");
  const [clinicServices, setClinicServices] = useState([]);
  const [loadingServices, setLoadingServices] = useState(true);
  const [serviceLoadError, setServiceLoadError] = useState("");
  const [clinicClosures, setClinicClosures] = useState([]);
  const [dentists, setDentists] = useState([]);
  const [selectedDentistId, setSelectedDentistId] = useState("");
  const [initialDate] = useState(() => getClinicDate());
  const [date, setDate] = useState(() => getClinicDate());
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");
  const [agreedToPrivacyConsent, setAgreedToPrivacyConsent] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [datePageStart, setDatePageStart] = useState(() => getClinicDate());
  const [slotOptions, setSlotOptions] = useState([]);
  const [blockedRanges, setBlockedRanges] = useState([]);
  const [duplicateWarning, setDuplicateWarning] = useState(false);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");
  const [bookingConfirmation, setBookingConfirmation] = useState(null);
  const [bookingStep, setBookingStep] = useState("info");
  const profileLoadRequest = useRef(0);

  const todayStr = getClinicDate();
  const lastBookingDate = getLatestBookingDate(todayStr);
  const getBookingAvailability = useMemo(
    () => httpsCallable(functions, "getBookingAvailability"),
    []
  );
  const createBooking = useMemo(
    () => httpsCallable(functions, "createBooking"),
    []
  );
  const upcomingDates = useMemo(() => generateUpcomingDates(new Date(`${datePageStart}T00:00:00`), 8, lastBookingDate), [datePageStart, lastBookingDate]);
  const patientType = patientProfile?.patientType;
  const activeServiceOptions = useMemo(() => getBookingServiceOptions(clinicServices).filter((option) => canBookService(option, patientType)), [clinicServices, patientType]);
  const bracesPackage = activeServiceOptions.find((option) => selectedServices.includes(option.name) && isBracesPackage(option));
  const needsBracesType = Boolean(bracesPackage && isGenericBracesPackage(bracesPackage));
  const serviceLabel = (name) => needsBracesType && name === bracesPackage.name && bracesType ? `${bracesType} Braces` : name;
  const profileDirty = ["firstName", "middleName", "lastName", "age", "phone"].some((field) => {
    const normalize = field === "phone" ? toStoredPhilippineMobile : (value) => String(value ?? "").trim();
    return normalize(profileDraft[field] || "") !== normalize(patientProfile?.[field] || "");
  });
  const selectedClosure = useMemo(() => getActiveClosureForDate(clinicClosures, date), [clinicClosures, date]);
  const service = selectedServices.join(", ");
  const appointmentDurationMinutes = BOOKING_SLOT_INTERVAL_MINUTES;
  const selectedTimeEnd = time ? minutesToTime(timeToMinutes(time) + appointmentDurationMinutes) : "";
  const selectedTimeRange = time ? `${formatTimeLabel(time)} - ${formatTimeLabel(selectedTimeEnd)}` : "";

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      const requestId = profileLoadRequest.current + 1;
      profileLoadRequest.current = requestId;
      setUser(u);
      setAuthReady(true);
      setError("");
      setPatientProfile(null);
      setPatientProfileUid("");
      setProfileDraft(getEmptyProfile(u?.email || ""));
      setSelectedServices([]);
      setBracesType("");
      setSavingProfile(false);
      setLoadingProfile(Boolean(u));
      setBookingStep("info");
      setBookingConfirmation(null);

      if (!u) {
        setLoadingProfile(false);
        setAgreedToPrivacyConsent(false);
        setSlotOptions([]);
        setBlockedRanges([]);
        setDuplicateWarning(false);
        setAvailabilityError("");
        setSelectedDentistId("");
        return;
      }

      try {
        const profileRef = doc(db, "patientProfiles", u.uid);
        const snap = await getDoc(profileRef);

        if (requestId !== profileLoadRequest.current || auth.currentUser?.uid !== u.uid) return;

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
          setPatientProfileUid(u.uid);
          setProfileDraft(nextProfile);
        } else {
          const emptyProfile = getEmptyProfile(u.email || "");
          setPatientProfile(null);
          setProfileDraft(emptyProfile);
        }
      } catch (profileError) {
        if (requestId !== profileLoadRequest.current || auth.currentUser?.uid !== u.uid) return;
        console.error(profileError);
        setError("Could not load your patient profile. Please try again.");
      } finally {
        if (requestId === profileLoadRequest.current && auth.currentUser?.uid === u.uid) {
          setLoadingProfile(false);
        }
      }
    });

    return () => {
      profileLoadRequest.current += 1;
      unsub();
    };
  }, []);



  useEffect(() => {
    const unsub = onSnapshot(collection(db, "dentists"), (snap) => {
      const list = snap.docs.map(entry => {
        const data = entry.data();
        return { ...data, id: entry.id, name: formatStaffDisplayName({ ...data, role: "dentist" }) };
      });
      setDentists(list);
      setLoadingDentists(false);
    }, () => {
      setDentistLoadError("Could not load dentists. Refresh to try again.");
      setLoadingDentists(false);
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    const unsubServices = onSnapshot(query(collection(db, "clinicServices"), orderBy("name", "asc")), (snap) => {
      const nextServices = snap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      setClinicServices(nextServices);
      setServiceLoadError("");
      setLoadingServices(false);
    }, () => {
      setServiceLoadError("Could not load the clinic service list.");
      setLoadingServices(false);
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
    setSelectedServices((current) => {
      const stillAvailable = current.filter((name) =>
        activeServiceOptions.some((entry) => entry.name === name)
      );
      return stillAvailable;
    });
  }, [activeServiceOptions]);

  function toggleService(option) {
    setSelectedServices((current) => selectBookingService(current, option, activeServiceOptions));
    setTime("");
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

  const selectedAvailability = getClinicAvailability(selectedDentistRecord, date, clinicClosures);

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
      setTime(availableSlots[0] || "");
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
    setLoadingAvailability(true);

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

    const requestTimer = window.setTimeout(() => {
      loadAvailability();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(requestTimer);
    };
  }, [date, getBookingAvailability, selectedClosure, selectedDentistRecord, selectedServices, user]);

  function moveSuggestedDates(amount) {
    const nextStart = new Date(`${datePageStart}T00:00:00`);
    nextStart.setDate(nextStart.getDate() + amount);
    const nextIso = toLocalISODate(nextStart);
    setDatePageStart(nextIso < todayStr ? todayStr : nextIso > lastBookingDate ? lastBookingDate : nextIso);
  }

  async function loginGoogle() {
    if (signingIn) return;
    setSigningIn(true);
    setError("");
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      navigate("/my-appointments", { replace: true });
    } catch (e) {
      if (e.code === "auth/popup-closed-by-user") {
        setError("Sign-in was cancelled. You can try again.");
      } else if (e.code === "auth/cancelled-popup-request") {
        setError("Another Google sign-in window was opened. Finish signing in there, or close it before trying again.");
      } else if (e.code === "auth/popup-blocked") {
        setError("Your browser blocked the sign-in window. Allow pop-ups for this website and try again.");
      } else {
        console.error(e);
        setError("Google sign-in failed. Try again.");
      }
    } finally {
      setSigningIn(false);
    }
  }

  function openProfileEditor() {
    setProfileDraft({ ...patientProfile });
    setError("");
    navigate("/book?editProfile=1");
  }

  function backToBooking() {
    if (savingProfile) return;
    setProfileDraft(patientProfile ? { ...patientProfile } : getEmptyProfile(user?.email || ""));
    setError("");
    setBookingStep("info");
    navigate("/book", { replace: true });
  }

  async function saveProfile(e) {
    e.preventDefault();
    setError("");

    if (savingProfile || loadingProfile || !profileDirty) return;
    if (!user) {
      setError("Please sign in first.");
      return;
    }
    if (!hasProfileText(profileDraft.firstName)) {
      setError("Please enter the first name.");
      return;
    }
    if (!hasProfileText(profileDraft.lastName)) {
      setError("Please enter the last name.");
      return;
    }
    if (!isValidPatientAge(profileDraft.age)) {
      setError("Please enter a valid age between 1 and 99.");
      return;
    }
    if (!isValidPhilippineMobile(profileDraft.phone)) {
      setError("Enter a valid Philippine mobile number with 10 digits after +63, starting with 9.");
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
      phone: toStoredPhilippineMobile(profileDraft.phone),
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

    setSavingProfile(true);
    try {
      await setDoc(doc(db, "patientProfiles", user.uid), nextProfile, { merge: true });

      if (auth.currentUser?.uid !== user.uid) return;

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
      setPatientProfileUid(user.uid);
      setProfileDraft(savedProfile);
      setBookingStep("info");
      navigate("/book", { replace: true });
      notifySuccess("Profile saved. You can now book appointments with your saved patient details.");
    } catch (profileError) {
      console.error(profileError);
      if (auth.currentUser?.uid === user.uid) {
        setError("Could not save your profile. Check your Firestore rules for patientProfiles.");
      }
    } finally {
      setSavingProfile(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setError("");

    if (!user) {
      setError("Please sign in with Google to book an appointment.");
      return;
    }
    if (!profileReady) {
      setError("Please complete your patient profile before booking.");
      return;
    }
    if (!date) return setError("Please choose a date.");
    if (date < todayStr) return setError("You cannot book before today.");
    if (!isWithinBookingWindow(date, todayStr)) return setError("You can only book up to two months ahead.");
    if (isSunday(date)) return setError("Clinic is closed on Sundays. Please choose Monday to Saturday.");
    if (selectedClosure) return setError(`${selectedClosure.label} blocks booking on ${formatDateLabel(date)}. Please choose another day.`);
    if (!selectedServices.length) return setError("Please choose at least one service.");
    if (needsBracesType && !bracesType) return setError("Please choose a type of braces.");
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
    const isBeforeOpen = hour < 9;
    const isAfterClose = requestedEnd > 18 * 60;
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
    setBookingStep("review");
  }

  function returnToInfo() {
    setError("");
    setBookingStep("info");
  }

  useEffect(() => {
    if (bookingStep !== "review") return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !saving) returnToInfo();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [bookingStep, saving]);

  async function confirmBookingSubmission() {
    if (saving || !bookingConfirmation || !user || !patientProfile || !selectedDentistRecord) return;

    setError("");
    setSaving(true);
    try {
      await createBooking({
        dentistId: selectedDentistRecord?.id || "",
        date,
        time,
        selectedServices,
        ...(needsBracesType ? { bracesType } : {}),
        notes: notes.trim(),
        privacyConsentAccepted: true,
      });

      const submittedAppointment = {
        patient: { ...patientProfile },
        services: service,
        serviceDetails: selectedServices.map((name) => {
          const serviceOption = activeServiceOptions.find((option) => option.name === name);
          return {
            name: serviceLabel(name),
            startingRate: serviceOption?.startingRate || "",
          };
        }),
        dentist: selectedDentistRecord.name,
        date,
        timeRange: bookingConfirmation.requestedTimeRange,
        notes: notes.trim(),
      };
      setBookingConfirmation(null);
      setSelectedServices([]);
      setBracesType("");
      setSelectedDentistId("");
      setDate(initialDate);
      setDatePageStart(initialDate);
      setTime("");
      setSlotOptions([]);
      setNotes("");
      setAgreedToPrivacyConsent(false);
      setBookingStep("info");
      notifySuccess(
        "Your request is waiting for admin approval.",
        "Appointment Request Submitted!",
        {
          content: (
            <>
              <section className="bookingSuccessSection">
                <h3>Patient Information</h3>
                <dl>
                  <div><dt>Full name</dt><dd>{submittedAppointment.patient.fullName}</dd></div>
                  <div><dt>Age and patient type</dt><dd>{submittedAppointment.patient.age} · {submittedAppointment.patient.patientType}</dd></div>
                  <div><dt>Contact number</dt><dd>{submittedAppointment.patient.phone}</dd></div>
                  <div><dt>Email</dt><dd>{submittedAppointment.patient.email}</dd></div>
                </dl>
              </section>
              <section className="bookingSuccessSection">
                <h3>Services</h3>
                <dl>
                  {submittedAppointment.serviceDetails.map((item) => (
                    <div key={item.name}>
                      <dt>{item.name}</dt>
                      <dd>{item.startingRate || "Pricing not set"}</dd>
                    </div>
                  ))}
                </dl>
              </section>
              <section className="bookingSuccessSection">
                <h3>Appointment Schedule</h3>
                <dl>
                  <div><dt>Dentist</dt><dd>{submittedAppointment.dentist}</dd></div>
                  <div><dt>Appointment date</dt><dd>{formatDateLabel(submittedAppointment.date)}</dd></div>
                  <div><dt>Appointment time</dt><dd>{submittedAppointment.timeRange}</dd></div>
                </dl>
              </section>
              <section className="bookingSuccessSection">
                <h3>Notes</h3>
                <dl>
                  <div><dt>Patient notes</dt><dd>{submittedAppointment.notes || "None"}</dd></div>
                </dl>
              </section>
            </>
          ),
          actionLabel: "View my appointments",
          onAction: () => navigate("/my-appointments"),
        }
      );
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

  const profileReady = Boolean(
    user
    && patientProfile
    && patientProfileUid === user.uid
    && hasProfileText(patientProfile.firstName)
    && hasProfileText(patientProfile.lastName)
    && isValidPatientAge(patientProfile.age)
    && hasProfileText(patientProfile.phone)
    && !editingProfile
    && !loadingProfile
    && !savingProfile
  );

  // Waiting for Firebase to tell us if someone is already signed in
  if (!authReady) {
    return (
      <div className="container bookingPage">
        <div className="googleGate">
          <SkeletonList count={1} label="Checking your session…" />
        </div>
      </div>
    );
  }

  // Not signed in -> show the "Continue with Google" screen only
  if (!user) {
    return (
      <div className="container bookingPage">
        <div className="googleGate">
          <div className="googleGateLogo">
            <img src={GOOGLE_ICON_URL} alt="Google" />
          </div>
          <h2>Continue with Google</h2>
          <p className="googleGateSub">
            Use your Google account to sign in or create your patient account.
          </p>

          <button type="button" className="googleGateBtn" onClick={loginGoogle} disabled={signingIn}>
            {signingIn ? <LoadingIndicator>Signing in…</LoadingIndicator> : <><img src={GOOGLE_ICON_URL} alt="" /> Sign in with Google</>}
          </button>

          {error ? <div className="error" style={{ marginTop: 12 }}>{error}</div> : null}

          <div className="googleGateDivider">
            <span>OR</span>
          </div>

          <ul className="googleGatePerks">
            <li>Quick and easy booking</li>
            <li>Your appointments saved automatically</li>
            <li>Secure and private</li>
          </ul>

          <p className="googleGateTerms">
            By continuing, you agree to our <a href="/terms">Terms and Conditions</a> and{" "}
            <a href="/privacy">Privacy Policy</a>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
    <BookingLeaveGuard active={Boolean(user && (
      selectedServices.length || time || notes.trim() || date !== initialDate
    ))} />
    <div className="container bookingPage">
      <header className="bookingPageHeading">
        <h1>Book an Appointment</h1>
        <p>Schedule your dental visit by selecting a service, dentist, date, and time.</p>
      </header>
      <div className="grid" style={{ marginTop: 0, gridTemplateColumns: "1fr" }}>
        <div className="card bookingFormCard">
          {!profileReady ? (
            <div className={`cardHeader bookingProfileHeader${editingProfile ? " bookingProfileHeading" : ""}`}>
              <div className="bookingProfileHeaderMain">
                <button
                  type="button"
                  className="appBackAction topdentBackAction bookingProfileBack"
                  onClick={backToBooking}
                  disabled={savingProfile}
                  aria-label="Back to Book Appointment"
                >
                  <BackArrow />
                </button>
                <div>
                  <h3 className="title">{editingProfile ? "Update Profile" : "Patient Sign-up First"}</h3>
                  <p className="sub">
                    {editingProfile
                      ? "Update your patient details, then return to your appointment."
                      : "Before booking, complete your patient profile so the same Gmail cannot create appointments under different names."}
                  </p>
                </div>
              </div>
              <span className="badge">Signed in</span>
            </div>
          ) : null}

          {loadingProfile ? <SkeletonList count={1} label="Loading your patient profile…" /> : null}

          {!loadingProfile && !profileReady ? (
            <form className="form bookingProfileForm" onSubmit={saveProfile} style={{ marginTop: 12 }}>
              <label className="bookingProfileField">
                <span>FIRST NAME</span>
                <input
                  className="input"
                  value={profileDraft.firstName}
                  onChange={(e) => setProfileDraft((current) => ({ ...current, firstName: e.target.value }))}
                  disabled={savingProfile || loadingProfile}
                />
              </label>

              <label className="bookingProfileField">
                <span>MIDDLE NAME</span>
                <input
                  className="input"
                  value={profileDraft.middleName}
                  onChange={(e) => setProfileDraft((current) => ({ ...current, middleName: e.target.value }))}
                  disabled={savingProfile || loadingProfile}
                />
              </label>

              <label className="bookingProfileField">
                <span>LAST NAME</span>
                <input
                  className="input"
                  value={profileDraft.lastName}
                  onChange={(e) => setProfileDraft((current) => ({ ...current, lastName: e.target.value }))}
                  disabled={savingProfile || loadingProfile}
                />
              </label>

              <label className="bookingProfileField">
                <span>AGE</span>
                <input
                  className="input bookingAgeInput"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={2}
                  value={profileDraft.age}
                  onChange={(e) => setProfileDraft((current) => ({
                    ...current,
                    age: e.target.value.replace(/\D/g, "").slice(0, 2),
                  }))}
                  disabled={savingProfile || loadingProfile}
                />
              </label>

              <label className="bookingProfileField bookingProfileFull">
                <span>CONTACT NUMBER</span>
                <span className="bookingContactInput">
                  <span className="bookingContactPrefix" aria-hidden="true">+63</span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    value={getPhilippineMobileDigits(profileDraft.phone)}
                    onChange={(e) => setProfileDraft((current) => ({
                      ...current,
                      phone: e.target.value.replace(/\D/g, "").slice(0, 10),
                    }))}
                    disabled={savingProfile || loadingProfile}
                    aria-label="Contact number after +63"
                    aria-describedby="booking-contact-hint"
                    aria-invalid={Boolean(profileDraft.phone) && !isValidPhilippineMobile(profileDraft.phone)}
                  />
                </span>
                <span className="bookingFieldHint" id="booking-contact-hint">
                  Enter 10 digits starting with 9.
                </span>
              </label>

              <label className="bookingProfileField bookingProfileFull">
                <span>EMAIL</span>
                <input className="input" value={user.email || profileDraft.email} readOnly />
              </label>

              <label className="bookingProfileField bookingProfileFull">
                <span>PATIENT TYPE</span>
                <input className="input" value={profileDraft.patientType || "New Patient"} readOnly />
                <span className="bookingFieldHint">
                  Patient type is assigned by clinic staff after your profile is reviewed.
                </span>
              </label>

              <button className="btn btnShine bookingPrimaryBtn" disabled={savingProfile || loadingProfile || !profileDirty}>
                {savingProfile ? <LoadingIndicator>Saving profile…</LoadingIndicator> : "Save Profile"}
              </button>
            </form>
          ) : null}

          {profileReady ? (
            <>
              <form className="form bookingAppointmentForm" onSubmit={submit}>
                <div className="bookingInfoGrid">
                  <section className="bookingPageSection bookingPatientSection">
                    <header className="bookingSectionHeader">
                      <span className="bookingSectionIcon" aria-hidden="true">
                        <svg viewBox="0 0 24 24">
                          <circle cx="12" cy="8" r="3.5" />
                          <path d="M5 20c.5-3.5 3.2-5.5 7-5.5s6.5 2 7 5.5" />
                        </svg>
                      </span>
                      <span className="bookingSectionHeading">
                        <h2>Patient Information</h2>
                        <p>Review your personal details for this appointment.</p>
                      </span>
                      <button
                        type="button"
                        className="btn secondary btnSoft bookingSecondaryBtn"
                        onClick={openProfileEditor}
                      >
                        Update Profile
                      </button>
                    </header>

                    <dl className="bookingPatientDetails">
                      <div><dt>Full name</dt><dd>{patientProfile.fullName}</dd></div>
                      <div><dt>Age</dt><dd>{patientProfile.age || "—"}</dd></div>
                      <div><dt>Patient type</dt><dd>{patientProfile.patientType || "—"}</dd></div>
                      <div><dt>Contact number</dt><dd>{patientProfile.phone || "—"}</dd></div>
                      <div><dt>Email</dt><dd>{patientProfile.email || user.email || "—"}</dd></div>
                    </dl>
                  </section>

                  <section className="bookingPageSection bookingServicesSection">
                    <header className="bookingSectionHeader">
                      <span className="bookingSectionIcon" aria-hidden="true">
                        <svg viewBox="0 0 24 24">
                          <path d="M12 3.2c-1.6 0-2.6.7-3.5.7-.8 0-1.5-.4-2.3-.1-1.3.5-2 2-2 4 0 3.1 1.5 8.3 3 10 .7.8 1.2-.3 1.5-1.3.3-1 .5-2.8 1.3-2.8s1 1.8 1.3 2.8c.3 1 .8 2.1 1.5 1.3 1.5-1.7 3-6.9 3-10 0-2-.7-3.5-2-4-.8-.3-1.5.1-2.3.1-.9 0-1.9-.7-3.5-.7Z" />
                          <path d="M16.2 5.2c1.1-.8 2.4-.7 3.3-.1" />
                        </svg>
                      </span>
                      <span className="bookingSectionHeading">
                        <h2>Choose Services</h2>
                        <p>Select up to {MAX_BOOKING_SERVICES} services. A braces package counts as one service.</p>
                      </span>
                      <strong className="bookingServiceCount">
                        {selectedServices.length} selected
                      </strong>
                    </header>

                    <div className="bookingServiceOptionGrid">
                      {loadingServices ? <SkeletonList count={3} label="Loading services…" /> : null}
                      {serviceLoadError ? <p role="alert">{serviceLoadError}</p> : null}
                      {!loadingServices && !serviceLoadError && activeServiceOptions.filter((option) => !isCrownTypeService(option) && (!bracesPackage || !isBracesPackageInclusion(option))).map((option) => {
                        const active = selectedServices.includes(option.name);

                        return (
                          <button
                            key={option.name}
                            type="button"
                            className={`bookingServiceOption ${active ? "active" : ""}`}
                            onClick={() => toggleService(option)}
                            disabled={!user || saving || (!active && selectBookingService(selectedServices, option, activeServiceOptions) === selectedServices)}
                            aria-pressed={active}
                          >
                            <span>{isGenericBracesPackage(option) ? "Braces Package" : option.name}</span>
                            <strong>{option.startingRate || "Pricing not set"}</strong>
                          </button>
                        );
                      })}
                    </div>
                    {!loadingServices && !serviceLoadError ? (
                      <BookingCrownPicker options={activeServiceOptions} selectedServices={selectedServices} onToggle={toggleService} disabled={saving} />
                    ) : null}
                    {bracesPackage ? (
                      <div className="bookingBracesPackageDetails">
                        {needsBracesType ? (
                          <label className="bookingServiceTypeField">
                            <strong>Type of Braces</strong>
                            <select className="input" value={bracesType} onChange={(event) => setBracesType(event.target.value)} required disabled={saving}>
                              <option value="">Select a type</option>
                              {BRACES_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                            </select>
                          </label>
                        ) : null}
                        <div>
                          <strong>Package Inclusions</strong>
                          <ul>{BRACES_PACKAGE_INCLUSIONS.map((inclusion) => <li key={inclusion}>{inclusion}</li>)}</ul>
                        </div>
                      </div>
                    ) : null}
                  </section>

                  <section className="bookingPageSection bookingInfoSection bookingInfoSchedule">
                    <header className="bookingSectionHeader">
                      <span className="bookingSectionIcon" aria-hidden="true">
                        <svg viewBox="0 0 24 24">
                          <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
                          <path d="M7.5 3.5v3M16.5 3.5v3M3.5 9.5h17" />
                        </svg>
                      </span>
                      <span className="bookingSectionHeading">
                        <h2>Appointment Schedule</h2>
                        <p>Choose your preferred dentist, appointment date, and time.</p>
                        <p>You can book up to two months ahead, through {formatDateLabel(lastBookingDate)}.</p>
                      </span>
                    </header>

                    <div className="bookingScheduleControls">
                      <label className="bookingFieldCard">
                        <span className="detailLabel">Available Dentist</span>
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
                              <option value="">{loadingDentists ? "Loading dentists…" : dentistLoadError ? "Dentist list unavailable" : "No dentist available on this day"}</option>
                            )}
                          </select>
                        </div>
                        {loadingDentists ? <LoadingIndicator>Loading dentists…</LoadingIndicator> : null}
                        {dentistLoadError ? <span className="error" role="alert">{dentistLoadError}</span> : null}
                      </label>

                      <label className="bookingFieldCard">
                        <span className="detailLabel">Day</span>
                        <span className="bookingDateInputShell">
                          <span>{formatDateLabel(date)}</span>
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <rect x="3.5" y="5" width="17" height="16" rx="2" />
                            <path d="M7.5 3.5v3M16.5 3.5v3M3.5 9.5h17M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01" />
                          </svg>
                          <input
                            type="date"
                            aria-label="Choose appointment day"
                            min={todayStr}
                            max={lastBookingDate}
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            disabled={!user || saving}
                          />
                        </span>
                      </label>

                      <div className="bookingTimeSlotField">
                        <label className="bookingFieldCard">
                          <span className="detailLabel">Time Slot</span>
                          <div className="bookingSelectShell">
                            <select
                              className="input bookingInputSpecial"
                              value={time}
                              onChange={(e) => setTime(e.target.value)}
                              disabled={!user || saving || !selectedServices.length || loadingAvailability || Boolean(availabilityError) || isSunday(date) || Boolean(selectedClosure) || !selectedDentistId}
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
                                <option value="">{!selectedServices.length
                                  ? "Choose a service first"
                                  : loadingAvailability
                                    ? "Loading available times…"
                                    : availabilityError
                                      ? "Could not load available times"
                                      : "No available times on this date"}</option>
                              )}
                            </select>
                          </div>
                          <span className="bookingFieldHint">
                            {!selectedServices.length
                              ? "Select at least one service to see available appointment times."
                              : loadingAvailability
                                ? <LoadingIndicator>Checking available times…</LoadingIndicator>
                                : availabilityError
                                  ? "Availability could not be checked. Refresh the page and try again."
                                  : `${availableSlots.length} open start time${availableSlots.length === 1 ? "" : "s"}. Each new request reserves one ${BOOKING_SLOT_INTERVAL_MINUTES}-minute booking block; the clinic can extend the end time if treatment needs longer.`}
                          </span>
                        </label>
                      </div>
                    </div>

                    <details className="bookingSuggestedDates">
                      <summary>Suggested clinic days</summary>
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
                          disabled={!user || saving || upcomingDates.at(-1) >= lastBookingDate || upcomingDates.length < 8}
                          aria-label="Next suggested appointment days"
                        >
                          <span>Next</span>
                        </button>
                      </div>
                    </details>

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

                        {!loadingDentists && !dentistLoadError && !availableDentists.length && !isSunday(date) && !selectedClosure ? (
                          <EmptyState
                            compact
                            title="No dentist available on this day"
                            message="Try another clinic day or choose a different date so the booking can continue."
                          />
                        ) : null}

                        {selectedServices.length > 0 && !loadingDentists && !loadingAvailability && !availabilityError && selectedDentistId && !availableSlots.length && !isSunday(date) && !selectedClosure ? (
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
                  </section>
                </div>

                <section className="bookingPageSection bookingNotesSection">
                  <header className="bookingSectionHeader">
                    <span className="bookingSectionIcon" aria-hidden="true">
                      <svg viewBox="0 0 24 24">
                        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-5 4v-4.5a2.5 2.5 0 0 1-1-2V5.5Z" />
                        <path d="M8 8h8M8 12h5" />
                      </svg>
                    </span>
                    <span className="bookingSectionHeading">
                      <h2>Notes (Optional)</h2>
                      <p>Share any details that may help the clinic prepare.</p>
                    </span>
                  </header>
                  <label className="bookingNotesField">
                    <textarea
                      className="input"
                      rows={4}
                      placeholder="Share any details that may help the clinic prepare."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      disabled={!user || saving}
                      aria-label="Notes (Optional)"
                    />
                  </label>
                </section>

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
                  type="submit"
                  className="btn btnShine bookingPrimaryBtn"
                  disabled={!user || saving || !selectedServices.length || loadingAvailability || Boolean(availabilityError) || !availableSlots.length || isSunday(date) || Boolean(selectedClosure) || !selectedDentistId || !agreedToPrivacyConsent}
                >
                  Review Appointment Details
                </button>

                {bookingStep === "review" && bookingConfirmation ? (
                  <div
                    className="bookingReviewOverlay"
                    onMouseDown={(event) => {
                      if (event.target === event.currentTarget && !saving) returnToInfo();
                    }}
                  >
                    <section
                      className="bookingReviewModal"
                      role="dialog"
                      aria-modal="true"
                      aria-labelledby="bookingReviewTitle"
                    >
                      <header className="bookingReviewModalHeader">
                        <h3 id="bookingReviewTitle">Review Appointment Details</h3>
                      </header>

                      <div className="bookingReviewModalContent">
                        <section className="bookingReviewModalSection">
                          <h4>Patient Information</h4>
                          <dl className="bookingReviewModalRows">
                            <div><dt>Full name</dt><dd>{patientProfile.fullName}</dd></div>
                            <div><dt>Age</dt><dd>{patientProfile.age || "—"}</dd></div>
                            <div><dt>Email</dt><dd>{patientProfile.email || user.email || "—"}</dd></div>
                            <div><dt>Contact number</dt><dd>{patientProfile.phone || "—"}</dd></div>
                            <div><dt>Patient type</dt><dd>{patientProfile.patientType || "—"}</dd></div>
                          </dl>
                        </section>

                        <section className="bookingReviewModalSection">
                          <h4>Selected Service/s</h4>
                          <ul className="bookingReviewModalServices">
                            {selectedServices.map((name) => {
                              const serviceOption = activeServiceOptions.find((option) => option.name === name);
                              return (
                                <li key={name}>
                                  <span>{serviceLabel(name)}</span>
                                  <strong>{serviceOption?.startingRate || "Pricing not set"}</strong>
                                </li>
                              );
                            })}
                          </ul>
                          {bracesPackage ? <p>{BRACES_PACKAGE_INCLUSIONS.join(" · ")}</p> : null}
                        </section>

                        <section className="bookingReviewModalSection">
                          <h4>Preferred Dentist</h4>
                          <dl className="bookingReviewModalRows">
                            <div><dt>Dentist</dt><dd>{selectedDentist || "—"}</dd></div>
                          </dl>
                        </section>

                        <section className="bookingReviewModalSection">
                          <h4>Appointment Schedule</h4>
                          <dl className="bookingReviewModalRows">
                            <div><dt>Date</dt><dd>{formatDateLabel(date)}</dd></div>
                            <div><dt>Time</dt><dd>{bookingConfirmation.requestedTimeRange || selectedTimeRange}</dd></div>
                            <div>
                              <dt>Clinic days</dt>
                              <dd>{selectedClosure ? selectedClosure.label : "Monday to Saturday"}</dd>
                            </div>
                          </dl>
                          {bookingConfirmation.hasDuplicateWarning ? (
                            <p className="bookingReviewModalWarning">
                              A previous booking for one of these services exists on this day. The clinic may review this request more carefully.
                            </p>
                          ) : null}
                        </section>


                      </div>

                      {error ? <div className="error" role="alert">{error}</div> : null}

                      <footer className="bookingReviewModalActions">
                        <button
                          type="button"
                          className="btn btnShine bookingPrimaryBtn"
                          onClick={confirmBookingSubmission}
                          disabled={!bookingConfirmation || saving}
                        >
                          {saving ? <LoadingIndicator>Confirming booking…</LoadingIndicator> : "Confirm Booking"}
                        </button>
                        <button
                          type="button"
                          className="btn bookingReviewCancelBtn"
                          onClick={returnToInfo}
                          disabled={saving}
                        >
                          Cancel
                        </button>
                      </footer>
                    </section>
                  </div>
                ) : null}
              </form>
            </>
          ) : null}

          {error && bookingStep !== "review" ? <div className="error">{error}</div> : null}
        </div>
      </div>
    </div>
    </>
  );
}
