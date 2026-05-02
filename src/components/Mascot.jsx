import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useLocation, useNavigate } from "react-router-dom";
import { auth } from "../firebase";
import "./Mascot.css";

const DEFAULT_MESSAGE = "Hi, I'm your little booking helper.";
const HINT_COOLDOWN = 4200;
const AUTO_MESSAGE_COOLDOWN = 5000;
const THEMES = ["light", "dark", "blue"];
const TIPS_DISABLED_KEY = "topdent-mascot-tips-disabled";
const TOUR_SEEN_KEY = "topdent-mascot-tour-seen";
const THEME_HINTS = {
  light: {
    text: "Back to a clean bright smile!",
    mood: "happy",
    pose: "wave",
  },
  dark: {
    text: "Night mode activated. Easy on the eyes!",
    mood: "calm",
    pose: "wave",
  },
  blue: {
    text: "GUSTONG DESIGN NI MASTER JAIRUS",
    mood: "happy",
    pose: "celebrate",
  },
};
const TOUR_LIBRARY = {
  home: [
    {
      id: "home-hero",
      targets: ["home-hero"],
      message: "Welcome to the clinic website. This is the main introduction to TopDent.",
      label: "Welcome",
      pose: "wave",
      mood: "happy",
    },
    {
      id: "home-book-preview",
      targets: ["book"],
      message: "This quick action is the fastest way into the booking form.",
      label: "Book appointment",
      pose: "point-book",
      mood: "happy",
    },
    {
      id: "nav-services",
      targets: ["nav-services"],
      message: "Use Services to review treatment options before booking.",
      label: "Open Services",
      pose: "point-book",
      mood: "happy",
    },
    {
      id: "nav-book",
      targets: ["nav-book", "book"],
      message: "Click Book when you are ready to schedule an appointment.",
      label: "Book here",
      pose: "point-book",
      mood: "happy",
    },
    {
      id: "nav-contact",
      targets: ["nav-contact"],
      message: "Contact shows the clinic details and map if you need directions first.",
      label: "Reach us here",
      pose: "point-contact",
      mood: "happy",
    },
    {
      id: "home-gallery",
      targets: ["home-gallery"],
      message: "This section gives you a quick feel for the clinic atmosphere.",
      label: "Clinic preview",
      pose: "peek",
      mood: "happy",
    },
  ],
  services: [
    {
      id: "selected-service-card",
      targets: ["selected-service-card"],
      message: "Select a service card to view its details.",
      label: "Selected card",
      pose: "peek",
      mood: "happy",
    },
    {
      id: "services-nav",
      targets: ["services-nav"],
      message: "Use the left and right buttons to browse services.",
      label: "Browse here",
      pose: "point-book",
      mood: "happy",
    },
    {
      id: "selected-service-details",
      targets: ["selected-service-details"],
      message: "The selected service details appear below.",
      label: "Details below",
      pose: "peek",
      mood: "happy",
    },
    {
      id: "service-pricing",
      targets: ["service-pricing"],
      message: "Check the starting rate and estimated duration.",
      label: "Rate and time",
      pose: "point-book",
      mood: "happy",
    },
    {
      id: "service-planning",
      targets: ["service-planning"],
      message: "Review appointment planning notes.",
      label: "Planning notes",
      pose: "peek",
      mood: "happy",
    },
    {
      id: "book",
      targets: ["book"],
      message: "Click Book to schedule this service.",
      label: "Book here",
      pose: "celebrate",
      mood: "happy",
    },
  ],
  book: [
    {
      id: "booking-auth",
      targets: ["booking-auth"],
      message: "Sign in first before booking so your appointment stays tied to one account.",
      label: "Sign in here",
      pose: "point-book",
      mood: "happy",
    },
    {
      id: "book-profile",
      targets: ["book-profile", "book-name"],
      message: "Complete your patient profile before sending a booking request.",
      label: "Profile first",
      pose: "point-book",
      mood: "happy",
    },
    {
      id: "book-service",
      targets: ["book-service"],
      message: "Start by choosing one or more dental services here.",
      label: "Choose service",
      pose: "point-book",
      mood: "happy",
    },
    {
      id: "book-date",
      targets: ["book-date"],
      message: "Choose a clinic day here. Sundays stay closed, and the suggested dates help you move faster.",
      label: "Pick a day",
      pose: "point-book",
      mood: "happy",
    },
    {
      id: "book-dentist",
      targets: ["book-dentist"],
      message: "Pick the dentist you want first so the schedule only shows valid options.",
      label: "Choose dentist",
      pose: "point-book",
      mood: "happy",
    },
    {
      id: "book-time",
      targets: ["book-time"],
      message: "These time slots already account for the full combined service duration, so overlapping appointments are blocked.",
      label: "Choose time",
      pose: "point-book",
      mood: "happy",
    },
    {
      id: "book-consent",
      targets: ["book-consent"],
      message: "Before sending anything, confirm the confidentiality consent here.",
      label: "Consent required",
      pose: "point-book",
      mood: "happy",
    },
    {
      id: "book-submit",
      targets: ["book-submit"],
      message: "Once everything looks right, submit your appointment request here.",
      label: "Submit here",
      pose: "celebrate",
      mood: "happy",
    },
  ],
  contact: [
    {
      id: "contact",
      targets: ["contact"],
      message: "These are the main clinic contact details.",
      label: "Contact details",
      pose: "point-contact",
      mood: "happy",
    },
    {
      id: "map",
      targets: ["map"],
      message: "Find our clinic location here.",
      label: "Map here",
      pose: "point-contact",
      mood: "happy",
    },
    {
      id: "nav-book",
      targets: ["nav-book"],
      message: "When you are ready, you can go straight to booking from here.",
      label: "Book next",
      pose: "point-book",
      mood: "happy",
    },
  ],
};

function getBookTourSteps(isSignedIn) {
  if (!isSignedIn) {
    return [
      {
        id: "booking-auth",
        targets: ["booking-auth"],
        message: "This page starts with Google sign-in so one patient account stays tied to one booking history.",
        label: "Sign in here",
        pose: "point-book",
        mood: "happy",
      },
      {
        id: "booking-summary",
        targets: ["booking-summary"],
        message: "Even before signing in, this side shows the appointment summary area you will review before submitting.",
        label: "Summary here",
        pose: "peek",
        mood: "happy",
      },
      {
        id: "booking-calendar",
        targets: ["booking-calendar"],
        message: "This availability calendar helps patients understand which clinic dates are open before they begin booking.",
        label: "Availability view",
        pose: "point-contact",
        mood: "happy",
      },
    ];
  }

  return [
    {
      id: "booking-summary",
      targets: ["booking-summary"],
      message: "This summary panel keeps the chosen patient, services, dentist, date, and time in one place.",
      label: "Summary here",
      pose: "peek",
      mood: "happy",
    },
    {
      id: "booking-calendar",
      targets: ["booking-calendar"],
      message: "This availability calendar shows which dates are open for the current dentist view.",
      label: "Availability view",
      pose: "point-contact",
      mood: "happy",
    },
    {
      id: "book-service",
      targets: ["book-service"],
      message: "Start by choosing one or more dental services here.",
      label: "Choose service",
      pose: "point-book",
      mood: "happy",
    },
    {
      id: "book-date",
      targets: ["book-date"],
      message: "Choose a clinic day here. Sundays stay closed, and the suggested dates help you move faster.",
      label: "Pick a day",
      pose: "point-book",
      mood: "happy",
    },
    {
      id: "book-dentist",
      targets: ["book-dentist"],
      message: "Pick the dentist you want first so the schedule only shows valid options.",
      label: "Choose dentist",
      pose: "point-book",
      mood: "happy",
    },
    {
      id: "book-time",
      targets: ["book-time"],
      message: "These time slots already account for the full combined service duration, so overlapping appointments are blocked.",
      label: "Choose time",
      pose: "point-book",
      mood: "happy",
    },
    {
      id: "book-consent",
      targets: ["book-consent"],
      message: "Before sending anything, confirm the confidentiality consent here.",
      label: "Consent required",
      pose: "point-book",
      mood: "happy",
    },
    {
      id: "book-submit",
      targets: ["book-submit"],
      message: "Once everything looks right, submit your appointment request here.",
      label: "Submit here",
      pose: "celebrate",
      mood: "happy",
    },
  ];
}

function getBookCurrentPageTourSteps(isSignedIn) {
  if (typeof document === "undefined") {
    return getBookTourSteps(isSignedIn);
  }

  const hasAuthStep = Boolean(document.querySelector('[data-mascot-target="booking-auth"]'));
  const hasProfileSetup = Boolean(
    document.querySelector('[data-mascot-target="book-profile-save"]')
    || document.querySelector('[data-mascot-target="book-name"]')
  );
  const hasFullBookingForm = Boolean(document.querySelector('[data-mascot-target="book-service"]'));

  if (hasAuthStep) {
    return getBookTourSteps(false);
  }

  if (hasProfileSetup && !hasFullBookingForm) {
    return [
      {
        id: "book-profile",
        targets: ["book-name", "book-profile", "book-profile-save"],
        message: "Start here by completing your patient profile so the clinic can keep one clean record for this Google account.",
        label: "Complete profile",
        pose: "point-book",
        mood: "happy",
      },
      {
        id: "booking-summary",
        targets: ["booking-summary"],
        message: "This side still previews how your appointment summary will look once booking is unlocked.",
        label: "Summary preview",
        pose: "peek",
        mood: "happy",
      },
      {
        id: "booking-calendar",
        targets: ["booking-calendar"],
        message: "The calendar stays visible here so you can already understand the clinic availability before the full form opens.",
        label: "Availability view",
        pose: "point-contact",
        mood: "happy",
      },
    ];
  }

  return getBookTourSteps(isSignedIn);
}

function getFullTourSteps(isSignedIn) {
  return [
    ...TOUR_LIBRARY.home
      .filter((step) => !String(step.id).startsWith("nav-"))
      .map((step) => ({ ...step, route: "/" })),
    {
      id: "go-services",
      route: "/",
      targets: ["nav-services"],
      transitionTo: "/services",
      message: "Now press Services on the navigation so I can tour that page next.",
      label: "Press Services",
      pose: "point-book",
      mood: "happy",
    },
    ...TOUR_LIBRARY.services.map((step) => ({ ...step, route: "/services" })),
    {
      id: "go-book",
      route: "/services",
      targets: ["nav-book"],
      transitionTo: "/book",
      message: "Nice. Next, press Book on the navigation so I can walk you through the appointment page.",
      label: "Press Book",
      pose: "point-book",
      mood: "happy",
    },
    ...getBookTourSteps(isSignedIn).map((step) => ({ ...step, route: "/book" })),
    {
      id: "go-contact",
      route: "/book",
      targets: ["nav-contact"],
      transitionTo: "/contact",
      message: "Great. Press Contact on the navigation and I’ll show you the clinic details and map.",
      label: "Press Contact",
      pose: "point-contact",
      mood: "happy",
    },
    ...TOUR_LIBRARY.contact
      .filter((step) => step.id !== "nav-book")
      .map((step) => ({ ...step, route: "/contact" })),
  ];
}

function detectTheme() {
  if (typeof document === "undefined") return "light";

  const htmlTheme = document.documentElement.getAttribute("data-theme");
  if (THEMES.includes(htmlTheme)) return htmlTheme;

  const bodyTheme = document.body?.getAttribute("data-theme");
  if (THEMES.includes(bodyTheme)) return bodyTheme;

  const htmlClassTheme = THEMES.find((theme) => document.documentElement.classList.contains(theme) || document.documentElement.classList.contains(`theme-${theme}`));
  if (htmlClassTheme) return htmlClassTheme;

  const bodyClassTheme = THEMES.find((theme) => document.body?.classList.contains(theme) || document.body?.classList.contains(`theme-${theme}`));
  if (bodyClassTheme) return bodyClassTheme;

  if (typeof window !== "undefined") {
    const storedTheme = window.localStorage.getItem("topdent-theme");
    if (THEMES.includes(storedTheme)) return storedTheme;
  }

  return "light";
}

function getPageTourKey(pathname) {
  if (pathname === "/book") return "book";
  if (pathname === "/services") return "services";
  if (pathname === "/contact") return "contact";
  if (pathname === "/") return "home";
  return "";
}

function getTourSteps(pathname, type = "current", isSignedIn = false) {
  const pageKey = getPageTourKey(pathname);
  if (!pageKey && type !== "full") return [];

  if (type === "home") return TOUR_LIBRARY.home;
  if (type === "booking") return getBookTourSteps(isSignedIn);
  if (type === "services") return TOUR_LIBRARY.services;
  if (type === "contact") return TOUR_LIBRARY.contact;
  if (type === "full") return getFullTourSteps(isSignedIn);

  if (pageKey === "book") return getBookCurrentPageTourSteps(isSignedIn);
  return TOUR_LIBRARY[pageKey] || [];
}

function getRouteIntro(pathname, isSignedIn) {
  if (pathname === "/book") {
    return isSignedIn
      ? {
        text: "Choose your dentist here, then I can help with the next step.",
        pose: "point-book",
        mood: "happy",
        target: "book",
        label: "Start here",
      }
      : {
        text: "Please sign in first so your booking stays connected to one patient profile.",
        pose: "point-book",
        mood: "calm",
        target: "book",
        label: "Sign in first",
      };
  }
  if (pathname === "/services") {
    return {
      text: "Select a service card to view its details.",
      pose: "peek",
      mood: "happy",
      target: "selected-service-card",
      label: "Select here",
    };
  }
  if (pathname === "/contact") {
    return {
      text: "We're located here. The map can help you find the clinic faster.",
      pose: "point-contact",
      mood: "happy",
      target: "map",
      label: "We're here",
    };
  }
  if (pathname === "/about") {
    return { text: "This page explains the clinic story and how TopDent works.", pose: "wave", mood: "happy" };
  }
  if (pathname === "/my-appointments") {
    return {
      text: "Track your appointments here, then send one clear reschedule or cancellation request if needed.",
      pose: "wave",
      mood: "happy",
    };
  }
  if (pathname === "/") {
    return {
      text: "This home page gives the quick clinic overview, then leads you into booking.",
      pose: "wave",
      mood: "happy",
      target: "home-hero",
      label: "Welcome",
    };
  }
  return {
    text: "Click here to book your appointment whenever you're ready.",
    pose: "wave",
    mood: "happy",
    target: "book",
    label: "Click here",
  };
}

function findVisibleTarget(targetKey) {
  if (!targetKey || typeof document === "undefined") return null;
  const candidates = Array.from(document.querySelectorAll(`[data-mascot-target="${targetKey}"]`));
  return candidates.find((entry) => {
    const rect = entry.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
  }) || candidates[0] || null;
}

function resolveTourTarget(step) {
  const targetKeys = Array.isArray(step.targets) ? step.targets : [step.target].filter(Boolean);
  for (const key of targetKeys) {
    const exists = typeof document !== "undefined"
      ? document.querySelector(`[data-mascot-target="${key}"]`)
      : null;
    if (!exists) continue;

    const element = findVisibleTarget(key);
    if (element) {
      return { element, key };
    }
  }
  return null;
}

function getDockMetrics() {
  return window.innerWidth <= 760
    ? { width: 176, height: 212, margin: 14, topLimit: 120 }
    : { width: 220, height: 252, margin: 18, topLimit: 132 };
}

function getTourDockPosition(targetElement) {
  const rect = targetElement.getBoundingClientRect();
  const { width, height, margin, topLimit } = getDockMetrics();
  const gap = 26;

  let left = rect.left - width - gap;
  if (left < margin) {
    left = rect.right + gap;
  }
  if (left + width > window.innerWidth - margin) {
    left = Math.min(window.innerWidth - width - margin, Math.max(margin, rect.left + (rect.width - width) / 2));
  }

  let top = rect.top + (rect.height - height) / 2;
  top = Math.min(window.innerHeight - height - margin, Math.max(topLimit, top));

  return { left, top };
}

export default function Mascot() {
  const location = useLocation();
  const navigate = useNavigate();
  const timersRef = useRef([]);
  const cooldownsRef = useRef({});
  const previousThemeRef = useRef(null);
  const lastAutoMessageRef = useRef({ key: "", time: 0 });
  const selectedServiceFollowRef = useRef({ frame: null, timeout: null });
  const dockRef = useRef(null);
  const [user, setUser] = useState(() => auth.currentUser);
  const [isVisible, setIsVisible] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [showBubble, setShowBubble] = useState(true);
  const [pose, setPose] = useState("idle");
  const [mood, setMood] = useState("calm");
  const [highlight, setHighlight] = useState(null);
  const [theme, setTheme] = useState(detectTheme);
  const [tipsDisabled, setTipsDisabled] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(TIPS_DISABLED_KEY) === "true";
  });
  const [isTourActive, setIsTourActive] = useState(false);
  const [tourType, setTourType] = useState(null);
  const [tourSteps, setTourSteps] = useState([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(-1);
  const [tourPosition, setTourPosition] = useState(null);
  const [lockedTarget, setLockedTarget] = useState(null);
  const [pendingStepIndex, setPendingStepIndex] = useState(null);
  const [tourMisclickCount, setTourMisclickCount] = useState(0);
  const [crownTaken, setCrownTaken] = useState(false);
  const [wandTaken, setWandTaken] = useState(false);
  const [isWebsiteCursed, setIsWebsiteCursed] = useState(false);
  const [curseRecovery, setCurseRecovery] = useState({ crown: false, wand: false });

  const active = useMemo(() => !location.pathname.startsWith("/admin"), [location.pathname]);
  const currentPageTourSteps = useMemo(
    () => getTourSteps(location.pathname, "current", Boolean(user)),
    [location.pathname, user]
  );
  const currentTourStep = useMemo(
    () => (currentStepIndex >= 0 ? tourSteps[currentStepIndex] || null : null),
    [currentStepIndex, tourSteps]
  );
  const isScary = crownTaken || wandTaken || isWebsiteCursed;
  const isDemonMode = crownTaken && wandTaken;

  function clearTimers() {
    timersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    timersRef.current = [];
  }

  function clearSelectedServiceFollow() {
    if (selectedServiceFollowRef.current.frame) {
      window.cancelAnimationFrame(selectedServiceFollowRef.current.frame);
    }
    if (selectedServiceFollowRef.current.timeout) {
      window.clearTimeout(selectedServiceFollowRef.current.timeout);
    }
    selectedServiceFollowRef.current = { frame: null, timeout: null };
  }

  function rememberTimer(callback, delay) {
    const timerId = window.setTimeout(callback, delay);
    timersRef.current.push(timerId);
    return timerId;
  }

  function closeBubbleLater(delay = 2800) {
    rememberTimer(() => setShowBubble(false), delay);
  }

  function clearHighlightLater(delay = 2400) {
    rememberTimer(() => setHighlight(null), delay);
  }

  function canShowHint(key, cooldown = HINT_COOLDOWN) {
    const now = Date.now();
    const previous = cooldownsRef.current[key] || 0;
    if (now - previous < cooldown) return false;
    cooldownsRef.current[key] = now;
    return true;
  }

  function canShowAutoMessage(key = "", cooldown = AUTO_MESSAGE_COOLDOWN) {
    const now = Date.now();
    if (isTourActive) return false;
    if (!key) return false;
    if (lastAutoMessageRef.current.key === key && now - lastAutoMessageRef.current.time < cooldown) {
      return false;
    }
    if (now - lastAutoMessageRef.current.time < cooldown) {
      return false;
    }
    lastAutoMessageRef.current = { key, time: now };
    return true;
  }

  function setHighlightTarget(targetKey, label = "Click here", targetElement = null) {
    const target = targetElement && document.body.contains(targetElement)
      ? targetElement
      : findVisibleTarget(targetKey);
    if (!target) {
      setHighlight(null);
      return;
    }

    const rect = target.getBoundingClientRect();
    setHighlight({
      key: targetKey,
      label,
      element: target,
      placeBelow: rect.top < 92,
      top: rect.top + window.scrollY,
      left: rect.left + window.scrollX,
      width: rect.width,
      height: rect.height,
    });
  }

  function positionMascotNearTarget(targetElement) {
    if (typeof window === "undefined" || !targetElement) return;
    setTourPosition(getTourDockPosition(targetElement));
  }

  function animateMascotToTarget(targetElement) {
    if (typeof window === "undefined" || !targetElement) return;

    const nextPosition = getTourDockPosition(targetElement);
    const currentRect = dockRef.current?.getBoundingClientRect();

    if (currentRect?.width && currentRect?.height) {
      setTourPosition({
        left: currentRect.left,
        top: currentRect.top,
      });

      window.requestAnimationFrame(() => {
        setTourPosition(nextPosition);
      });
      return;
    }

    setTourPosition(nextPosition);
  }

  function clearTourState() {
    setIsTourActive(false);
    setTourType(null);
    setTourSteps([]);
    setCurrentStepIndex(-1);
    setTourPosition(null);
    setLockedTarget(null);
    setPendingStepIndex(null);
    setTourMisclickCount(0);
  }

  function toggleTipsDisabled() {
    const nextValue = !tipsDisabled;
    setTipsDisabled(nextValue);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TIPS_DISABLED_KEY, nextValue ? "true" : "false");
    }

    if (nextValue) {
      clearTimers();
      clearTourState();
      setHighlight(null);
      setShowBubble(false);
      setPose("idle");
      setMood("calm");
      return;
    }

    setMessage("Tips are back on. I’ll keep the help quieter unless you need me.");
    setShowBubble(true);
    setPose("wave");
    setMood("happy");
    rememberTimer(() => setPose("idle"), 1200);
    rememberTimer(() => setMood("calm"), 1500);
    closeBubbleLater(2200);
  }

  function reactToPropTheft(prop) {
    if (isTourActive) return;

    clearTimers();
    const nextCrownTaken = prop === "crown" ? true : crownTaken;
    const nextWandTaken = prop === "wand" ? true : wandTaken;
    const nextDemonMode = nextCrownTaken && nextWandTaken;

    setMenuOpen(nextDemonMode);
    setShowBubble(true);
    setPose(nextDemonMode ? "celebrate" : "jump");
    setMood("angry");

    if (prop === "crown") {
      setCrownTaken(true);
      setMessage(nextDemonMode
        ? "You took both. Now I own the screen. Put them back if you want peace."
        : "My crown! Now I look a little scary. Put it back when you're done.");
    } else {
      setWandTaken(true);
      setMessage(nextDemonMode
        ? "That was the last one. Demon mode it is. Return them if you want the site back."
        : "You took my wand! Without it I look way creepier.");
    }

    if (!nextDemonMode) {
      rememberTimer(() => setPose("idle"), 1400);
      rememberTimer(() => setMood("calm"), 1800);
      closeBubbleLater(2800);
    }
  }

  function restoreProp(prop) {
    clearTimers();
    setShowBubble(true);
    setPose("wave");
    setMood("happy");

    if (prop === "crown") {
      setCrownTaken(false);
      setMessage(wandTaken ? "Thanks. The crown is back. I still need my wand though." : "Much better. My crown is back where it belongs.");
    } else {
      setWandTaken(false);
      setMessage(crownTaken ? "Thanks. The wand is back. I still need my crown though." : "Ahh, that feels better. My wand is back.");
    }

    rememberTimer(() => setPose("idle"), 1300);
    rememberTimer(() => setMood("calm"), 1700);
    closeBubbleLater(2400);
  }

  function breakTheCurse() {
    clearTimers();
    setIsWebsiteCursed(false);
    setCrownTaken(false);
    setWandTaken(false);
    setCurseRecovery({ crown: false, wand: false });
    setMenuOpen(false);
    setHighlight(null);
    setTourPosition(null);
    setShowBubble(true);
    setPose("wave");
    setMood("happy");
    setMessage("The curse is gone. Everything feels normal again.");
    rememberTimer(() => setPose("idle"), 1300);
    rememberTimer(() => setMood("calm"), 1700);
    closeBubbleLater(2400);
  }

  function embraceTheCurse() {
    clearTimers();
    setIsWebsiteCursed(true);
    setCurseRecovery({ crown: false, wand: false });
    setMenuOpen(true);
    setHighlight(null);
    setShowBubble(true);
    setPose("jump");
    setMood("angry");
    setMessage("Fine. Keep them. Find the hidden wand on Book and the crown on Contact if you want to undo this.");

    const logoutTarget = findVisibleTarget("nav-logout");

    if (!user) {
      rememberTimer(() => setPose("idle"), 1600);
      return;
    }

    rememberTimer(() => {
      setMessage("The curse is locking onto your session. You still have time to return the crown and wand.");
      setShowBubble(true);
      setPose("point-book");
      setMood("angry");
    }, 1600);

    if (logoutTarget) {
      rememberTimer(() => {
        if (!document.body.contains(logoutTarget)) return;
        logoutTarget.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
        setHighlightTarget("nav-logout", "Logout target", logoutTarget);
        setMessage("Watch closely. I'm floating toward Logout now.");
        setShowBubble(true);
        setPose("point-book");
      }, 3200);

      rememberTimer(() => {
        if (!document.body.contains(logoutTarget)) return;
        animateMascotToTarget(logoutTarget);
        setMessage("Almost there. Return both items before the countdown ends.");
        setShowBubble(true);
        setPose("jump");
      }, 4700);
    } else {
      rememberTimer(() => {
        setMessage("I cannot see the Logout button, but the curse countdown is still running.");
        setShowBubble(true);
        setPose("jump");
      }, 3200);
    }

    rememberTimer(() => {
      setMessage("Logging out in 3...");
      setShowBubble(true);
      setPose("jump");
    }, logoutTarget ? 7000 : 4800);

    rememberTimer(() => {
      setMessage("Logging out in 2...");
      setShowBubble(true);
    }, logoutTarget ? 8200 : 6000);

    rememberTimer(() => {
      setMessage("Logging out in 1...");
      setShowBubble(true);
    }, logoutTarget ? 9400 : 7200);

    rememberTimer(async () => {
      try {
        await signOut(auth);
        setMessage("Logged out. The curse still lingers until the missing items return.");
        setShowBubble(true);
        setPose("idle");
      } catch (error) {
        console.error("Demonic logout failed:", error);
        setMessage("The curse tried to log you out, but the logout failed.");
        setShowBubble(true);
      }
    }, logoutTarget ? 10800 : 8600);
  }

  function handleChaosBlockedInteraction() {
    if (!isDemonMode || isTourActive) return;
    if (!canShowHint("mascot-demon-block", 1500)) return;

    clearTimers();
    setMenuOpen(true);
    setMessage(
      Math.random() > 0.5
        ? "Nope. Return the crown and wand first."
        : "You broke the fairy rules. Give my things back."
    );
    setShowBubble(true);
    setPose("jump");
    setMood("angry");
    rememberTimer(() => setPose("idle"), 900);
  }

  function stopTour(messageText = "No problem. Tap Start Tour anytime if you want the guided version.") {
    clearTimers();
    clearTourState();
    setHighlight(null);
    setPose("wave");
    setMood("calm");
    setMessage(messageText);
    setShowBubble(true);
    closeBubbleLater(2200);
    rememberTimer(() => setPose("idle"), 1200);
  }

  function syncTourStep(index, options = {}) {
    const { auto = false, stepList = tourSteps, skipNavigation = false } = options;
    const step = stepList[index];
    setTourSteps(stepList);
    setCurrentStepIndex(index);
    setIsTourActive(true);
    setTourMisclickCount(0);
    if (!step) {
      stopTour("Tour finished. I’m back here if you need another quick guide.");
      return;
    }

    if (step.route && !skipNavigation && location.pathname !== step.route) {
      clearTimers();
      setPendingStepIndex(index);
      setLockedTarget(null);
      setHighlight(null);
      setTourPosition(null);
      setMessage("Taking you to the next part of the tour...");
      setShowBubble(true);
      setPose("wave");
      setMood("happy");
      navigate(step.route);
      return;
    }

    setPendingStepIndex(null);

    const resolved = resolveTourTarget(step);
    if (!resolved) {
      syncTourStep(index + 1, options);
      return;
    }

    clearTimers();
    setLockedTarget(resolved.key);

    if (auto && typeof window !== "undefined") {
      window.localStorage.setItem(TOUR_SEEN_KEY, "true");
    }

    resolved.element.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "center",
    });

    let interactionBound = false;
    const lockOnTarget = (attempt = 0) => {
      const refreshed = resolveTourTarget(step) || resolved;

      if (!refreshed?.element || !document.body.contains(refreshed.element)) {
        if (attempt >= 6) {
          syncTourStep(index + 1, options);
          return;
        }
        rememberTimer(() => lockOnTarget(attempt + 1), attempt < 2 ? 100 : 160);
        return;
      }

      positionMascotNearTarget(refreshed.element);
      setHighlightTarget(refreshed.key, step.label, refreshed.element);
      setMessage(step.message);
      setShowBubble(true);
      setPose(step.pose || "wave");
      setMood(step.mood || "happy");

      if (!interactionBound) {
        interactionBound = true;
        if (step.transitionTo) {
          const handleTransition = (event) => {
            event.preventDefault();
            event.stopPropagation();
            setPendingStepIndex(index + 1);
            setLockedTarget(null);
            setHighlight(null);
            setTourPosition(null);
            setMessage("Nice. Opening the next page...");
            setShowBubble(true);
            setPose("wave");
            setMood("happy");
            navigate(step.transitionTo);
          };
          refreshed.element.addEventListener("click", handleTransition, { once: true });
        } else if (step.nextOnClick) {
          const handleAdvance = () => syncTourStep(index + 1, { stepList });
          refreshed.element.addEventListener("click", handleAdvance, { once: true });
        }
      }

      if (attempt < 4) {
        rememberTimer(() => lockOnTarget(attempt + 1), 120);
      }
    };

    rememberTimer(() => lockOnTarget(0), 160);
  }

  function startTour(type = "current", options = {}) {
    const nextSteps = getTourSteps(location.pathname, type === "current" ? "current" : type, Boolean(user));
    if (!nextSteps.length) {
      setMenuOpen(false);
      setMessage("I don't have a guided tour for this page yet.");
      setShowBubble(true);
      setPose("wave");
      setMood("calm");
      closeBubbleLater(2200);
      return;
    }

    setMenuOpen(false);
    setTourType(type);
    setTourMisclickCount(0);
    syncTourStep(0, { ...options, stepList: nextSteps });
  }

  function moveTour(direction) {
    if (direction > 0 && currentTourStep?.transitionTo) {
      clearTimers();
      setMessage("Press the highlighted navigation item to continue this part of the tour.");
      setShowBubble(true);
      setMood("angry");
      setPose("point-book");
      return;
    }
    const nextIndex = currentStepIndex + direction;
    if (direction < 0 && nextIndex < 0) {
      syncTourStep(0, { stepList: tourSteps });
      return;
    }
    syncTourStep(nextIndex, { stepList: tourSteps });
  }

  function skipTour() {
    stopTour("No problem. You can start the tour again anytime.");
  }

  function handleTourOverlayClick() {
    if (!isTourActive) return;
    const nextMisses = tourMisclickCount + 1;
    setTourMisclickCount(nextMisses);

    const activeStep = currentTourStep;
    if (activeStep?.transitionTo && nextMisses >= 3) {
      clearTimers();
      setPendingStepIndex(currentStepIndex + 1);
      setLockedTarget(null);
      setHighlight(null);
      setTourPosition(null);
      setMessage("Okay, I’ll open the next page for you this time.");
      setShowBubble(true);
      setMood("angry");
      setPose("point-book");
      navigate(activeStep.transitionTo);
      return;
    }

    const warning = activeStep?.transitionTo
      ? nextMisses >= 2
        ? "Still not there. Press the highlighted navigation item."
        : "Press the highlighted navigation item to continue."
      : nextMisses >= 2
        ? "Use Next to continue this part of the tour."
        : "This part is just for viewing. Use Next when you're ready.";
    clearTimers();
    setMessage(warning);
    setShowBubble(true);
    setMood("angry");
    setPose("point-book");
  }

  function showAssistantMessage(nextMessage, options = {}) {
    const {
      nextPose = "idle",
      nextMood = "calm",
      bubbleDuration = 2800,
      resetDelay = 1700,
      key = "",
      force = false,
      target = "",
      label = "Click here",
      cooldown = HINT_COOLDOWN,
    } = options;

    if (isTourActive) return;
    if (key && !force && !canShowHint(key, cooldown)) return;

    clearTimers();
    setMessage(nextMessage);
    setShowBubble(true);
    setPose(nextPose);
    setMood(nextMood);

    if (target) {
      const targetElement = findVisibleTarget(target);
      if (targetElement) {
        targetElement.scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "nearest",
        });
        rememberTimer(() => {
          if (!document.body.contains(targetElement)) return;
          setHighlightTarget(target, label, targetElement);
          positionMascotNearTarget(targetElement);
        }, 220);
      }
      rememberTimer(() => {
        if (!isTourActive) {
          setHighlight(null);
          setTourPosition(null);
        }
      }, Math.max(2200, bubbleDuration));
    } else {
      setHighlight(null);
      if (!isTourActive) setTourPosition(null);
    }

    if (nextPose !== "idle" && !isTourActive) {
      rememberTimer(() => setPose("idle"), resetDelay);
    }
    if (nextMood !== "calm" && !isTourActive) {
      rememberTimer(() => setMood("calm"), resetDelay + 200);
    }

    if (!isTourActive) {
      closeBubbleLater(bubbleDuration);
    }
  }

  useEffect(() => () => {
    clearTimers();
    clearSelectedServiceFollow();
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => setUser(nextUser));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return undefined;

    const syncTheme = () => {
      const nextTheme = detectTheme();
      setTheme((currentTheme) => {
        if (currentTheme === nextTheme) return currentTheme;
        return nextTheme;
      });
    };

    syncTheme();

    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });

    if (document.body) {
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["data-theme", "class"],
      });
    }

    window.addEventListener("storage", syncTheme);
    return () => {
      observer.disconnect();
      window.removeEventListener("storage", syncTheme);
    };
  }, []);

  useEffect(() => {
    if (!active) {
      previousThemeRef.current = theme;
      return;
    }

    if (tipsDisabled) {
      previousThemeRef.current = theme;
      return;
    }

    if (!previousThemeRef.current) {
      previousThemeRef.current = theme;
      return;
    }

    if (previousThemeRef.current === theme) return;
    previousThemeRef.current = theme;

    if (isTourActive) {
      previousThemeRef.current = theme;
      return;
    }

    const themeHint = THEME_HINTS[theme] || THEME_HINTS.light;
    showAssistantMessage(themeHint.text, {
      nextPose: themeHint.pose,
      nextMood: themeHint.mood,
      bubbleDuration: 2400,
      resetDelay: 1600,
      key: `theme-change-${theme}`,
    });
  }, [active, isTourActive, theme, tipsDisabled]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    if (isDemonMode && !isWebsiteCursed && !isTourActive) {
      document.body.classList.add("mascotChaosMode");
      setMenuOpen(true);
    } else {
      document.body.classList.remove("mascotChaosMode");
    }

    return () => {
      document.body.classList.remove("mascotChaosMode");
    };
  }, [isDemonMode, isTourActive, isWebsiteCursed]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    if (isWebsiteCursed) {
      document.body.classList.add("mascotDemonicTheme");
    } else {
      document.body.classList.remove("mascotDemonicTheme");
    }

    return () => {
      document.body.classList.remove("mascotDemonicTheme");
    };
  }, [isWebsiteCursed]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    document.body.classList.toggle("mascotCurseFoundWand", curseRecovery.wand);
    document.body.classList.toggle("mascotCurseFoundCrown", curseRecovery.crown);

    return () => {
      document.body.classList.remove("mascotCurseFoundWand");
      document.body.classList.remove("mascotCurseFoundCrown");
    };
  }, [curseRecovery.crown, curseRecovery.wand]);

  useEffect(() => {
    if (!active || isTourActive || isWebsiteCursed || !isDemonMode) return undefined;

    const intervalId = window.setInterval(() => {
      if (!canShowHint("mascot-demon-taunt", 6800)) return;
      setShowBubble(true);
      setMood("angry");
      setPose("jump");
      setMessage(
        Math.random() > 0.5
          ? "Return my things, or keep the curse and see what happens."
          : "I can spread this curse across the whole clinic if you let me."
      );
      rememberTimer(() => setPose("idle"), 1400);
      closeBubbleLater(2800);
    }, 8200);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [active, isDemonMode, isTourActive, isWebsiteCursed]);

  useEffect(() => {
    if (!active || isTourActive || !isWebsiteCursed) return undefined;

    const proactiveStep = () => {
      const needsWand = !curseRecovery.wand;
      const needsCrown = !curseRecovery.crown;
      if (!needsWand && !needsCrown) return;
      if (!canShowHint("mascot-curse-proactive", 5200)) return;

      const shouldPointToBook = needsWand && (!needsCrown || Math.random() > 0.45);
      const clue = shouldPointToBook
        ? {
            route: "/book",
            navKey: "nav-book",
            label: "Find the wand",
            wrongPageMessage: "The wand is hidden on Book. Go there and look carefully.",
            rightPageMessage: "Good. The wand is somewhere on this page. Keep searching.",
          }
        : {
            route: "/contact",
            navKey: "nav-contact",
            label: "Find the crown",
            wrongPageMessage: "The crown is hidden on Contact. Go there and find it.",
            rightPageMessage: "You're close. The crown is hiding on this page.",
          };

      setShowBubble(true);
      setMenuOpen(true);
      setMood("angry");

      if (location.pathname !== clue.route) {
        const target = findVisibleTarget(clue.navKey);
        if (target) {
          setHighlightTarget(clue.navKey, clue.label, target);
          animateMascotToTarget(target);
          clearHighlightLater(3200);
        }
        setPose("point-book");
        setMessage(clue.wrongPageMessage);
      } else {
        setHighlight(null);
        setPose("jump");
        setMessage(clue.rightPageMessage);
      }

      rememberTimer(() => setPose("idle"), 1500);
      closeBubbleLater(3000);
    };

    const kickoff = window.setTimeout(proactiveStep, 1800);
    const intervalId = window.setInterval(proactiveStep, 7600);

    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(intervalId);
    };
  }, [active, curseRecovery.crown, curseRecovery.wand, isTourActive, isWebsiteCursed, location.pathname]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handleCurseItemFound = (event) => {
      const item = event?.detail?.item;
      if (!isWebsiteCursed || (item !== "crown" && item !== "wand")) return;

      clearTimers();
      setMenuOpen(true);
      setShowBubble(true);
      setPose("celebrate");
      setMood("happy");

      if (item === "crown") {
        setCrownTaken(false);
      }
      if (item === "wand") {
        setWandTaken(false);
      }

      setCurseRecovery((current) => {
        const next = { ...current, [item]: true };
        const recoveredAll = next.crown && next.wand;

        if (recoveredAll) {
          setMessage("You found both missing items. The curse is breaking now.");
          rememberTimer(() => breakTheCurse(), 1400);
        } else {
          const missingText = item === "crown"
            ? "Good. You found the crown. Now search the Book page for the wand."
            : "Nice. You found the wand. Now search the Contact page for the crown.";
          setMessage(missingText);
          rememberTimer(() => setPose("idle"), 1200);
          rememberTimer(() => setMood("calm"), 1500);
        }

        return next;
      });
    };

    window.addEventListener("topdent:curse-item-found", handleCurseItemFound);
    return () => {
      window.removeEventListener("topdent:curse-item-found", handleCurseItemFound);
    };
  }, [isWebsiteCursed]);

  useEffect(() => {
    if (!highlight?.key) return undefined;

    const update = () => {
      const resolved = isTourActive && currentTourStep
        ? resolveTourTarget(currentTourStep)
        : null;
      const activeElement = resolved?.element
        || (highlight.element && document.body.contains(highlight.element)
          ? highlight.element
          : findVisibleTarget(highlight.key));
      const targetKey = resolved?.key || highlight.key;

      if (!activeElement) {
        setHighlight(null);
        if (isTourActive) {
          clearTourState();
        }
        return;
      }

      setHighlightTarget(targetKey, highlight.label, activeElement);
      if (isTourActive || tourPosition) {
        positionMascotNearTarget(activeElement);
      }
    };
    window.addEventListener("resize", update, { passive: true });
    window.addEventListener("scroll", update, { passive: true });
    const domObserver = typeof MutationObserver !== "undefined"
      ? new MutationObserver(update)
      : null;
    domObserver?.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "data-mascot-target", "aria-pressed", "disabled"],
    });
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update);
      domObserver?.disconnect();
    };
  }, [currentTourStep, highlight?.element, highlight?.key, highlight?.label, isTourActive, tourPosition]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handleSelectedServiceChange = () => {
      if (location.pathname !== "/services") return;
      const shouldFollowSelectedCard =
        highlight?.key === "selected-service-card"
        || lockedTarget === "selected-service-card"
        || currentTourStep?.targets?.includes("selected-service-card");
      if (!shouldFollowSelectedCard) return;

      clearSelectedServiceFollow();

      const syncSelectedCard = () => {
        const activeElement = findVisibleTarget("selected-service-card");
        if (!activeElement) return;

        setHighlightTarget("selected-service-card", highlight?.label || "Selected card", activeElement);
        positionMascotNearTarget(activeElement);
        selectedServiceFollowRef.current.frame = window.requestAnimationFrame(syncSelectedCard);
      };

      selectedServiceFollowRef.current.frame = window.requestAnimationFrame(syncSelectedCard);
      selectedServiceFollowRef.current.timeout = window.setTimeout(() => {
        clearSelectedServiceFollow();
        const finalElement = findVisibleTarget("selected-service-card");
        if (!finalElement) return;
        setHighlightTarget("selected-service-card", highlight?.label || "Selected card", finalElement);
        positionMascotNearTarget(finalElement);
      }, 420);
    };

    window.addEventListener("topdent:selected-service-change", handleSelectedServiceChange);
    return () => {
      clearSelectedServiceFollow();
      window.removeEventListener("topdent:selected-service-change", handleSelectedServiceChange);
    };
  }, [currentTourStep, highlight?.key, highlight?.label, location.pathname, lockedTarget]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const activeElement = isTourActive ? highlight?.element : null;
    if (isTourActive) {
      document.body.classList.add("mascotTourLocked");
    } else {
      document.body.classList.remove("mascotTourLocked");
    }

    if (activeElement && document.body.contains(activeElement)) {
      activeElement.classList.add("mascotTourTarget");
    }

    return () => {
      document.body.classList.remove("mascotTourLocked");
      if (activeElement && document.body.contains(activeElement)) {
        activeElement.classList.remove("mascotTourTarget");
      }
    };
  }, [highlight?.element, isTourActive]);

  useEffect(() => {
    if (!isTourActive || pendingStepIndex === null || typeof window === "undefined") return undefined;

    const pendingStep = tourSteps[pendingStepIndex];
    if (!pendingStep || pendingStep.route !== location.pathname) return undefined;

    const timerId = window.setTimeout(() => {
      syncTourStep(pendingStepIndex, { stepList: tourSteps, skipNavigation: true });
    }, 260);

    return () => window.clearTimeout(timerId);
  }, [isTourActive, location.pathname, pendingStepIndex, tourSteps]);

  useEffect(() => {
    if (!isTourActive || !currentTourStep?.transitionTo) return undefined;
    if (location.pathname !== currentTourStep.transitionTo) return undefined;

    const timerId = window.setTimeout(() => {
      syncTourStep(currentStepIndex + 1, { stepList: tourSteps, skipNavigation: true });
    }, 220);

    return () => window.clearTimeout(timerId);
  }, [currentStepIndex, currentTourStep, isTourActive, location.pathname, tourSteps]);

  useEffect(() => {
    if (!isTourActive || typeof document === "undefined") return undefined;

    const handleBlockedInteraction = (event) => {
      const mascotSurface = document.querySelector(".mascotDock");
      const currentTarget = highlight?.element;
      const rawTarget = event.target;
      const clickedNode = rawTarget instanceof Element ? rawTarget : rawTarget?.parentElement;

      if (!(clickedNode instanceof Element)) {
        event.preventDefault();
        event.stopPropagation();
        handleTourOverlayClick();
        return;
      }
      if (mascotSurface?.contains(clickedNode)) return;
      if (currentTarget?.contains(clickedNode)) return;

      event.preventDefault();
      event.stopPropagation();
      handleTourOverlayClick();
    };

    document.addEventListener("pointerdown", handleBlockedInteraction, true);
    document.addEventListener("click", handleBlockedInteraction, true);

    return () => {
      document.removeEventListener("pointerdown", handleBlockedInteraction, true);
      document.removeEventListener("click", handleBlockedInteraction, true);
    };
  }, [highlight?.element, isTourActive, mood]);

  useEffect(() => {
    if (!active) return undefined;
    if (isTourActive) return undefined;

    setIsVisible(true);
    setMenuOpen(false);
    clearTourState();
    cooldownsRef.current = {};
    if (tipsDisabled) {
      setShowBubble(false);
      setHighlight(null);
      setPose("idle");
      setMood("calm");
      return undefined;
    }
    const intro = getRouteIntro(location.pathname, Boolean(user));

    clearTimers();
    setMessage(intro.text);
    setShowBubble(true);
    setPose(intro.pose);
    setMood(intro.mood);
    if (intro.target) {
      setHighlightTarget(intro.target, intro.label || "Click here");
      clearHighlightLater(2800);
    } else {
      setHighlight(null);
    }
    rememberTimer(() => setPose("idle"), 1500);
    rememberTimer(() => setMood("calm"), 1800);
    closeBubbleLater(2800);

    return () => clearTimers();
  }, [active, isTourActive, location.pathname, user, tipsDisabled]);

  useEffect(() => {
    return undefined;
  }, [active, currentPageTourSteps, isTourActive, tipsDisabled]);

  useEffect(() => {
    if (!active || !isVisible || typeof window === "undefined" || isTourActive || tipsDisabled) return undefined;

    const cleanupFns = [];

    if (location.pathname === "/book") {
      const firstNameField = document.querySelector('input[placeholder="First name"]');
      if (firstNameField) {
        const onBlur = () => {
          if (String(firstNameField.value || "").trim()) return;
          showAssistantMessage("Don't forget your name so the clinic can save your profile.", {
            nextPose: "point-book",
            nextMood: "calm",
            bubbleDuration: 2200,
            resetDelay: 1600,
            key: "booking-name-empty",
            target: "book",
            label: "Fill this in",
          });
        };
        firstNameField.addEventListener("blur", onBlur);
        cleanupFns.push(() => firstNameField.removeEventListener("blur", onBlur));
      }

      const dentistSelect = document.querySelector("select.bookingInputSpecial");
      if (dentistSelect) {
        const onFocus = () => {
          showAssistantMessage("Choose your dentist here before picking a time slot.", {
            nextPose: "point-book",
            nextMood: "happy",
            bubbleDuration: 1800,
            resetDelay: 1200,
            key: "booking-dentist-focus",
            target: "book",
            label: "Choose here",
          });
        };
        dentistSelect.addEventListener("focus", onFocus);
        cleanupFns.push(() => dentistSelect.removeEventListener("focus", onFocus));
      }

      const bookingPageObserver = new MutationObserver(() => {
        const errorNode = document.querySelector(".error");
        const successNode = document.querySelector(".successBanner");
        const successModal = document.querySelector(".bookingSuccessModal");
        const errorText = errorNode?.textContent?.trim() || "";

        if (successModal || successNode?.textContent?.includes("Booking submitted")) {
          showAssistantMessage("Nice work. Your booking request is on its way to the clinic.", {
            nextPose: "celebrate",
            nextMood: "happy",
            bubbleDuration: 2800,
            resetDelay: 2100,
            key: "booking-success",
            target: "book",
            label: "Submitted here",
          });
          return;
        }

        if (!errorText) return;

        if (errorText.includes("Please sign in first") || errorText.includes("Please sign in with Google")) {
          showAssistantMessage("Please sign in first so your booking stays under one account.", {
            nextPose: "point-book",
            nextMood: "sad",
            bubbleDuration: 2400,
            resetDelay: 1800,
            key: "booking-signin-error",
            target: "book",
            label: "Sign in first",
          });
          return;
        }

        if (errorText.includes("Sundays")) {
          showAssistantMessage("We're closed on Sundays. Please choose Monday to Saturday.", {
            nextPose: "point-book",
            nextMood: "sad",
            bubbleDuration: 2400,
            resetDelay: 1800,
            key: "booking-sunday-error",
            target: "book-date",
            label: "Choose another day",
          });
          return;
        }

        if (errorText.includes("Please choose a date") || errorText.includes("before today") || errorText.includes("blocks booking on")) {
          showAssistantMessage("This date needs to change before the booking can continue.", {
            nextPose: "point-book",
            nextMood: "sad",
            bubbleDuration: 2400,
            resetDelay: 1800,
            key: "booking-date-error",
            target: "book-date",
            label: "Pick another day",
          });
          return;
        }

        if (errorText.includes("No dentist is available") || errorText.includes("inactive on the selected day")) {
          showAssistantMessage("Choose another dentist or date here.", {
            nextPose: "point-book",
            nextMood: "sad",
            bubbleDuration: 2300,
            resetDelay: 1700,
            key: "booking-dentist-error",
            target: "book-dentist",
            label: "Choose dentist",
          });
          return;
        }

        if (errorText.includes("Please choose a time") || errorText.includes("between 9:00 AM and 6:00 PM") || errorText.includes("time already passed") || errorText.includes("outside the dentist's schedule")) {
          showAssistantMessage("This time slot needs to be adjusted.", {
            nextPose: "point-book",
            nextMood: "sad",
            bubbleDuration: 2300,
            resetDelay: 1700,
            key: "booking-time-error",
            target: "book-time",
            label: "Choose another time",
          });
          return;
        }

        if (errorText.includes("Please complete your patient profile")) {
          showAssistantMessage("Finish your profile first, then the booking form will work smoothly.", {
            nextPose: "point-book",
            nextMood: "calm",
            bubbleDuration: 2300,
            resetDelay: 1700,
            key: "booking-profile-error",
            target: "book",
            label: "Complete this first",
          });
          return;
        }

        if (errorText.includes("Please confirm the confidentiality")) {
          showAssistantMessage("Don't forget the consent checkbox before submitting.", {
            nextPose: "point-book",
            nextMood: "calm",
            bubbleDuration: 2200,
            resetDelay: 1600,
            key: "booking-consent-error",
            target: "book-consent",
            label: "Check this first",
          });
          return;
        }

        if (errorText.includes("Please enter the first name") || errorText.includes("Please enter the last name")) {
          showAssistantMessage("Your name is still missing here.", {
            nextPose: "point-book",
            nextMood: "sad",
            bubbleDuration: 2200,
            resetDelay: 1600,
            key: "booking-name-error",
            target: "book-name",
            label: "Enter your name",
          });
        }
      });

      bookingPageObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
      cleanupFns.push(() => bookingPageObserver.disconnect());
    }

    if (location.pathname === "/my-appointments") {
      const requestPageObserver = new MutationObserver(() => {
        const errorNode = document.querySelector(".error");
        const errorText = errorNode?.textContent?.trim() || "";
        if (!errorText) return;

        if (errorText.includes("reason for the cancellation request") || errorText.includes("reason for the reschedule request")) {
          showAssistantMessage("Hey, I need a real reason here before the clinic can review this request.", {
            nextPose: "point-book",
            nextMood: "angry",
            bubbleDuration: 2600,
            resetDelay: 1800,
            key: "appointment-request-reason-error",
            target: "appointment-request-reason",
            label: "Reason required",
          });
          return;
        }

        if (errorText.includes("Please choose a new date")) {
          showAssistantMessage("Pick the new date first before sending the reschedule request.", {
            nextPose: "point-book",
            nextMood: "sad",
            bubbleDuration: 2400,
            resetDelay: 1700,
            key: "appointment-request-date-error",
            target: "appointment-request-date",
            label: "Choose a date",
          });
          return;
        }

        if (errorText.includes("Sunday reschedule requests")) {
          showAssistantMessage("No Sundays here. Choose a Monday to Saturday slot instead.", {
            nextPose: "point-book",
            nextMood: "angry",
            bubbleDuration: 2500,
            resetDelay: 1800,
            key: "appointment-request-sunday-error",
            target: "appointment-request-date",
            label: "Pick another day",
          });
        }
      });

      requestPageObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
      cleanupFns.push(() => requestPageObserver.disconnect());
    }

    return () => {
      cleanupFns.forEach((cleanup) => cleanup());
    };
  }, [active, isVisible, location.pathname, isTourActive, tipsDisabled]);

  if (!active) return null;

  const bubbleShouldDropBelow = Boolean(tourPosition && tourPosition.top < 176);
  const hasTallMenu = menuOpen && (crownTaken || wandTaken);
  const tourProgress = tourSteps.length && currentStepIndex >= 0
    ? ((currentStepIndex + 1) / tourSteps.length) * 100
    : 0;

  return (
    <div className={`mascotLayer theme-${theme}`}>
      {isDemonMode && !isWebsiteCursed && !isTourActive ? (
        <div className="mascotChaosOverlay" onClick={handleChaosBlockedInteraction}>
          <div className="mascotChaosScratches" aria-hidden="true" />
        </div>
      ) : null}

      {isWebsiteCursed && !isTourActive ? (
        <div className="mascotDemonicScene" aria-hidden="true">
          <div className="mascotBloodRain">
            {Array.from({ length: 10 }).map((_, index) => (
              <span key={index} className={`mascotBloodDrop drop-${index + 1}`} />
            ))}
          </div>
          <div className="mascotDemonicVignette" />
        </div>
      ) : null}

      {isTourActive ? (
        <div className="mascotTourOverlay" onClick={handleTourOverlayClick} />
      ) : null}

      {highlight ? (
        <>
          {!isTourActive ? <div className="mascotTargetDim" /> : null}
          <div
            className="mascotTargetRing"
            style={{
              top: `${highlight.top - window.scrollY - 8}px`,
              left: `${highlight.left - window.scrollX - 8}px`,
              width: `${highlight.width + 16}px`,
              height: `${highlight.height + 16}px`,
            }}
          />
          <div
            className={`mascotTargetLabel ${highlight.placeBelow ? "below-target" : ""}`}
            style={{
              top: highlight.placeBelow
                ? `${highlight.top - window.scrollY + highlight.height + 12}px`
                : `${highlight.top - window.scrollY - 36}px`,
              left: `${highlight.left - window.scrollX}px`,
            }}
          >
            {highlight.label}
          </div>
        </>
      ) : null}

      <div
        ref={dockRef}
        className={`mascotDock ${isVisible ? "is-open" : "is-closed"} ${isTourActive ? "is-touring" : ""} ${isWebsiteCursed ? "is-cursed" : ""} mood-${mood} pose-${pose} theme-${theme}`}
        style={tourPosition ? { left: `${tourPosition.left}px`, top: `${tourPosition.top}px`, right: "auto", bottom: "auto" } : undefined}
      >
        <div className={`mascotBubble ${showBubble && isVisible ? "is-visible" : ""} ${menuOpen ? "with-menu" : ""} ${hasTallMenu ? "with-tall-menu" : ""} ${isTourActive ? "tour-open" : ""} ${bubbleShouldDropBelow ? "bubble-below" : ""}`}>
          {message}
        </div>

        {menuOpen ? (
          <div className="mascotMenu" role="menu" aria-label="Mascot helper menu">
            {isWebsiteCursed ? (
              <>
                <div className="mascotCurseHintCard">
                  <strong>Break the curse</strong>
                  <span>Find the wand on Book and the crown on Contact.</span>
                  <small>{`${curseRecovery.wand ? "Wand found" : "Wand missing"} • ${curseRecovery.crown ? "Crown found" : "Crown missing"}`}</small>
                </div>
              </>
            ) : isDemonMode ? (
              <>
                {crownTaken ? (
                  <button type="button" className="mascotMenuBtn primary" onClick={() => restoreProp("crown")}>
                    Return Crown
                  </button>
                ) : null}
                {wandTaken ? (
                  <button type="button" className="mascotMenuBtn" onClick={() => restoreProp("wand")}>
                    Return Wand
                  </button>
                ) : null}
                <button type="button" className="mascotMenuBtn subtle" onClick={embraceTheCurse}>
                  Keep The Curse
                </button>
              </>
            ) : (
              <>
                {currentPageTourSteps.length ? (
                  <button type="button" className="mascotMenuBtn primary" onClick={() => startTour("current")}>
                    Start Tour
                  </button>
                ) : null}
                <button type="button" className="mascotMenuBtn" onClick={() => startTour("full")}>
                  Full Website Tour
                </button>
                {crownTaken ? (
                  <button type="button" className="mascotMenuBtn" onClick={() => restoreProp("crown")}>
                    Return Crown
                  </button>
                ) : null}
                {wandTaken ? (
                  <button type="button" className="mascotMenuBtn" onClick={() => restoreProp("wand")}>
                    Return Wand
                  </button>
                ) : null}
                <button type="button" className="mascotMenuBtn subtle" onClick={toggleTipsDisabled}>
                  {tipsDisabled ? "Turn Tips On" : "Don't Show Again"}
                </button>
              </>
            )}
          </div>
        ) : null}

        {isTourActive ? (
          <div className="mascotTourRail">
            <div className="mascotTourStepLabel">
              {tourType === "full" ? "Full Website Tour" : tourType === "current" ? "Current Page Tour" : `${String(tourType || "").charAt(0).toUpperCase()}${String(tourType || "").slice(1)} Tour`}
            </div>
            <div className="mascotTourProgress" aria-hidden="true">
              <span style={{ width: `${tourProgress}%` }} />
            </div>
            <div className="mascotTourStepCount">
              Step {Math.max(currentStepIndex + 1, 1)} of {tourSteps.length || 1}
            </div>
            <div className="mascotTourControls" aria-label="Guided tour controls">
              <button type="button" className="mascotTourBtn" onClick={() => moveTour(-1)} disabled={currentStepIndex <= 0}>
                Back
              </button>
              <button
                type="button"
                className="mascotTourBtn"
                onClick={() => moveTour(1)}
                disabled={Boolean(currentTourStep?.transitionTo)}
              >
                {currentStepIndex >= tourSteps.length - 1 ? "Finish" : "Next"}
              </button>
              <button type="button" className="mascotTourBtn subtle" onClick={skipTour}>
                Stop Tour
              </button>
            </div>
          </div>
        ) : null}

        <div
          className="mascotToggle"
          role="button"
          tabIndex={0}
          aria-label={menuOpen ? "Close mascot helper menu" : "Open mascot helper menu"}
          onClick={() => {
            if (isWebsiteCursed) {
              setMenuOpen(true);
              setShowBubble(true);
              setPose("jump");
              setMood("angry");
              setMessage("The curse is active. Book hides the wand. Contact hides the crown.");
              rememberTimer(() => setPose("idle"), 1000);
              return;
            }

            clearTimers();
            if (isDemonMode) {
              setMenuOpen(true);
              setShowBubble(true);
              setPose("jump");
              setMood("angry");
              setMessage("Return the crown and wand first. Then we can talk.");
              rememberTimer(() => setPose("idle"), 1000);
              return;
            }

            if (menuOpen) {
              setMenuOpen(false);
              setShowBubble(false);
              setPose("idle");
              setMood("calm");
              return;
            }

            if (isTourActive) {
              skipTour();
              return;
            }

            setMenuOpen(true);
            setPose("wave");
            setMood("happy");
            setMessage(tipsDisabled ? "Tips are currently off. You can turn them back on or start a manual tour here." : "Need help with booking, services, or contact details?");
            setShowBubble(true);
            rememberTimer(() => setPose("idle"), 1400);
            rememberTimer(() => setMood("calm"), 1700);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.currentTarget.click();
          }}
        >
          <div className={`toothFairyAssistant ${menuOpen ? "menu-open" : ""} ${isScary ? "scary" : ""} ${(isDemonMode || isWebsiteCursed) ? "demon-mode" : ""} ${crownTaken ? "missing-crown" : ""} ${wandTaken ? "missing-wand" : ""}`}>
            <div className="assistantShadow" />
            <div className="assistantWings">
              <span className="assistantWing left" />
              <span className="assistantWing right" />
            </div>
            <div className="assistantGlow" />
            <div className="assistantBody">
              <div className="assistantHorns" aria-hidden="true">
                <span className="assistantHorn left" />
                <span className="assistantHorn right" />
              </div>
              {!crownTaken ? (
                <button
                  type="button"
                  className="assistantPropButton assistantPropButton-crown"
                  aria-label="Take mascot crown"
                  disabled={isTourActive}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    reactToPropTheft("crown");
                  }}
                >
                  <div className="assistantCrown">
                    <span />
                    <span />
                    <span />
                  </div>
                </button>
              ) : null}
              <div className="assistantFace">
                <div className="assistantEyes">
                  <span className="assistantEye" />
                  <span className="assistantEye" />
                </div>
                <div className="assistantMouth" />
              </div>
              <div className="assistantCheeks">
                <span className="assistantCheek" />
                <span className="assistantCheek" />
              </div>
            </div>
            <div className="assistantArms">
              <span className="assistantArm left">
                {!wandTaken ? (
                  <button
                    type="button"
                    className="assistantPropButton assistantPropButton-wand"
                    aria-label="Take mascot magic wand"
                    disabled={isTourActive}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      reactToPropTheft("wand");
                    }}
                  >
                    <span className="assistantWand">
                      <span className="assistantWandStick" />
                      <span className="assistantWandStar" />
                    </span>
                  </button>
                ) : null}
              </span>
              <span className="assistantArm right" />
            </div>
            <div className="assistantSparkles">
              <span />
              <span />
              <span />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
