import { describe, expect, test } from 'vitest';
import { demoLedger } from '../fixtures/demoWeek';
import { addCorrectionOnce, previewCorrection, removeCorrection, sumCorrections, type BalanceCorrection } from './correction';
import { ledgerReducer, weekAccount, type Ledger, type LedgerAction } from './ledger';

const lower: BalanceCorrection = { id: 'c1', date: '2026-11-05', differenceCents: -2000 };

// Hand-worked, with 5 days this week and 26 left. Cash 960, free cash 560, 40 spent.
describe('previewCorrection', () => {
  const now = { currentCashCents: 96000, freeCents: 56000, spentCents: 4000, daysThisWeek: 5, daysLeft: 26 };

  test('bank says 940: difference -20, cash 940, free cash 540, suggestion 143.84', () => {
    expect(previewCorrection({ actualCents: 94000, ...now })).toEqual({
      kind: 'ok',
      differenceCents: -2000,
      before: { cashCents: 96000, freeCents: 56000 },
      after: { cashCents: 94000, freeCents: 54000 },
      // 540.00 x 5 / 26 = 103.8461..., rounded down to 103.84, plus the 40.00 spent.
      suggestion: { kind: 'ok', totalCents: 14384, remainingCents: 10384, shortfallCents: 0 },
    });
  });

  test('bank says 1,000: difference +40, cash 1,000, free cash 600', () => {
    expect(previewCorrection({ actualCents: 100000, ...now })).toMatchObject({
      differenceCents: 4000,
      after: { cashCents: 100000, freeCents: 60000 },
    });
  });

  test('bank says 350: difference -610, free cash -50 and the shortfall is shown', () => {
    expect(previewCorrection({ actualCents: 35000, ...now })).toMatchObject({
      differenceCents: -61000,
      after: { cashCents: 35000, freeCents: -5000 },
      suggestion: { totalCents: 4000, remainingCents: 0, shortfallCents: 5000 },
    });
  });

  test('a balance of 0 is a real answer', () => {
    expect(previewCorrection({ actualCents: 0, ...now })).toMatchObject({ differenceCents: -96000, after: { cashCents: 0 } });
  });

  test('a balance that already matches saves nothing', () => {
    expect(previewCorrection({ actualCents: 96000, ...now })).toEqual({ kind: 'noDifference' });
  });

  test('a difference of exactly 100,000.00 is allowed; one cent more is not', () => {
    expect(previewCorrection({ actualCents: 10096000, ...now }).kind).toBe('ok');
    expect(previewCorrection({ actualCents: 10096001, ...now })).toEqual({ kind: 'tooLarge' });
  });
});

describe('correction records', () => {
  test('adds up signed differences', () => {
    expect(sumCorrections([lower, { ...lower, id: 'c2', differenceCents: 500 }])).toBe(-1500);
    expect(sumCorrections([])).toBe(0);
  });

  test('adding the same id twice keeps one; removal touches only that one', () => {
    const second = { ...lower, id: 'c2' };
    expect(addCorrectionOnce([lower], { ...lower, differenceCents: 1 })).toEqual([lower]);
    expect(removeCorrection([lower, second], 'c1')).toEqual([second]);
  });
});

describe('corrections in the ledger', () => {
  const run = (state: Ledger, ...actions: LedgerAction[]) => actions.reduce(ledgerReducer, state);
  const toMonday: LedgerAction[] = Array.from({ length: 4 }, () => ({ type: 'nextDay' }));
  const add = (correction: BalanceCorrection = lower): LedgerAction => ({ type: 'addCorrection', currency: 'USD', correction });
  const undo: LedgerAction = { type: 'deleteCorrection', currency: 'USD', id: 'c1' };

  test('listed this week, and spending, savings, bills and the allowance stay put', () => {
    const before = weekAccount(demoLedger, 'USD');
    expect(weekAccount(run(demoLedger, add()), 'USD')).toEqual({ ...before, corrections: [lower] });
  });

  test('a retry after a lost reply counts once', () => {
    expect(weekAccount(run(demoLedger, add(), add()), 'USD').corrections).toHaveLength(1);
  });

  test('USD corrections leave BSD alone', () => {
    expect(weekAccount(run(demoLedger, add()), 'BSD')).toEqual(weekAccount(demoLedger, 'BSD'));
  });

  test('a date still to come, or before this week, changes nothing', () => {
    expect(run(demoLedger, add({ ...lower, date: '2026-11-06' }))).toEqual(demoLedger);
    expect(run(demoLedger, add({ ...lower, date: '2026-11-01' }))).toEqual(demoLedger);
  });

  test('undoing puts everything back', () => {
    expect(weekAccount(run(demoLedger, add(), undo), 'USD')).toEqual(weekAccount(demoLedger, 'USD'));
  });

  test('next week: it is in the starting cash and off the list, and spending is untouched', () => {
    const account = weekAccount(run(demoLedger, add(), ...toMonday), 'USD');
    // 1,000 - 40 of purchases - 20 corrected.
    expect(account.weekStartCashCents).toBe(94000);
    expect(account.corrections).toEqual([]);
    expect(account.previousClosure).toMatchObject({ spentCents: 4000, leftoverCents: 11000, protectedCents: 11000 });
  });

  test('a large correction limits what the week can protect, and never goes below zero', () => {
    // Cash 350, savings 200, bills 200: free cash is -50, so nothing is protected.
    const big = add({ ...lower, differenceCents: -61000 });
    expect(weekAccount(run(demoLedger, big, ...toMonday), 'USD').previousClosure).toMatchObject({
      leftoverCents: 11000,
      protectedCents: 0,
    });
  });

  test('once its week has closed a correction cannot be undone', () => {
    const monday = run(demoLedger, add(), ...toMonday);
    expect(run(monday, undo)).toEqual(monday);
  });
});
