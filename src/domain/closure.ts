// Closing a finished week, from PRODUCT_PLAN.md ("At weekly closure" and
// "Rollover with a shortfall"). Pure: every input is passed in, all money is
// integer cents in ONE currency.
//
// Closing moves nothing and spends nothing. It relabels part of the cash the
// student still has: the unused allowance becomes protected savings (P goes
// up, C stays the same). Free cash F is only a ceiling here, never added:
// the unspent allowance is still cash, so it is already inside F.
import type { IsoDate } from './dates';
import type { Currency } from './money';

/**
 * The record of one closed week. (currency, weekStart) identifies it: a week
 * can only ever be closed once, so the week itself is the key. In the database
 * this becomes a uniqueness constraint.
 */
export type WeekClosure = {
  currency: Currency;
  weekStart: IsoDate;
  allowanceCents: number;
  spentCents: number;
  /** A - S. Negative means the week was overspent. */
  leftoverCents: number;
  /** Moved into protected savings: min(max(0, A - S), max(0, F)). */
  protectedCents: number;
};

export type CloseWeekInput = {
  currency: Currency;
  weekStart: IsoDate;
  /** A: the allowance in force at the end of the week, including any midweek change. */
  allowanceCents: number;
  /** S: discretionary spending recorded in that week. */
  spentCents: number;
  /** F = current cash - protected savings - unpaid commitments, before closing. May be negative. */
  freeCents: number;
  /** Every closure recorded so far, any currency. */
  closures: WeekClosure[];
};

export type CloseWeekResult =
  | { kind: 'closed'; closure: WeekClosure }
  // Running closure again (a retry, a second tab) changes nothing.
  | { kind: 'alreadyClosed'; closure: WeekClosure };

export function closeWeek({
  currency,
  weekStart,
  allowanceCents,
  spentCents,
  freeCents,
  closures,
}: CloseWeekInput): CloseWeekResult {
  for (const [name, value] of Object.entries({ allowanceCents, spentCents, freeCents })) {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`${name} must be a whole number within the safe integer range (got ${value})`);
    }
  }
  if (allowanceCents < 0 || spentCents < 0) {
    throw new RangeError('Allowance and spending cannot be negative');
  }

  const existing = closures.find((closure) => closure.currency === currency && closure.weekStart === weekStart);
  if (existing) {
    return { kind: 'alreadyClosed', closure: existing };
  }

  const leftoverCents = allowanceCents - spentCents;
  // Overspending protects nothing, and money already needed for bills (or a
  // negative F) is never protected: no negative savings event.
  const protectedCents = Math.min(Math.max(0, leftoverCents), Math.max(0, freeCents));

  return {
    kind: 'closed',
    closure: { currency, weekStart, allowanceCents, spentCents, leftoverCents, protectedCents },
  };
}
