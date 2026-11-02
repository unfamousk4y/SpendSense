// FICTIONAL DEMO DATA for the representative screen. Not saved anywhere and not
// a real person's spending. Replace with persisted data once authentication and
// ownership checks exist.
import type { IsoDate } from '../domain/dates';
import type { Currency } from '../domain/money';
import type { Purchase } from '../domain/week';

export type DemoAccount = {
  currency: Currency;
  /** C now, after this week's purchases. */
  currentCashCents: number;
  /** P: protected savings allocation (part of C). */
  protectedCents: number;
  /** B: unpaid commitments due by the plan end date (part of C). */
  commitmentsCents: number;
  planEndDate: IsoDate;
  /** Snapshot taken at the start of the week. */
  recommendedAllowanceCents: number;
  chosenAllowanceCents: number;
  purchases: Purchase[];
};

/** A Thursday, so the screen shows a week in progress. */
export const DEMO_TODAY: IsoDate = '2026-11-05';
export const DEMO_WEEK_START: IsoDate = '2026-11-02';

export const demoAccounts: Record<Currency, DemoAccount> = {
  // The worked example from PRODUCT_PLAN.md, partway through the week.
  USD: {
    currency: 'USD',
    currentCashCents: 96000,
    protectedCents: 20000,
    commitmentsCents: 20000,
    planEndDate: '2026-11-29',
    recommendedAllowanceCents: 15000,
    chosenAllowanceCents: 15000,
    purchases: [
      { id: 'usd-1', date: '2026-11-03', merchant: 'Campus café', cents: 450 },
      { id: 'usd-2', date: '2026-11-04', merchant: 'Bookstore', note: 'Used statistics textbook', cents: 2800 },
      { id: 'usd-3', date: '2026-11-05', merchant: 'Bus pass top-up', cents: 750 },
    ],
  },
  // Separate account with its own numbers; never combined with USD.
  // The student chose slightly more than suggested, to show both on screen.
  BSD: {
    currency: 'BSD',
    currentCashCents: 32000,
    protectedCents: 5000,
    commitmentsCents: 12000,
    planEndDate: '2026-11-29',
    recommendedAllowanceCents: 4387,
    chosenAllowanceCents: 4500,
    purchases: [
      { id: 'bsd-1', date: '2026-11-02', merchant: 'Fish fry lunch', cents: 1200 },
      { id: 'bsd-2', date: '2026-11-04', merchant: 'Pharmacy', cents: 1350 },
    ],
  },
};
