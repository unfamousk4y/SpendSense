// Everything the app remembers, and the one function that changes it.
//
// `ledgerReducer` is a pure reducer: (old state, action) -> new state. React's
// useReducer calls it for every change, one action after another, each time
// with the state the previous action returned. Changes that belong together
// (closing a week AND starting the next) come back as one new state, so the
// screen can never show half of them.
//
// Only facts are stored: opening balances, purchases, week plans, closures.
// Current cash and protected savings are worked out from them when needed.
import { freeCashCents, suggestAllowance } from './allowance';
import { currentAllowanceCents, recordAllowanceChange, type AllowanceChange } from './allowanceChange';
import { closeWeek, type WeekClosure } from './closure';
import { addDays, mondayOf, planDays, type IsoDate } from './dates';
import type { Currency } from './money';
import { previewRelease, recordRelease, type SavingsRelease } from './release';
import { addPurchaseOnce, removePurchase, updatePurchase, type Purchase } from './week';

/** The allowance snapshot for one week, plus any explained changes to it. */
export type WeekPlan = {
  weekStart: IsoDate;
  /** The suggestion when the week started. */
  recommendedCents: number;
  /** The allowance chosen when the week started. */
  startingAllowanceCents: number;
  /** Midweek changes, oldest first. The latest one is in force. */
  changes: AllowanceChange[];
};

export type AccountLedger = {
  currency: Currency;
  /** C at the start of the first planned week, before any recorded purchase. */
  openingCashCents: number;
  /** P at the start of the first planned week. Closures add to it. */
  openingProtectedCents: number;
  /** B: unpaid commitments due by the plan end date. */
  commitmentsCents: number;
  planEndDate: IsoDate;
  /** One plan per week the student actually had, oldest first. */
  weeks: WeekPlan[];
  /** Every recorded purchase, all weeks. */
  purchases: Purchase[];
  closures: WeekClosure[];
  /** Explicit releases of protected savings, oldest first. */
  releases: SavingsRelease[];
};

export type Ledger = {
  today: IsoDate;
  accounts: Record<Currency, AccountLedger>;
};

export type LedgerAction =
  | { type: 'addPurchase'; currency: Currency; purchase: Purchase }
  | { type: 'updatePurchase'; currency: Currency; purchase: Purchase }
  | { type: 'deletePurchase'; currency: Currency; id: string }
  | { type: 'changeAllowance'; currency: Currency; change: AllowanceChange }
  | { type: 'releaseSavings'; currency: Currency; release: SavingsRelease }
  | { type: 'nextDay' };

/** What the week screen needs for one account. Worked out, never stored. */
export type WeekAccount = {
  currency: Currency;
  weekStart: IsoDate;
  weekStartCashCents: number;
  protectedCents: number;
  commitmentsCents: number;
  planEndDate: IsoDate;
  recommendedAllowanceCents: number;
  chosenAllowanceCents: number;
  allowanceChanges: AllowanceChange[];
  /** This week's purchases only. */
  purchases: Purchase[];
  /** The closure of the week just before this one, if it was closed. */
  previousClosure: WeekClosure | undefined;
};

export function ledgerReducer(state: Ledger, action: LedgerAction): Ledger {
  switch (action.type) {
    case 'addPurchase':
      // Only today or earlier in the open week. Closed weeks are never edited.
      if (!isOpenDate(state, action.purchase.date)) return state;
      return changeAccount(state, action.currency, (account) => ({
        ...account,
        purchases: addPurchaseOnce(account.purchases, action.purchase),
      }));

    case 'updatePurchase': {
      const original = state.accounts[action.currency].purchases.find((p) => p.id === action.purchase.id);
      // Both where it was and where it is moving to must be in the open week.
      if (!original || !isOpenDate(state, original.date) || !isOpenDate(state, action.purchase.date)) return state;
      return changeAccount(state, action.currency, (account) => ({
        ...account,
        purchases: updatePurchase(account.purchases, action.purchase),
      }));
    }

    case 'deletePurchase': {
      const original = state.accounts[action.currency].purchases.find((p) => p.id === action.id);
      if (!original || !isOpenDate(state, original.date)) return state;
      return changeAccount(state, action.currency, (account) => ({
        ...account,
        purchases: removePurchase(account.purchases, action.id),
      }));
    }

    case 'changeAllowance': {
      const weekStart = mondayOf(state.today);
      return changeAccount(state, action.currency, (account) => ({
        ...account,
        weeks: account.weeks.map((week) =>
          week.weekStart === weekStart ? { ...week, changes: recordAllowanceChange(week.changes, action.change) } : week,
        ),
      }));
    }

    case 'releaseSavings': {
      const account = state.accounts[action.currency];
      // Already recorded (a double tap): nothing to check or change.
      if (account.releases.some((release) => release.id === action.release.id)) return state;
      // Checked here too, not only in the dialog: never release more than is protected.
      const parts = cashParts(account, account.closures);
      const preview = previewRelease({
        releaseCents: action.release.cents,
        protectedCents: parts.protectedCents,
        freeCents: freeCashCents(parts),
      });
      if (preview.kind !== 'ok') return state;
      return changeAccount(state, action.currency, (current) => ({
        ...current,
        releases: recordRelease(current.releases, action.release),
      }));
    }

    case 'nextDay':
      return advanceDay(state);
  }
}

/**
 * Moves the date forward one day. Crossing into a new week closes the week
 * that ended and starts the next one's plan, for every account, in the same
 * returned state.
 */
function advanceDay(state: Ledger): Ledger {
  // The demo stops at the earliest plan end; a new plan is out of scope.
  const lastDay = Object.values(state.accounts)
    .map((account) => account.planEndDate)
    .sort()[0];
  if (state.today >= lastDay) return state;

  const tomorrow = addDays(state.today, 1);
  const endedWeek = mondayOf(state.today);
  const newWeek = mondayOf(tomorrow);
  if (endedWeek === newWeek) return { ...state, today: tomorrow };

  const accounts = { ...state.accounts };
  for (const currency of Object.keys(accounts) as Currency[]) {
    accounts[currency] = rollOver(accounts[currency], endedWeek, newWeek);
  }
  return { today: tomorrow, accounts };
}

function rollOver(account: AccountLedger, endedWeek: IsoDate, newWeek: IsoDate): AccountLedger {
  const plan = account.weeks.find((week) => week.weekStart === endedWeek);
  let closures = account.closures;

  // Only a week the student planned is closed; nothing is invented for others.
  if (plan) {
    const spentCents = spentIn(account, endedWeek);
    const result = closeWeek({
      currency: account.currency,
      weekStart: endedWeek,
      allowanceCents: currentAllowanceCents(plan.startingAllowanceCents, plan.changes),
      spentCents,
      freeCents: freeCashCents(cashParts(account, account.closures)),
      closures,
    });
    if (result.kind === 'closed') closures = [...closures, result.closure];
  }

  // The new week's snapshot uses free cash AFTER the closure.
  const suggestion = suggestAllowance({
    freeCents: freeCashCents(cashParts(account, closures)),
    ...planDays(newWeek, account.planEndDate),
  });
  const weeks =
    suggestion.kind === 'ok' && !account.weeks.some((week) => week.weekStart === newWeek)
      ? [
          ...account.weeks,
          {
            weekStart: newWeek,
            recommendedCents: suggestion.suggestedCents,
            startingAllowanceCents: suggestion.suggestedCents,
            changes: [],
          },
        ]
      : account.weeks;

  return { ...account, closures, weeks };
}

/** The week screen's numbers for one account on the ledger's current date. */
export function weekAccount(state: Ledger, currency: Currency): WeekAccount {
  const account = state.accounts[currency];
  const weekStart = mondayOf(state.today);
  const plan = account.weeks.find((week) => week.weekStart === weekStart);
  if (!plan) {
    // advanceDay always starts a plan before the plan end, so this is a bug.
    throw new Error(`No ${currency} plan for the week of ${weekStart}`);
  }
  return {
    currency,
    weekStart,
    weekStartCashCents: account.openingCashCents - sumCents(account.purchases.filter((p) => p.date < weekStart)),
    protectedCents: protectedCents(account, account.closures),
    commitmentsCents: account.commitmentsCents,
    planEndDate: account.planEndDate,
    recommendedAllowanceCents: plan.recommendedCents,
    chosenAllowanceCents: currentAllowanceCents(plan.startingAllowanceCents, plan.changes),
    allowanceChanges: plan.changes,
    purchases: account.purchases.filter((p) => mondayOf(p.date) === weekStart),
    previousClosure: account.closures.find((closure) => closure.weekStart === addDays(weekStart, -7)),
  };
}

function isOpenDate(state: Ledger, date: IsoDate): boolean {
  return mondayOf(date) === mondayOf(state.today) && date <= state.today;
}

function changeAccount(state: Ledger, currency: Currency, change: (account: AccountLedger) => AccountLedger): Ledger {
  return { ...state, accounts: { ...state.accounts, [currency]: change(state.accounts[currency]) } };
}

function cashParts(account: AccountLedger, closures: WeekClosure[]) {
  return {
    // Every recorded purchase is on or before today, so this is current cash.
    currentCashCents: account.openingCashCents - sumCents(account.purchases),
    protectedCents: protectedCents(account, closures),
    commitmentsCents: account.commitmentsCents,
  };
}

function protectedCents(account: AccountLedger, closures: WeekClosure[]): number {
  const protectedByClosures = closures.reduce((total, closure) => total + closure.protectedCents, 0);
  const released = account.releases.reduce((total, release) => total + release.cents, 0);
  return account.openingProtectedCents + protectedByClosures - released;
}

function spentIn(account: AccountLedger, weekStart: IsoDate): number {
  return sumCents(account.purchases.filter((p) => mondayOf(p.date) === weekStart));
}

function sumCents(purchases: Purchase[]): number {
  return purchases.reduce((total, purchase) => total + purchase.cents, 0);
}
