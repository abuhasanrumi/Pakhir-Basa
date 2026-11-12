import { Check, Plus, Users, X } from "lucide-react";
import { useState } from "react";

export function MessSwitcher({ currentMemberId, currentMess, memberships, onCreateMess, onSwitchMess, readOnly = false }) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [messName, setMessName] = useState("My New Mess");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const currentMembership = memberships.find((item) => item.id === currentMemberId);

  async function submitNewMess(event) {
    event.preventDefault();
    if (!onCreateMess || saving) return;
    try {
      setSaving(true);
      setError("");
      await onCreateMess(messName.trim() || "My New Mess");
      setCreating(false);
      setOpen(false);
      setMessName("My New Mess");
    } catch (createError) {
      setError(createError.message || "Couldn’t create the mess. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mess-quick-switch">
      <div className="mess-quick-switch__copy">
        <span>Mess</span>
        <strong>{currentMess?.name || currentMembership?.messName || "This mess"}</strong>
      </div>
      <button className="mess-icon-button" disabled={readOnly} title="Switch or create mess" type="button" onClick={() => setOpen(true)}>
        <Users size={17} />
      </button>
      {open ? (
        <div className="modal-backdrop modal-backdrop--soft" role="presentation" onMouseDown={() => setOpen(false)}>
          <div className="modal-card mess-switch-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading mess-switch-modal__heading">
              <div>
                <h2>Your messes</h2>
                <p>Pick where you want to work now.</p>
              </div>
              <button className="icon-button mess-switch-modal__close" type="button" title="Close" onClick={() => setOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="mess-current-strip">
              <span>Current</span>
              <strong>{currentMess?.name || currentMembership?.messName || "This mess"}</strong>
            </div>
            <div className="mess-choice-list">
              {memberships.map((membership) => (
                <button
                  className={membership.id === currentMemberId ? "mess-choice active" : "mess-choice"}
                  disabled={membership.id === currentMemberId}
                  key={membership.id}
                  type="button"
                  onClick={async () => {
                    await onSwitchMess(membership.id);
                    setOpen(false);
                  }}
                >
                  <span className="mess-choice__mark">
                    {membership.id === currentMemberId ? <Check size={17} /> : <Users size={17} />}
                  </span>
                  <div>
                    <strong>{membership.messName || "Unnamed mess"}</strong>
                    <span>{membership.role === "admin" ? "Admin access" : "Member access"}</span>
                  </div>
                  {membership.id === currentMemberId ? <small>Active</small> : <small>Open</small>}
                </button>
              ))}
            </div>
            {creating ? (
              <form className="mess-create-inline" onSubmit={submitNewMess}>
                <label>
                  Mess name
                  <input autoFocus value={messName} onChange={(event) => setMessName(event.target.value)} />
                </label>
                {error ? <p className="modal-error">{error}</p> : null}
                <div className="modal-actions">
                  <button className="secondary" disabled={saving} type="button" onClick={() => setCreating(false)}>Cancel</button>
                  <button className="primary" disabled={saving} type="submit">
                    <Plus size={18} /> {saving ? "Creating..." : "Create mess"}
                  </button>
                </div>
              </form>
            ) : (
              <button className="mess-create-wide" type="button" onClick={() => setCreating(true)}>
                <span><Plus size={18} /></span>
                <div>
                  <strong>Create another mess</strong>
                  <small>You’ll be admin of the new mess.</small>
                </div>
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
