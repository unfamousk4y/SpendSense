// Money the student has actually received, from PRODUCT_PLAN.md: "Received
// income changes C exactly once" and "Expected income is not spendable until
// recorded as received". Pure: all money is integer cents in ONE currency.
//
// Income raises cash C. Any savings share the student confirmed goes to protected
// savings, and the rest raises free cash F. It never changes bills or this week's
// allowance: new income prompts an explicit update, made separately if wanted.
import { midweekSuggestion, type MidweekSuggestion } from './allowanceChange';
import type { IsoDate } from './dates';
import { splitMoneyIn, type Split, type SplitAmounts } from './split';

/** Only a label: no future income is predicted or added from it. */
export type IncomeKind = 'regular' | 'oneOff';

export type IncomeReceipt = {
  /** One per opening of the form, so a repeated save is the same entry. */
  id: string;
  /** The day it was received. Never a day still to come. */
  date: IsoDate;
  cents: number;
  /** Where it came from, such as Aid or Family. */
  source?: string;
  /** Absent means one-off. */
  kind?: IncomeKind;
  /** The part set aside as protected savings, as confirmed. Absent when not split. */
  savingsCents?: number;
  /** The part added to the wants pool, as confirmed. Absent when not split. */
  wantsCents?: number;
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
  savingsChangeCents = 0,
  currentCashCents,
  freeCents,
  spentCents,
  daysThisWeek,
  daysLeft,
}: {
  /** The new entry's amount, or an edit's difference from the old amount. */
  changeCents: number;
  /** How much more this saves as protected savings, which free cash does not get. */
  savingsChangeCents?: number;
  currentCashCents: number;
  freeCents: number;
  spentCents: number;
  daysThisWeek: number;
  daysLeft: number;
}): IncomePreview {
  for (const [name, value] of Object.entries({ changeCents, savingsChangeCents, currentCashCents, freeCents, spentCents })) {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`${name} must be a whole number within the safe integer range (got ${value})`);
    }
  }
  const after = { cashCents: currentCashCents + changeCents, freeCents: freeCents + changeCents - savingsChangeCents };
  return {
    before: { cashCents: currentCashCents, freeCents },
    after,
    suggestion: midweekSuggestion({ spentCents, freeCents: after.freeCents, daysThisWeek, daysLeft }),
  };
}

/**
 * A payment's shares under a split. An edit replaces the payment's old amount
 * and savings, so those come out of free cash before the cap on savings is worked out.
 */
export function incomeShares({
  cents,
  split,
  freeCents,
  previous,
}: {
  cents: number;
  split: Split;
  /** F now, with the payment being edited still counted. May be negative. */
  freeCents: number;
  previous?: Pick<IncomeReceipt, 'cents' | 'savingsCents'>;
}): SplitAmounts {
  const freeAfterCents = freeCents + cents - (previous?.cents ?? 0) + (previous?.savingsCents ?? 0);
  return splitMoneyIn({ cents, split, freeAfterCents });
}

/** The nearest whole percents to a saved payment's shares, to fill in the form when editing it. */
export function splitFromShares({ cents, savingsCents = 0, wantsCents = 0 }: IncomeReceipt): Split {
  const savingsPercent = Math.round((savingsCents * 100) / cents);
  const wantsPercent = Math.min(Math.round((wantsCents * 100) / cents), 100 - savingsPercent);
  return { needsPercent: 100 - savingsPercent - wantsPercent, wantsPercent, savingsPercent };
}

export function sumIncome(income: IncomeReceipt[]): number {
  return income.reduce((total, receipt) => total + receipt.cents, 0);
}

export function sumIncomeSavings(income: IncomeReceipt[]): number {
  return income.reduce((total, receipt) => total + (receipt.savingsCents ?? 0), 0);
}

/** Whether a receipt's confirmed shares are whole cents that fit inside its amount. */
export function incomeSharesFit({ cents, savingsCents = 0, wantsCents = 0 }: IncomeReceipt): boolean {
  return (
    Number.isSafeInteger(savingsCents) &&
    Number.isSafeInteger(wantsCents) &&
    savingsCents >= 0 &&
    wantsCents >= 0 &&
    savingsCents + wantsCents <= cents
  );
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
