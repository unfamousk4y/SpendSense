// Pure summary of one Monday to Sunday week for one currency account.
import type { CategoryId, NeedOrWant } from './categories';
import { daysBetween, type IsoDate } from './dates';

export type Purchase = {
  /** Created once when the entry form opens; a repeated save reuses it. */
  id: string;
  date: IsoDate;
  /** Where the money went, kept short: "Bookstore". May be empty. */
  merchant: string;
  /** Optional detail shown on its own line: "Used statistics textbook". */
  note?: string;
  category?: CategoryId;
  needOrWant?: NeedOrWant;
  cents: number;
};

/**
 * Adds a purchase unless one with the same id is already in the list, so a
 * double tap or retry cannot record the same purchase twice. Returns a new
 * list (or the same list when nothing changed) and never edits the old one.
 */
export function addPurchaseOnce(purchases: Purchase[], purchase: Purchase): Purchase[] {
  if (purchases.some((existing) => existing.id === purchase.id)) {
    return purchases;
  }
  return [...purchases, purchase];
}

export type WeekSummary = {
  spentCents: number;
  /** Chosen allowance minus spending. Negative means overspent; never clamped. */
  remainingCents: number;
  /** Total spent by the end of each day, Monday first (7 entries). */
  cumulativeCents: number[];
  /** Even-paced share of the allowance by the end of each day, rounded down (7 entries). */
  evenPaceCents: number[];
};

const KNOWN_MONDAY = '2026-11-02';

export function summarizeWeek(
  weekStart: IsoDate,
  allowanceCents: number,
  purchases: Purchase[],
): WeekSummary {
  const offset = daysBetween(KNOWN_MONDAY, weekStart);
  if (((offset % 7) + 7) % 7 !== 0) {
    throw new RangeError(`weekStart must be a Monday (got ${weekStart})`);
  }

  const dailyCents = [0, 0, 0, 0, 0, 0, 0];
  for (const purchase of purchases) {
    const day = daysBetween(weekStart, purchase.date);
    if (day < 0 || day > 6) {
      throw new RangeError(`Purchase ${purchase.id} on ${purchase.date} is outside the week of ${weekStart}`);
    }
    dailyCents[day] += purchase.cents;
  }

  let runningTotal = 0;
  const cumulativeCents = dailyCents.map((cents) => (runningTotal += cents));
  const evenPaceCents = dailyCents.map((_, day) => Math.floor((allowanceCents * (day + 1)) / 7));

  return {
    spentCents: runningTotal,
    remainingCents: allowanceCents - runningTotal,
    cumulativeCents,
    evenPaceCents,
  };
}
