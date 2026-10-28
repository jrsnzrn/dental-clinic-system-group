import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "./firebase";
import NavBar from "./components/NavBar";
import Footer from "./components/Footer";
import Mascot from "./components/Mascot";
import ProtectedRoute from "./routes/ProtectedRoute";

import Home from "./pages/Home";
import Services from "./pages/Services";
import Contact from "./pages/Contact";
import Book from "./pages/Book";
import MyAppointments from "./pages/MyAppointments";
import MyDentalRecord from "./pages/MyDentalRecord";
import About from "./pages/About";

import Login from "./pages/admin/Login";
import EmailVerification from "./pages/admin/EmailVerification";
import Mfa from "./pages/admin/Mfa";
import Dashboard from "./pages/admin/Dashboard";
import Patients from "./pages/admin/Patients";
import Bookings from "./pages/admin/Bookings";
import Braces from "./pages/admin/Braces";
import Payments from "./pages/admin/Payments";
import Dentists from "./pages/admin/Dentists";
import ServicesAdmin from "./pages/admin/ServicesAdmin";
import Accounts from "./pages/admin/Accounts";
import Logs from "./pages/admin/Logs";
import Archive from "./pages/admin/Archive";
import Promotions from "./pages/admin/Promotions";
import Analytics from "./pages/admin/Analytics";
import ForgotPassword from "./pages/admin/ForgotPassword";
import { getAdminProfile, getDefaultAdminPath, ROLES } from "./utils/rbac";

const THEMES = ["light", "blue", "dark"];
const FIRST_VISIT_KEY = "topdent-has-visited";
const PUBLIC_ANIMATION_PATHS = new Set(["/", "/about", "/services", "/contact", "/book"]);

function getInitialTheme() {
  if (typeof window === "undefined") return "light";
  const savedTheme = window.localStorage.getItem("topdent-theme");
  return THEMES.includes(savedTheme) ? savedTheme : "light";
}

function FirstVisitHomeGate({ isAdmin, children }) {
  const location = useLocation();

  useEffect(() => {
    const currentPath = location.pathname.replace(/\/+$/, "") || "/";
    const isPublicRoute = !isAdmin && PUBLIC_ANIMATION_PATHS.has(currentPath);
    const appMain = document.querySelector(".appMain");
    if (!appMain) return undefined;

    if (!isPublicRoute) {
      appMain.classList.remove("publicAnimationScope");
      appMain.classList.remove("publicPageEnter");
      return undefined;
    }

    appMain.classList.add("publicAnimationScope");
    appMain.classList.remove("publicPageEnter");
    void appMain.offsetWidth;
    appMain.classList.add("publicPageEnter");

    const revealSelectors = [
      ".feedbackCard",
      ".whyUsCard",
      ".serviceCardIcon",
      ".doctorCard",
      ".aboutPage .revealOnScroll",
      ".aboutPage .aboutSection > .title",
      ".aboutPage .aboutSplitIntro .title",
      ".aboutPage .aboutHeroText > *",
      ".aboutPage .aboutPhotos img",
      ".aboutPage .aboutTeamCard img",
      ".aboutPage .aboutTeamCard",
      ".aboutPage .aboutSplitIntro > *",
      ".aboutPage .aboutPolicyItem",
      ".svxHeader",
      ".svxHeader > *",
      ".svxCard",
      ".svxCard img",
      ".contactMapCard",
      ".contactInfo .iconRow",
      ".bookingPage .hero.bookingHero",
      ".bookingPage .googleGate",
      ".bookingPage .bookingSummaryCard",
      ".bookingPage .bookingFormCard",
      ".bookingPage .editorPreview",
      ".bookingPage .bookingServiceSelector",
      ".bookingPage .bookingDatePanel",
    ];

    if (currentPath === "/") {
      revealSelectors.push(
        ".homePage .homeLandingCopy > :not(.homeLandingActions)",
        ".homePage .homeLandingActions > *",
        ".homePage .homeLandingVisual img",
        ".homePage .homeOffersGrid > .homeOfferCard",
        ".homePage .homeWhyUsVisual img",
        ".homePage .homeWhyUsContent > h2",
        ".homePage .homeWhyUsContent > p",
        ".homePage .homeGalleryIntro > *",
        ".homePage .homeGalleryCard",
        ".homePage .smileIntro > *",
        ".homePage .smileCard",
        ".homePage .homeServicesIntro > *",
        ".homePage .serviceCard",
        ".homePage .homeDoctorsIntro > *",
        ".homePage .doctorCard",
        ".homePage .homeFeedbackIntro > *",
        ".homePage .feedbackCard",
        ".homePage .homePromo .homePromoInner > *",
        ".homePage img"
      );
    }

    const revealSelector = revealSelectors.join(", ");
    const revealTargets = appMain.querySelectorAll(revealSelector);

    const showAllReveals = () => {
      revealTargets.forEach((target) => {
        target.classList.add("publicScrollReveal", "visible");
      });
    };

    if (typeof window.IntersectionObserver !== "function") {
      showAllReveals();
      return undefined;
    }

    let observer;
    let mutationObserver;
    const observedTargets = new Set();
    try {
      observer = new window.IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("visible");
              observer.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.12 }
      );

      const observeTargets = (root) => {
        if (!root || root.nodeType !== 1) return;

        const targets = [];
        if (root.matches(revealSelector)) targets.push(root);
        targets.push(...root.querySelectorAll(revealSelector));

        targets.forEach((target) => {
          if (observedTargets.has(target)) return;
          observer.observe(target);
          target.classList.add("publicScrollReveal");
          observedTargets.add(target);
        });
      };

      observeTargets(appMain);

      if (typeof window.MutationObserver === "function") {
        mutationObserver = new window.MutationObserver((records) => {
          records.forEach((record) => {
            record.addedNodes.forEach((node) => {
              try {
                observeTargets(node);
              } catch (error) {
                console.warn("A public scroll reveal target could not be observed; leaving it visible.", error);
              }
            });
          });
        });
        mutationObserver.observe(appMain, { childList: true, subtree: true });
      }
    } catch (error) {
      observer?.disconnect();
      mutationObserver?.disconnect();
      console.warn("Public scroll reveals unavailable; showing content without observation.", error);
      showAllReveals();
      return undefined;
    }

    return () => {
      observer.disconnect();
      mutationObserver?.disconnect();
    };
  }, [isAdmin, location.pathname]);

  if (typeof window === "undefined") return children;

  const hasVisited = window.localStorage.getItem(FIRST_VISIT_KEY) === "true";
  const isAdminPath = location.pathname.startsWith("/admin");

  if (!hasVisited) {
    window.localStorage.setItem(FIRST_VISIT_KEY, "true");

    if (!isAdmin && !isAdminPath && location.pathname !== "/") {
      return <Navigate to="/" replace />;
    }
  }

  return children;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingAdmin, setCheckingAdmin] = useState(true);
  const [adminRole, setAdminRole] = useState("");
  const [theme, setTheme] = useState(getInitialTheme);
  const [dentistSearch, setDentistSearch] = useState("");
  const [dentistPatientTypeFilter, setDentistPatientTypeFilter] = useState("All");
  const [archiveSearch, setArchiveSearch] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setUser(null);
        setLoadingAuth(false);
        setIsAdmin(false);
        setAdminRole("");
        setCheckingAdmin(false);
        return;
      }

      setUser(u);
      setCheckingAdmin(true);
      try {
        await u.reload();
        const freshUser = auth.currentUser || u;
        setUser(freshUser);
        const snap = await getDoc(doc(db, "admins", freshUser.uid));
        if (snap.exists()) {
          const profile = getAdminProfile(snap.data());
          if (profile.disabled) {
            setIsAdmin(false);
            setAdminRole("");
          } else {
            setIsAdmin(true);
            setAdminRole(profile.role);
          }
        } else {
          setIsAdmin(false);
          setAdminRole("");
        }
      } catch (error) {
        console.error("App admin check failed:", error);
        setIsAdmin(false);
        setAdminRole("");
      } finally {
        setLoadingAuth(false);
        setCheckingAdmin(false);
      }
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    window.localStorage.setItem("topdent-theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.dashboard = isAdmin ? "true" : "false";
  }, [isAdmin]);

  if (loadingAuth || checkingAdmin) {
    return <div style={{ padding: 20 }}>Loading...</div>;
  }

  const adminRedirect = <Navigate to={getDefaultAdminPath(adminRole)} replace />;

  return (
    <BrowserRouter>
      <FirstVisitHomeGate isAdmin={isAdmin}>
        <NavBar
          isAdmin={isAdmin}
          user={user}
          adminRole={adminRole}
          theme={theme}
          onThemeChange={setTheme}
          dentistSearch={dentistSearch}
          onDentistSearchChange={setDentistSearch}
          dentistPatientTypeFilter={dentistPatientTypeFilter}
          onDentistPatientTypeFilterChange={setDentistPatientTypeFilter}
          archiveSearch={archiveSearch}
          onArchiveSearchChange={setArchiveSearch}
        />

        <div className={`appMain ${isAdmin ? "adminAppMain" : ""}`}>
          <Routes>
            <Route path="/" element={isAdmin ? adminRedirect : <Home />} />
            <Route path="/services" element={isAdmin ? adminRedirect : <Services />} />
            <Route path="/contact" element={isAdmin ? adminRedirect : <Contact />} />
            <Route path="/about" element={isAdmin ? adminRedirect : <About />} />
            <Route path="/book" element={isAdmin ? adminRedirect : <Book />} />
            <Route path="/my-appointments" element={isAdmin ? adminRedirect : <MyAppointments />} />
            <Route path="/my-record" element={isAdmin ? adminRedirect : <MyDentalRecord />} />
            <Route path="/terms" element={<Navigate to="/about" replace />} />
            <Route path="/privacy-policy" element={<Navigate to="/about" replace />} />

            <Route path="/admin/login" element={isAdmin ? adminRedirect : <Login />} />
            <Route path="/admin/forgot-password" element={<ForgotPassword />} />
            <Route path="/admin/verify-email" element={<EmailVerification />} />
            <Route path="/admin/mfa" element={<Mfa />} />

            <Route
              path="/admin"
              element={
                <ProtectedRoute
                  user={user}
                  allowedRoles={[ROLES.ADMIN, ROLES.RECEPTIONIST, ROLES.DENTIST]}
                >
                  <Dashboard adminRole={adminRole} />
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to={getDefaultAdminPath(adminRole).replace("/admin/", "")} replace />} />
              <Route
                path="patients/:patientId?"
                element={
                  <ProtectedRoute
                    user={user}
                    allowedRoles={[ROLES.ADMIN, ROLES.RECEPTIONIST, ROLES.DENTIST]}
                  >
                    <Patients
                      dentistSearch={dentistSearch}
                      dentistPatientTypeFilter={dentistPatientTypeFilter}
                    />
                  </ProtectedRoute>
                }
              />
              <Route
                path="completed"
                element={
                  <ProtectedRoute
                    user={user}
                    allowedRoles={[ROLES.DENTIST]}
                  >
                    <Patients
                      completedOnly
                      dentistSearch={dentistSearch}
                    />
                  </ProtectedRoute>
                }
              />
              <Route path="bookings">
                <Route index element={<Navigate to="calendar" replace />} />
                <Route path="completed" element={<Navigate to="/admin/bookings/calendar" replace />} />
                <Route
                  path=":status"
                  element={
                    <ProtectedRoute
                      user={user}
                      allowedRoles={[ROLES.ADMIN, ROLES.RECEPTIONIST]}
                    >
                      <Bookings />
                    </ProtectedRoute>
                  }
                />
              </Route>
              <Route
                path="braces"
                element={
                  <ProtectedRoute
                    user={user}
                    allowedRoles={[ROLES.ADMIN, ROLES.RECEPTIONIST]}
                  >
                    <Braces />
                  </ProtectedRoute>
                }
              />
              <Route
                path="payments"
                element={
                  <ProtectedRoute
                    user={user}
                    allowedRoles={[ROLES.ADMIN, ROLES.RECEPTIONIST]}
                  >
                    <Payments />
                  </ProtectedRoute>
                }
              />
              <Route
                path="dentists"
                element={
                  <ProtectedRoute
                    user={user}
                    allowedRoles={[ROLES.ADMIN]}
                  >
                    <Dentists />
                  </ProtectedRoute>
                }
              />
              <Route
                path="services"
                element={
                  <ProtectedRoute
                    user={user}
                    allowedRoles={[ROLES.ADMIN]}
                  >
                    <ServicesAdmin />
                  </ProtectedRoute>
                }
              />
              <Route
                path="accounts"
                element={
                  <ProtectedRoute
                    user={user}
                    allowedRoles={[ROLES.ADMIN]}
                  >
                    <Accounts />
                  </ProtectedRoute>
                }
              />
              <Route path="promos" element={<ProtectedRoute user={user} allowedRoles={[ROLES.ADMIN]}><Promotions /></ProtectedRoute>} />
              <Route path="analytics" element={<ProtectedRoute user={user} allowedRoles={[ROLES.ADMIN]}><Analytics /></ProtectedRoute>} />
              <Route
                path="logs"
                element={
                  <ProtectedRoute
                    user={user}
                    allowedRoles={[ROLES.ADMIN]}
                  >
                    <Logs />
                  </ProtectedRoute>
                }
              />
              <Route path="archive">
                <Route index element={<Navigate to={adminRole === ROLES.ADMIN ? "all" : "bookings"} replace />} />
                <Route
                  path=":section"
                  element={
                    <ProtectedRoute
                      user={user}
                      allowedRoles={[ROLES.ADMIN, ROLES.RECEPTIONIST]}
                    >
                      <Archive
                        adminRole={adminRole}
                        search={archiveSearch}
                      />
                    </ProtectedRoute>
                  }
                />
              </Route>
            </Route>

            <Route path="*" element={isAdmin ? adminRedirect : <Navigate to="/" replace />} />
          </Routes>
        </div>

        <Footer isAdmin={isAdmin} theme={theme} onThemeChange={setTheme} />
        <Mascot />
      </FirstVisitHomeGate>
    </BrowserRouter>
  );
}
