import { useEffect, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../firebase";
import { ROLE_LABELS, ROLES } from "../../utils/rbac";

const CREATE_STAFF = httpsCallable(functions, "createStaffAccount");
const GET_STAFF_ACCOUNTS = httpsCallable(functions, "getStaffAccounts");
const SET_STAFF_DISABLED = httpsCallable(functions, "setStaffAccountDisabled");
const ARCHIVE_STAFF_ACCOUNT = httpsCallable(functions, "archiveStaffAccount");
const SET_STAFF_MFA_REQUIRED = httpsCallable(functions, "setStaffMfaRequired");

function emptyDraft() {
  return {
    name: "",
    email: "",
    password: "",
    role: ROLES.RECEPTIONIST,
  };
}

export default function Accounts() {
  const [draft, setDraft] = useState(emptyDraft());
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [listError, setListError] = useState("");
  const [success, setSuccess] = useState("");
  const [created, setCreated] = useState(null);
  const [adminAccounts, setAdminAccounts] = useState([]);
  const [staffAccounts, setStaffAccounts] = useState([]);
  const [loadingStaff, setLoadingStaff] = useState(true);
  const [updatingAccountId, setUpdatingAccountId] = useState("");

  function normalizeStaffAccount(entry) {
    return {
      ...entry,
      createdAt: entry.createdAt?.toDate ? entry.createdAt.toDate().toISOString() : entry.createdAt || null,
      mfaVerifiedUntil: entry.mfaVerifiedUntil?.toDate
        ? entry.mfaVerifiedUntil.toDate().toISOString()
        : entry.mfaVerifiedUntil || null,
      mfaLastVerifiedAt: entry.mfaLastVerifiedAt?.toDate
        ? entry.mfaLastVerifiedAt.toDate().toISOString()
        : entry.mfaLastVerifiedAt || null,
    };
  }

  async function loadStaffAccountsFromFirestore() {
    const snapshot = await getDocs(query(collection(db, "admins"), orderBy("createdAt", "desc")));
    return snapshot.docs.map((entry) => normalizeStaffAccount({ id: entry.id, ...entry.data() }));
  }

  async function loadStaffAccounts() {
    try {
      setLoadingStaff(true);
      setListError("");
      let accounts = [];

      try {
        const result = await GET_STAFF_ACCOUNTS();
        accounts = Array.isArray(result.data) ? result.data : [];
      } catch (callableError) {
        console.error("getStaffAccounts callable failed, using Firestore read fallback:", callableError);
        accounts = await loadStaffAccountsFromFirestore();
      }

      setStaffAccounts(
        accounts
          .filter((entry) => entry.role === ROLES.RECEPTIONIST || entry.role === ROLES.DENTIST)
          .filter((entry) => entry.archiveStatus !== "Archived")
      );
      setAdminAccounts(
        accounts
          .filter((entry) => entry.role === ROLES.ADMIN)
          .filter((entry) => entry.archiveStatus !== "Archived")
      );
    } catch (err) {
      setListError(err?.message || "Could not load staff accounts.");
      setStaffAccounts([]);
      setAdminAccounts([]);
      console.error(err);
    } finally {
      setLoadingStaff(false);
    }
  }

  useEffect(() => {
    loadStaffAccounts();
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError("");
    setSuccess("");
    setCreated(null);

    if (!draft.name.trim() || !draft.email.trim() || !draft.password.trim()) {
      setFormError("Complete the staff name, email, password, and role first.");
      return;
    }

    try {
      setSubmitting(true);
      const result = await CREATE_STAFF({
        name: draft.name.trim(),
        email: draft.email.trim(),
        password: draft.password,
        role: draft.role,
      });

      setCreated(result.data || null);
      setSuccess(`${ROLE_LABELS[draft.role]} account created successfully.`);
      setDraft(emptyDraft());
      await loadStaffAccounts();
    } catch (err) {
      setFormError(err?.message || "Could not create the staff account.");
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleStaffStatus(account) {
    try {
      setListError("");
      setSuccess("");
      setUpdatingAccountId(account.id);
      await SET_STAFF_DISABLED({
        uid: account.id,
        disabled: !account.disabled,
      });
      setSuccess(
        `${account.email || account.name || "Staff account"} ${
          account.disabled ? "enabled" : "disabled"
        } successfully.`
      );
      await loadStaffAccounts();
    } catch (err) {
      setListError(err?.message || "Could not update the staff account status.");
      console.error(err);
    } finally {
      setUpdatingAccountId("");
    }
  }

  async function archiveStaffAccount(account) {
    if (!account.disabled) {
      setListError("Disable the staff account first before archiving it.");
      return;
    }

    try {
      setListError("");
      setSuccess("");
      setUpdatingAccountId(account.id);
      await ARCHIVE_STAFF_ACCOUNT({ uid: account.id });
      setSuccess(`${account.email || account.name || "Staff account"} archived successfully.`);
      await loadStaffAccounts();
    } catch (err) {
      setListError(err?.message || "Could not archive the staff account.");
      console.error(err);
    } finally {
      setUpdatingAccountId("");
    }
  }

  async function toggleStaffMfa(account) {
    const isAdministrator = account.role === ROLES.ADMIN;
    const nextMfaEnabled = isAdministrator ? true : account.mfaEnabled !== true;

    try {
      setListError("");
      setSuccess("");
      setUpdatingAccountId(account.id);
      await SET_STAFF_MFA_REQUIRED({
        uid: account.id,
        mfaEnabled: nextMfaEnabled,
      });
      setSuccess(
        `${account.email || account.name || "Staff account"} MFA ${
          nextMfaEnabled ? "turned on" : "turned off"
        } successfully.`
      );
      await loadStaffAccounts();
    } catch (err) {
      setListError(err?.message || "Could not update staff MFA.");
      console.error(err);
    } finally {
      setUpdatingAccountId("");
    }
  }

  return (
    <div className="container adminSurface">
      <div className="hero adminHero">
        <div className="adminHeroGlow" />
        <div className="adminHeroContent">
          <span className="heroEyebrow">Security Control</span>
          <h1>Staff Accounts</h1>
          <p>Create dentist and receptionist logins, then manage whether those staff accounts can access the system.</p>
        </div>
      </div>

      <div className="card adminEditorCard" style={{ marginTop: 18 }}>
        <div className="cardHeader">
          <div>
            <h3 className="title">Create Staff Account</h3>
            <p className="sub">This form creates the Firebase Authentication login and the matching `admins/{'{uid}'}` role record through a protected backend function.</p>
          </div>
          <span className="badge">Admin Only</span>
        </div>

        <form className="form" onSubmit={handleSubmit}>
          <input
            className="input"
            placeholder="Full name"
            value={draft.name}
            onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value }))}
          />

          <input
            className="input"
            type="email"
            placeholder="staff@topdent.com"
            value={draft.email}
            onChange={(e) => setDraft((current) => ({ ...current, email: e.target.value }))}
          />

          <input
            className="input"
            type="password"
            placeholder="Temporary password"
            value={draft.password}
            onChange={(e) => setDraft((current) => ({ ...current, password: e.target.value }))}
          />

          <select
            className="input"
            value={draft.role}
            onChange={(e) => setDraft((current) => ({ ...current, role: e.target.value }))}
          >
            <option value={ROLES.RECEPTIONIST}>{ROLE_LABELS[ROLES.RECEPTIONIST]}</option>
            <option value={ROLES.DENTIST}>{ROLE_LABELS[ROLES.DENTIST]}</option>
          </select>

          <button className="btn btnShine" type="submit" disabled={submitting}>
            {submitting ? "Creating Account..." : "Create Staff Account"}
          </button>
        </form>

        {formError ? <div className="error" style={{ marginTop: 12 }}>{formError}</div> : null}
        {success ? <div className="successBanner" style={{ marginTop: 12 }}>{success}</div> : null}

        {created ? (
          <div className="detailNote historyPanel selectedToothPanel" style={{ marginTop: 14 }}>
            <span className="detailLabel">Latest created account</span>
            <p><strong>{created.name}</strong> {" - "} {created.email}</p>
            <p>Role: {ROLE_LABELS[created.role] || created.role}</p>
          </div>
        ) : null}
      </div>

      <div className="card adminRecordsCard" style={{ marginTop: 18 }}>
        <div className="cardHeader">
          <div>
            <h3 className="title">Administrator MFA</h3>
            <p className="sub">Require email verification for administrator accounts after password login.</p>
          </div>
          <span className="badge">{loadingStaff ? "Loading..." : `${adminAccounts.length} admin`}</span>
        </div>

        <ul className="list detailedList">
          {!loadingStaff && adminAccounts.map((account) => (
            <li key={account.id} className="item detailedItem bookingShowcase">
              <div className="detailContent">
                <div className="detailTopRow">
                  <div>
                    <strong className="detailTitle">{account.name || account.email || "Administrator"}</strong>
                    <p className="detailSubtitle">{account.email || "No email saved"}</p>
                  </div>
                  <span className={`statusPill ${account.mfaEnabled ? "approved" : "active"}`}>
                    {account.mfaEnabled ? "MFA on" : "MFA repair needed"}
                  </span>
                </div>
              </div>
              <div className="actionColumn">
                {account.mfaEnabled ? (
                  <span className="badge">Admin MFA is mandatory</span>
                ) : (
                  <button
                    className="btn secondary btnSoft"
                    type="button"
                    onClick={() => toggleStaffMfa(account)}
                    disabled={updatingAccountId === account.id}
                  >
                    {updatingAccountId === account.id ? "Updating..." : "Repair Admin MFA"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="card adminRecordsCard" style={{ marginTop: 18 }}>
        <div className="cardHeader">
          <div>
            <h3 className="title">Staff Access Control</h3>
            <p className="sub">Enable or disable dentist and receptionist accounts without showing administrator records here.</p>
          </div>
          <span className="badge">{loadingStaff ? "Loading..." : `${staffAccounts.length} staff`}</span>
        </div>

        <ul className="list detailedList">
          {listError ? (
            <li className="item detailedItem bookingShowcase">
              <div className="detailContent">
                <strong className="detailTitle">Could not load staff accounts</strong>
                <p className="detailSubtitle">{listError}</p>
              </div>
            </li>
          ) : null}

          {loadingStaff ? (
            <li className="item detailedItem bookingShowcase">
              <div className="detailContent">
                <strong className="detailTitle">Loading staff accounts...</strong>
                <p className="detailSubtitle">Fetching every saved staff account from Firestore.</p>
              </div>
            </li>
          ) : null}

          {!loadingStaff && !listError && staffAccounts.length === 0 ? (
            <li className="item detailedItem bookingShowcase">
              <div className="detailContent">
                <strong className="detailTitle">No staff accounts found</strong>
                <p className="detailSubtitle">Dentist and receptionist accounts created from this page will appear here for access control.</p>
              </div>
            </li>
          ) : null}

          {!loadingStaff && !listError ? staffAccounts.map((account) => (
            <li key={account.id} className="item detailedItem bookingShowcase">
              <div className="detailContent">
                <div className="detailTopRow">
                  <div>
                    <strong className="detailTitle">{account.name || "No staff name saved"}</strong>
                    <p className="detailSubtitle">{ROLE_LABELS[account.role] || account.role || "No role saved"}</p>
                  </div>
                  <span className={`statusPill ${account.disabled ? "cancelled" : "approved"}`}>
                    {account.disabled ? "disabled" : "active"}
                  </span>
                  <span className={`statusPill ${account.mfaEnabled ? "approved" : "active"}`}>
                    {account.mfaEnabled ? "MFA on" : "MFA off"}
                  </span>
                </div>
                <div className="detailGrid accountGrid" style={{ marginTop: 12 }}>
                  <div className="detailBox">
                    <span className="detailLabel">Staff Name</span>
                    <strong>{account.name || "No staff name saved"}</strong>
                  </div>
                  <div className="detailBox">
                    <span className="detailLabel">Email</span>
                    <strong>{account.email || "No email saved"}</strong>
                  </div>
                  <div className="detailBox">
                    <span className="detailLabel">Role</span>
                    <strong>{ROLE_LABELS[account.role] || account.role || "No role saved"}</strong>
                  </div>
                  <div className="detailBox detailBoxWide">
                    <span className="detailLabel">Account ID</span>
                    <strong className="accountIdValue">{account.id}</strong>
                  </div>
                </div>
              </div>
              <div className="actionColumn">
                <button
                  className="btn secondary btnSoft"
                  type="button"
                  onClick={() => toggleStaffMfa(account)}
                  disabled={updatingAccountId === account.id}
                >
                  {updatingAccountId === account.id
                    ? "Updating..."
                    : account.mfaEnabled
                      ? "Turn MFA Off"
                      : "Require MFA"}
                </button>
                <button
                  className={`btn ${account.disabled ? "patientEditBtn" : "actionPending"}`}
                  type="button"
                  onClick={() => toggleStaffStatus(account)}
                  disabled={updatingAccountId === account.id}
                >
                  {updatingAccountId === account.id
                    ? "Updating..."
                    : account.disabled
                      ? "Enable Account"
                      : "Disable Account"}
                </button>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => archiveStaffAccount(account)}
                  disabled={updatingAccountId === account.id || !account.disabled}
                >
                  {updatingAccountId === account.id ? "Updating..." : "Archive Account"}
                </button>
              </div>
            </li>
          )) : null}
        </ul>
      </div>
    </div>
  );
}
