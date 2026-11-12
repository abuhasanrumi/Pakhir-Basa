import { addDays, today } from "./format";

export const SESSION_KEYS = ["lunch", "dinner"];
export const DEFAULT_CUTOFFS = { lunch: "10:00", dinner: "16:00" };

// Plans are stored one per member (doc id = member id):
// { messId, memberId, defaults: { lunch: 1, dinner: 1 }, days: { "YYYY-MM-DD": { lunch, dinner, lunchGuests, dinnerGuests } } }
// A day without an entry follows the defaults with no guests.
export function planFor(plans = [], memberId) {
  return plans.find((plan) => plan.memberId === memberId || plan.id === memberId) || null;
}

export function defaultsOf(plan) {
  return {
    lunch: plan?.defaults?.lunch ?? 1,
    dinner: plan?.defaults?.dinner ?? 1,
  };
}

export function dayPlan(plan, date) {
  const defaults = defaultsOf(plan);
  const day = plan?.days?.[date] || {};
  return {
    lunch: Number(day.lunch ?? defaults.lunch) || 0,
    dinner: Number(day.dinner ?? defaults.dinner) || 0,
    lunchGuests: Number(day.lunchGuests || 0),
    dinnerGuests: Number(day.dinnerGuests || 0),
    changed: Boolean(plan?.days?.[date]),
  };
}

// Who is planned to eat a session on a date, and how many meals that makes.
export function headcount(plans, members, date, session) {
  const rows = members.map((person) => {
    const plan = dayPlan(planFor(plans, person.id), date);
    const own = plan[session];
    const guests = plan[`${session}Guests`];
    return { memberId: person.id, name: person.name, own, guests, total: own + guests };
  });
  const eating = rows.filter((row) => row.total > 0);
  return {
    eating,
    people: rows.filter((row) => row.own > 0).length,
    guests: rows.reduce((sum, row) => sum + row.guests, 0),
    total: rows.reduce((sum, row) => sum + row.total, 0),
  };
}

// Portions for the meal sheet from everyone's plan (guests are charged to the host).
export function portionsFromPlans(plans, members, date, session) {
  return Object.fromEntries(
    members.map((person) => {
      const plan = dayPlan(planFor(plans, person.id), date);
      return [person.id, plan[session] + plan[`${session}Guests`]];
    }),
  );
}

export function cutoffsOf(settings = {}) {
  return {
    lunch: settings.lunchCutoff || DEFAULT_CUTOFFS.lunch,
    dinner: settings.dinnerCutoff || DEFAULT_CUTOFFS.dinner,
  };
}

// A member can't change a meal after its cutoff time on that day (or any past day).
export function isLocked(date, session, settings, now = new Date()) {
  const [hours, minutes] = cutoffsOf(settings)[session].split(":").map(Number);
  const cutoff = new Date(`${date}T00:00:00`);
  cutoff.setHours(hours || 0, minutes || 0, 0, 0);
  return now >= cutoff;
}

export function formatCutoff(value) {
  const [hours, minutes] = String(value || "").split(":").map(Number);
  const date = new Date();
  date.setHours(hours || 0, minutes || 0, 0, 0);
  return date.toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" });
}

export function upcomingDates(count = 7, from = today()) {
  return Array.from({ length: count }, (_, index) => addDays(from, index));
}

export function shortDayLabel(date) {
  if (date === today()) return "Today";
  if (date === addDays(today(), 1)) return "Tomorrow";
  return new Date(`${date}T00:00:00`).toLocaleDateString("en", { weekday: "short", day: "numeric", month: "short" });
}
