import SuccessDialog from "../../components/SuccessDialog";
import LoadingIndicator from "../../components/LoadingIndicator";
import { buildStaffProfile, getStaffTitle, staffProfileDraft } from "../../utils/staffProfile";
import RecordPagination from "../../components/RecordPagination";
import useRecordPagination from "../../hooks/useRecordPagination";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../firebase";
import ConfirmDialog from "../../components/ConfirmDialog";
import { ROLE_LABELS, ROLES } from "../../utils/rbac";
import { fetchStaffAccounts } from "../../utils/staffAccounts";

const CREATE_STAFF = httpsCallable(functions, "createStaffAccount");
const UPDATE_STAFF_PROFILE = httpsCallable(functions, "updateStaffProfile");
const SET_STAFF_EMAIL = httpsCallable(functions, "setStaffAccountEmail");
const SET_STAFF_DISABLED = httpsCallable(functions, "setStaffAccountDisabled");
const ARCHIVE_STAFF_ACCOUNT = httpsCallable(functions, "archiveStaffAccount");
const SET_STAFF_MFA_REQUIRED = httpsCallable(functions, "setStaffMfaRequired");

function emptyDraft() {
  return { firstName: "", middleName: "", lastName: "", age: "", gender: "", phone: "", email: "", password: "", role: ROLES.RECEPTIONIST };
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
  onEdit,
  onChangeEmail,
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
              {!isAdmin ? <button className="acctMenuItem" type="button" role="menuitem" onClick={run(onEdit)}>Edit staff details</button> : null}
              {!isAdmin ? <button className="acctMenuItem" type="button" role="menuitem" onClick={run(onChangeEmail)}>Change sign-in email</button> : null}
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [draft, setDraft] = useState(emptyDraft());
  const [showForm, setShowForm] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState("");
  const [emailAccount, setEmailAccount] = useState(null);
  const [newEmail, setNewEmail] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [formError, setFormError] = useState("");
  const [listError, setListError] = useState("");
  const [success, setSuccess] = useState("");
  const [adminAccounts, setAdminAccounts] = useState([]);
  const [staffAccounts, setStaffAccounts] = useState([]);
  const [loadingStaff, setLoadingStaff] = useState(true);
  const [updatingAccountId, setUpdatingAccountId] = useState("");
  const [menuId, setMenuId] = useState("");
  const [search, setSearch] = useState("");
  const [pendingAction, setPendingAction] = useState(null);
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const requestedRole = searchParams.get("role");
  const roleFilter = ROLE_FILTER_OPTIONS.some((option) => option.value === requestedRole)
    ? requestedRole
    : "all";

  const labelOf = (account) => account.name || account.email || "Staff account";

  async function loadStaffAccounts() {
    try {
      setLoadingStaff(true);
      setListError("");
      const accounts = await fetchStaffAccounts();

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


  // close the row menu on outside click, and the menu / dialog on Escape
  useEffect(() => {
    function onPointerDown(event) {
      if (!event.target.closest?.(".acctMenuWrap")) setMenuId("");
    }
    function onKeyDown(event) {
      if (event.key === "Escape" && !submitting) {
        setMenuId("");
        setShowPassword(false);
        setShowForm(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [submitting]);

  function openForm() {
    setEditingAccountId("");
    setDraft(emptyDraft());
    setFormError("");
    setShowPassword(false);
    setShowForm(true);
  }

  function closeForm() {
    if (submitting) return;
    setShowPassword(false);
    setShowForm(false);
    setFormError("");
  }

  function editStaff(account) {
    setEditingAccountId(account.id);
    setDraft(staffProfileDraft(account));
    setFormError("");
    setShowPassword(false);
    setShowForm(true);
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
    if (submitting) return;
    setFormError("");
    setSuccess("");

    try {
      const profile = buildStaffProfile(draft, draft.role);
      if (!editingAccountId && (!draft.email.trim() || !draft.password.trim())) throw new Error("Enter an email and temporary password.");
      setSubmitting(true);
      const result = editingAccountId
        ? await UPDATE_STAFF_PROFILE({ uid: editingAccountId, firstName: profile.firstName, middleName: profile.middleName,
          lastName: profile.lastName, age: profile.age, gender: profile.gender, phone: profile.phone })
        : await CREATE_STAFF({ ...profile, email: draft.email.trim(), password: draft.password, role: draft.role });

      const created = result.data || {};
      setSuccess(
        editingAccountId
          ? `Staff details saved for ${created.name || profile.name}.${created.authDisplayNameSynced === false ? " The sign-in display name could not be synced; save again to retry." : ""}`
          : `${ROLE_LABELS[draft.role]} account created for ${created.name || profile.name} (${created.email || draft.email.trim()}).`
      );
      setDraft(emptyDraft());
      setShowPassword(false);
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

  const accountPage = useRecordPagination(visibleAccounts, JSON.stringify([searchTerm, roleFilter]));
  return (
    <div className="container adminSurface acctPage">
      <SuccessDialog message={success} onConfirm={() => setSuccess("")} />

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
              onChange={(event) => {
                const nextParams = new URLSearchParams(searchParams);
                if (event.target.value === "all") nextParams.delete("role");
                else nextParams.set("role", event.target.value);
                setSearchParams(nextParams);
              }}
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
              {accountPage.items.map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  busy={actionSubmitting || updatingAccountId === account.id}
                  menuOpen={menuId === account.id}
                  setMenuId={setMenuId}
                  onToggleMfa={toggleStaffMfa}
                  onRequestStatusChange={requestStatusChange}
                  onRequestArchive={requestArchive}
                  onEdit={editStaff}
                  onChangeEmail={account => { setEmailAccount(account); setNewEmail(account.email || ""); setEmailError(""); }}
                />
              ))}
            </ul>
              <RecordPagination pagination={accountPage} />
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
              <h3 id="acctDialogTitle">{editingAccountId ? "Edit staff details" : "Add staff account"}</h3>
              <button className="acctIconBtn" type="button" aria-label="Close" onClick={closeForm} disabled={submitting}>
                ✕
              </button>
            </div>
            <p className="acctHint">The title is set automatically from the staff member’s role and gender.</p>

            <div className="acctFields">
              {[["firstName", "First name"], ["middleName", "Middle name (optional)"], ["lastName", "Last name"]].map(([field, label]) => <label className="acctField" key={field}><span>{label}</span>
                <input className="input" value={draft[field]} maxLength={80} autoComplete={field === "firstName" ? "given-name" : field === "lastName" ? "family-name" : "additional-name"}
                  required={field !== "middleName"} disabled={submitting} onChange={event => setDraft(current => ({ ...current, [field]: event.target.value }))} />
              </label>)}
              <label className="acctField"><span>Age</span><input className="input" type="number" min="18" max="100" step="1" required value={draft.age} disabled={submitting}
                onChange={event => setDraft(current => ({ ...current, age: event.target.value }))} /></label>
              <label className="acctField"><span>Gender</span><select className="input" required value={draft.gender} disabled={submitting}
                onChange={event => setDraft(current => ({ ...current, gender: event.target.value }))}>
                <option value="">Select gender</option><option value="male">Male</option><option value="female">Female</option>
              </select></label>
              <div className="acctField"><span>Title</span><strong className="staffTitlePreview">{draft.gender ? getStaffTitle(draft.role, draft.gender) : "Choose gender first"}</strong></div>
              <label className="acctField"><span>Contact number (optional)</span><input className="input" type="tel" maxLength={30} value={draft.phone} disabled={submitting}
                onChange={event => setDraft(current => ({ ...current, phone: event.target.value }))} /></label>
              <label className="acctField">
                <span>Email</span>
                <input
                  className="input"
                  type="email"
                  readOnly={Boolean(editingAccountId)}
                  disabled={submitting}
                  required
                  placeholder="staff@topdent.com"
                  value={draft.email}
                  onChange={(e) => setDraft((current) => ({ ...current, email: e.target.value }))}
                />
              </label>
              {!editingAccountId ? <label className="acctField">
                <span>Temporary password</span>
                <div className="acctPasswordInput">
                  <input
                    className="input"
                    type={showPassword ? "text" : "password"}
                    placeholder="Temporary password"
                    autoComplete="new-password"
                    disabled={submitting}
                    minLength={6}
                    required
                    value={draft.password}
                    onChange={(e) => setDraft((current) => ({ ...current, password: e.target.value }))}
                  />
                  <button
                    className="acctPasswordToggle"
                    type="button"
                    aria-label={showPassword ? "Hide temporary password" : "Show temporary password"}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((current) => !current)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      {showPassword ? (
                        <>
                          <path d="M3 3l18 18" />
                          <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                          <path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c5 0 8.5 4.5 9.5 7-.4 1-1.3 2.3-2.6 3.5" />
                          <path d="M6.2 6.2C3.9 7.7 2.8 9.7 2.5 12c.5 1.3 3.9 7 9.5 7 1.2 0 2.3-.3 3.3-.7" />
                        </>
                      ) : (
                        <>
                          <path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" />
                          <circle cx="12" cy="12" r="3" />
                        </>
                      )}
                    </svg>
                  </button>
                </div>
              </label> : null}
              <label className="acctField">
                <span>Role</span>
                <select
                  className="input"
                  value={draft.role}
                  disabled={submitting || Boolean(editingAccountId)}
                  onChange={(e) => setDraft((current) => ({ ...current, role: e.target.value }))}
                >
                  <option value={ROLES.RECEPTIONIST}>{ROLE_LABELS[ROLES.RECEPTIONIST]}</option>
                  <option value={ROLES.DENTIST}>{ROLE_LABELS[ROLES.DENTIST]}</option>
                </select>
              </label>
            </div>

            {formError ? <div className="error acctBanner">{formError}</div> : null}

            <div className="acctDialogActions">
              <button className="btn btnShine" type="submit" disabled={submitting}>
                {submitting ? <LoadingIndicator>{editingAccountId ? "Saving…" : "Creating…"}</LoadingIndicator> : editingAccountId ? "Save staff details" : "Create account"}
              </button>
              <button className="btn secondary" type="button" onClick={closeForm} disabled={submitting}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {emailAccount ? <div className="acctOverlay"><form className="acctDialog" role="dialog" aria-modal="true" aria-labelledby="staff-email-title" onSubmit={async event => {
        event.preventDefault();
        if (savingEmail) return;
        setSavingEmail(true);
        setEmailError("");
        try {
          const result = await SET_STAFF_EMAIL({ uid: emailAccount.id, email: newEmail.trim() });
          setEmailAccount(null);
          setSuccess(`Sign-in email updated to ${result.data.email}.${result.data.verificationRequired ? " The staff member must verify the new email when signing in." : ""}`);
          await loadStaffAccounts();
        } catch (error) { setEmailError(error.message || "The email could not be changed."); }
        finally { setSavingEmail(false); }
      }}>
        <div className="acctDialogHead"><h3 id="staff-email-title">Change sign-in email</h3></div>
        <p className="acctHint">Change the sign-in email for {labelOf(emailAccount)}. The staff member will need to sign in again and verify their new email.</p>
        <label className="acctField"><span>New email address</span><input className="input" type="email" required maxLength={254} autoFocus disabled={savingEmail} value={newEmail} onChange={event => setNewEmail(event.target.value)} /></label>
        {emailError ? <div className="error" role="alert">{emailError}</div> : null}
        <div className="acctDialogActions"><button type="submit" className="btn btnShine" disabled={savingEmail || newEmail.trim().toLowerCase() === emailAccount.email?.toLowerCase()}>
          {savingEmail ? <LoadingIndicator>Updating email…</LoadingIndicator> : "Confirm email change"}</button>
          <button type="button" className="btn secondary" disabled={savingEmail} onClick={() => setEmailAccount(null)}>Cancel</button></div>
      </form></div> : null}

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
