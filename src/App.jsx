import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "./firebase";

import NavBar from "./components/NavBar";
import ProtectedRoute from "./routes/ProtectedRoute";

import Home from "./pages/Home";
import Services from "./pages/Services";
import Contact from "./pages/Contact";
import Book from "./pages/Book";
import MyDentalRecord from "./pages/MyDentalRecord";

import Login from "./pages/admin/Login";
import Dashboard from "./pages/admin/Dashboard";
import Patients from "./pages/admin/Patients";
import Bookings from "./pages/admin/Bookings";
import Dentists from "./pages/admin/Dentists";
import Archive from "./pages/admin/Archive";

export default function App() {
  const [user, setUser] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingAdmin, setCheckingAdmin] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setLoadingAuth(false);

      if (!u) {
        setIsAdmin(false);
        setCheckingAdmin(false);
        return;
      }

      setCheckingAdmin(true);
      try {
        const snap = await getDoc(doc(db, "admins", u.uid));
        setIsAdmin(snap.exists());
      } catch (error) {
        console.error("App admin check failed:", error);
        setIsAdmin(false);
      } finally {
        setCheckingAdmin(false);
      }
    });

    return () => unsub();
  }, []);

  if (loadingAuth || checkingAdmin) {
    return <div style={{ padding: 20 }}>Loading...</div>;
  }

  const adminRedirect = <Navigate to="/admin/patients" replace />;

  return (
    <BrowserRouter>
      <NavBar isAdmin={isAdmin} user={user} />

      <div className="appMain">
        <Routes>
          <Route path="/" element={isAdmin ? adminRedirect : <Home />} />
          <Route path="/services" element={isAdmin ? adminRedirect : <Services />} />
          <Route path="/contact" element={isAdmin ? adminRedirect : <Contact />} />
          <Route path="/book" element={isAdmin ? adminRedirect : <Book />} />
          <Route path="/my-record" element={isAdmin ? adminRedirect : <MyDentalRecord />} />

          <Route path="/admin/login" element={isAdmin ? adminRedirect : <Login />} />

          <Route
            path="/admin"
            element={
              <ProtectedRoute user={user}>
                <Dashboard />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="patients" replace />} />
            <Route path="patients" element={<Patients />} />
            <Route path="bookings">
              <Route index element={<Navigate to="pending" replace />} />
              <Route path=":status" element={<Bookings />} />
            </Route>
            <Route path="dentists" element={<Dentists />} />
            <Route path="archive">
              <Route index element={<Navigate to="patients" replace />} />
              <Route path=":section" element={<Archive />} />
            </Route>
          </Route>

          <Route path="*" element={isAdmin ? adminRedirect : <Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
