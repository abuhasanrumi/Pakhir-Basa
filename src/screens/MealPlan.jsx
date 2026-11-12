import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { Clock, Lock, Minus, Moon, Plus, Share2, Sun, UserPlus } from "lucide-react";
import { useState } from "react";
import { trackEvent } from "../analytics";
import { Sheet } from "../components/Sheet.jsx";
import { db } from "../firebase";
import { copyToClipboard } from "../lib/actions";
import { logActivity } from "../lib/activity";
import { formatDisplayDate, today } from "../lib/format";
import { cutoffsOf, dayPlan, defaultsOf, formatCutoff, headcount, isLocked, planFor, shortDayLabel, upcomingDates } from "../lib/mealPlans";

const SESSION_INFO = {
  lunch: { label: "Lunch", icon: Sun },
  dinner: { label: "Dinner", icon: Moon },
};

export async function savePlan({ currentCycle, date, defaults, editor, isAdmin, person, values }) {
  const payload = {
    messId: currentCycle.messId,
    memberId: person.id,
    memberName: person.name,
    updatedBy: editor.id,
    updatedAt: serverTimestamp(),
  };
  if (defaults) payload.defaults = defaults;
  if (date && values) payload.days = { [date]: values };
  await setDoc(doc(db, "mealPlans", person.id), payload, { merge: true });
  const who = person.id === editor.id ? "" : ` for ${person.name}`;
  if (defaults) {
    logActivity({
      cycleId: currentCycle.id,
      kind: "plan",
      member: editor,
      messId: currentCycle.messId,
      summary: `Set usual meals${who}: lunch ${defaults.lunch ? "on" : "off"}, dinner ${defaults.dinner ? "on" : "off"}`,
    });
  } else {
    const parts = ["lunch", "dinner"].map((session) => {
      const guests = values[`${session}Guests`] || 0;
      return `${session} ${values[session] ? "on" : "off"}${guests ? ` +${guests} guest${guests === 1 ? "" : "s"}` : ""}`;
    });
    logActivity({
      cycleId: currentCycle.id,
      kind: "plan",
      member: editor,
      messId: currentCycle.messId,
      summary: `${formatDisplayDate(date)}${who}: ${parts.join(", ")}`,
    });
  }
  trackEvent(defaults ? "meal_plan_defaults_saved" : "meal_plan_day_saved", { by_admin: isAdmin && person.id !== editor.id });
}

export function MealPlan({ activeMembers, currentCycle, isAdmin, member, plans, settings, setMessage }) {
  const [personId, setPersonId] = useState(member.id);
  const [openDate, setOpenDate] = useState("");
  const person = activeMembers.find((item) => item.id === personId) || member;
  const plan = planFor(plans, person.id);
  const defaults = defaultsOf(plan);
  const cutoffs = cutoffsOf(settings);
  const dates = upcomingDates(7);
  const canBypassCutoff = isAdmin;

  async function save(args) {
    try {
      await savePlan({ currentCycle, editor: member, isAdmin, person, ...args });
    } catch (error) {
      console.error("Plan save failed", error);
      setMessage(error.code === "permission-denied" ? "Couldn’t save this. Please refresh and try again." : error.message);
    }
  }

  function toggleSession(date, session) {
    if (isLocked(date, session, settings) && !canBypassCutoff) {
      setMessage(`${SESSION_INFO[session].label} for ${shortDayLabel(date).toLowerCase()} is locked after ${formatCutoff(cutoffs[session])}.`);
      return;
    }
    const current = dayPlan(plan, date);
    save({ date, values: { lunch: current.lunch, dinner: current.dinner, lunchGuests: current.lunchGuests, dinnerGuests: current.dinnerGuests, [session]: current[session] > 0 ? 0 : 1 } });
  }

  return (
    <div className="plan-screen">
      {isAdmin ? (
        <div className="chip-row plan-people" role="radiogroup" aria-label="Whose plan">
          {activeMembers.map((item) => (
            <button aria-checked={item.id === person.id} className={item.id === person.id ? "chip person-chip active" : "chip person-chip"} key={item.id} role="radio" type="button" onClick={() => setPersonId(item.id)}>
              <span aria-hidden="true">{item.name?.[0]?.toUpperCase()}</span>
              {item.id === member.id ? "You" : item.name}
            </button>
          ))}
        </div>
      ) : null}

      <section className="panel plan-defaults">
        <header>
          <h3>{person.id === member.id ? "Your usual meals" : `${person.name}’s usual meals`}</h3>
          <p>Every day starts like this. Change single days below.</p>
        </header>
        <div className="plan-defaults__row">
          {["lunch", "dinner"].map((session) => {
            const Icon = SESSION_INFO[session].icon;
            const on = defaults[session] > 0;
            return (
              <button aria-pressed={on} className={on ? "plan-switch on" : "plan-switch"} key={session} type="button" onClick={() => save({ defaults: { ...defaults, [session]: on ? 0 : 1 } })}>
                <Icon size={20} />
                <span>
                  <strong>{SESSION_INFO[session].label}</strong>
                  <small>{on ? "On every day" : "Off by default"}</small>
                </span>
                <i aria-hidden="true" className="plan-switch__knob" />
              </button>
            );
          })}
        </div>
      </section>

      <section className="panel plan-days">
        <header>
          <h3>Next 7 days</h3>
          <p>
            <Clock size={13} /> Changes close at {formatCutoff(cutoffs.lunch)} for lunch and {formatCutoff(cutoffs.dinner)} for dinner.
          </p>
        </header>
        {dates.map((date) => {
          const day = dayPlan(plan, date);
          return (
            <div className="plan-day" key={date}>
              <div className="plan-day__label">
                <strong>{shortDayLabel(date)}</strong>
                <small>{date === today() || shortDayLabel(date) === "Tomorrow" ? formatDisplayDate(date).replace(/,? \d{4}$/, "") : day.changed ? "Changed" : "Usual"}</small>
              </div>
              {["lunch", "dinner"].map((session) => {
                const on = day[session] > 0;
                const guests = day[`${session}Guests`];
                const locked = isLocked(date, session, settings);
                const Icon = SESSION_INFO[session].icon;
                return (
                  <button
                    aria-label={`${SESSION_INFO[session].label} ${shortDayLabel(date)}: ${on ? "on" : "off"}${guests ? `, ${guests} guests` : ""}${locked ? ", locked" : ""}`}
                    aria-pressed={on}
                    className={`plan-pill${on ? " on" : ""}${locked ? " locked" : ""}`}
                    disabled={locked && !canBypassCutoff}
                    key={session}
                    type="button"
                    onClick={() => toggleSession(date, session)}
                  >
                    {locked ? <Lock size={13} /> : <Icon size={14} />}
                    <span>{on ? "On" : "Off"}</span>
                    {guests ? <b>+{guests}</b> : null}
                  </button>
                );
              })}
              <button aria-label={`Guests and details for ${shortDayLabel(date)}`} className="plan-day__more" type="button" onClick={() => setOpenDate(date)}>
                <UserPlus size={17} />
              </button>
            </div>
          );
        })}
      </section>

      {isAdmin ? <CutoffSettings currentCycle={currentCycle} member={member} setMessage={setMessage} settings={settings} /> : null}

      {openDate ? (
        <DaySheet
          canBypassCutoff={canBypassCutoff}
          date={openDate}
          onClose={() => setOpenDate("")}
          onSave={async (values) => {
            await save({ date: openDate, values });
            setOpenDate("");
            setMessage(`${person.id === member.id ? "Your" : `${person.name}’s`} meals for ${shortDayLabel(openDate).toLowerCase()} are saved.`);
          }}
          plan={plan}
          settings={settings}
        />
      ) : null}
    </div>
  );
}

function DaySheet({ canBypassCutoff, date, onClose, onSave, plan, settings }) {
  const initial = dayPlan(plan, date);
  const [values, setValues] = useState({ lunch: initial.lunch, dinner: initial.dinner, lunchGuests: initial.lunchGuests, dinnerGuests: initial.dinnerGuests });
  const [saving, setSaving] = useState(false);
  const cutoffs = cutoffsOf(settings);

  return (
    <Sheet title={`${shortDayLabel(date)} · ${formatDisplayDate(date)}`} onClose={onClose}>
      <div className="day-sheet">
        {["lunch", "dinner"].map((session) => {
          const locked = isLocked(date, session, settings) && !canBypassCutoff;
          const Icon = SESSION_INFO[session].icon;
          const guestsKey = `${session}Guests`;
          return (
            <section className={locked ? "day-sheet__session locked" : "day-sheet__session"} key={session}>
              <header>
                <Icon size={18} />
                <strong>{SESSION_INFO[session].label}</strong>
                {locked ? (
                  <small>
                    <Lock size={12} /> Closed at {formatCutoff(cutoffs[session])}
                  </small>
                ) : null}
              </header>
              <div className="segmented" role="radiogroup" aria-label={`${SESSION_INFO[session].label} on or off`}>
                {[
                  [1, "I’m eating"],
                  [0, "Off"],
                ].map(([value, label]) => (
                  <button aria-checked={values[session] === value} className={values[session] === value ? "active" : ""} disabled={locked} key={value} role="radio" type="button" onClick={() => setValues({ ...values, [session]: value })}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="guest-stepper">
                <span>
                  <strong>Guests</strong>
                  <small>Charged to you</small>
                </span>
                <button aria-label="One less guest" disabled={locked || values[guestsKey] <= 0} type="button" onClick={() => setValues({ ...values, [guestsKey]: Math.max(0, values[guestsKey] - 1) })}>
                  <Minus size={16} />
                </button>
                <b>{values[guestsKey]}</b>
                <button aria-label="One more guest" disabled={locked || values[guestsKey] >= 10} type="button" onClick={() => setValues({ ...values, [guestsKey]: values[guestsKey] + 1 })}>
                  <Plus size={16} />
                </button>
              </div>
            </section>
          );
        })}
        <button
          className="primary money-form__submit"
          disabled={saving}
          type="button"
          onClick={async () => {
            setSaving(true);
            await onSave(values);
            setSaving(false);
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </Sheet>
  );
}

function CutoffSettings({ currentCycle, member, setMessage, settings }) {
  const cutoffs = cutoffsOf(settings);
  const [lunch, setLunch] = useState(cutoffs.lunch);
  const [dinner, setDinner] = useState(cutoffs.dinner);
  const dirty = lunch !== cutoffs.lunch || dinner !== cutoffs.dinner;

  async function saveCutoffs(event) {
    event.preventDefault();
    await setDoc(doc(db, "settings", `${currentCycle.messId}_main`), { messId: currentCycle.messId, lunchCutoff: lunch, dinnerCutoff: dinner, updatedAt: serverTimestamp() }, { merge: true });
    setMessage(`Cutoff saved: lunch ${formatCutoff(lunch)}, dinner ${formatCutoff(dinner)}.`);
    logActivity({ cycleId: currentCycle.id, kind: "settings", member, messId: currentCycle.messId, summary: `Changed meal cutoff to lunch ${formatCutoff(lunch)}, dinner ${formatCutoff(dinner)}` });
    trackEvent("meal_cutoff_saved");
  }

  return (
    <form className="panel plan-cutoff" onSubmit={saveCutoffs}>
      <header>
        <h3>Cutoff times</h3>
        <p>After this, members can’t change that day’s meal. Admins still can.</p>
      </header>
      <div className="plan-cutoff__row">
        <label>
          Lunch
          <input type="time" value={lunch} onChange={(event) => setLunch(event.target.value)} />
        </label>
        <label>
          Dinner
          <input type="time" value={dinner} onChange={(event) => setDinner(event.target.value)} />
        </label>
        <button className="secondary" disabled={!dirty} type="submit">
          Save
        </button>
      </div>
    </form>
  );
}

// Who's eating, for the cook: totals with names, shareable to the group.
export function HeadcountCard({ date, members, messName, plans, title }) {
  const [status, setStatus] = useState("");
  const lunch = headcount(plans, members, date, "lunch");
  const dinner = headcount(plans, members, date, "dinner");

  function line(count) {
    return count.eating.map((row) => `${row.name}${row.own === 0 ? " (guests only)" : ""}${row.guests ? ` +${row.guests}` : ""}`).join(", ") || "No one";
  }

  async function share() {
    const text = [
      `${messName || "Mess"} · ${shortDayLabel(date)} (${formatDisplayDate(date)})`,
      `Lunch: ${lunch.total} — ${line(lunch)}`,
      `Dinner: ${dinner.total} — ${line(dinner)}`,
    ].join("\n");
    try {
      if (navigator.share) {
        await navigator.share({ title: "Meal count", text });
        trackEvent("headcount_shared", { method: "share_sheet" });
        return;
      }
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
    const ok = await copyToClipboard(text);
    setStatus(ok ? "Copied" : "Couldn’t copy");
    window.setTimeout(() => setStatus(""), 2500);
  }

  return (
    <section className="panel headcount">
      <header>
        <div>
          <h3>{title || `Planned for ${shortDayLabel(date).toLowerCase()}`}</h3>
          <p>From everyone’s meal plan</p>
        </div>
        <button className="secondary headcount__share" type="button" onClick={share}>
          <Share2 size={16} /> {status || "Share"}
        </button>
      </header>
      <div className="headcount__sessions">
        {[
          ["lunch", lunch],
          ["dinner", dinner],
        ].map(([session, count]) => {
          const Icon = SESSION_INFO[session].icon;
          return (
            <div className="headcount__session" key={session}>
              <span className="headcount__total">
                <Icon size={16} /> {SESSION_INFO[session].label}
                <strong>{count.total}</strong>
              </span>
              <small>
                {count.people} {count.people === 1 ? "person" : "people"}
                {count.guests ? ` + ${count.guests} guest${count.guests === 1 ? "" : "s"}` : ""}
              </small>
              <p>{line(count)}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
