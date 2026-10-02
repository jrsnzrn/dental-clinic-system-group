import { useEffect, useMemo, useState } from "react";
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
  return { name: "", email: "", password: "", role: ROLES.RECEPTIONIST };
}

function toIso(value) {
  return value?.toDate ? value.toDate().toISOString() : value || null;
}

function normalizeStaffAccount(entry) {
  return {
    ...entry,
    createdAt: toIso(entry.createdAt),
    mfaVerifiedUntil: toIso(entry.mfaVerifiedUntil),
    mfaLastVerifiedAt: toIso(entry.mfaLastVerifiedAt),
  };
}

async function loadStaffAccountsFromFirestore() {
  const snapshot = await getDocs(query(collection(db, "admins"), orderBy("createdAt", "desc")));
  return snapshot.docs.map((entry) => normalizeStaffAccount({ id: entry.id, ...entry.data() }));
}

const ROLE_ORDER = { [ROLES.ADMIN]: 0, [ROLES.DENTIST]: 1, [ROLES.RECEPTIONIST]: 2 };

const SORT_OPTIONS = [
  { value: "role", label: "Role" },
  { value: "name", label: "Name (A–Z)" },
  { value: "newest", label: "Latest created" },
  { value: "oldest", label: "Earliest created" },
];

const nameOf = (account) => (account.name || account.email || "").toLowerCase();

function createdTime(account) {
  const value = account.createdAt;
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Date.parse(value) || 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  const seconds = value.seconds ?? value._seconds;
  return typeof seconds === "number" ? seconds * 1000 : 0;
}

function sortAccounts(accounts, sortBy) {
  const byName = (a, b) => nameOf(a).localeCompare(nameOf(b));
  const roleRank = (a) => ROLE_ORDER[a.role] ?? 99;
  const list = [...accounts];

  if (sortBy === "name") return list.sort(byName);
  if (sortBy === "newest") return list.sort((a, b) => createdTime(b) - createdTime(a) || byName(a, b));
  if (sortBy === "oldest") {
    const time = (a) => createdTime(a) || Number.MAX_SAFE_INTEGER;
    return list.sort((a, b) => time(a) - time(b) || byName(a, b));
  }
  return list.sort((a, b) => roleRank(a) - roleRank(b) || byName(a, b));
}

function initials(account) {
  const source = (account.name || account.email || "?").trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  const letters = (parts[0]?.[0] || "?") + (parts.length > 1 ? parts[1][0] : "");
  return letters.toUpperCase();
}

function AccountRow({ account, busy, menuOpen, setMenuId, onToggleMfa, onToggleStatus, onArchive }) {
  const isAdmin = account.role === ROLES.ADMIN;
  const roleLabel = ROLE_LABELS[account.role] || account.role || "No role saved";
  const displayName = account.name || account.email || (isAdmin ? "Administrator" : "No staff name saved");
  const run = (action) => () => {
    setMenuId("");
    action(account);
  };
  const mfaLabel = isAdmin
    ? account.mfaEnabled ? "MFA required" : "MFA repair needed"
    : account.mfaEnabled ? "MFA on" : "MFA off";

  return (
    <li className={`acctRow${account.disabled && !isAdmin ? " isDisabled" : ""}`} title={`Account ID: ${account.id}`}>
      <span className="acctAvatar" aria-hidden="true">
        {initials(account)}
      </span>

      <div className="acctWho">
        <strong>{displayName}</strong>
        <span>{account.email || "No email saved"}</span>
      </div>

      <div className="acctPills">
        <span className="acctRole">{roleLabel}</span>
        <span className={`acctMeta${account.mfaEnabled ? "" : isAdmin ? " isWarn" : ""}`}>{mfaLabel}</span>
        {!isAdmin && account.disabled ? <span className="acctMeta isWarn">Disabled</span> : null}
      </div>

      <div className="acctMenuWrap">
        {isAdmin ? (
          !account.mfaEnabled ? (
            <button className="btn secondary btnSoft" type="button" onClick={() => onToggleMfa(account)} disabled={busy}>
              {busy ? "Updating..." : "Repair MFA"}
            </button>
          ) : null
        ) : (
          <>
            <button
              className="acctIconBtn"
              type="button"
              aria-label={`Actions for ${displayName}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuId(menuOpen ? "" : account.id)}
              disabled={busy}
            >
              {busy ? "…" : "⋯"}
            </button>

            {menuOpen ? (
              <div className="acctMenu" role="menu">
                <button className="acctMenuItem" type="button" role="menuitem" onClick={run(onToggleMfa)}>
                  {account.mfaEnabled ? "Turn MFA off" : "Require MFA"}
                </button>
                <button className="acctMenuItem" type="button" role="menuitem" onClick={run(onToggleStatus)}>
                  {account.disabled ? "Enable account" : "Disable account"}
                </button>
                <button
                  className="acctMenuItem isDanger"
                  type="button"
                  role="menuitem"
                  onClick={run(onArchive)}
                  disabled={!account.disabled}
                  title={account.disabled ? "" : "Disable the account first"}
                >
                  Archive account
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </li>
  );
}


export default function Accounts() {
  const [draft, setDraft] = useState(emptyDraft());
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [listError, setListError] = useState("");
  const [success, setSuccess] = useState("");
  const [adminAccounts, setAdminAccounts] = useState([]);
  const [staffAccounts, setStaffAccounts] = useState([]);
  const [loadingStaff, setLoadingStaff] = useState(true);
  const [updatingAccountId, setUpdatingAccountId] = useState("");
  const [menuId, setMenuId] = useState("");
  const [sortBy, setSortBy] = useState("role");
  const [search, setSearch] = useState("");

  const labelOf = (account) => account.email || account.name || "Staff account";

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

      const active = accounts.filter((entry) => entry.archiveStatus !== "Archived");
      setStaffAccounts(active.filter((entry) => entry.role === ROLES.RECEPTIONIST || entry.role === ROLES.DENTIST));
      setAdminAccounts(active.filter((entry) => entry.role === ROLES.ADMIN));
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

  // success message fades out on its own
  useEffect(() => {
    if (!success) return undefined;
    const timer = setTimeout(() => setSuccess(""), 5000);
    return () => clearTimeout(timer);
  }, [success]);

  // close the row menu on outside click, and the menu / dialog on Escape
  useEffect(() => {
    function onPointerDown(event) {
      if (!event.target.closest?.(".acctMenuWrap")) setMenuId("");
    }
    function onKeyDown(event) {
      if (event.key === "Escape") {
        setMenuId("");
        setShowForm(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  function openForm() {
    setFormError("");
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setFormError("");
  }

  async function runAccountAction(account, action, successMessage, errorMessage) {
    try {
      setListError("");
      setSuccess("");
      setUpdatingAccountId(account.id);
      await action();
      setSuccess(successMessage);
      await loadStaffAccounts();
    } catch (err) {
      setListError(err?.message || errorMessage);
      console.error(err);
    } finally {
      setUpdatingAccountId("");
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError("");
    setSuccess("");

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

      const created = result.data || {};
      setSuccess(
        `${ROLE_LABELS[draft.role]} account created for ${created.name || draft.name.trim()} (${created.email || draft.email.trim()}).`
      );
      setDraft(emptyDraft());
      setShowForm(false);
      await loadStaffAccounts();
    } catch (err) {
      setFormError(err?.message || "Could not create the staff account.");
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  function toggleStaffStatus(account) {
    return runAccountAction(
      account,
      () => SET_STAFF_DISABLED({ uid: account.id, disabled: !account.disabled }),
      `${labelOf(account)} ${account.disabled ? "enabled" : "disabled"} successfully.`,
      "Could not update the staff account status."
    );
  }

  function archiveStaffAccount(account) {
    if (!account.disabled) {
      setListError("Disable the staff account first before archiving it.");
      return undefined;
    }
    return runAccountAction(
      account,
      () => ARCHIVE_STAFF_ACCOUNT({ uid: account.id }),
      `${labelOf(account)} archived successfully.`,
      "Could not archive the staff account."
    );
  }

  function toggleStaffMfa(account) {
    const nextMfaEnabled = account.role === ROLES.ADMIN ? true : account.mfaEnabled !== true;
    return runAccountAction(
      account,
      () => SET_STAFF_MFA_REQUIRED({ uid: account.id, mfaEnabled: nextMfaEnabled }),
      `${labelOf(account)} MFA ${nextMfaEnabled ? "turned on" : "turned off"} successfully.`,
      "Could not update staff MFA."
    );
  }

  const allAccounts = useMemo(
    () => sortAccounts([...adminAccounts, ...staffAccounts], sortBy),
    [adminAccounts, staffAccounts, sortBy]
  );

  const searchTerm = search.trim().toLowerCase();
  const visibleAccounts = useMemo(() => {
    return allAccounts.filter((account) => {
      if (!searchTerm) return true;
      return [account.name, account.email, ROLE_LABELS[account.role] || account.role].some((value) =>
        String(value || "").toLowerCase().includes(searchTerm)
      );
    });
  }, [allAccounts, searchTerm]);

  const plural = (n) => `${n} ${n === 1 ? "account" : "accounts"}`;

  return (
    <div className="container adminSurface acctPage">
      {success ? (
        <div className="successBanner acctBanner acctToast" role="status">
          <span>{success}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setSuccess("")}>✕</button>
        </div>
      ) : null}

      <div className="acctBar">
        <div className="acctBarLeft">
          <div className="acctSearch">
            <svg className="acctSearchIcon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M20 20l-3.5-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              className="input"
              type="text"
              placeholder="Search name, email, or role"
              aria-label="Search accounts"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search ? (
              <button className="acctSearchClear" type="button" aria-label="Clear search" onClick={() => setSearch("")}>
                ✕
              </button>
            ) : null}
          </div>
          <span className="acctCount">
            {loadingStaff
              ? "Loading..."
              : searchTerm
                ? `${visibleAccounts.length} of ${plural(allAccounts.length)}`
                : plural(allAccounts.length)}
          </span>
        </div>

        <div className="acctBarActions">
          <label className="acctSort">
            <span>Sort by</span>
            <select className="input" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btnShine" type="button" onClick={openForm}>
            + Add staff
          </button>
        </div>
      </div>

      <section className="card acctCard">
        {listError ? <div className="error acctBanner">{listError}</div> : null}

        {loadingStaff ? <p className="acctEmpty">Loading staff accounts...</p> : null}

        {!loadingStaff && !listError && allAccounts.length === 0 ? (
          <div className="acctEmpty">
            <strong>No accounts yet</strong>
            <span>Dentist and receptionist accounts you add will appear here.</span>
            <button className="btn btnShine" type="button" onClick={openForm}>
              Add staff
            </button>
          </div>
        ) : null}

        {!loadingStaff && allAccounts.length > 0 && visibleAccounts.length === 0 ? (
          <div className="acctEmpty">
            <strong>No matches</strong>
            <span>
              {searchTerm ? `Nothing matches “${search.trim()}”. ` : ""}Try a different name, email, or role.
            </span>
            <button className="btn secondary" type="button" onClick={() => setSearch("")}>
              Clear search
            </button>
          </div>
        ) : null}

        {!loadingStaff && visibleAccounts.length > 0 ? (
          <ul className="acctList">
            {visibleAccounts.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                busy={updatingAccountId === account.id}
                menuOpen={menuId === account.id}
                setMenuId={setMenuId}
                onToggleMfa={toggleStaffMfa}
                onToggleStatus={toggleStaffStatus}
                onArchive={archiveStaffAccount}
              />
            ))}
          </ul>
        ) : null}
      </section>

      {showForm ? (
        <div
          className="acctOverlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeForm();
          }}
        >
          <form className="acctDialog" onSubmit={handleSubmit} role="dialog" aria-modal="true" aria-labelledby="acctDialogTitle">
            <div className="acctDialogHead">
              <h3 id="acctDialogTitle">Add staff account</h3>
              <button className="acctIconBtn" type="button" aria-label="Close" onClick={closeForm}>
                ✕
              </button>
            </div>
            <p className="acctHint">Creates the login and its role record through a protected backend function.</p>

            <div className="acctFields">
              <label className="acctField">
                <span>Full name</span>
                <input
                  className="input"
                  placeholder="Maria Santos"
                  value={draft.name}
                  onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value }))}
                  autoFocus
                />
              </label>
              <label className="acctField">
                <span>Email</span>
                <input
                  className="input"
                  type="email"
                  placeholder="staff@topdent.com"
                  value={draft.email}
                  onChange={(e) => setDraft((current) => ({ ...current, email: e.target.value }))}
                />
              </label>
              <label className="acctField">
                <span>Temporary password</span>
                <input
                  className="input"
                  type="password"
                  placeholder="Temporary password"
                  autoComplete="new-password"
                  value={draft.password}
                  onChange={(e) => setDraft((current) => ({ ...current, password: e.target.value }))}
                />
              </label>
              <label className="acctField">
                <span>Role</span>
                <select
                  className="input"
                  value={draft.role}
                  onChange={(e) => setDraft((current) => ({ ...current, role: e.target.value }))}
                >
                  <option value={ROLES.ADMIN}>{ROLE_LABELS[ROLES.ADMIN]}</option>
                  <option value={ROLES.RECEPTIONIST}>{ROLE_LABELS[ROLES.RECEPTIONIST]}</option>
                  <option value={ROLES.DENTIST}>{ROLE_LABELS[ROLES.DENTIST]}</option>
                </select>
              </label>
            </div>

            {formError ? <div className="error acctBanner">{formError}</div> : null}

            <div className="acctDialogActions">
              <button className="btn secondary" type="button" onClick={closeForm}>
                Cancel
              </button>
              <button className="btn btnShine" type="submit" disabled={submitting}>
                {submitting ? "Creating..." : "Create account"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}