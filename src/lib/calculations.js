export const taka = (amount) => Math.round((Number(amount) || 0) * 100) / 100;

export function getMealRateMode(settings = {}) {
  const mode = settings.mealRateMode || settings.mealRateMethod || "static";
  return mode === "dynamic" ? "calculated" : mode;
}

export function getCalculatedMealRate({ mealEntries = [], expenses = [], settings = {} }) {
  const defaultRate = Number(settings.mealRate) || 70;
  const totalMeals = mealEntries
    .filter((entry) => entry.status === "approved")
    .reduce((sum, entry) => sum + Number(entry.boxCount || 0), 0);
  const mealExpenses = expenses
    .filter((expense) => expense.status === "approved" && ["bazaar", "meal"].includes(expense.category))
    .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);

  return totalMeals > 0 && mealExpenses > 0 ? taka(mealExpenses / totalMeals) : defaultRate;
}

export function getMealEntryRate(entry = {}, settings = {}, context = {}) {
  const fallbackRate = Number(settings.mealRate) || 70;
  if (getMealRateMode(settings) === "calculated") {
    return getCalculatedMealRate({ ...context, settings });
  }
  return Number(entry.rate) || fallbackRate;
}

export function splitMeal(entry, rateOverride) {
  const eaters = entry.eaters || [];
  const activeRate = rateOverride !== undefined && rateOverride !== null ? Number(rateOverride) : (Number(entry.rate) || 70);
  const total = taka((Number(entry.boxCount) || 0) * activeRate);
  if (!eaters.length || total <= 0) return {};

  const portions = entry.portions || {};
  const hasPortions = eaters.some((memberId) => Number(portions[memberId]) > 0);
  const weights = Object.fromEntries(
    eaters.map((memberId) => [memberId, hasPortions ? Number(portions[memberId]) || 0 : 1]),
  );
  const totalWeight = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (totalWeight <= 0) return {};

  return eaters.reduce((shares, memberId) => {
    shares[memberId] = taka((total * weights[memberId]) / totalWeight);
    return shares;
  }, {});
}

export function splitExpense(expense) {
  const participants = expense.participants || [];
  const amount = taka(expense.amount);
  if (!participants.length || amount <= 0) return {};

  if (expense.splitMethod === "custom" && expense.customShares) {
    return participants.reduce((shares, memberId) => {
      shares[memberId] = taka(expense.customShares[memberId]);
      return shares;
    }, {});
  }

  return participants.reduce((shares, memberId) => {
    shares[memberId] = taka(amount / participants.length);
    return shares;
  }, {});
}

export function calculateLedger({ 
  members = [], 
  mealEntries = [], 
  expenses = [], 
  deposits = [], 
  settings = {} 
}) {
  const ledger = members.reduce((acc, member) => {
    acc[member.id] = {
      memberId: member.id,
      name: member.name,
      deposits: 0,     /* Total advance deposits/contributions handed in */
      mealCount: 0,    /* Total meal boxes assigned to this member */
      owed: 0,         /* Total owed (Meals + Expense Share) */
      mealCost: 0,     /* Subtotal meal costs incurred */
      expenseCost: 0,  /* Subtotal utility/other shared expense costs */
      balance: 0,
    };
    return acc;
  }, {});

  const ensure = (memberId) => {
    if (!ledger[memberId]) {
      ledger[memberId] = {
        memberId,
        name: memberId,
        deposits: 0,
        mealCount: 0,
        owed: 0,
        mealCost: 0,
        expenseCost: 0,
        balance: 0,
      };
    }
    return ledger[memberId];
  };

  // 1. Sum up approved deposits/advances
  deposits
    .filter((d) => d.status === "approved")
    .forEach((d) => {
      const amount = taka(d.amount);
      const row = ensure(d.memberId);
      row.deposits = taka(row.deposits + amount);
    });

  // 2. Process Meal Entries
  const calculatedRate = getCalculatedMealRate({ mealEntries, expenses, settings });
  mealEntries
    .filter((entry) => entry.status === "approved")
    .forEach((entry) => {
      const rateToUse = getMealRateMode(settings) === "calculated" ? calculatedRate : getMealEntryRate(entry, settings);
      const shares = splitMeal(entry, rateToUse);
      const eaters = entry.eaters || [];
      const portions = entry.portions || {};
      const hasPortions = eaters.some((memberId) => Number(portions[memberId]) > 0);
      const weights = Object.fromEntries(eaters.map((memberId) => [memberId, hasPortions ? Number(portions[memberId]) || 0 : 1]));
      const totalWeight = Object.values(weights).reduce((sum, value) => sum + value, 0);
      Object.entries(shares).forEach(([memberId, amount]) => {
        const row = ensure(memberId);
        const mealCount = totalWeight > 0 ? (Number(entry.boxCount || 0) * (weights[memberId] || 0)) / totalWeight : 0;
        row.mealCount = taka(row.mealCount + mealCount);
        row.mealCost = taka(row.mealCost + amount);
        row.owed = taka(row.owed + amount);
      });
    });

  // 3. Process Expenses
  expenses
    .filter((expense) => expense.status === "approved")
    .forEach((expense) => {
      const amount = taka(expense.amount);
      const isMealRateExpense = getMealRateMode(settings) === "calculated" && ["bazaar", "meal"].includes(expense.category);
      
      if (isMealRateExpense) return;

      // Debit all participants for their share of the expense
      const shares = splitExpense(expense);
      Object.entries(shares).forEach(([memberId, share]) => {
        const row = ensure(memberId);
        row.expenseCost = taka(row.expenseCost + share);
        row.owed = taka(row.owed + share);
      });
    });

  // 4. Finalize Net Balances
  // Balance = deposits - meal share - other expense share.
  Object.values(ledger).forEach((row) => {
    row.balance = taka(row.deposits - row.owed);
  });

  return ledger;
}

export function buildCycleSnapshot({ 
  members = [], 
  mealEntries = [], 
  expenses = [], 
  deposits = [], 
  settings = {} 
}) {
  const ledger = calculateLedger({ members, mealEntries, expenses, deposits, settings });
  
  const approvedMeals = mealEntries.filter((m) => m.status === "approved");
  const approvedExpenses = expenses.filter((expense) => expense.status === "approved");
  const approvedDeposits = deposits.filter((deposit) => deposit.status === "approved");
  const calculatedRate = getCalculatedMealRate({ mealEntries, expenses, settings });
  const mealTotal = approvedMeals.reduce((sum, entry) => {
    const rateToUse = getMealRateMode(settings) === "calculated" ? calculatedRate : getMealEntryRate(entry, settings);
    return sum + Number(entry.boxCount || 0) * rateToUse;
  }, 0);

  return {
    totals: {
      meals: taka(mealTotal),
      expenses: taka(
        approvedExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0),
      ),
      deposits: taka(approvedDeposits.reduce((sum, deposit) => sum + Number(deposit.amount || 0), 0)),
      mealRateMode: getMealRateMode(settings),
      calculatedMealRate: calculatedRate,
      defaultMealRate: Number(settings?.mealRate) || 70,
    },
    meals: approvedMeals,
    expenses: approvedExpenses,
    deposits: approvedDeposits,
    ledger,
  };
}
