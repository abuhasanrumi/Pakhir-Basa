import { Copy, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { trackEvent, trackFormError } from "../analytics";
import { ConfirmModal } from "../components/ConfirmModal.jsx";
import { createInvite, deleteRecord, updateRecord } from "../firebase";
import { copyToClipboard } from "../lib/actions";

export function Members({ currentCycle, currentMess, cycleMembers, member, members, setCurrentCycle, setMessage }) {
  const [form, setForm] = useState({ role: "member" });
  const [inviteLink, setInviteLink] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [cycleMemberToAdd, setCycleMemberToAdd] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const householdActiveMembers = members.filter((item) => item.active);
  const includedIds = currentCycle?.memberIds || [];
  const availableForCycle = householdActiveMembers.filter((person) => !includedIds.includes(person.id));
  const activeAdminCount = members.filter((person) => person.active && person.role === "admin").length;

  async function submitMember(event) {
    event.preventDefault();
    try {
      setCreatingInvite(true);
      setInviteCopied(false);
      const activeMessId = currentMess?.id || member.messId || currentCycle?.messId;
      if (!activeMessId) throw new Error("No mess is selected. Refresh once and try again.");
      const token = await createInvite({ messId: activeMessId, messName: currentMess?.name || "", role: form.role, createdBy: member.id });
      const link = `${window.location.origin}${window.location.pathname}?invite=${token}`;
      setInviteLink(link);
      const copied = await copyToClipboard(link);
      setInviteCopied(copied);
      setMessage(copied ? "Invite link is ready and copied." : "Invite link is ready. Copy it below.");
      trackEvent("invite_created", { role: form.role, copied });
    } catch (error) {
      console.error("Invite creation failed", error);
      setMessage(error.code === "permission-denied" ? "Couldn’t make the invite link. Please refresh and try again." : error.message);
      trackEvent("invite_create_failed", { error_code: error.code || "unknown", role: form.role });
    } finally {
      setCreatingInvite(false);
    }
  }

  async function copyInviteLink() {
    if (!inviteLink) return;
    const copied = await copyToClipboard(inviteLink);
    setInviteCopied(copied);
    setMessage(copied ? "Invite link copied." : "Couldn’t auto-copy. Select the link and copy it manually.");
    trackEvent("invite_copied", { copied });
  }

  async function addMemberToCycle(memberId) {
    const nextMemberIds = [...new Set([...includedIds, memberId])];
    await updateRecord("cycles", currentCycle.id, { memberIds: nextMemberIds });
    setCurrentCycle({ ...currentCycle, memberIds: nextMemberIds });
    setCycleMemberToAdd("");
    setMessage("Person added to this month.");
    trackEvent("cycle_member_added", { member_count: nextMemberIds.length });
  }

  async function deleteMemberFromWorkspace() {
    if (!deleteTarget) return;
    if (deleteTarget.role === "admin") {
      setDeleteTarget(null);
      trackFormError("delete_member", "admin_locked");
      return setMessage("Admins can’t be deleted. Change their role first.");
    }

    const nextMemberIds = includedIds.filter((id) => id !== deleteTarget.id);
    if (nextMemberIds.length !== includedIds.length) {
      await updateRecord("cycles", currentCycle.id, { memberIds: nextMemberIds });
      setCurrentCycle({ ...currentCycle, memberIds: nextMemberIds });
    }

    await deleteRecord("members", deleteTarget.id);
    setDeleteTarget(null);
    setMessage("Person removed from this mess.");
    trackEvent("member_deleted", { was_in_current_cycle: includedIds.includes(deleteTarget.id) });
  }

  async function changeMemberRole(person, role) {
    if (person.role === "admin" && role !== "admin" && activeAdminCount <= 1) {
      trackFormError("member_role", "last_admin");
      return setMessage("Keep at least one active admin.");
    }
    await updateRecord("members", person.id, { role });
    trackEvent("member_role_changed", { from_role: person.role, to_role: role });
  }

  async function toggleMemberActive(person) {
    if (person.active && person.role === "admin" && activeAdminCount <= 1) {
      trackFormError("member_active_toggle", "last_admin");
      return setMessage("Keep at least one active admin.");
    }
    await updateRecord("members", person.id, { active: !person.active });
    trackEvent(person.active ? "member_deactivated" : "member_activated", { role: person.role });
  }

  return (
    <div className="two-column">
      <section className="panel">
        <div className="section-heading">
          <h2>Invite someone</h2>
          <p>Make a one-time link for the next housemate. Pick their role first.</p>
        </div>
        <form className="form-grid" onSubmit={submitMember}>
          <label>
            Role
            <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button className="primary" disabled={creatingInvite} type="submit">
            <Plus size={18} /> {creatingInvite ? "Creating..." : "Create invite link"}
          </button>
          {inviteLink ? (
            <div className="invite-result">
              <div>
                <strong>{inviteCopied ? "Copied. Send it now." : "Share this invite link."}</strong>
                <span>{form.role === "admin" ? "The next person will join as admin." : "The next person will join as member."}</span>
              </div>
              <div className="invite-link-row">
                <input aria-label="Invite link" readOnly value={inviteLink} onFocus={(event) => event.target.select()} />
                <button className="secondary" type="button" onClick={copyInviteLink}>
                  <Copy size={16} /> Copy
                </button>
              </div>
            </div>
          ) : null}
        </form>
      </section>
      <section className="panel">
        <div className="section-heading">
          <h2>People in this mess</h2>
          <p>Manage roles, access, and who counts this month.</p>
        </div>
        <div className="cycle-member-manager">
          <div className="cycle-member-manager__header">
            <div>
              <span className="eyebrow">This month</span>
              <p>Only these people count in meals, deposits, and balances.</p>
            </div>
            <span className="cycle-member-count">{includedIds.length} picked</span>
          </div>
          <div className="cycle-member-pills">
            {cycleMembers.map((person) => (
              <span key={person.id}>{person.name}</span>
            ))}
          </div>
          {availableForCycle.length ? (
            <div className="cycle-member-add">
              <label>
                Add person
                <select value={cycleMemberToAdd} onChange={(event) => setCycleMemberToAdd(event.target.value)}>
                  <option value="">Choose someone</option>
                  {availableForCycle.map((person) => (
                    <option key={person.id} value={person.id}>{person.name}</option>
                  ))}
                </select>
              </label>
              <button className="secondary" disabled={!cycleMemberToAdd} type="button" onClick={() => addMemberToCycle(cycleMemberToAdd)}>
                <Plus size={16} /> Add to month
              </button>
            </div>
          ) : (
            <p className="cycle-member-complete">Everyone active is already in this month.</p>
          )}
        </div>
        <div className="entry-list">
          {members.map((person) => (
            <article className="entry-row member-row" key={person.id}>
              <div className="member-row__info">
                <MemberNameEditor person={person} setMessage={setMessage} />
                <span>{person.email}</span>
                <small>
                  {person.role} · {person.active ? "active" : "inactive"}
                </small>
              </div>
              <div className="member-row__actions">
                <select value={person.role} onChange={(event) => changeMemberRole(person, event.target.value)}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <button className="secondary" onClick={() => toggleMemberActive(person)}>
                  {person.active ? "Deactivate" : "Activate"}
                </button>
                <button
                  className="delete-member-button"
                  disabled={person.role === "admin"}
                  title={person.role === "admin" ? "Admins can’t be deleted while they are admin" : "Delete person"}
                  onClick={() => setDeleteTarget(person)}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      <ConfirmModal
        confirmLabel="Delete person"
        message={deleteTarget ? `${deleteTarget.name} will be removed from this mess and this month. Old saved records will stay as they are.` : ""}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={deleteMemberFromWorkspace}
        open={Boolean(deleteTarget)}
        title="Delete this person?"
      />
    </div>
  );
}

export function MemberNameEditor({ person, setMessage }) {
  const [name, setName] = useState(person.name || "");

  useEffect(() => {
    setName(person.name || "");
  }, [person.name]);

  async function saveName() {
    const nextName = name.trim();
    if (!nextName || nextName === person.name) return;
    await updateRecord("members", person.id, { name: nextName });
    setMessage("Name updated.");
    trackEvent("member_name_updated", { own_profile: false });
  }

  return (
    <input
      className="inline-name-input"
      value={name}
      onBlur={saveName}
      onChange={(event) => setName(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}
