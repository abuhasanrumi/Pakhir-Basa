import { Check, Plus } from "lucide-react";
import { useState } from "react";
import { trackEvent } from "../analytics";
import { createMess, getMess, joinInvite } from "../firebase";
import { trackedSignOut } from "../lib/actions";

export function MessSetupScreen({ inviteToken, message, setCurrentMess, setMember, setMemberships, setMessage, user }) {
  const [messName, setMessName] = useState("My Mess");
  const [joining, setJoining] = useState(false);
  const [creating, setCreating] = useState(false);

  async function handleCreateMess(event) {
    event.preventDefault();
    try {
      setCreating(true);
      const { mess, member: createdMember } = await createMess({ name: messName, user });
      setCurrentMess(mess);
      setMember(createdMember);
      setMemberships([createdMember]);
      setMessage("Mess created. You’re the admin for this mess.");
      trackEvent("mess_created", { source: inviteToken ? "invite_screen" : "setup_screen" });
    } catch (error) {
      trackEvent("mess_create_failed", { error_code: error.code || "unknown" });
      setMessage(error.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleJoinInvite() {
    if (!inviteToken) return;
    try {
      setJoining(true);
      const joinedMember = await joinInvite({ token: inviteToken, user });
      const mess = await getMess(joinedMember.messId);
      setCurrentMess(mess);
      setMember(joinedMember);
      setMemberships([joinedMember]);
      window.history.replaceState({}, document.title, window.location.pathname);
      setMessage(`Joined ${mess?.name || "mess"}.`);
      trackEvent("invite_joined_from_setup", { role: joinedMember.role });
    } catch (error) {
      trackEvent("invite_join_failed", { error_code: error.code || "unknown" });
      setMessage(error.message);
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="center-screen setup">
      <div className="setup-card mess-setup-card">
        <div className="loading-brand">
          <div className="loading-brand__mark">PB</div>
          <div>
            <strong>Pakhir Basa</strong>
            <span>Meal Tracker</span>
          </div>
        </div>
        <div>
          <h1>Start or join a mess</h1>
          <p>Create your own mess, or join one with an invite link from a housemate.</p>
        </div>
        {message ? <div className="notice">{message}</div> : null}
        {inviteToken ? (
          <button className="primary" disabled={joining} type="button" onClick={handleJoinInvite}>
            <Check size={18} /> {joining ? "Joining..." : "Join from invite"}
          </button>
        ) : null}
        <form className="form-grid" onSubmit={handleCreateMess}>
          <label>
            Mess name
            <input value={messName} onChange={(event) => setMessName(event.target.value)} />
          </label>
          <button className="primary" disabled={creating} type="submit">
            <Plus size={18} /> {creating ? "Creating..." : "Start a new mess"}
          </button>
        </form>
        <button className="secondary" type="button" onClick={trackedSignOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}
