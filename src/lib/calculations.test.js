import { describe, expect, it } from "vitest";
import { calculateLedger, splitExpense, splitMeal } from "./calculations";

const members = [
  { id: "rumi", name: "Rumi" },
  { id: "sami", name: "Sami" },
  { id: "nabil", name: "Nabil" },
  { id: "tuhin", name: "Tuhin" },
];

describe("meal splitting", () => {
  it("splits two 70 taka boxes among four eaters", () => {
    expect(
      splitMeal({
        boxCount: 2,
        rate: 70,
        eaters: ["rumi", "sami", "nabil", "tuhin"],
      }),
    ).toEqual({ rumi: 35, sami: 35, nabil: 35, tuhin: 35 });
  });

  it("charges one full meal to one eater", () => {
    expect(splitMeal({ boxCount: 1, rate: 70, eaters: ["rumi"] })).toEqual({ rumi: 70 });
  });

  it("splits by portion weights when overrides exist", () => {
    expect(
      splitMeal({
        boxCount: 2,
        rate: 70,
        eaters: ["rumi", "sami", "nabil"],
        portions: { rumi: 1, sami: 0.5, nabil: 1.5 },
      }),
    ).toEqual({ rumi: 46.67, sami: 23.33, nabil: 70 });
  });
});

describe("expense and ledger calculation", () => {
  it("splits bazaar expense and credits payer", () => {
    expect(
      splitExpense({
        amount: 300,
        payerId: "rumi",
        participants: ["rumi", "sami", "nabil"],
      }),
    ).toEqual({ rumi: 100, sami: 100, nabil: 100 });
  });

  it("combines deposits, meals, and expenses into net balances", () => {
    const ledger = calculateLedger({
      members,
      mealEntries: [
        {
          status: "approved",
          boxCount: 2,
          rate: 70,
          eaters: ["rumi", "sami", "nabil", "tuhin"],
        },
      ],
      expenses: [
        {
          status: "approved",
          amount: 300,
          payerId: "rumi",
          participants: ["rumi", "sami", "nabil"],
        },
      ],
    });

    expect(ledger.rumi.balance).toBe(-135);
    expect(ledger.sami.balance).toBe(-135);
    expect(ledger.nabil.balance).toBe(-135);
    expect(ledger.tuhin.balance).toBe(-35);
  });

  it("uses each approved meal entry rate when the month is static", () => {
    const ledger = calculateLedger({
      members,
      settings: { mealRateMode: "static", mealRate: 70 },
      mealEntries: [
        {
          status: "approved",
          boxCount: 2,
          rate: 70,
          eaters: ["rumi", "sami"],
        },
        {
          status: "approved",
          boxCount: 2,
          rate: 90,
          eaters: ["rumi", "sami"],
        },
      ],
    });

    expect(ledger.rumi.mealCost).toBe(160);
    expect(ledger.sami.mealCost).toBe(160);
  });

  it("calculates meal rate from approved meal expenses and ordered meals", () => {
    const ledger = calculateLedger({
      members,
      settings: { mealRateMode: "calculated", mealRate: 70 },
      mealEntries: [
        {
          status: "approved",
          boxCount: 2,
          eaters: ["rumi", "sami"],
        },
        {
          status: "approved",
          boxCount: 2,
          eaters: ["sami", "nabil"],
        },
      ],
      expenses: [
        {
          status: "approved",
          category: "bazaar",
          amount: 320,
          payerId: "mess_cash",
          participants: [],
        },
      ],
    });

    expect(ledger.rumi.mealCost).toBe(80);
    expect(ledger.sami.mealCost).toBe(160);
    expect(ledger.nabil.mealCost).toBe(80);
    expect(ledger.rumi.expenseCost).toBe(0);
  });

  it("counts merchant meal payments as calculated meal cost", () => {
    const ledger = calculateLedger({
      members,
      settings: { mealRateMode: "calculated", mealRate: 70 },
      mealEntries: [
        {
          status: "approved",
          boxCount: 4,
          eaters: ["rumi", "sami"],
        },
      ],
      expenses: [
        {
          status: "approved",
          category: "meal",
          amount: 400,
          payerId: "mess_cash",
          participants: [],
        },
      ],
    });

    expect(ledger.rumi.mealCost).toBe(200);
    expect(ledger.sami.mealCost).toBe(200);
  });

  it("credits approved advances deposits to member balances", () => {
    const ledger = calculateLedger({
      members,
      deposits: [
        {
          status: "approved",
          memberId: "rumi",
          amount: 5000,
        },
        {
          status: "pending",
          memberId: "sami",
          amount: 3000,
        },
      ],
      mealEntries: [
        {
          status: "approved",
          boxCount: 2,
          rate: 100,
          eaters: ["rumi"],
        },
      ],
    });

    expect(ledger.rumi.deposits).toBe(5000);
    expect(ledger.sami.deposits).toBe(0);
    expect(ledger.rumi.balance).toBe(4800);
  });

  it("supports groceries paid from Mess Cash fund", () => {
    const ledger = calculateLedger({
      members,
      settings: { mealRateMode: "calculated", mealRate: 80 },
      deposits: [
        {
          status: "approved",
          memberId: "rumi",
          amount: 2000,
        },
        {
          status: "approved",
          memberId: "sami",
          amount: 2000,
        },
      ],
      mealEntries: [
        {
          status: "approved",
          boxCount: 40,
          rate: 80,
          eaters: ["rumi", "sami"],
        },
      ],
      expenses: [
        {
          status: "approved",
          category: "bazaar",
          amount: 3200,
          payerId: "mess_cash",
          participants: ["rumi", "sami"],
        },
      ],
    });

    expect(ledger.rumi.balance).toBe(400);
    expect(ledger.sami.balance).toBe(400);
  });
});
