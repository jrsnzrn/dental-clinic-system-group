import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../firebase";
import ConfirmDialog from "../../components/ConfirmDialog";
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

const ROLE_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: ROLES.DENTIST, label: ROLE_LABELS[ROLES.DENTIST] },
  { value: ROLES.RECEPTIONIST, label: ROLE_LABELS[ROLES.RECEPTIONIST] },
  { value: ROLES.ADMIN, label: ROLE_LABELS[ROLES.ADMIN] },
  { value: "disabled", label: "Disabled" },
];

function compareAccountNames(a, b) {
  const nameA = String(a.name || "").trim();
  const nameB = String(b.name || "").trim();
  if (!nameA || !nameB) return nameA ? -1 : nameB ? 1 : 0;
  return nameA.localeCompare(nameB, undefined, { sensitivity: "base" });
}

function initials(account) {
  const source = (account.name || account.email || "?").trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  const letters = (parts[0]?.[0] || "?") + (parts.length > 1 ? parts[1][0] : "");
  return letters.toUpperCase();
}

function AccountRow({
  account,
  busy,
  menuOpen,
  setMenuId,
  onToggleMfa,
  onRequestStatusChange,
  onRequestArchive,
}) {
  const isAdmin = account.role === ROLES.ADMIN;
  const canArchive = account.disabled && !isAdmin;
  const roleLabel = ROLE_LABELS[account.role] || account.role || "No role saved";
  const displayName = account.name || account.email || (isAdmin ? "Administrator" : "No staff name saved");
  const run = (action) => () => {
    setMenuId("");
    action(account);
  };

  return (
    <li className={`acctRow${account.disabled ? " isDisabled" : ""}`} title={`Account ID: ${account.id}`}>
      <span className="acctAvatar" aria-hidden="true">
        {initials(account)}
      </span>

      <div className="acctWho">
        <strong>{displayName}</strong>
        <span>{account.email || "No email saved"}</span>
      </div>

      <div className="acctPills">
        <span className="acctRole">{roleLabel}</span>
        {account.disabled ? <span className="acctMeta isWarn">Disabled</span> : null}
      </div>

      <div className="acctMenuWrap">
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
              {isAdmin ? (
                !account.mfaEnabled ? (
                  <button className="acctMenuItem" type="button" role="menuitem" onClick={run(onToggleMfa)}>
                    Repair MFA
                  </button>
                ) : null
              ) : (
                <button className="acctMenuItem" type="button" role="menuitem" onClick={run(onToggleMfa)}>
                  {account.mfaEnabled ? "Turn MFA off" : "Turn MFA on"}
                </button>
              )}
              <button className="acctMenuItem" type="button" role="menuitem" onClick={run(onRequestStatusChange)}>
                {account.disabled ? "Enable account" : "Disable account"}
              </button>
              {canArchive ? (
                <button
                  className="acctMenuItem isDanger"
                  type="button"
                  role="menuitem"
                  onClick={run(onRequestArchive)}
                >
                  Archive account
                </button>
              ) : null}
            </div>
          ) : null}
        </>
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
  const [roleFilter, setRoleFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [pendingAction, setPendingAction] = useState(null);
  const [actionSubmitting, setActionSubmitting] = useState(false);

  const labelOf = (account) => account.name || account.email || "Staff account";

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

  function toggleStaffMfa(account) {
    const nextMfaEnabled = account.role === ROLES.ADMIN ? true : account.mfaEnabled !== true;
    return runAccountAction(
      account,
      () => SET_STAFF_MFA_REQUIRED({ uid: account.id, mfaEnabled: nextMfaEnabled }),
      `${labelOf(account)} MFA ${nextMfaEnabled ? "turned on" : "turned off"} successfully.`,
      "Could not update staff MFA."
    );
  }

  const allAccounts = useMemo(() => [...adminAccounts, ...staffAccounts], [adminAccounts, staffAccounts]);

  const roleFilteredAccounts = useMemo(
    () => allAccounts.filter((account) => {
      if (roleFilter === "disabled") return account.disabled;
      return roleFilter === "all" || account.role === roleFilter;
    }),
    [allAccounts, roleFilter]
  );
  const searchTerm = search.trim().toLowerCase();
  const visibleAccounts = useMemo(() => {
    return roleFilteredAccounts
      .filter((account) => {
        if (!searchTerm) return true;
        return [account.name, account.email, ROLE_LABELS[account.role] || account.role].some((value) =>
          String(value || "").toLowerCase().includes(searchTerm)
        );
      })
      .sort(compareAccountNames);
  }, [roleFilteredAccounts, searchTerm]);

  function requestStatusChange(account) {
    setPendingAction({
      type: "status",
      disabled: !account.disabled,
      accounts: [account],
    });
  }

  function requestArchive(account) {
    if (!account.disabled || account.role === ROLES.ADMIN) return;
    setPendingAction({ type: "archive", accounts: [account] });
  }

  async function handleConfirmAction() {
    if (!pendingAction || actionSubmitting) return;
    const action = pendingAction;
    setActionSubmitting(true);
    setPendingAction(null);
    setMenuId("");

    const results = await Promise.allSettled(action.accounts.map(async (account) => {
      if (action.type === "archive") {
        if (!account.disabled || account.role === ROLES.ADMIN) {
          throw new Error(`${labelOf(account)} is not eligible for archiving.`);
        }
        return ARCHIVE_STAFF_ACCOUNT({ uid: account.id });
      }

      if (action.disabled === account.disabled) {
        throw new Error(`${labelOf(account)} is no longer eligible for this status change.`);
      }
      return SET_STAFF_DISABLED({ uid: account.id, disabled: action.disabled });
    }));

    const succeeded = results.filter((result) => result.status === "fulfilled").length;
    const failures = results.filter((result) => result.status === "rejected");
    await loadStaffAccounts();
    setActionSubmitting(false);

    if (failures.length) {
      const firstFailure = failures[0].reason?.message || "An account action failed.";
      setListError(
        succeeded
          ? `${succeeded} account${succeeded === 1 ? "" : "s"} updated; ${failures.length} failed. ${firstFailure}`
          : firstFailure
      );
    }
    if (succeeded) {
      const verb = action.type === "archive"
        ? "archived"
        : action.disabled
          ? "disabled"
          : "enabled";
      setSuccess(`${succeeded} account${succeeded === 1 ? "" : "s"} ${verb} successfully.`);
    }
  }

  const plural = (n) => `${n} ${n === 1 ? "account" : "accounts"}`;

  const confirmationDetails = useMemo(() => {
    if (!pendingAction) return null;
    const { type, disabled, accounts: affected } = pendingAction;
    const target = labelOf(affected[0]);
    if (type === "archive") {
      return {
        title: "Archive this account?",
        message: `${target} will be removed from the active accounts list.`,
        confirmLabel: "Archive Account",
        tone: "archive",
      };
    }
    const verb = disabled ? "Disable" : "Enable";
    const stateWord = verb === "Disable" ? "disabled" : "enabled";
    return {
      title: `${verb} this account?`,
      message: `${target} will be ${stateWord}.`,
      confirmLabel: `${verb} Account`,
      tone: verb === "Disable" ? "danger" : "default",
    };
  }, [pendingAction]);

  return (
    <div className="container adminSurface acctPage">
      {success ? (
        <div className="successBanner acctBanner acctToast" role="status">
          <span>{success}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setSuccess("")}>✕</button>
        </div>
      ) : null}

      <div className="acctBar acctTopToolbar">
        <div className="acctBarLeft">
          <div className="acctSearch adminSearchField">
            <svg className="acctSearchIcon adminSearchIcon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
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
              <button
                className="acctSearchClear"
                type="button"
                aria-label="Clear search"
                onClick={() => setSearch("")}
              >
                ✕
              </button>
            ) : null}
          </div>
        </div>

        <div className="acctBarActions">
          <label className="acctSort">
            <select
              className="input"
              aria-label="Filter accounts by role or status"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              {ROLE_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btnShine" type="button" onClick={openForm}>
            + Add Staff
          </button>
        </div>
      </div>
      <section className="acctListPanel">
        {listError ? <div className="error acctBanner">{listError}</div> : null}

        {loadingStaff ? <p className="acctEmpty">Loading staff accounts...</p> : null}

        {!loadingStaff && !listError && allAccounts.length === 0 ? (
          <div className="acctEmpty">
            <strong>No accounts yet</strong>
            <span>Admin, dentist, and receptionist accounts will appear here.</span>
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
          <>
            <div className="acctListHeader">
              <div className="acctListCount">
                {searchTerm || roleFilter !== "all"
                  ? `${visibleAccounts.length} of ${plural(roleFilteredAccounts.length)}`
                  : plural(allAccounts.length)}
              </div>
            </div>
            <ul className="acctList">
              {visibleAccounts.map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  busy={actionSubmitting || updatingAccountId === account.id}
                  menuOpen={menuId === account.id}
                  setMenuId={setMenuId}
                  onToggleMfa={toggleStaffMfa}
                  onRequestStatusChange={requestStatusChange}
                  onRequestArchive={requestArchive}
                />
              ))}
            </ul>
          </>
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

      <ConfirmDialog
        open={Boolean(pendingAction)}
        title={confirmationDetails?.title}
        message={confirmationDetails?.message}
        confirmLabel={confirmationDetails?.confirmLabel}
        tone={confirmationDetails?.tone}
        onClose={() => {
          if (!actionSubmitting) setPendingAction(null);
        }}
        onConfirm={handleConfirmAction}
      />
    </div>
  );
}