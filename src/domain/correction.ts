// Correcting the balance, from PRODUCT_PLAN.md: "Show users how to correct the
// current balance with a labeled adjustment that does not masquerade as
// spending." Pure: all money is integer cents in ONE currency.
//
// A correction moves cash C and free cash F by the same amount. It is not
// spending or income, and it never changes protected savings, bills or this
// week's allowance. Closed weeks are not rewritten: it applies from today.
import { MAX_AMOUNT_CENTS } from './amount';
import { midweekSuggestion, type MidweekSuggestion } from './allowanceChange';
import type { IsoDate } from './dates';

export type BalanceCorrection = {
  /** One per opening of the form, so a repeated save is the same correction. */
  id: string;
  date: IsoDate;
  /** Signed: below zero when the real balance was lower than the app's cash. Never 0. */
  differenceCents: number;
  note?: string;
};

export type CorrectionSide = { cashCents: number; freeCents: number };

export type CorrectionPreview =
  | {
      kind: 'ok';
      differenceCents: number;
      before: CorrectionSide;
      after: CorrectionSide;
      /** A fresh suggestion for this week if it is saved. Only ever offered. */
      suggestion: MidweekSuggestion;
    }
  // Expected student situations, explained on screen.
  | { kind: 'noDifference' }
  | { kind: 'tooLarge' };

/** The student types the balance they can see; the difference is worked out from it. */
export function previewCorrection({
  actualCents,
  currentCashCents,
  freeCents,
  spentCents,
  daysThisWeek,
  daysLeft,
}: {
  actualCents: number;
  currentCashCents: number;
  freeCents: number;
  spentCents: number;
  daysThisWeek: number;
  daysLeft: number;
}): CorrectionPreview {
  for (const [name, value] of Object.entries({ actualCents, currentCashCents, freeCents, spentCents })) {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`${name} must be a whole number within the safe integer range (got ${value})`);
    }
  }
  const differenceCents = actualCents - currentCashCents;
  if (differenceCents === 0) return { kind: 'noDifference' };
  if (Math.abs(differenceCents) > MAX_AMOUNT_CENTS) return { kind: 'tooLarge' };

  const afterFreeCents = freeCents + differenceCents;
  return {
    kind: 'ok',
    differenceCents,
    before: { cashCents: currentCashCents, freeCents },
    after: { cashCents: actualCents, freeCents: afterFreeCents },
    suggestion: midweekSuggestion({ spentCents, freeCents: afterFreeCents, daysThisWeek, daysLeft }),
  };
}

export function sumCorrections(corrections: BalanceCorrection[]): number {
  return corrections.reduce((total, correction) => total + correction.differenceCents, 0);
}

/** Appends a correction unless one with the same id is already recorded. */
export function addCorrectionOnce(corrections: BalanceCorrection[], correction: BalanceCorrection): BalanceCorrection[] {
  if (corrections.some((existing) => existing.id === correction.id)) return corrections;
  return [...corrections, correction];
}

export function removeCorrection(corrections: BalanceCorrection[], id: string): BalanceCorrection[] {
  return corrections.filter((existing) => existing.id !== id);
}
