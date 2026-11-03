import { describe, expect, test } from 'vitest';
import {
  currentAllowanceCents,
  midweekSuggestion,
  previewAllowanceChange,
  recordAllowanceChange,
  type AllowanceChange,
} from './allowanceChange';

// Expected values worked out by hand from PRODUCT_PLAN.md's midweek adjustment
// example: S = USD 40 spent, F = USD 560 free, current A = USD 150.
const midweek = { currentAllowanceCents: 15000, spentCents: 4000, freeCents: 56000 };

describe('previewAllowanceChange', () => {
  test('plan example: raising A to $180 leaves $140, which is within $560 free', () => {
    expect(previewAllowanceChange({ ...midweek, proposedAllowanceCents: 18000 })).toEqual({
      kind: 'ok',
      before: { allowanceCents: 15000, remainingCents: 11000, laterWeeksCents: 45000 },
      after: { allowanceCents: 18000, remainingCents: 14000, laterWeeksCents: 42000 },
      overspentCents: 0,
    });
  });

  // $600 is more than the $560 free, but $40 of it is already spent and already
  // out of current cash. Only the $560 still to spend needs funding. A check
  // that compared A itself with F would wrongly refuse this.
  test('compares A - S with F, not A: $600 total with $40 spent uses exactly the $560 free', () => {
    expect(previewAllowanceChange({ ...midweek, proposedAllowanceCents: 60000 })).toEqual({
      kind: 'ok',
      before: { allowanceCents: 15000, remainingCents: 11000, laterWeeksCents: 45000 },
      after: { allowanceCents: 60000, remainingCents: 56000, laterWeeksCents: 0 },
      overspentCents: 0,
    });
  });

  test('one cent more than the free cash is refused', () => {
    expect(previewAllowanceChange({ ...midweek, proposedAllowanceCents: 60001 })).toEqual({
      kind: 'exceedsFreeCash',
      proposedRemainingCents: 56001,
      availableCents: 56000,
      excessCents: 1,
    });
  });

  test('plan example: lowering A to $30 is allowed and shows $10 overspent', () => {
    expect(previewAllowanceChange({ ...midweek, proposedAllowanceCents: 3000 })).toEqual({
      kind: 'ok',
      before: { allowanceCents: 15000, remainingCents: 11000, laterWeeksCents: 45000 },
      // Nothing left to spend this week, so all $560 stays for later weeks.
      after: { allowanceCents: 3000, remainingCents: -1000, laterWeeksCents: 56000 },
      overspentCents: 1000,
    });
  });

  test('negative free cash: any amount left to spend is refused', () => {
    expect(
      previewAllowanceChange({ currentAllowanceCents: 3000, proposedAllowanceCents: 3500, spentCents: 3000, freeCents: -2000 }),
    ).toEqual({ kind: 'exceedsFreeCash', proposedRemainingCents: 500, availableCents: 0, excessCents: 500 });
  });

  test('negative free cash: lowering to what is spent is allowed, and the shortfall stays visible', () => {
    expect(
      previewAllowanceChange({ currentAllowanceCents: 5000, proposedAllowanceCents: 3000, spentCents: 3000, freeCents: -2000 }),
    ).toEqual({
      kind: 'ok',
      before: { allowanceCents: 5000, remainingCents: 2000, laterWeeksCents: -4000 },
      after: { allowanceCents: 3000, remainingCents: 0, laterWeeksCents: -2000 },
      overspentCents: 0,
    });
  });

  // Free cash can drop after the week started (a new bill). Lowering the
  // allowance then makes things better even if it is still above free cash,
  // so it must not be blocked.
  test('a reduction is allowed even when the new remaining amount is still above free cash', () => {
    const preview = previewAllowanceChange({
      currentAllowanceCents: 10000,
      proposedAllowanceCents: 6000,
      spentCents: 2000,
      freeCents: 1000,
    });
    expect(preview).toMatchObject({ kind: 'ok', after: { remainingCents: 4000, laterWeeksCents: -3000 } });
  });

  test('the same amount as now is reported as unchanged', () => {
    expect(previewAllowanceChange({ ...midweek, proposedAllowanceCents: 15000 })).toEqual({ kind: 'unchanged' });
  });

  test('a zero allowance is allowed', () => {
    expect(previewAllowanceChange({ ...midweek, proposedAllowanceCents: 0 })).toMatchObject({
      kind: 'ok',
      overspentCents: 4000,
    });
  });

  test('negative or fractional inputs are programming errors', () => {
    expect(() => previewAllowanceChange({ ...midweek, proposedAllowanceCents: -1 })).toThrow(RangeError);
    expect(() => previewAllowanceChange({ ...midweek, proposedAllowanceCents: 100.5 })).toThrow(RangeError);
    expect(() => previewAllowanceChange({ ...midweek, proposedAllowanceCents: 18000, spentCents: -1 })).toThrow(RangeError);
  });
});

describe('midweekSuggestion', () => {
  // Demo account on Thu Nov 5, plan ending Sun Nov 29: d = 4 (Thu to Sun), D = 25.
  // floor(56000 * 4 / 25) = floor(8960) = 8960.
  test('demo Thursday: $89.60 more for 4 of 25 days, so a $129.60 total', () => {
    expect(midweekSuggestion({ spentCents: 4000, freeCents: 56000, daysThisWeek: 4, daysLeft: 25 })).toEqual({
      kind: 'ok',
      totalCents: 12960,
      remainingCents: 8960,
      shortfallCents: 0,
    });
  });

  test('plan example: recommending $120 more with $40 spent proposes $160, not $120', () => {
    // floor(60000 * 2 / 10) = 12000
    expect(midweekSuggestion({ spentCents: 4000, freeCents: 60000, daysThisWeek: 2, daysLeft: 10 })).toMatchObject({
      totalCents: 16000,
      remainingCents: 12000,
    });
  });

  test('negative free cash suggests nothing more and reports the shortfall', () => {
    expect(midweekSuggestion({ spentCents: 3000, freeCents: -2000, daysThisWeek: 3, daysLeft: 10 })).toEqual({
      kind: 'ok',
      totalCents: 3000,
      remainingCents: 0,
      shortfallCents: 2000,
    });
  });

  test('an ended plan asks for a new plan', () => {
    expect(midweekSuggestion({ spentCents: 0, freeCents: 1000, daysThisWeek: 0, daysLeft: 0 })).toEqual({
      kind: 'planExpired',
    });
  });
});

describe('allowance change record', () => {
  const change: AllowanceChange = {
    id: 'change-1',
    madeOn: '2026-11-05',
    fromCents: 15000,
    toCents: 18000,
    suggestedCents: 12960,
  };

  test('a double tap on Save records the change once', () => {
    const once = recordAllowanceChange([], change);
    expect(once).toEqual([change]);
    expect(recordAllowanceChange(once, { ...change })).toBe(once);
  });

  test('the allowance in force is the latest change, or the snapshot when there is none', () => {
    expect(currentAllowanceCents(15000, [])).toBe(15000);
    const second = { ...change, id: 'change-2', fromCents: 18000, toCents: 12000 };
    expect(currentAllowanceCents(15000, [change, second])).toBe(12000);
  });
});
