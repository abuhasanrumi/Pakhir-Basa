import { serverTimestamp } from "firebase/firestore";
import { Check, Moon, Pencil, Plus, RotateCcw, Soup, Sun, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { trackEvent, trackFormError } from "../analytics";
import { DateInput } from "../components/DateInput.jsx";
import { setRecord, updateRecord } from "../firebase";
import { getCalculatedMealRate, getMealRateMode, splitMeal, taka } from "../lib/calculations";
import { logActivity } from "../lib/activity";
import { addDays, formatDisplayDate, formatTk, isBeforeDate, today } from "../lib/format";
import { portionsFromPlans } from "../lib/mealPlans";
import { HeadcountCard, MealPlan } from "./MealPlan.jsx";

const SESSIONS = {
  lunch: { label: "Lunch", icon: Sun },
  dinner: { label: "Dinner", icon: Moon },
};

function defaultSessionForNow() {
  return new Date().getHours() < 16 ? "lunch" : "dinner";
}

function sumPortions(portions = {}) {
  return Object.values(portions).reduce((sum, value) => sum + Number(value || 0), 0);
}

// A session counts as added once it has eaters, an ordered count, or was marked as skipped.
function isSessionAdded(sessionData) {
  if (!sessionData) return false;
  return Boolean(sessionData.skipped) || Number(sessionData.boxCount || 0) > 0 || (sessionData.eaters?.length || 0) > 0;
}

function blankSession(rate) {
  return { boxCount: 0, rate: Number(rate) || 70, eaters: [], portions: {}, skipped: false };
}

// Meals page: "My meals" (plan on/off, guests) and the "Meal sheet" (what was actually eaten).
export function MealsScreen(props) {
  const { initialSession, isAdmin } = props;
  const [tab, setTab] = useState(initialSession || isAdmin ? "sheet" : "plan");

  useEffect(() => {
    if (initialSession) setTab("sheet");
  }, [initialSession]);

  return (
    <div className="meals-screen">
      <div className="page-tabs" role="tablist" aria-label="Meals">
        <button aria-selected={tab === "plan"} className={tab === "plan" ? "page-tab active" : "page-tab"} role="tab" type="button" onClick={() => setTab("plan")}>
          My meals
        </button>
        <button aria-selected={tab === "sheet"} className={tab === "sheet" ? "page-tab active" : "page-tab"} role="tab" type="button" onClick={() => setTab("sheet")}>
          Meal sheet
        </button>
      </div>
      {tab === "plan" ? <MealPlan {...props} /> : <Meals {...props} />}
    </div>
  );
}

export function Meals({ activeMembers, currentCycle, currentMess, dailyMeals, expenses, initialDate, initialSession, isAdmin, mealEntries, member, plans = [], settings, setMessage }) {
  const [date, setDate] = useState(initialDate || today());
  const [session, setSession] = useState(initialSession || defaultSessionForNow());

  useEffect(() => {
    if (initialDate) setDate(initialDate);
  }, [initialDate]);
  const [optimisticDailyMeal, setOptimisticDailyMeal] = useState(null);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (initialSession) setSession(initialSession);
  }, [initialSession]);

  const savedDailyMeal = useMemo(() => dailyMeals.find((entry) => entry.date === date), [dailyMeals, date]);
  const existingDailyMeal = savedDailyMeal || (optimisticDailyMeal?.cycleId === currentCycle.id && optimisticDailyMeal?.date === date ? optimisticDailyMeal : null);

  useEffect(() => {
    if (savedDailyMeal && optimisticDailyMeal?.id === savedDailyMeal.id) {
      setOptimisticDailyMeal(null);
    }
  }, [optimisticDailyMeal, savedDailyMeal]);

  const cycleStartDate = currentCycle?.startDate || "";
  const isDateBeforeCycle = isBeforeDate(date, cycleStartDate);
  const isCalculated = getMealRateMode(settings) === "calculated";
  const calculatedRate = isCalculated ? getCalculatedMealRate({ mealEntries, expenses, settings }) : 0;

  function confirmDiscard() {
    return !isDirty || window.confirm("You have unsaved changes. Discard them?");
  }

  function changeSession(nextSession) {
    if (nextSession === session || !confirmDiscard()) return;
    setIsDirty(false);
    setSession(nextSession);
    trackEvent("meal_session_tab_selected", { session: nextSession });
  }

  function changeDate(nextDate) {
    if (nextDate === date || !confirmDiscard()) return;
    setIsDirty(false);
    setDate(nextDate);
  }

  function sessionTabSummary(sessionKey) {
    const data = existingDailyMeal?.[sessionKey];
    if (!isSessionAdded(data)) return "Not added";
    if (data.skipped) return `No ${sessionKey}`;
    const count = taka(Number(data.boxCount || 0) || sumPortions(data.portions));
    return `${count} meal${count === 1 ? "" : "s"}`;
  }

  return (
    <div className="meals-sheet">
      <section className="panel meal-picker">
        <div className="meal-picker__row">
          <label className="meal-picker__date">
            Date
            <DateInput label="Meal date" min={cycleStartDate} showToday value={date} onChange={changeDate} />
          </label>
          {existingDailyMeal ? (
            <span className={existingDailyMeal.status === "approved" ? "status-badge approved" : "status-badge pending"}>{existingDailyMeal.status}</span>
          ) : null}
        </div>
        {isDateBeforeCycle ? <p className="empty">This date is before this month started on {formatDisplayDate(cycleStartDate)}.</p> : null}
        <div className="session-tabs" role="tablist" aria-label="Meal">
          {Object.entries(SESSIONS).map(([key, { label, icon: Icon }]) => {
            const added = isSessionAdded(existingDailyMeal?.[key]);
            return (
              <button
                aria-selected={session === key}
                className={`session-tab${session === key ? " active" : ""}${added ? " added" : ""}`}
                key={key}
                role="tab"
                type="button"
                onClick={() => changeSession(key)}
              >
                <Icon size={20} />
                <span className="session-tab__text">
                  <strong>{label}</strong>
                  <small>{sessionTabSummary(key)}</small>
                </span>
                {added ? <Check className="session-tab__check" size={16} /> : null}
              </button>
            );
          })}
        </div>
      </section>

      {isAdmin ? <HeadcountCard date={date} members={activeMembers} messName={currentMess?.name} plans={plans} /> : null}

      <SessionForm
        key={`${date}-${session}`}
        plans={plans}
        previousSession={dailyMeals.find((entry) => entry.date === addDays(date, -1))?.[session] || null}
        activeMembers={activeMembers}
        calculatedRate={calculatedRate}
        currentCycle={currentCycle}
        date={date}
        existingDailyMeal={existingDailyMeal}
        isAdmin={isAdmin}
        isCalculated={isCalculated}
        isDateBeforeCycle={isDateBeforeCycle}
        member={member}
        onDirtyChange={setIsDirty}
        onSaved={(docId, payload) => setOptimisticDailyMeal({ ...(existingDailyMeal || {}), id: docId, ...payload })}
        session={session}
        settings={settings}
        setMessage={setMessage}
      />
    </div>
  );
}

// One meal (lunch or dinner) for one date: view, add, edit and save it on its own.
function SessionForm({ activeMembers, calculatedRate, currentCycle, date, existingDailyMeal, isAdmin, isCalculated, isDateBeforeCycle, member, onDirtyChange, onSaved, plans = [], previousSession, session, settings, setMessage }) {
  const { label } = SESSIONS[session];
  const lowerLabel = label.toLowerCase();
  const defaultRate = Number(settings.mealRate) || 70;
  const savedSession = existingDailyMeal?.[session];
  const sessionAdded = isSessionAdded(savedSession);
  const editableMembers = isAdmin ? activeMembers : activeMembers.filter((person) => person.id === member.id);
  const editableMemberIds = new Set(editableMembers.map((person) => person.id));

  const [rate, setRate] = useState(defaultRate);
  const [ordered, setOrdered] = useState(0);
  const [portions, setPortions] = useState({});
  const [unavailable, setUnavailable] = useState({});
  const [skipped, setSkipped] = useState(false);
  const [editingRate, setEditingRate] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [fillNote, setFillNote] = useState("");

  function blankPortions() {
    return Object.fromEntries(editableMembers.map((person) => [person.id, 0]));
  }

  function hydrate() {
    const next = blankPortions();
    Object.entries(savedSession?.portions || {}).forEach(([memberId, value]) => {
      if (editableMemberIds.has(memberId)) next[memberId] = value;
    });
    const savedCount = Number(savedSession?.boxCount || 0);
    setOrdered(isAdmin && savedCount <= 0 ? sumPortions(savedSession?.portions) : savedCount);
    setRate(savedSession?.rate || defaultRate);
    setPortions(next);
    setUnavailable({});
    setSkipped(Boolean(savedSession?.skipped));
    setEditingRate(false);
  }

  // Firestore listeners hand back fresh objects on every snapshot (including other
  // people's saves), so re-hydrate only when this meal's saved content really changes.
  // Otherwise a remote write would wipe an edit in progress.
  const memberIdsKey = activeMembers.map((person) => person.id).join(",");
  const savedKey = JSON.stringify([existingDailyMeal?.id, existingDailyMeal?.status, savedSession || null]);
  useEffect(() => {
    hydrate();
    setIsEditing(false);
  }, [memberIdsKey, savedKey, defaultRate]);

  useEffect(() => {
    onDirtyChange(isEditing);
  }, [isEditing]);

  useEffect(() => {
    if (!formError) return undefined;
    const timeoutId = window.setTimeout(() => setFormError(""), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [formError]);

  const canEditExisting = isAdmin || (existingDailyMeal?.createdBy === member.id && existingDailyMeal?.status === "pending");
  const formOpen = isEditing;
  const activeRate = isCalculated ? calculatedRate : Number(rate || defaultRate);
  const demandTotal = sumPortions(portions);
  const preview = splitMeal({
    boxCount: skipped ? 0 : demandTotal,
    rate: activeRate,
    eaters: skipped ? [] : selectedMemberIds(portions),
    portions: skipped ? {} : positivePortions(portions),
  });
  const sessionTotal = skipped ? 0 : taka(demandTotal * activeRate);

  function selectedMemberIds(values) {
    return Object.entries(values)
      .filter(([memberId, val]) => editableMemberIds.has(memberId) && Number(val) > 0)
      .map(([id]) => id);
  }

  function positivePortions(values) {
    return Object.fromEntries(
      Object.entries(values)
        .filter(([memberId, val]) => editableMemberIds.has(memberId) && Number(val) > 0)
        .map(([id, val]) => [id, Number(val)]),
    );
  }

  function updatePortion(setter, memberId, value) {
    setter((current) => ({ ...current, [memberId]: Math.max(0, Number(value) || 0) }));
  }

  function adjustPortion(setter, memberId, delta) {
    setter((current) => ({ ...current, [memberId]: Math.max(0, taka((Number(current[memberId]) || 0) + delta)) }));
  }

  function setAllPortions(setter, value, targetMembers = editableMembers) {
    const next = blankPortions();
    targetMembers.forEach((person) => {
      next[person.id] = value;
    });
    setter(next);
  }

  function setEvenSplit(setter, total, targetMembers = editableMembers) {
    const count = targetMembers.length;
    if (!count) {
      setter({});
      return;
    }
    const baseShare = taka(Number(total || 0) / count);
    const next = blankPortions();
    targetMembers.forEach((person, index) => {
      next[person.id] = index === count - 1 ? taka(Number(total || 0) - baseShare * (count - 1)) : baseShare;
    });
    setter(next);
  }

  function toggleUnavailable(memberId) {
    setUnavailable((current) => {
      const next = { ...current, [memberId]: !current[memberId] };
      if (next[memberId]) setPortions((portionsNow) => ({ ...portionsNow, [memberId]: 0 }));
      trackEvent(next[memberId] ? "meal_member_temporarily_removed" : "meal_member_restored", { session });
      return next;
    });
  }

  function buildSession() {
    if (skipped) {
      return { boxCount: 0, rate: Number(rate || defaultRate), eaters: [], portions: {}, skipped: true };
    }
    return {
      boxCount: isAdmin ? demandTotal : 0,
      // Members can't edit the rate, but `rate` already holds this meal's saved rate
      // (or the month default), so keep it instead of resetting to the default.
      rate: Number(rate || defaultRate),
      eaters: selectedMemberIds(portions),
      portions: positivePortions(portions),
      skipped: false,
    };
  }

  function fillFromPlans(note = "Filled from everyone’s meal plan. Adjust if anything changed.") {
    const planned = portionsFromPlans(plans, editableMembers, date, session);
    const next = blankPortions();
    Object.entries(planned).forEach(([memberId, value]) => {
      if (editableMemberIds.has(memberId)) next[memberId] = value;
    });
    setPortions(next);
    setOrdered(isAdmin ? sumPortions(next) : 0);
    setSkipped(false);
    setFillNote(note);
    trackEvent("meal_sheet_filled_from_plans", { session });
  }

  function fillFromYesterday() {
    const next = blankPortions();
    Object.entries(previousSession?.portions || {}).forEach(([memberId, value]) => {
      if (editableMemberIds.has(memberId)) next[memberId] = Number(value) || 0;
    });
    setPortions(next);
    setOrdered(isAdmin ? sumPortions(next) : 0);
    setSkipped(false);
    setFillNote(`Copied from yesterday’s ${lowerLabel}.`);
    trackEvent("meal_sheet_copied_yesterday", { session });
  }

  function startEditing() {
    hydrate();
    setFillNote("");
    if (!sessionAdded && plans.length) fillFromPlans();
    setIsEditing(true);
    trackEvent(sessionAdded ? "meal_session_edit_clicked" : "meal_session_add_clicked", { session });
  }

  function cancelEditing() {
    hydrate();
    setIsEditing(false);
  }

  async function approveDay() {
    if (!existingDailyMeal) return;
    await updateRecord("dailyMeals", existingDailyMeal.id, { status: "approved" });
    setMessage(`Meals approved for ${formatDisplayDate(date)}.`);
    logActivity({ cycleId: currentCycle.id, kind: "meal", member, messId: currentCycle.messId, summary: `Approved meals for ${formatDisplayDate(date)}` });
    trackEvent("meal_approved", { session });
  }

  async function submit(event) {
    event.preventDefault();
    setFormError("");

    if (isDateBeforeCycle) {
      setFormError(`This date is before the month started on ${formatDisplayDate(currentCycle?.startDate)}.`);
      trackFormError("meal_session", "date_before_cycle");
      return;
    }

    const eaters = selectedMemberIds(portions);
    if (!skipped && !eaters.length) {
      setFormError(`Add ${lowerLabel} for at least one person, or mark it as no ${lowerLabel}.`);
      trackFormError("meal_session", "no_eaters");
      return;
    }

    if (isAdmin && !skipped) {
      // An empty ordered count just means "same as the portions".
      if (Number(ordered) > 0 && Math.abs(Number(ordered) - demandTotal) > 0.01) {
        setFormError(`Ordered meals (${taka(Number(ordered))}) should match everyone’s portions (${taka(demandTotal)}).`);
        trackFormError("meal_session", "ordered_count_mismatch");
        return;
      }
    }

    const docId = `${currentCycle.messId}_${currentCycle.id}_${date}`;
    const otherSession = session === "lunch" ? "dinner" : "lunch";
    // Only this meal is written; the other one keeps whatever is saved (merge write).
    const payload = {
      messId: currentCycle.messId,
      cycleId: currentCycle.id,
      date,
      rateMode: getMealRateMode(settings),
      [session]: buildSession(),
      status: isAdmin ? "approved" : "pending",
      createdBy: existingDailyMeal?.createdBy || member.id,
      createdByName: existingDailyMeal?.createdByName || member.name,
      submittedBy: member.id,
      submittedByName: member.name,
      submittedAt: serverTimestamp(),
    };
    if (!existingDailyMeal) {
      payload.createdAt = serverTimestamp();
      payload[otherSession] = blankSession(defaultRate);
    }

    try {
      setIsSaving(true);
      await setRecord("dailyMeals", docId, payload);
      onSaved(docId, payload);
      setIsEditing(false);
      setEditingRate(false);
      setMessage(isAdmin ? `${label} saved for ${formatDisplayDate(date)}.` : `${label} saved. An admin will review it.`);
      logActivity({
        cycleId: currentCycle.id,
        kind: "meal",
        member,
        messId: currentCycle.messId,
        summary: skipped
          ? `Marked no ${lowerLabel} on ${formatDisplayDate(date)}`
          : `${sessionAdded ? "Updated" : "Added"} ${lowerLabel} for ${formatDisplayDate(date)}: ${taka(demandTotal)} meal${demandTotal === 1 ? "" : "s"}, ${eaters.length} ${eaters.length === 1 ? "person" : "people"}`,
      });
      trackEvent(sessionAdded ? "meal_session_updated" : "meal_session_created", {
        session,
        status: payload.status,
        meal_rate_mode: payload.rateMode,
        skipped,
        eaters: eaters.length,
        meals: demandTotal,
      });
    } catch (error) {
      console.error("Meal save failed", error);
      setMessage(error.code === "permission-denied" ? "Couldn’t save this meal. Please refresh and try again." : error.message);
      trackEvent("meal_session_save_failed", { session, error_code: error.code || "unknown" });
    } finally {
      setIsSaving(false);
    }
  }

  if (!sessionAdded && !formOpen) {
    return (
      <section className="panel meal-empty-panel">
        <div className="date-empty-state">
          <Soup size={28} />
          <div>
            <strong>No {lowerLabel} added</strong>
            <p>{date === today() ? `Add today’s ${lowerLabel} when it’s ordered.` : `Nothing saved for ${lowerLabel} on ${formatDisplayDate(date)}.`}</p>
          </div>
          <button className="primary" disabled={isDateBeforeCycle} type="button" onClick={startEditing}>
            <Plus size={18} /> Add {lowerLabel}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="panel meal-session-panel">
      <form className="form-grid" onSubmit={submit}>
        {existingDailyMeal && sessionAdded ? (
          <p className="meal-session-meta">
            Submitted by {existingDailyMeal.submittedByName || existingDailyMeal.createdByName || "Admin"}
          </p>
        ) : null}

        {formOpen ? (
          <div className="fill-row">
            {plans.length ? (
              <button className="chip" type="button" onClick={() => fillFromPlans()}>
                Fill from plans
              </button>
            ) : null}
            {previousSession && isSessionAdded(previousSession) ? (
              <button className="chip" type="button" onClick={fillFromYesterday}>
                Same as yesterday
              </button>
            ) : null}
          </div>
        ) : null}
        {formOpen && fillNote ? <p className="fill-note">{fillNote}</p> : null}

        {formOpen ? (
          <label className="skip-toggle">
            <input checked={skipped} type="checkbox" onChange={(event) => setSkipped(event.target.checked)} />
            <span>No {lowerLabel} on this day</span>
          </label>
        ) : null}

        <MealSessionEditor
          activeMembers={editableMembers}
          adjustPortion={adjustPortion}
          allowCountEdit={isAdmin}
          allowRateEdit={isAdmin && !isCalculated}
          defaultRate={defaultRate}
          disabled={!formOpen}
          editingRate={editingRate}
          label={label}
          ordered={ordered}
          portions={portions}
          preview={preview}
          rate={activeRate}
          setAllPortions={setAllPortions}
          setEditingRate={setEditingRate}
          setEvenSplit={setEvenSplit}
          setOrdered={setOrdered}
          setPortions={setPortions}
          setRate={setRate}
          setSkipped={setSkipped}
          skipped={skipped}
          toggleUnavailable={toggleUnavailable}
          unavailableMembers={unavailable}
          updatePortion={updatePortion}
        />

        {formError ? <div className="meal-form-error">{formError}</div> : null}

        <div className="form-actions">
          {formOpen ? (
            <>
              <button className="secondary" type="button" onClick={cancelEditing}>Cancel</button>
              <button className="primary" disabled={isSaving || isDateBeforeCycle} type="submit">
                <Check size={18} /> {isSaving ? "Saving..." : `Save ${lowerLabel}`}{!skipped && sessionTotal ? ` · ${formatTk(sessionTotal)}` : ""}
              </button>
            </>
          ) : (
            <>
              {isAdmin && existingDailyMeal?.status === "pending" ? (
                <button className="primary" type="button" onClick={approveDay}>
                  <Check size={18} /> Approve
                </button>
              ) : null}
              {canEditExisting ? (
                <button className="secondary" type="button" onClick={startEditing}>
                  <Pencil size={18} /> Edit {lowerLabel}
                </button>
              ) : null}
            </>
          )}
        </div>
      </form>
    </section>
  );
}

export function MealSessionEditor({
  activeMembers,
  adjustPortion,
  defaultRate,
  disabled = false,
  allowCountEdit = true,
  allowRateEdit = true,
  editingRate,
  label,
  ordered,
  portions,
  preview,
  rate,
  setAllPortions,
  setEvenSplit,
  setEditingRate,
  setOrdered,
  setPortions,
  setRate,
  setSkipped,
  skipped,
  toggleUnavailable,
  unavailableMembers = {},
  updatePortion,
}) {
  const portionControlsDisabled = disabled || skipped;
  const availableMembers = activeMembers.filter((person) => !unavailableMembers[person.id]);
  const rateDisabled = disabled || skipped || !allowRateEdit;
  const totalPortions = skipped ? 0 : taka(Object.values(portions).reduce((sum, value) => sum + Number(value || 0), 0));
  const sessionCount = skipped ? 0 : Number(ordered) || totalPortions;
  const estimatedTotal = skipped ? 0 : taka(sessionCount * (Number(rate) || 0));
  const activeCount = skipped ? 0 : Object.values(portions).filter((value) => Number(value) > 0).length;
  const sessionClass = label.toLowerCase();
  const sessionName = sessionClass;

  function chooseOrderedMealCount(count, source = "chip") {
    setOrdered(count);
    trackEvent("ordered_meal_count_selected", { session: sessionName, source, count: Number(count || 0) });
  }

  function applyPortionPreset(action, callback) {
    callback();
    trackEvent("meal_portion_preset_used", {
      session: sessionName,
      action,
      available_member_count: availableMembers.length,
      ordered_meals: Number(ordered || 0),
    });
  }

  return (
    <section className={`meal-session-box meal-session-box--${sessionClass}${disabled ? " readonly" : skipped ? " skipped" : ""}`}>
      <div className="meal-session-header">
        <div>
          <h3>{label}</h3>
          <span>{skipped ? `No ${label.toLowerCase()}` : `${formatTk(estimatedTotal)} total · ${activeCount} eating`}</span>
        </div>
        {allowCountEdit ? (
          <>
            <div className="session-controls">
              <label className="ordered-field">
                Ordered meals
                <input disabled={portionControlsDisabled} min="0" step="0.5" type="number" value={ordered} onChange={(event) => setOrdered(event.target.value)} />
              </label>
              <div className="ordered-meal-pills" aria-label={`${label} ordered meals quick choices`}>
                {[1, 2, 3, 4].map((count) => (
                  <button
                    className={Number(ordered) === count ? "active" : ""}
                    disabled={portionControlsDisabled}
                    key={count}
                    type="button"
                    onClick={() => chooseOrderedMealCount(count)}
                  >
                    {count}
                  </button>
                ))}
                <button
                  disabled={portionControlsDisabled}
                  type="button"
                  onClick={() => chooseOrderedMealCount(taka((Number(ordered) || 0) + 1), "more")}
                >
                  More
                </button>
              </div>
              <label className="rate-field">
                Rate
                <div className={editingRate ? "rate-inline-editor editing" : "rate-inline-editor"}>
                  {editingRate ? (
                    <input
                      autoFocus
                      min="1"
                      type="number"
                      disabled={rateDisabled}
                      value={rate}
                      onChange={(event) => setRate(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          setEditingRate(false);
                          trackEvent("meal_rate_confirmed", { session: sessionName, source: "enter" });
                        }
                      }}
                    />
                  ) : (
                    <span>{formatTk(rate)}</span>
                  )}
                  {editingRate ? (
                    <button
                      disabled={rateDisabled}
                      type="button"
                      title="Confirm rate"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setEditingRate(false);
                        trackEvent("meal_rate_confirmed", { session: sessionName, source: "button" });
                      }}
                    >
                      <Check size={13} />
                    </button>
                  ) : (
                    <button disabled={rateDisabled} type="button" title="Edit rate" onClick={() => {
                      setEditingRate(true);
                      trackEvent("meal_rate_edit_started", { session: sessionName });
                    }}>
                      <Pencil size={13} />
                    </button>
                  )}
                  <button
                    disabled={rateDisabled}
                    type="button"
                    title="Reset rate"
                    onClick={() => {
                      setRate(defaultRate || 70);
                      setEditingRate(false);
                      trackEvent("meal_rate_reset", { session: sessionName });
                    }}
                  >
                    <RotateCcw size={13} />
                  </button>
                </div>
              </label>
            </div>
          </>
        ) : null}
      </div>

      {allowCountEdit ? (
        <div className="meal-quick-actions">
          <button disabled={portionControlsDisabled || !availableMembers.length} type="button" onClick={() => applyPortionPreset("all_1", () => setAllPortions(setPortions, 1, availableMembers))}>All 1</button>
          <button disabled={portionControlsDisabled || !availableMembers.length} type="button" onClick={() => applyPortionPreset("split_evenly", () => setEvenSplit(setPortions, ordered, availableMembers))}>Split evenly</button>
          <button disabled={portionControlsDisabled} type="button" onClick={() => applyPortionPreset("clear", () => setAllPortions(setPortions, 0, availableMembers))}>Clear</button>
        </div>
      ) : null}

      <div className="meal-member-list">
        {activeMembers.map((person) => (
          <div className={unavailableMembers[person.id] ? "meal-member-row unavailable" : "meal-member-row"} key={person.id}>
            <div className="meal-member-row__top">
              <span>{person.name}</span>
              <button
                className={unavailableMembers[person.id] ? "availability-toggle restore" : "availability-toggle"}
                disabled={disabled || skipped}
                aria-label={unavailableMembers[person.id] ? `Bring ${person.name} back for ${label}` : `Remove ${person.name} from ${label}`}
                title={unavailableMembers[person.id] ? "Bring back for this meal" : "Remove for this meal"}
                type="button"
                onClick={() => toggleUnavailable?.(person.id)}
              >
                {unavailableMembers[person.id] ? <Plus size={14} /> : <X size={14} />}
              </button>
              
            </div>
            <div className="portion-controls">
              <button disabled={portionControlsDisabled || unavailableMembers[person.id]} type="button" onClick={() => adjustPortion(setPortions, person.id, -0.5)}>-</button>
              <input
                disabled={portionControlsDisabled || unavailableMembers[person.id]}
                min="0"
                step="any"
                type="number"
                value={portions[person.id] ?? 0}
                onChange={(event) => updatePortion(setPortions, person.id, event.target.value)}
              />
              <button disabled={portionControlsDisabled || unavailableMembers[person.id]} type="button" onClick={() => adjustPortion(setPortions, person.id, 0.5)}>+</button>
            </div>
          </div>
        ))}
      </div>

      <div className="meal-session-summary">
        {Object.entries(preview).map(([memberId, amount]) => (
          <span key={memberId}>
            {activeMembers.find((item) => item.id === memberId)?.name || memberId}: {formatTk(amount)}
          </span>
        ))}
      </div>
    </section>
  );
}
