import { Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { canAccessRoute, getAdminProfile, getDefaultAdminPath } from "../utils/rbac";

export default function ProtectedRoute({ user, children, allowedRoles = [] }) {
  const [loading, setLoading] = useState(true);
  const [adminProfile, setAdminProfile] = useState(null);

  useEffect(() => {
    let alive = true;

    async function checkAdmin() {
      if (!user) {
        if (alive) {
          setAdminProfile(null);
          setLoading(false);
        }
        return;
      }

      try {
        const ref = doc(db, "admins", user.uid);
        const snap = await getDoc(ref);

        if (alive) {
          setAdminProfile(snap.exists() ? getAdminProfile(snap.data()) : null);
          setLoading(false);
        }
      } catch (err) {
        console.error("Admin access check failed:", err);
        if (alive) {
          setAdminProfile(null);
          setLoading(false);
        }
      }
    }

    checkAdmin();
    return () => {
      alive = false;
    };
  }, [allowedRoles, user]);

  if (!user) return <Navigate to="/admin/login" replace />;
  if (loading) return null;
  if (!adminProfile) return <Navigate to="/" replace />;
  if (adminProfile.disabled) return <Navigate to="/admin/login" replace />;
  if (!canAccessRoute(adminProfile.role, allowedRoles)) {
    return <Navigate to={getDefaultAdminPath(adminProfile.role)} replace />;
  }

  return children;
}
