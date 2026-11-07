// Everything the app remembers, and the one function that changes it.
//
// `ledgerReducer` is a pure reducer: (old state, action) -> new state. React's
// useReducer calls it for every change, one action after another, each time
// with the state the previous action returned. Changes that belong together
// (closing a week AND starting the next) come back as one new state, so the
// screen can never show half of them.
//
// Only facts are stored: opening balances, purchases, income, bills, corrections, week plans, closures.
// Current cash and protected savings are worked out from them when needed.
import { freeCashCents, suggestAllowance } from './allowance';
import { currentAllowanceCents, recordAllowanceChange, type AllowanceChange } from './allowanceChange';
import {
  addBillOnce,
  billPaymentsCents,
  recordPayment,
  removeBill,
  splitPayment,
  undoPayment,
  unpaidBillsCents,
  updateBill,
  type Bill,
  type BillPayment,
} from './bills';
import { closeWeek, type WeekClosure } from './closure';
import { addCorrectionOnce, removeCorrection, sumCorrections, type BalanceCorrection } from './correction';
import { addDays, mondayOf, planDays, type IsoDate } from './dates';
import {
  addIncomeOnce,
  incomeSharesFit,
  removeIncome,
  sumIncome,
  sumIncomeSavings,
  updateIncome,
  type IncomeReceipt,
} from './income';
import type { Currency } from './money';
import { canStartNewPlan } from './newPlan';
import { previewRelease, recordRelease, type SavingsRelease } from './release';
import type { Split } from './split';
import { addPurchaseOnce, removePurchase, updatePurchase, type Purchase } from './week';

/** The allowance snapshot for one week, plus any explained changes to it. */
export type WeekPlan = {
  weekStart: IsoDate;
  /** The suggestion when the week started. */
  recommendedCents: number;
  /** The allowance chosen when the week started. */
  startingAllowanceCents: number;
  /** This week's share of what is left for wants. Absent until the week screen saves one. */
  wantsGuideCents?: number;
  /** Midweek changes, oldest first. The latest one is in force. */
  changes: AllowanceChange[];
};

export type AccountLedger = {
  currency: Currency;
  /**
   * The date the opening amounts were true. Spending before it is already
   * reflected in the opening cash, so purchases cannot be dated earlier.
   */
  openingDate: IsoDate;
  /** C on the opening date, before any recorded purchase or income. */
  openingCashCents: number;
  /** P on the opening date. Closures add to it. */
  openingProtectedCents: number;
  /** The default for new payments. Absent until setup saves one. */
  split?: Split;
  /** The wants share of the opening cash. Absent until setup saves one. */
  openingWantsCents?: number;
  planEndDate: IsoDate;
  /** Every bill, paid or not. B is worked out from these. */
  bills: Bill[];
  /** One plan per week the student actually had, oldest first. */
  weeks: WeekPlan[];
  /** Every recorded purchase, all weeks. */
  purchases: Purchase[];
  /** Every recorded receipt of money, all weeks. */
  income: IncomeReceipt[];
  /** Every balance correction, all weeks. */
  corrections: BalanceCorrection[];
  closures: WeekClosure[];
  /** Explicit releases of protected savings, oldest first. */
  releases: SavingsRelease[];
};

export type Ledger = {
  today: IsoDate;
  /** A student may have set up one currency or both. */
  accounts: Partial<Record<Currency, AccountLedger>>;
};

export type LedgerAction =
  | { type: 'addPurchase'; currency: Currency; purchase: Purchase }
  | { type: 'updatePurchase'; currency: Currency; purchase: Purchase }
  | { type: 'deletePurchase'; currency: Currency; id: string }
  | { type: 'addIncome'; currency: Currency; income: IncomeReceipt }
  | { type: 'updateIncome'; currency: Currency; income: IncomeReceipt }
  | { type: 'deleteIncome'; currency: Currency; id: string }
  | { type: 'addCorrection'; currency: Currency; correction: BalanceCorrection }
  | { type: 'deleteCorrection'; currency: Currency; id: string }
  | { type: 'addBill'; currency: Currency; bill: Bill }
  | { type: 'updateBill'; currency: Currency; bill: Bill }
  | { type: 'deleteBill'; currency: Currency; id: string }
  | { type: 'payBill'; currency: Currency; id: string; payment: BillPayment }
  | { type: 'payBillKeepRest'; currency: Currency; id: string; payment: BillPayment; restId: string }
  | { type: 'undoBillPayment'; currency: Currency; id: string }
  | { type: 'startNewPlan'; currency: Currency; endDate: IsoDate; week?: WeekPlan }
  | { type: 'changeAllowance'; currency: Currency; change: AllowanceChange }
  | { type: 'releaseSavings'; currency: Currency; release: SavingsRelease }
  | { type: 'nextDay' };

/** What the week screen needs for one account. Worked out, never stored. */
export type WeekAccount = {
  currency: Currency;
  weekStart: IsoDate;
  /** Cash at the start of Monday: this week's income and spending are not in it. */
  weekStartCashCents: number;
  protectedCents: number;
  /** B: unpaid bills due by the plan end date. */
  commitmentsCents: number;
  /** Every bill, including paid ones and ones due after the plan end. */
  bills: Bill[];
  /** What this week's bill payments took out of cash. Not spending. */
  billPaymentsThisWeekCents: number;
  openingDate: IsoDate;
  planEndDate: IsoDate;
  /** The default for new payments. Absent on an account made before splits. */
  split: Split | undefined;
  recommendedAllowanceCents: number;
  chosenAllowanceCents: number;
  allowanceChanges: AllowanceChange[];
  /** This week's purchases only. */
  purchases: Purchase[];
  /** This week's income only. */
  income: IncomeReceipt[];
  /** This week's balance corrections only. */
  corrections: BalanceCorrection[];
  /** The closure of the week just before this one, if it was closed. */
  previousClosure: WeekClosure | undefined;
};

export function ledgerReducer(state: Ledger, action: LedgerAction): Ledger {
  switch (action.type) {
    case 'addPurchase': {
      const existing = state.accounts[action.currency];
      // Only today or earlier in the open week. Closed weeks are never edited.
      if (!existing || !isOpenDate(state, existing, action.purchase.date)) return state;
      return changeAccount(state, action.currency, (account) => ({
        ...account,
        purchases: addPurchaseOnce(account.purchases, action.purchase),
      }));
    }

    case 'updatePurchase': {
      const existing = state.accounts[action.currency];
      const original = existing?.purchases.find((p) => p.id === action.purchase.id);
      // Both where it was and where it is moving to must be in the open week.
      if (!existing || !original) return state;
      if (!isOpenDate(state, existing, original.date) || !isOpenDate(state, existing, action.purchase.date)) return state;
      return changeAccount(state, action.currency, (account) => ({
        ...account,
        purchases: updatePurchase(account.purchases, action.purchase),
      }));
    }

    case 'deletePurchase': {
      const existing = state.accounts[action.currency];
      const original = existing?.purchases.find((p) => p.id === action.id);
      if (!existing || !original || !isOpenDate(state, existing, original.date)) return state;
      return changeAccount(state, action.currency, (account) => ({
        ...account,
        purchases: removePurchase(account.purchases, action.id),
      }));
    }

    case 'addIncome': {
      const existing = state.accounts[action.currency];
      // Only money already received, in the open week. Closed weeks are never edited.
      if (!existing || !isOpenDate(state, existing, action.income.date)) return state;
      const income = addIncomeOnce(existing.income, action.income);
      // Already recorded (a double tap): nothing to check or change.
      if (income === existing.income) return state;
      if (!incomeChangeFits(existing, income, undefined, action.income)) return state;
      return changeAccount(state, action.currency, (account) => ({ ...account, income }));
    }

    case 'updateIncome': {
      const existing = state.accounts[action.currency];
      const original = existing?.income.find((receipt) => receipt.id === action.income.id);
      if (!existing || !original) return state;
      if (!isOpenDate(state, existing, original.date) || !isOpenDate(state, existing, action.income.date)) return state;
      const income = updateIncome(existing.income, action.income);
      if (!incomeChangeFits(existing, income, original, action.income)) return state;
      return changeAccount(state, action.currency, (account) => ({ ...account, income }));
    }

    case 'deleteIncome': {
      const existing = state.accounts[action.currency];
      const original = existing?.income.find((receipt) => receipt.id === action.id);
      if (!existing || !original || !isOpenDate(state, existing, original.date)) return state;
      const income = removeIncome(existing.income, action.id);
      if (!incomeChangeFits(existing, income, original, undefined)) return state;
      return changeAccount(state, action.currency, (account) => ({ ...account, income }));
    }

    case 'addCorrection': {
      const existing = state.accounts[action.currency];
      // Only in the open week. Closed weeks are never edited.
      if (!existing || !isOpenDate(state, existing, action.correction.date)) return state;
      return changeAccount(state, action.currency, (account) => ({
        ...account,
        corrections: addCorrectionOnce(account.corrections, action.correction),
      }));
    }

    case 'deleteCorrection': {
      const existing = state.accounts[action.currency];
      const original = existing?.corrections.find((correction) => correction.id === action.id);
      if (!existing || !original || !isOpenDate(state, existing, original.date)) return state;
      return changeAccount(state, action.currency, (account) => ({
        ...account,
        corrections: removeCorrection(account.corrections, action.id),
      }));
    }

    case 'addBill':
      return changeAccount(state, action.currency, (account) => ({
        ...account,
        bills: addBillOnce(account.bills, action.bill),
      }));

    case 'updateBill': {
      const existing = state.accounts[action.currency];
      const original = existing?.bills.find((bill) => bill.id === action.bill.id);
      if (!existing || !original || !billCanChange(state, existing, original)) return state;
      return changeAccount(state, action.currency, (account) => ({
        ...account,
        bills: updateBill(account.bills, action.bill),
      }));
    }

    case 'deleteBill': {
      const existing = state.accounts[action.currency];
      const original = existing?.bills.find((bill) => bill.id === action.id);
      if (!existing || !original || !billCanChange(state, existing, original)) return state;
      return changeAccount(state, action.currency, (account) => ({
        ...account,
        bills: removeBill(account.bills, action.id),
      }));
    }

    case 'payBill': {
      const existing = state.accounts[action.currency];
      const original = existing?.bills.find((bill) => bill.id === action.id);
      // Only paid already, today or earlier in the open week. Closed weeks are never edited.
      if (!existing || !original || !billCanChange(state, existing, original)) return state;
      if (!isOpenDate(state, existing, action.payment.paidOn)) return state;
      return changeAccount(state, action.currency, (account) => ({
        ...account,
        bills: updateBill(account.bills, recordPayment(original, action.payment)),
      }));
    }

    case 'payBillKeepRest': {
      const existing = state.accounts[action.currency];
      const original = existing?.bills.find((bill) => bill.id === action.id);
      if (!existing || !original || !billCanChange(state, existing, original)) return state;
      if (!isOpenDate(state, existing, action.payment.paidOn)) return state;
      // Already split (a retry), or nothing would be left to owe.
      if (existing.bills.some((bill) => bill.id === action.restId) || action.payment.paidCents >= original.cents) return state;
      const [paidPart, rest] = splitPayment(original, action.payment, action.restId);
      return changeAccount(state, action.currency, (account) => ({
        ...account,
        bills: addBillOnce(updateBill(account.bills, paidPart), rest),
      }));
    }

    case 'undoBillPayment': {
      const existing = state.accounts[action.currency];
      const original = existing?.bills.find((bill) => bill.id === action.id);
      if (!existing || !original || !billCanChange(state, existing, original)) return state;
      return changeAccount(state, action.currency, (account) => ({
        ...account,
        bills: updateBill(account.bills, undoPayment(original)),
      }));
    }

    case 'startNewPlan': {
      const existing = state.accounts[action.currency];
      if (!existing || action.endDate < state.today) return state;
      // A plan still running stays as it is. The same end date is a repeated save.
      if (!canStartNewPlan(existing.planEndDate, state.today) && existing.planEndDate !== action.endDate) return state;
      return changeAccount(state, action.currency, (account) => ({
        ...account,
        planEndDate: action.endDate,
        // A week that has a plan keeps it: allowances never change by themselves.
        weeks:
          action.week && !hasPlanThisWeek(account, state.today) ? [...account.weeks, action.week] : account.weeks,
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
      if (!account) return state;
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
  // The demo waits once no account has a plan this week: its next step is
  // starting a new one, not another day.
  if (!presentAccounts(state).some((account) => hasPlanThisWeek(account, state.today))) return state;

  const tomorrow = addDays(state.today, 1);
  const endedWeek = mondayOf(state.today);
  const newWeek = mondayOf(tomorrow);
  if (endedWeek === newWeek) return { ...state, today: tomorrow };

  const accounts = { ...state.accounts };
  for (const account of presentAccounts(state)) {
    accounts[account.currency] = rollOver(account, endedWeek, newWeek);
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
  if (!account) throw new Error(`No ${currency} account in the ledger`);
  const weekStart = mondayOf(state.today);
  const plan = account.weeks.find((week) => week.weekStart === weekStart);
  if (!plan) {
    // advanceDay always starts a plan before the plan end, so this is a bug.
    throw new Error(`No ${currency} plan for the week of ${weekStart}`);
  }
  return {
    currency,
    weekStart,
    weekStartCashCents:
      account.openingCashCents +
      sumIncome(account.income.filter((receipt) => receipt.date < weekStart)) -
      sumCents(account.purchases.filter((p) => p.date < weekStart)) -
      billPaymentsCents(account.bills, weekStart) +
      sumCorrections(account.corrections.filter((correction) => correction.date < weekStart)),
    protectedCents: protectedCents(account, account.closures),
    commitmentsCents: unpaidBillsCents(account.bills, account.planEndDate),
    bills: account.bills,
    billPaymentsThisWeekCents: billPaymentsCents(account.bills) - billPaymentsCents(account.bills, weekStart),
    openingDate: account.openingDate,
    planEndDate: account.planEndDate,
    split: account.split,
    recommendedAllowanceCents: plan.recommendedCents,
    chosenAllowanceCents: currentAllowanceCents(plan.startingAllowanceCents, plan.changes),
    allowanceChanges: plan.changes,
    purchases: account.purchases.filter((p) => mondayOf(p.date) === weekStart),
    income: account.income.filter((receipt) => mondayOf(receipt.date) === weekStart),
    corrections: account.corrections.filter((correction) => mondayOf(correction.date) === weekStart),
    previousClosure: account.closures.find((closure) => closure.weekStart === addDays(weekStart, -7)),
  };
}

/** Whether this account has an allowance plan for the week containing today. */
export function hasPlanThisWeek(account: AccountLedger, today: IsoDate): boolean {
  return account.weeks.some((week) => week.weekStart === mondayOf(today));
}

/** Whether a planned week has ended without being closed yet. */
export function hasEndedWeekToClose(account: AccountLedger, today: IsoDate): boolean {
  return account.weeks.some(
    (week) =>
      addDays(week.weekStart, 7) <= today && !account.closures.some((closure) => closure.weekStart === week.weekStart),
  );
}

/**
 * The plan to create when an account reaches a week it has no plan for, or
 * null if it has one or the plan end date has passed. Days are counted from
 * today, since the student may first open the app partway through the week.
 */
export function planForNewWeek(account: AccountLedger, today: IsoDate): WeekPlan | null {
  if (hasPlanThisWeek(account, today)) return null;
  const suggestion = suggestAllowance({
    freeCents: freeCashCents(cashParts(account, account.closures)),
    ...planDays(today, account.planEndDate),
  });
  if (suggestion.kind === 'planExpired') return null;
  return {
    weekStart: mondayOf(today),
    recommendedCents: suggestion.suggestedCents,
    startingAllowanceCents: suggestion.suggestedCents,
    changes: [],
  };
}

function presentAccounts(state: Ledger): AccountLedger[] {
  return Object.values(state.accounts).filter((account): account is AccountLedger => account !== undefined);
}

function isOpenDate(state: Ledger, account: AccountLedger, date: IsoDate): boolean {
  return mondayOf(date) === mondayOf(state.today) && date <= state.today && date >= account.openingDate;
}

/** An unpaid bill moved no cash, so it can always change. A payment locks once its week closes. */
function billCanChange(state: Ledger, account: AccountLedger, bill: Bill): boolean {
  return bill.paidOn === undefined || isOpenDate(state, account, bill.paidOn);
}

function changeAccount(state: Ledger, currency: Currency, change: (account: AccountLedger) => AccountLedger): Ledger {
  const account = state.accounts[currency];
  if (!account) return state;
  return { ...state, accounts: { ...state.accounts, [currency]: change(account) } };
}

/**
 * Checked here too, not only in the form. Protected savings can never go below
 * zero, which editing income could do after its savings were released, and
 * setting more aside can never deepen a shortfall.
 */
function incomeChangeFits(
  account: AccountLedger,
  income: IncomeReceipt[],
  before: IncomeReceipt | undefined,
  after: IncomeReceipt | undefined,
): boolean {
  if (after && !incomeSharesFit(after)) return false;
  const parts = cashParts({ ...account, income }, account.closures);
  if (parts.protectedCents < 0) return false;
  const savingsGrew = (after?.savingsCents ?? 0) > (before?.savingsCents ?? 0);
  return !savingsGrew || freeCashCents(parts) >= 0;
}

function cashParts(account: AccountLedger, closures: WeekClosure[]) {
  return {
    // Everything recorded is dated today or earlier, so this is current cash.
    currentCashCents:
      account.openingCashCents +
      sumIncome(account.income) -
      sumCents(account.purchases) -
      billPaymentsCents(account.bills) +
      sumCorrections(account.corrections),
    protectedCents: protectedCents(account, closures),
    commitmentsCents: unpaidBillsCents(account.bills, account.planEndDate),
  };
}

/** Current cash and protected savings, which a new plan carries over as they are. */
export function accountCash(account: AccountLedger): { currentCashCents: number; protectedCents: number } {
  const { currentCashCents, protectedCents } = cashParts(account, account.closures);
  return { currentCashCents, protectedCents };
}

function protectedCents(account: AccountLedger, closures: WeekClosure[]): number {
  const protectedByClosures = closures.reduce((total, closure) => total + closure.protectedCents, 0);
  const released = account.releases.reduce((total, release) => total + release.cents, 0);
  return account.openingProtectedCents + protectedByClosures + sumIncomeSavings(account.income) - released;
}

function spentIn(account: AccountLedger, weekStart: IsoDate): number {
  return sumCents(account.purchases.filter((p) => mondayOf(p.date) === weekStart));
}

function sumCents(purchases: Purchase[]): number {
  return purchases.reduce((total, purchase) => total + purchase.cents, 0);
}
