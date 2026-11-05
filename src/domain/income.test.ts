import { describe, expect, test } from 'vitest';
import { demoLedger } from '../fixtures/demoWeek';
import { addIncomeOnce, previewIncome, removeIncome, sumIncome, updateIncome, type IncomeReceipt } from './income';
import { ledgerReducer, weekAccount, type Ledger, type LedgerAction } from './ledger';

const paid = (overrides: Partial<IncomeReceipt> = {}): IncomeReceipt => ({
  id: 'income-1',
  date: '2026-11-04',
  cents: 30000,
  ...overrides,
});

function run(state: Ledger, ...actions: LedgerAction[]): Ledger {
  return actions.reduce(ledgerReducer, state);
}

// Hand-worked, Wed Nov 4 with the plan ending Nov 29: 5 days this week, 26 left.
// Cash 960, protected 200, bills 200, so free cash 560; 40 already spent.
describe('previewIncome', () => {
  const now = { currentCashCents: 96000, freeCents: 56000, spentCents: 4000, daysThisWeek: 5, daysLeft: 26 };

  test('receiving 300: cash 1,260, free cash 860, new suggestion 205.38 for the week', () => {
    expect(previewIncome({ changeCents: 30000, ...now })).toEqual({
      before: { cashCents: 96000, freeCents: 56000 },
      after: { cashCents: 126000, freeCents: 86000 },
      // 860.00 x 5 / 26 = 165.3846..., rounded down to 165.38, plus the 40.00 spent.
      suggestion: { kind: 'ok', totalCents: 20538, remainingCents: 16538, shortfallCents: 0 },
    });
  });

  test('correcting an entry down by 100 lowers cash and free cash by exactly that', () => {
    expect(previewIncome({ changeCents: -10000, ...now }).after).toEqual({ cashCents: 86000, freeCents: 46000 });
  });

  test('income that does not cover a shortfall still shows what is missing', () => {
    const preview = previewIncome({ ...now, changeCents: 5000, freeCents: -8000 });
    expect(preview.after.freeCents).toBe(-3000);
    expect(preview.suggestion).toEqual({ kind: 'ok', totalCents: 4000, remainingCents: 0, shortfallCents: 3000 });
  });

  test('money that is not whole cents is a bug, not a rounding', () => {
    expect(() => previewIncome({ ...now, changeCents: 10.5 })).toThrow(RangeError);
  });
});

describe('income records', () => {
  test('a repeated save with the same id is recorded once', () => {
    expect(addIncomeOnce(addIncomeOnce([], paid()), paid())).toEqual([paid()]);
  });

  test('editing keeps the id and replaces the values; deleting removes only that entry', () => {
    const list = [paid(), paid({ id: 'income-2', cents: 100 })];
    expect(updateIncome(list, paid({ cents: 500 }))[0].cents).toBe(500);
    expect(removeIncome(list, 'income-1').map((receipt) => receipt.id)).toEqual(['income-2']);
  });

  test('adds up exactly', () => {
    expect(sumIncome([paid({ cents: 1 }), paid({ cents: 1999 })])).toBe(2000);
  });
});

// The demo starts Thu Nov 5 in the week of Nov 2: USD 1,000 opening cash, 200
// protected, 200 bills, allowance 150, 40 spent. The plan ends Nov 29.
describe('income in the ledger', () => {
  const received = (overrides: Partial<IncomeReceipt> = {}): LedgerAction => ({
    type: 'addIncome',
    currency: 'USD',
    income: paid(overrides),
  });

  test('this week: listed, and the allowance does not change by itself', () => {
    const account = weekAccount(run(demoLedger, received()), 'USD');
    expect(account.income).toEqual([paid()]);
    expect(account.weekStartCashCents).toBe(100000);
    expect(account.chosenAllowanceCents).toBe(15000);
    expect(account.protectedCents).toBe(20000);
    expect(account.commitmentsCents).toBe(20000);
  });

  test('a retry after a lost reply counts once', () => {
    expect(weekAccount(run(demoLedger, received(), received()), 'USD').income).toHaveLength(1);
  });

  test('USD income leaves BSD alone', () => {
    const before = weekAccount(demoLedger, 'BSD');
    expect(weekAccount(run(demoLedger, received()), 'BSD')).toEqual(before);
  });

  test('expected money is refused: a date after today changes nothing', () => {
    const state = run(demoLedger, received({ date: '2026-11-06' }));
    expect(weekAccount(state, 'USD').income).toEqual([]);
  });

  test('a date before this week changes nothing', () => {
    expect(weekAccount(run(demoLedger, received({ date: '2026-11-01' })), 'USD').income).toEqual([]);
  });

  test('next week: cash carries over, the closure protects 110, and the new plan uses the income', () => {
    const toMonday: LedgerAction[] = Array.from({ length: 4 }, () => ({ type: 'nextDay' }));
    const account = weekAccount(run(demoLedger, received(), ...toMonday), 'USD');
    // 1,000 + 300 - 40.
    expect(account.weekStartCashCents).toBe(126000);
    expect(account.income).toEqual([]);
    expect(account.protectedCents).toBe(31000);
    // Free cash 1,260 - 310 - 200 = 750, over 21 days, 7 of them this week.
    expect(account.recommendedAllowanceCents).toBe(25000);
  });

  test('income raises what closure can protect when free cash was the limit', () => {
    // The bill is set so free cash without the income would be only 10.
    const tight: Ledger = {
      ...demoLedger,
      accounts: { ...demoLedger.accounts, USD: { ...demoLedger.accounts.USD!, bills: [{ id: 'big', name: 'Fictional fee', dueOn: '2026-11-20', cents: 75000 }] } },
    };
    const toMonday: LedgerAction[] = Array.from({ length: 4 }, () => ({ type: 'nextDay' }));
    expect(weekAccount(run(tight, ...toMonday), 'USD').protectedCents).toBe(20000 + 1000);
    expect(weekAccount(run(tight, received(), ...toMonday), 'USD').protectedCents).toBe(20000 + 11000);
  });

  test('an open week entry can be edited or deleted, but not moved outside the week', () => {
    const start = run(demoLedger, received());
    const edited = run(start, { type: 'updateIncome', currency: 'USD', income: paid({ cents: 500 }) });
    expect(weekAccount(edited, 'USD').income[0].cents).toBe(500);

    const moved = run(start, { type: 'updateIncome', currency: 'USD', income: paid({ date: '2026-11-01' }) });
    expect(weekAccount(moved, 'USD').income[0].date).toBe('2026-11-04');

    const deleted = run(start, { type: 'deleteIncome', currency: 'USD', id: 'income-1' });
    expect(weekAccount(deleted, 'USD').income).toEqual([]);
  });

  test('once the week has closed, the entry stays as it is', () => {
    const toMonday: LedgerAction[] = Array.from({ length: 4 }, () => ({ type: 'nextDay' }));
    const closed = run(demoLedger, received(), ...toMonday);
    const edited = run(closed, { type: 'updateIncome', currency: 'USD', income: paid({ cents: 1 }) });
    const deleted = run(closed, { type: 'deleteIncome', currency: 'USD', id: 'income-1' });
    expect(edited).toEqual(closed);
    expect(deleted).toEqual(closed);
  });
});
