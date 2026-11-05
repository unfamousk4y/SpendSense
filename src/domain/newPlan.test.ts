import { describe, expect, test } from 'vitest';
import type { Bill } from './bills';
import { demoLedger } from '../fixtures/demoWeek';
import { hasPlanThisWeek, ledgerReducer, weekAccount, type AccountLedger, type Ledger, type LedgerAction } from './ledger';
import { canStartNewPlan, previewNewPlan } from './newPlan';

const phone: Bill = { id: 'phone', name: 'Phone', dueOn: '2026-11-25', cents: 5000 };
const deposit: Bill = { id: 'deposit', name: 'Deposit', dueOn: '2026-12-10', cents: 30000 };

// Mon Nov 30, after a plan that ended Nov 29. Cash 810, savings 310.
const now = { today: '2026-11-30', currentCashCents: 81000, protectedCents: 31000, bills: [phone, deposit], spentCents: 0 };

describe('canStartNewPlan', () => {
  test('not before the last day, then on it and after it', () => {
    expect(canStartNewPlan('2026-11-29', '2026-11-28')).toBe(false);
    expect(canStartNewPlan('2026-11-29', '2026-11-29')).toBe(true);
    expect(canStartNewPlan('2026-11-29', '2026-11-30')).toBe(true);
  });
});

describe('previewNewPlan', () => {
  test('worked example, to Dec 27: 28 days, B 350, free cash 150, suggests 37.50', () => {
    expect(previewNewPlan({ ...now, endDate: '2026-12-27' })).toEqual({
      kind: 'ok',
      commitmentsCents: 35000,
      freeCents: 15000,
      daysLeft: 28,
      suggestedCents: 3750,
      shortfallCents: 0,
      billsAfterEnd: [],
    });
  });

  test('worked example, to Dec 6: 7 days, the deposit is named and not counted, free cash 450, suggests 450', () => {
    expect(previewNewPlan({ ...now, endDate: '2026-12-06' })).toEqual({
      kind: 'ok',
      commitmentsCents: 5000,
      freeCents: 45000,
      daysLeft: 7,
      suggestedCents: 45000,
      shortfallCents: 0,
      billsAfterEnd: [deposit],
    });
  });

  test('a bill due exactly on the new end date counts', () => {
    const preview = previewNewPlan({ ...now, endDate: '2026-12-10' });
    expect(preview).toMatchObject({ commitmentsCents: 35000, billsAfterEnd: [] });
  });

  test('a paid bill is neither counted nor named', () => {
    const paid: Bill = { ...deposit, paidOn: '2026-11-30', paidCents: 30000 };
    expect(previewNewPlan({ ...now, bills: [phone, paid], endDate: '2026-12-06' })).toMatchObject({
      commitmentsCents: 5000,
      billsAfterEnd: [],
    });
  });

  test('a plan that cannot cover its bills shows the shortfall and suggests nothing', () => {
    expect(previewNewPlan({ ...now, currentCashCents: 60000, endDate: '2026-12-27' })).toMatchObject({
      freeCents: -6000,
      suggestedCents: 0,
      shortfallCents: 6000,
    });
  });

  test('midweek the suggestion is a total: what is spent, plus a share of the days left', () => {
    // Thu Dec 3 to Dec 27 is 25 days, 4 of them this week: 150 x 4 / 25 = 24, plus 40 spent.
    expect(previewNewPlan({ ...now, today: '2026-12-03', spentCents: 4000, endDate: '2026-12-27' })).toMatchObject({
      daysLeft: 25,
      suggestedCents: 6400,
    });
  });

  test('ending today is a one day plan', () => {
    expect(previewNewPlan({ ...now, endDate: '2026-11-30' })).toMatchObject({ kind: 'ok', daysLeft: 1 });
  });

  test('an end date before today is refused', () => {
    expect(previewNewPlan({ ...now, endDate: '2026-11-29' })).toEqual({ kind: 'endPassed' });
  });
});

describe('starting a new plan in the ledger', () => {
  const run = (state: Ledger, ...actions: LedgerAction[]) => actions.reduce(ledgerReducer, state);
  const toMonday: LedgerAction[] = Array.from({ length: 4 }, () => ({ type: 'nextDay' }));

  // The demo's USD account, with its plan ending today, Thu Nov 5.
  const usd = demoLedger.accounts.USD!;
  const endingToday = (changes: Partial<AccountLedger> = {}): Ledger => ({
    ...demoLedger,
    accounts: { ...demoLedger.accounts, USD: { ...usd, planEndDate: demoLedger.today, ...changes } },
  });
  const start = (endDate: string, extra: Partial<Extract<LedgerAction, { type: 'startNewPlan' }>> = {}): LedgerAction => ({
    type: 'startNewPlan',
    currency: 'USD',
    endDate,
    ...extra,
  });

  test('cash, savings, purchases and this week’s allowance stay; only the date and what it counts change', () => {
    const before = weekAccount(endingToday(), 'USD');
    expect(before.commitmentsCents).toBe(0);
    const after = weekAccount(run(endingToday(), start('2026-12-13')), 'USD');
    // The demo's bills of 150 and 50 fall inside the new plan.
    expect(after).toEqual({ ...before, planEndDate: '2026-12-13', commitmentsCents: 20000 });
  });

  test('bills are counted against the new date', () => {
    const later: Bill = { id: 'later', name: 'Later', dueOn: '2026-12-01', cents: 7000 };
    const state = endingToday({ bills: [later] });
    expect(weekAccount(state, 'USD').commitmentsCents).toBe(0);
    expect(weekAccount(run(state, start('2026-12-13')), 'USD').commitmentsCents).toBe(7000);
  });

  test('a plan still running, or an end date before today, changes nothing', () => {
    expect(run(demoLedger, start('2026-12-13'))).toEqual(demoLedger);
    expect(run(endingToday(), start('2026-11-04'))).toEqual(endingToday());
  });

  test('USD changes leave BSD alone', () => {
    expect(weekAccount(run(endingToday(), start('2026-12-13')), 'BSD')).toEqual(weekAccount(demoLedger, 'BSD'));
  });

  test('saving it twice is the same as saving it once', () => {
    const once = run(endingToday(), start('2026-11-05'));
    expect(run(once, start('2026-11-05'))).toEqual(once);
  });

  test('a week with no plan gets the one the student chose; one that has a plan keeps it', () => {
    const noPlan = endingToday({ weeks: [] });
    expect(hasPlanThisWeek(noPlan.accounts.USD!, noPlan.today)).toBe(false);
    const week = { weekStart: '2026-11-02', recommendedCents: 10000, startingAllowanceCents: 9000, changes: [] };
    const started = run(noPlan, start('2026-12-13', { week }));
    expect(weekAccount(started, 'USD')).toMatchObject({ recommendedAllowanceCents: 10000, chosenAllowanceCents: 9000 });

    const kept = run(endingToday(), start('2026-12-13', { week }));
    expect(weekAccount(kept, 'USD').chosenAllowanceCents).toBe(15000);
  });

  test('the week in progress closes under the new date, so newly counted bills lower what it protects', () => {
    // Cash 960, savings 200 and an allowance of 150 with 40 spent, so 110 is left.
    // Under the old end date the 700 bill is not counted, and free cash is 760.
    const big: Bill = { id: 'big', name: 'Big', dueOn: '2026-12-01', cents: 70000 };
    const state = endingToday({ bills: [big] });
    const toMondayFromHere = run(state, start('2026-12-13'), ...toMonday);
    // Under the new one, free cash is 960 - 200 - 700 = 60, which is the limit.
    expect(weekAccount(toMondayFromHere, 'USD').previousClosure).toMatchObject({ leftoverCents: 11000, protectedCents: 6000 });
  });
});
