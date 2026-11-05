// Changing this week's allowance partway through, from PRODUCT_PLAN.md
// ("Allowance override" and the midweek adjustment example). Pure: every input
// is passed in, all money is integer cents in ONE currency.
//
// The key rule: free cash F comes from current cash, which has already gone
// down by what was spent this week. So only what is still left to spend, A - S,
// is compared with F. Comparing the whole allowance A would count S twice.
import type { IsoDate } from './dates';
import { suggestAllowance } from './allowance';

/** One side of the before/after comparison. */
export type AllowanceSide = {
  /** A: the total allowance for this week's active period. */
  allowanceCents: number;
  /** A - S. Negative means overspent. */
  remainingCents: number;
  /** F minus what this week may still spend: what the weeks after this one can use. */
  laterWeeksCents: number;
};

export type AllowanceChangeInput = {
  currentAllowanceCents: number;
  proposedAllowanceCents: number;
  /** S: discretionary spending already recorded this week. */
  spentCents: number;
  /** F = current cash - protected savings - unpaid commitments. May be negative. */
  freeCents: number;
};

export type AllowanceChangePreview =
  | { kind: 'unchanged' }
  | { kind: 'ok'; before: AllowanceSide; after: AllowanceSide; overspentCents: number }
  | {
      // Refused: the remaining amount would need money that is not free. The
      // student must release savings or change commitments first.
      kind: 'exceedsFreeCash';
      proposedRemainingCents: number;
      availableCents: number;
      excessCents: number;
    };

export function previewAllowanceChange({
  currentAllowanceCents,
  proposedAllowanceCents,
  spentCents,
  freeCents,
}: AllowanceChangeInput): AllowanceChangePreview {
  for (const [name, value] of Object.entries({ currentAllowanceCents, proposedAllowanceCents, spentCents, freeCents })) {
    requireSafeInteger(value, name);
  }
  // These come from our own code (parsed amounts and sums), never directly
  // from typing, so a negative value is a bug.
  if (proposedAllowanceCents < 0 || currentAllowanceCents < 0 || spentCents < 0) {
    throw new RangeError('Allowances and spending cannot be negative');
  }

  if (proposedAllowanceCents === currentAllowanceCents) {
    return { kind: 'unchanged' };
  }

  const proposedRemainingCents = proposedAllowanceCents - spentCents;
  const availableCents = Math.max(0, freeCents);
  // A reduction is always allowed, even below S: the overspend is shown, not clamped.
  // Only an increase that needs more than the free cash is refused.
  const isIncrease = proposedAllowanceCents > currentAllowanceCents;
  if (isIncrease && Math.max(0, proposedRemainingCents) > availableCents) {
    return {
      kind: 'exceedsFreeCash',
      proposedRemainingCents,
      availableCents,
      excessCents: proposedRemainingCents - availableCents,
    };
  }

  return {
    kind: 'ok',
    before: side(currentAllowanceCents, spentCents, freeCents),
    after: side(proposedAllowanceCents, spentCents, freeCents),
    overspentCents: Math.max(0, -proposedRemainingCents),
  };
}

function side(allowanceCents: number, spentCents: number, freeCents: number): AllowanceSide {
  const remainingCents = allowanceCents - spentCents;
  return { allowanceCents, remainingCents, laterWeeksCents: freeCents - Math.max(0, remainingCents) };
}

export type MidweekSuggestion =
  | { kind: 'ok'; totalCents: number; remainingCents: number; shortfallCents: number }
  | { kind: 'planExpired' };

/**
 * A fresh suggestion for the days still left, expressed as a TOTAL for the
 * week: what is already spent plus the day-prorated share of free cash.
 * Recommending $120 more spending means proposing S + $120, not resetting A to $120.
 */
export function midweekSuggestion({
  spentCents,
  freeCents,
  daysThisWeek,
  daysLeft,
}: {
  spentCents: number;
  freeCents: number;
  daysThisWeek: number;
  daysLeft: number;
}): MidweekSuggestion {
  const suggestion = suggestAllowance({ freeCents, daysThisWeek, daysLeft });
  if (suggestion.kind === 'planExpired') return suggestion;
  return {
    kind: 'ok',
    totalCents: spentCents + suggestion.suggestedCents,
    remainingCents: suggestion.suggestedCents,
    shortfallCents: suggestion.shortfallCents,
  };
}

/** The before/after record kept for every saved change. Purchases are never touched. */
export type AllowanceChange = {
  /** One per opening of the form, so a double tap on Save records it once. */
  id: string;
  madeOn: IsoDate;
  fromCents: number;
  toCents: number;
  /** The midweek suggestion shown when the change was made, for the record. */
  suggestedCents: number | null;
};

/** Appends a change unless one with the same id is already recorded. */
export function recordAllowanceChange(changes: AllowanceChange[], change: AllowanceChange): AllowanceChange[] {
  if (changes.some((existing) => existing.id === change.id)) return changes;
  return [...changes, change];
}

/** The allowance in force: the latest change, or the start-of-week snapshot. */
export function currentAllowanceCents(snapshotCents: number, changes: AllowanceChange[]): number {
  return changes.at(-1)?.toCents ?? snapshotCents;
}

function requireSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a whole number within the safe integer range (got ${value})`);
  }
}

/**
 * Whether this week's remaining amount is more than the money available for it.
 * The allowance is a snapshot and never changes by itself, so a later bill or
 * balance correction can leave it promising more than free cash covers. Null
 * when it does not, including when the week is already overspent.
 */
export function remainingOverFreeCash({
  remainingCents,
  freeCents,
}: {
  remainingCents: number;
  freeCents: number;
}): { availableCents: number; overCents: number } | null {
  const availableCents = Math.max(0, freeCents);
  const overCents = remainingCents - availableCents;
  return overCents > 0 ? { availableCents, overCents } : null;
}
