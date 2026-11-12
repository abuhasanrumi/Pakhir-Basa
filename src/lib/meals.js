import { getMess } from "../firebase";
import { getMealEntryRate, getMealRateMode, splitMeal, taka } from "./calculations";

export function flattenDailyMeals(dailyMeals = []) {
  return dailyMeals.flatMap((day) =>
    ["lunch", "dinner"].flatMap((session) => {
      const meal = day[session];
      if (!meal || Number(meal.boxCount || 0) <= 0 || !meal.eaters?.length) return [];

      return [{
        id: `${day.id}-${session}`,
        dailyMealId: day.id,
        cycleId: day.cycleId,
        date: day.date,
        session,
        boxCount: Number(meal.boxCount || 0),
        rate: Number(meal.rate || day.mealRate || 70),
        rateMode: day.rateMode,
        eaters: meal.eaters || [],
        portions: meal.portions || {},
        status: day.status || "approved",
        createdBy: day.createdBy,
        createdByName: day.createdByName,
        submittedBy: day.submittedBy || day.createdBy,
        submittedByName: day.submittedByName || day.createdByName,
      }];
    }),
  );
}

export async function enrichMembershipsWithMessNames(memberships = []) {
  return Promise.all(
    memberships.map(async (membership) => {
      if (membership.messName) return membership;
      const mess = await getMess(membership.messId);
      return { ...membership, messName: mess?.name || membership.messName || "Unnamed mess" };
    }),
  );
}

export function buildMemberMealStats({ members, mealEntries, settings, activeRate }) {
  const stats = members.reduce((acc, person) => {
    acc[person.id] = { meals: 0, mealCost: 0 };
    return acc;
  }, {});

  mealEntries.forEach((entry) => {
    const rate = getMealRateMode(settings) === "calculated" ? activeRate : getMealEntryRate(entry, settings);
    const shares = splitMeal(entry, rate);
    const eaters = entry.eaters || [];
    const portions = entry.portions || {};
    const hasPortions = eaters.some((memberId) => Number(portions[memberId]) > 0);
    const weights = Object.fromEntries(eaters.map((memberId) => [memberId, hasPortions ? Number(portions[memberId]) || 0 : 1]));
    const totalWeight = Object.values(weights).reduce((sum, value) => sum + value, 0);

    eaters.forEach((memberId) => {
      if (!stats[memberId]) stats[memberId] = { meals: 0, mealCost: 0 };
      const mealCount = totalWeight > 0 ? (Number(entry.boxCount || 0) * weights[memberId]) / totalWeight : 0;
      stats[memberId].meals = taka(stats[memberId].meals + mealCount);
      stats[memberId].mealCost = taka(stats[memberId].mealCost + (shares[memberId] || 0));
    });
  });

  return stats;
}

export function groupMealsByDate(mealEntries) {
  return mealEntries.reduce((acc, entry) => {
    acc[entry.date] = [...(acc[entry.date] || []), entry];
    return acc;
  }, {});
}
