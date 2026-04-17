import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "./firebase";
import NavBar from "./components/NavBar";
import Footer from "./components/Footer";
import ProtectedRoute from "./routes/ProtectedRoute";

import Home from "./pages/Home";
import Services from "./pages/Services";
import Contact from "./pages/Contact";
import Book from "./pages/Book";
import MyAppointments from "./pages/MyAppointments";
import MyDentalRecord from "./pages/MyDentalRecord";
import About from "./pages/About";

import Login from "./pages/admin/Login";
import Dashboard from "./pages/admin/Dashboard";
import Patients from "./pages/admin/Patients";
import Bookings from "./pages/admin/Bookings";
import Dentists from "./pages/admin/Dentists";
import ServicesAdmin from "./pages/admin/ServicesAdmin";
import Accounts from "./pages/admin/Accounts";
import Logs from "./pages/admin/Logs";
import Archive from "./pages/admin/Archive";
import { getAdminProfile, getDefaultAdminPath, ROLES } from "./utils/rbac";

const THEMES = ["light", "blue", "dark"];
const FIRST_VISIT_KEY = "topdent-has-visited";

function getInitialTheme() {
  if (typeof window === "undefined") return "light";
  const savedTheme = window.localStorage.getItem("topdent-theme");
  return THEMES.includes(savedTheme) ? savedTheme : "light";
}

function FirstVisitHomeGate({ isAdmin, children }) {
  const location = useLocation();

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

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setLoadingAuth(false);

      if (!u) {
        setIsAdmin(false);
        setAdminRole("");
        setCheckingAdmin(false);
        return;
      }

      setCheckingAdmin(true);
      try {
        const snap = await getDoc(doc(db, "admins", u.uid));
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
        setCheckingAdmin(false);
      }
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    window.localStorage.setItem("topdent-theme", theme);
  }, [theme]);

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
        />

        <div className="appMain">
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
                path="patients"
                element={
                  <ProtectedRoute
                    user={user}
                    allowedRoles={[ROLES.ADMIN, ROLES.RECEPTIONIST, ROLES.DENTIST]}
                  >
                    <Patients />
                  </ProtectedRoute>
                }
              />
              <Route path="bookings">
                <Route index element={<Navigate to="pending" replace />} />
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
                <Route index element={<Navigate to="patients" replace />} />
                <Route
                  path=":section"
                  element={
                    <ProtectedRoute
                      user={user}
                      allowedRoles={[ROLES.ADMIN, ROLES.RECEPTIONIST]}
                    >
                      <Archive />
                    </ProtectedRoute>
                  }
                />
              </Route>
            </Route>

            <Route path="*" element={isAdmin ? adminRedirect : <Navigate to="/" replace />} />
          </Routes>
        </div>

        <Footer isAdmin={isAdmin} theme={theme} onThemeChange={setTheme} />
      </FirstVisitHomeGate>
    </BrowserRouter>
  );
}
