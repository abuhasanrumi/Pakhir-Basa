import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { Banknote, CalendarCheck, Check, LogOut, Menu, Plus, Soup, Wallet, X } from "lucide-react";
import { useEffect, useState } from "react";
import { trackEvent, trackFormError } from "../analytics";
import { DateInput } from "../components/DateInput.jsx";
import { MessSwitcher } from "../components/MessSwitcher.jsx";
import { OfflineBanner } from "../components/StatusScreens.jsx";
import { addRecord, db } from "../firebase";
import { trackedSignOut } from "../lib/actions";
import { today } from "../lib/format";
import { History } from "./History.jsx";

export function NoCycleScreen({ currentMess, cycles, isAdmin, isOnline, member, memberships, members, onCreateMess, onRetryConnection, onSwitchMess, readOnlyMode, selectedHistoryCycleId, serverDataReady, setCurrentCycle, setMessage, setMobileSidebarOpen, setSelectedHistoryCycleId, sidebarOpen, user }) {
  const selectableMembers = members
    .filter((item) => item.active)
    .sort((left, right) => {
      if (left.id === member.id) return -1;
      if (right.id === member.id) return 1;
      return String(left.name || left.email).localeCompare(String(right.name || right.email));
    });
  const [sidebarView, setSidebarView] = useState(selectedHistoryCycleId ? "history" : "create");
  const [form, setForm] = useState({
    name: new Date().toLocaleString("en", { month: "long", year: "numeric" }),
    startDate: today(),
    rateMode: "static",
    mealRate: 70,
    memberIds: [],
  });

  useEffect(() => {
    setForm((current) => {
      if (current.memberIds.length || !selectableMembers.length) return current;
      return { ...current, memberIds: selectableMembers.some((person) => person.id === member.id) ? [member.id] : [selectableMembers[0].id] };
    });
  }, [member.id, selectableMembers]);

  function toggleCycleMember(memberId) {
    if (memberId === member.id) return;
    setForm((current) => {
      const hasMember = current.memberIds.includes(memberId);
      return {
        ...current,
        memberIds: hasMember ? current.memberIds.filter((id) => id !== memberId) : [...current.memberIds, memberId],
      };
    });
  }

  async function startCycle(event) {
    event.preventDefault();
    if (!form.memberIds.length) {
      trackFormError("start_cycle", "no_members");
      return setMessage("Pick at least one person for this month.");
    }
    const activeMessId = currentMess?.id || member.messId;
    const cycle = {
      messId: activeMessId,
      name: form.name || "Current Month",
      status: "open",
      startDate: form.startDate,
      mealRateMode: form.rateMode,
      mealRate: Number(form.mealRate) || 70,
      memberIds: form.memberIds,
      createdBy: member.id,
    };
    const ref = await addRecord("cycles", cycle);
    const createdCycle = { id: ref.id, ...cycle };
    await setDoc(
      doc(db, "settings", `${activeMessId}_main`),
      {
        messId: activeMessId,
        mealRate: cycle.mealRate,
        mealRateMode: cycle.mealRateMode,
        mealRateMethod: cycle.mealRateMode,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    setCurrentCycle(createdCycle);
    setSelectedHistoryCycleId(createdCycle.id);
    setMobileSidebarOpen(false);
    setMessage("New month started.");
    trackEvent("cycle_created", {
      meal_rate_mode: cycle.mealRateMode,
      member_count: cycle.memberIds.length,
      meal_rate: cycle.mealRate,
    });
  }

  return (
    <div className="app">
      <button
        className="sidebar-toggle"
        type="button"
        aria-label={sidebarOpen ? "Close menu" : "Open menu"}
        aria-expanded={sidebarOpen}
        onClick={() => setMobileSidebarOpen((current) => !current)}
      >
        {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
      </button>
      {sidebarOpen ? <div className="sidebar-backdrop" role="presentation" onClick={() => setMobileSidebarOpen(false)} /> : null}
      <aside className={sidebarOpen ? "sidebar sidebar--open" : "sidebar"}>
        <div className="brand">
          <div className="brand-mark">PB</div>
          <div>
            <strong>{currentMess?.name || "Pakhir Basa"}</strong>
            <span>Meal Tracker</span>
          </div>
        </div>
        {isAdmin ? (
          <nav className="nav no-cycle-nav">
            <button className={sidebarView === "create" ? "nav-item active" : "nav-item"} onClick={() => { setSidebarView("create"); setMobileSidebarOpen(false); }}>
              <Plus size={18} />
              <span>New month</span>
            </button>
            <button className={sidebarView === "history" ? "nav-item active" : "nav-item"} onClick={() => { setSidebarView("history"); setMobileSidebarOpen(false); }}>
              <Banknote size={18} />
              <span>Old months</span>
              {cycles.filter((cycle) => cycle.status === "closed").length ? <b>{cycles.filter((cycle) => cycle.status === "closed").length}</b> : null}
            </button>
          </nav>
        ) : null}
        <MessSwitcher currentMemberId={member.id} currentMess={currentMess} memberships={memberships} onCreateMess={onCreateMess} onSwitchMess={onSwitchMess} readOnly={readOnlyMode} />
        <div className="profile">
          <img src={user.photoURL} alt="" />
          <div>
            <strong>{member.name}</strong>
            <span>{member.role}</span>
          </div>
          <button className="icon-button" title="Sign out" onClick={trackedSignOut}>
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <main className="main no-cycle-main">
        {readOnlyMode ? <OfflineBanner isOnline={isOnline} onRetry={onRetryConnection} serverDataReady={serverDataReady} /> : null}
        {isAdmin && sidebarView === "history" ? (
          <History cycles={cycles} selectedCycleId={selectedHistoryCycleId} onSelectCycle={setSelectedHistoryCycleId} />
        ) : (
          <section className="panel no-cycle-panel">
            <div className="no-cycle-hero">
              <div className="no-cycle-hero__copy">
                <span className="eyebrow">Month setup</span>
                <h2>No month is running</h2>
                <p>{isAdmin ? "Start a month when everyone is ready to track meals and money." : "You’ll see the month here once an admin starts it."}</p>
              </div>
              <div className="no-cycle-hero__badge">
                <CalendarCheck size={18} />
                <span>Ready when you are</span>
              </div>
            </div>

            <div className="no-cycle-overview">
              <article>
                <Soup size={18} />
                <strong>Meals</strong>
                <span>Add lunch and dinner for each day.</span>
              </article>
              <article>
                <Wallet size={18} />
                <strong>Deposits</strong>
                <span>Keep everyone’s advance money clear.</span>
              </article>
              <article>
                <Banknote size={18} />
                <strong>Old months</strong>
                <span>Check previous months after closing them.</span>
              </article>
            </div>

            {isAdmin ? (
              <form className="form-grid no-cycle-form" onSubmit={startCycle}>
                <label>
                  Month name
                  <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
                </label>
                <label>
                  Start date
                  <DateInput label="Start date" value={form.startDate} onChange={(startDate) => setForm({ ...form, startDate })} />
                </label>
                <label>
                  Meal rate type
                  <select value={form.rateMode} onChange={(event) => setForm({ ...form, rateMode: event.target.value })}>
                    <option value="static">Fixed meal rate</option>
                    <option value="calculated">Calculate from bazaar</option>
                  </select>
                </label>
                <label>
                  Default meal rate
                  <input min="1" type="number" value={form.mealRate} onChange={(event) => setForm({ ...form, mealRate: event.target.value })} />
                </label>
                <div className="cycle-member-picker">
                  <div>
                    <strong>People for this month</strong>
                    <span>Only these people will count in meals, deposits, and balances.</span>
                  </div>
                  <div className="member-picker">
                    {selectableMembers.map((person) => (
                      <button
                        className={form.memberIds.includes(person.id) ? "chip selected" : "chip"}
                        key={person.id}
                        disabled={person.id === member.id}
                        type="button"
                        onClick={() => toggleCycleMember(person.id)}
                      >
                        {form.memberIds.includes(person.id) ? <Check size={15} /> : null}
                        <span>{person.name}</span>
                        {person.id === member.id ? <small>Admin</small> : null}
                      </button>
                    ))}
                  </div>
                </div>
                <button className="primary no-cycle-form__submit" type="submit">
                  <Plus size={18} /> Start month
                </button>
              </form>
            ) : null}
          </section>
        )}
      </main>
    </div>
  );
}
