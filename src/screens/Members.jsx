import { CalendarCheck, CalendarX, ChevronRight, Copy, Crown, Link2, Plus, Share2, Trash2, UserCheck, UserPlus, UserX } from "lucide-react";
import { useEffect, useState } from "react";
import { trackEvent, trackFormError } from "../analytics";
import { ConfirmModal } from "../components/ConfirmModal.jsx";
import { Sheet } from "../components/Sheet.jsx";
import { createInvite, deleteRecord, updateRecord } from "../firebase";
import { copyToClipboard } from "../lib/actions";
import { formatTk } from "../lib/format";

const ROLES = [
  { id: "member", label: "Member", hint: "Adds own meals and deposits; an admin approves them" },
  { id: "admin", label: "Admin", hint: "Manages meals, money, people and months" },
];

function initialOf(name) {
  return name?.trim()?.[0]?.toUpperCase() || "?";
}

export function Members({ currentCycle, currentMess, ledger = {}, member, members, setCurrentCycle, setMessage }) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [openId, setOpenId] = useState("");
  const [confirm, setConfirm] = useState(null);
  const includedIds = currentCycle?.memberIds || [];
  const activeAdminCount = members.filter((person) => person.active && person.role === "admin").length;
  const byName = (left, right) => String(left.name || "").localeCompare(String(right.name || ""));
  const inMonth = members.filter((person) => person.active && includedIds.includes(person.id)).sort(byName);
  const notInMonth = members.filter((person) => person.active && !includedIds.includes(person.id)).sort(byName);
  const inactive = members.filter((person) => !person.active).sort(byName);
  const openPerson = members.find((person) => person.id === openId) || null;

  async function setInMonth(person, include) {
    const nextMemberIds = include ? [...new Set([...includedIds, person.id])] : includedIds.filter((id) => id !== person.id);
    await updateRecord("cycles", currentCycle.id, { memberIds: nextMemberIds });
    setCurrentCycle({ ...currentCycle, memberIds: nextMemberIds });
    setMessage(include ? `${person.name} added to this month.` : `${person.name} removed from this month.`);
    trackEvent(include ? "cycle_member_added" : "cycle_member_removed", { member_count: nextMemberIds.length });
  }

  async function changeRole(person, role) {
    if (role === person.role) return;
    if (person.role === "admin" && role !== "admin" && activeAdminCount <= 1) {
      trackFormError("member_role", "last_admin");
      setMessage("Keep at least one active admin.");
      return;
    }
    await updateRecord("members", person.id, { role });
    setMessage(`${person.name} is now ${role === "admin" ? "an admin" : "a member"}.`);
    trackEvent("member_role_changed", { from_role: person.role, to_role: role });
  }

  async function setActive(person, active) {
    if (!active && person.role === "admin" && activeAdminCount <= 1) {
      trackFormError("member_active_toggle", "last_admin");
      setMessage("Keep at least one active admin.");
      return;
    }
    await updateRecord("members", person.id, { active });
    setMessage(active ? `${person.name} can use the mess again.` : `${person.name} is deactivated.`);
    trackEvent(active ? "member_activated" : "member_deactivated", { role: person.role });
  }

  async function deletePerson(person) {
    if (person.role === "admin") {
      trackFormError("delete_member", "admin_locked");
      setMessage("Admins can’t be deleted. Make them a member first.");
      return;
    }
    if (includedIds.includes(person.id)) {
      const nextMemberIds = includedIds.filter((id) => id !== person.id);
      await updateRecord("cycles", currentCycle.id, { memberIds: nextMemberIds });
      setCurrentCycle({ ...currentCycle, memberIds: nextMemberIds });
    }
    await deleteRecord("members", person.id);
    setOpenId("");
    setMessage(`${person.name} was removed from this mess.`);
    trackEvent("member_deleted", { was_in_current_cycle: includedIds.includes(person.id) });
  }

  function renderRow(person, { showBalance = false, quickAdd = false } = {}) {
    const row = ledger[person.id];
    const balance = Number(row?.balance || 0);
    return (
      <div className="person-row" key={person.id}>
        <button className="person-row__main" type="button" onClick={() => setOpenId(person.id)}>
          <span className={person.active ? "person-row__avatar" : "person-row__avatar is-muted"} aria-hidden="true">
            {initialOf(person.name)}
          </span>
          <span className="person-row__who">
            <strong>
              {person.name}
              {person.id === member.id ? <em> (you)</em> : null}
              {person.role === "admin" ? (
                <span className="role-badge">
                  <Crown size={11} /> Admin
                </span>
              ) : null}
            </strong>
            <small>{person.email}</small>
          </span>
          {showBalance && row ? (
            <span className={balance < 0 ? "person-row__balance is-due" : "person-row__balance is-credit"}>
              <strong>{formatTk(Math.abs(balance))}</strong>
              <small>{balance < 0 ? "to pay" : "balance"}</small>
            </span>
          ) : null}
          {!quickAdd ? <ChevronRight className="person-row__chevron" size={18} /> : null}
        </button>
        {quickAdd ? (
          <button className="chip chip--accent person-row__add" type="button" onClick={() => setInMonth(person, true)}>
            <Plus size={15} /> Add
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="people-screen">
      <section className="people-hero">
        <div className="people-hero__stats">
          <div>
            <strong>{inMonth.length}</strong>
            <span>in {currentCycle?.name || "this month"}</span>
          </div>
          <div>
            <strong>{members.filter((person) => person.active).length}</strong>
            <span>active in mess</span>
          </div>
          <div>
            <strong>{activeAdminCount}</strong>
            <span>admin{activeAdminCount === 1 ? "" : "s"}</span>
          </div>
        </div>
        <button className="primary people-hero__invite" type="button" onClick={() => setInviteOpen(true)}>
          <UserPlus size={18} /> Invite someone
        </button>
      </section>

      <section className="panel people-group">
        <header>
          <h3>In this month</h3>
          <p>Only these people count in meals, deposits and balances.</p>
        </header>
        {inMonth.length ? inMonth.map((person) => renderRow(person, { showBalance: true })) : <p className="empty">No one is in this month yet.</p>}
      </section>

      {notInMonth.length ? (
        <section className="panel people-group">
          <header>
            <h3>Not in this month</h3>
            <p>Active in the mess, but not counted this month.</p>
          </header>
          {notInMonth.map((person) => renderRow(person, { quickAdd: true }))}
        </section>
      ) : null}

      {inactive.length ? (
        <section className="panel people-group people-group--muted">
          <header>
            <h3>Inactive</h3>
            <p>Can’t open this mess until reactivated.</p>
          </header>
          {inactive.map((person) => renderRow(person))}
        </section>
      ) : null}

      {inviteOpen ? (
        <InviteSheet currentCycle={currentCycle} currentMess={currentMess} member={member} onClose={() => setInviteOpen(false)} setMessage={setMessage} />
      ) : null}

      {openPerson ? (
        <PersonSheet
          activeAdminCount={activeAdminCount}
          inMonth={includedIds.includes(openPerson.id)}
          isSelf={openPerson.id === member.id}
          onAskConfirm={setConfirm}
          onChangeRole={changeRole}
          onClose={() => setOpenId("")}
          onDelete={deletePerson}
          onSetActive={setActive}
          onSetInMonth={setInMonth}
          person={openPerson}
          row={ledger[openPerson.id]}
          setMessage={setMessage}
        />
      ) : null}

      <ConfirmModal
        confirmLabel={confirm?.confirmLabel || "Confirm"}
        message={confirm?.message || ""}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          const action = confirm?.action;
          setConfirm(null);
          if (action) await action();
        }}
        open={Boolean(confirm)}
        title={confirm?.title || ""}
      />
    </div>
  );
}

function PersonSheet({ activeAdminCount: adminCount, inMonth: isInMonth, isSelf, onAskConfirm, onChangeRole, onClose, onDelete, onSetActive, onSetInMonth, person, row, setMessage: notify }) {
  const [name, setName] = useState(person.name || "");
  const lastAdmin = person.role === "admin" && person.active && adminCount <= 1;

  useEffect(() => {
    setName(person.name || "");
  }, [person.name]);

  async function saveName(event) {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName || nextName === person.name) return;
    await updateRecord("members", person.id, { name: nextName });
    notify("Name updated.");
    trackEvent("member_name_updated", { own_profile: isSelf });
  }

  return (
    <Sheet title={person.name} onClose={onClose}>
      <div className="person-sheet">
        <div className="person-sheet__head">
          <span className="person-row__avatar person-row__avatar--lg" aria-hidden="true">
            {initialOf(person.name)}
          </span>
          <div>
            <strong>{person.email}</strong>
            <span>
              {person.active ? "Active" : "Inactive"} · {isInMonth ? "in this month" : "not in this month"}
            </span>
          </div>
        </div>

        {row && isInMonth ? (
          <div className="person-sheet__stats">
            <div>
              <span>Meals</span>
              <strong>{Number(row.mealCount || 0).toFixed(1)}</strong>
            </div>
            <div>
              <span>Paid</span>
              <strong>{formatTk(row.deposits || 0)}</strong>
            </div>
            <div>
              <span>{Number(row.balance || 0) < 0 ? "To pay" : "Balance"}</span>
              <strong className={Number(row.balance || 0) < 0 ? "is-due" : "is-credit"}>{formatTk(Math.abs(Number(row.balance || 0)))}</strong>
            </div>
          </div>
        ) : null}

        <form className="person-sheet__name" onSubmit={saveName}>
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <button className="secondary" disabled={!name.trim() || name.trim() === person.name} type="submit">
            Save
          </button>
        </form>

        <div className="field-block">
          <span className="field-label">Role</span>
          <div className="role-options" role="radiogroup" aria-label="Role">
            {ROLES.map((role) => (
              <button
                aria-checked={person.role === role.id}
                className={person.role === role.id ? "role-option active" : "role-option"}
                disabled={lastAdmin && role.id !== "admin"}
                key={role.id}
                role="radio"
                type="button"
                onClick={() => onChangeRole(person, role.id)}
              >
                <strong>{role.label}</strong>
                <small>{role.hint}</small>
              </button>
            ))}
          </div>
          {lastAdmin ? <p className="money-form__hint">This is the only admin, so the role can’t change.</p> : null}
        </div>

        <div className="person-sheet__actions">
          {person.active ? (
            isInMonth ? (
              <button
                className="action-row"
                type="button"
                onClick={() =>
                  onAskConfirm({
                    title: `Remove ${person.name} from this month?`,
                    message: "Their meals and deposits this month will stop counting in balances. You can add them back later and it all counts again.",
                    confirmLabel: "Remove from month",
                    action: () => onSetInMonth(person, false),
                  })
                }
              >
                <CalendarX size={20} />
                <span>
                  <strong>Remove from this month</strong>
                  <small>Stop counting them in meals and balances</small>
                </span>
              </button>
            ) : (
              <button className="action-row" type="button" onClick={() => onSetInMonth(person, true)}>
                <CalendarCheck size={20} />
                <span>
                  <strong>Add to this month</strong>
                  <small>Count their meals and deposits</small>
                </span>
              </button>
            )
          ) : null}

          {person.active ? (
            <button
              className="action-row"
              disabled={lastAdmin || isSelf}
              type="button"
              onClick={() =>
                onAskConfirm({
                  title: `Deactivate ${person.name}?`,
                  message: "They won’t be able to open this mess until you activate them again. Their records stay.",
                  confirmLabel: "Deactivate",
                  action: () => onSetActive(person, false),
                })
              }
            >
              <UserX size={20} />
              <span>
                <strong>Deactivate</strong>
                <small>{isSelf ? "You can’t deactivate yourself" : lastAdmin ? "Keep at least one active admin" : "Block access, keep their records"}</small>
              </span>
            </button>
          ) : (
            <button className="action-row" type="button" onClick={() => onSetActive(person, true)}>
              <UserCheck size={20} />
              <span>
                <strong>Activate</strong>
                <small>Let them open this mess again</small>
              </span>
            </button>
          )}

          <button
            className="action-row action-row--danger"
            disabled={person.role === "admin" || isSelf}
            type="button"
            onClick={() =>
              onAskConfirm({
                title: `Delete ${person.name}?`,
                message: `${person.name} will be removed from this mess and this month. Old saved records stay as they are.`,
                confirmLabel: "Delete person",
                action: () => onDelete(person),
              })
            }
          >
            <Trash2 size={20} />
            <span>
              <strong>Delete from mess</strong>
              <small>{person.role === "admin" ? "Make them a member first" : "Remove them for good"}</small>
            </span>
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function InviteSheet({ currentCycle, currentMess, member, onClose, setMessage }) {
  const [role, setRole] = useState("member");
  const [link, setLink] = useState("");
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  async function createLink() {
    try {
      setCreating(true);
      setCopied(false);
      const activeMessId = currentMess?.id || member.messId || currentCycle?.messId;
      if (!activeMessId) throw new Error("No mess is selected. Refresh once and try again.");
      const token = await createInvite({ messId: activeMessId, messName: currentMess?.name || "", role, createdBy: member.id });
      const nextLink = `${window.location.origin}${window.location.pathname}?invite=${token}`;
      setLink(nextLink);
      trackEvent("invite_created", { role, copied: false });
    } catch (error) {
      console.error("Invite creation failed", error);
      setMessage(error.code === "permission-denied" ? "Couldn’t make the invite link. Please refresh and try again." : error.message);
      trackEvent("invite_create_failed", { error_code: error.code || "unknown", role });
    } finally {
      setCreating(false);
    }
  }

  async function copyLink() {
    const ok = await copyToClipboard(link);
    setCopied(ok);
    trackEvent("invite_copied", { copied: ok });
  }

  async function shareLink() {
    const text = `Join ${currentMess?.name || "our mess"} on Pakhir Basa: ${link}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Join our mess", text, url: link });
        trackEvent("invite_shared", { method: "share_sheet" });
        return;
      }
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
    await copyLink();
  }

  return (
    <Sheet title="Invite someone" onClose={onClose}>
      <div className="invite-sheet">
        {!link ? (
          <>
            <p className="money-form__hint">Make a one-time link. The person opens it, signs in with Google, and joins this mess.</p>
            <div className="role-options" role="radiogroup" aria-label="Join as">
              {ROLES.map((item) => (
                <button aria-checked={role === item.id} className={role === item.id ? "role-option active" : "role-option"} key={item.id} role="radio" type="button" onClick={() => setRole(item.id)}>
                  <strong>Join as {item.label.toLowerCase()}</strong>
                  <small>{item.hint}</small>
                </button>
              ))}
            </div>
            <button className="primary money-form__submit" disabled={creating} type="button" onClick={createLink}>
              <Link2 size={18} /> {creating ? "Making link…" : "Create invite link"}
            </button>
          </>
        ) : (
          <>
            <div className="invite-sheet__ready">
              <strong>Link ready</strong>
              <span>Works once. They’ll join as {role === "admin" ? "an admin" : "a member"}.</span>
              <input aria-label="Invite link" readOnly value={link} onFocus={(event) => event.target.select()} />
            </div>
            <div className="entry-detail__actions">
              <button className="primary" type="button" onClick={shareLink}>
                <Share2 size={18} /> Share
              </button>
              <button className="secondary" type="button" onClick={copyLink}>
                <Copy size={18} /> {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="money-form__hint">After they join, they show up under “Not in this month” — tap Add to count them.</p>
          </>
        )}
      </div>
    </Sheet>
  );
}
