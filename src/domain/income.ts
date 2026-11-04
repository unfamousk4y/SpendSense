// Money the student has actually received, from PRODUCT_PLAN.md: "Received
// income changes C exactly once" and "Expected income is not spendable until
// recorded as received". Pure: all money is integer cents in ONE currency.
//
// Income raises cash C and free cash F by the same amount. It never changes
// protected savings, bills or this week's allowance: new income prompts an
// explicit update, which the student makes separately if they want to.
import { midweekSuggestion, type MidweekSuggestion } from './allowanceChange';
import type { IsoDate } from './dates';

export type IncomeReceipt = {
  /** One per opening of the form, so a repeated save is the same entry. */
  id: string;
  /** The day it was received. Never a day still to come. */
  date: IsoDate;
  cents: number;
  /** Where it came from, such as Aid or Family. */
  source?: string;
};

export type IncomeSide = { cashCents: number; freeCents: number };

export type IncomePreview = {
  before: IncomeSide;
  after: IncomeSide;
  /** A fresh suggestion for this week if the change is saved. Only ever offered. */
  suggestion: MidweekSuggestion;
};

export function previewIncome({
  changeCents,
  currentCashCents,
  freeCents,
  spentCents,
  daysThisWeek,
  daysLeft,
}: {
  /** The new entry's amount, or an edit's difference from the old amount. */
  changeCents: number;
  currentCashCents: number;
  freeCents: number;
  spentCents: number;
  daysThisWeek: number;
  daysLeft: number;
}): IncomePreview {
  for (const [name, value] of Object.entries({ changeCents, currentCashCents, freeCents, spentCents })) {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`${name} must be a whole number within the safe integer range (got ${value})`);
    }
  }
  const after = { cashCents: currentCashCents + changeCents, freeCents: freeCents + changeCents };
  return {
    before: { cashCents: currentCashCents, freeCents },
    after,
    suggestion: midweekSuggestion({ spentCents, freeCents: after.freeCents, daysThisWeek, daysLeft }),
  };
}

export function sumIncome(income: IncomeReceipt[]): number {
  return income.reduce((total, receipt) => total + receipt.cents, 0);
}

/** Appends an entry unless one with the same id is already recorded. */
export function addIncomeOnce(income: IncomeReceipt[], receipt: IncomeReceipt): IncomeReceipt[] {
  if (income.some((existing) => existing.id === receipt.id)) return income;
  return [...income, receipt];
}

export function updateIncome(income: IncomeReceipt[], receipt: IncomeReceipt): IncomeReceipt[] {
  return income.map((existing) => (existing.id === receipt.id ? receipt : existing));
}

export function removeIncome(income: IncomeReceipt[], id: string): IncomeReceipt[] {
  return income.filter((existing) => existing.id !== id);
}
