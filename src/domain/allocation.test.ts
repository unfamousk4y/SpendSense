import { describe, expect, test } from 'vitest';
import { allocateCash } from './allocation';

// Hand-worked. Percent rounding: floor every share, then hand the missing
// points to the largest remainders.
describe('allocateCash', () => {
  test('USD worked example: 960 = 200 protected + 200 bills + 110 this week + 450 later', () => {
    // Exact shares 20.83, 20.83, 11.46, 46.875 -> floors 20, 20, 11, 46 (97);
    // the 3 missing points go to 46.875, then the two 20.83s.
    expect(
      allocateCash({ currentCashCents: 96000, protectedCents: 20000, commitmentsCents: 20000, weekRemainingCents: 11000 }),
    ).toEqual({
      kind: 'ok',
      totalCents: 96000,
      segments: [
        { key: 'protected', cents: 20000, percent: 21 },
        { key: 'bills', cents: 20000, percent: 21 },
        { key: 'thisWeek', cents: 11000, percent: 11 },
        { key: 'laterWeeks', cents: 45000, percent: 47 },
      ],
    });
  });

  test('BSD fixture: 320 = 50 + 120 + 19.50 + 130.50', () => {
    // Exact 15.625, 37.5, 6.09, 40.78 -> floors 15, 37, 6, 40 (98); +1 to 40.78 and 15.625.
    const result = allocateCash({ currentCashCents: 32000, protectedCents: 5000, commitmentsCents: 12000, weekRemainingCents: 1950 });
    expect(result).toEqual({
      kind: 'ok',
      totalCents: 32000,
      segments: [
        { key: 'protected', cents: 5000, percent: 16 },
        { key: 'bills', cents: 12000, percent: 37 },
        { key: 'thisWeek', cents: 1950, percent: 6 },
        { key: 'laterWeeks', cents: 13050, percent: 41 },
      ],
    });
  });

  test('three equal parts show 34/33/33, never 99%', () => {
    const result = allocateCash({ currentCashCents: 300, protectedCents: 100, commitmentsCents: 100, weekRemainingCents: 100 });
    expect(result.kind === 'ok' && result.segments.map((s) => s.percent)).toEqual([34, 33, 33, 0]);
  });

  test('overspending leaves nothing for this week; the cash is still all accounted for', () => {
    const result = allocateCash({ currentCashCents: 96000, protectedCents: 20000, commitmentsCents: 20000, weekRemainingCents: -1000 });
    expect(result.kind === 'ok' && result.segments.map((s) => s.cents)).toEqual([20000, 20000, 0, 56000]);
  });

  test('this week is capped by the free cash that actually exists', () => {
    const result = allocateCash({ currentCashCents: 50000, protectedCents: 20000, commitmentsCents: 20000, weekRemainingCents: 15000 });
    expect(result.kind === 'ok' && result.segments.map((s) => s.cents)).toEqual([20000, 20000, 10000, 0]);
  });

  test('savings plus bills above cash is a shortfall, not a chart', () => {
    expect(
      allocateCash({ currentCashCents: 10000, protectedCents: 5000, commitmentsCents: 8000, weekRemainingCents: 0 }),
    ).toEqual({ kind: 'shortfall', shortfallCents: 3000 });
  });

  test('zero cash shows all zero percents instead of dividing by zero', () => {
    const result = allocateCash({ currentCashCents: 0, protectedCents: 0, commitmentsCents: 0, weekRemainingCents: 0 });
    expect(result.kind === 'ok' && result.segments.map((s) => s.percent)).toEqual([0, 0, 0, 0]);
  });
});
