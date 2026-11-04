import { describe, expect, test } from 'vitest';
import { firstAllowanceFits, previewSetup } from './setup';

// Hand-worked. 2026-11-02 is a Monday; 2026-11-29 is a Sunday.
const worked = { cashCents: 100000, protectedCents: 20000, commitmentsCents: 20000, planEndDate: '2026-11-29' };

describe('previewSetup', () => {
  test('worked example on a Monday: $600 free over 28 days suggests $150', () => {
    expect(previewSetup({ ...worked, today: '2026-11-02' })).toEqual({
      kind: 'ok',
      weekStart: '2026-11-02',
      freeCents: 60000,
      daysThisWeek: 7,
      daysLeft: 28,
      suggestedCents: 15000,
      shortfallCents: 0,
    });
  });

  // Wed Nov 4 to Sun Nov 8 is 5 days; through Nov 29 is 26.
  // 60000 * 5 / 26 = 11538.46, rounded down.
  test('set up on a Wednesday: a partial first week of 5 of 26 days suggests $115.38', () => {
    expect(previewSetup({ ...worked, today: '2026-11-04' })).toMatchObject({
      weekStart: '2026-11-02',
      daysThisWeek: 5,
      daysLeft: 26,
      suggestedCents: 11538,
    });
  });

  test('bills above cash: suggests nothing and reports the $50 shortfall', () => {
    expect(
      previewSetup({ today: '2026-11-02', cashCents: 10000, protectedCents: 0, commitmentsCents: 15000, planEndDate: '2026-11-29' }),
    ).toMatchObject({ kind: 'ok', freeCents: -5000, suggestedCents: 0, shortfallCents: 5000 });
  });

  test('a plan ending today gets all free cash', () => {
    expect(previewSetup({ ...worked, today: '2026-11-29' })).toMatchObject({ daysThisWeek: 1, daysLeft: 1, suggestedCents: 60000 });
  });

  test('a plan end date in the past is refused', () => {
    expect(previewSetup({ ...worked, today: '2026-11-30' })).toEqual({ kind: 'planEndPassed' });
  });

  test('protected savings above cash are refused; exactly equal is fine', () => {
    expect(previewSetup({ ...worked, today: '2026-11-02', cashCents: 19999 })).toEqual({ kind: 'protectedAboveCash' });
    expect(previewSetup({ ...worked, today: '2026-11-02', cashCents: 20000, commitmentsCents: 0 })).toMatchObject({ kind: 'ok', freeCents: 0 });
  });
});

describe('firstAllowanceFits', () => {
  test('up to free cash fits, one cent more does not', () => {
    expect(firstAllowanceFits(60000, 15000, 60000)).toBe(true);
    expect(firstAllowanceFits(60001, 15000, 60000)).toBe(false);
  });

  test('below the suggestion or the same as it fits, even zero', () => {
    expect(firstAllowanceFits(0, 15000, 60000)).toBe(true);
    expect(firstAllowanceFits(15000, 15000, 60000)).toBe(true);
  });
});

// Regression: a date box reports each stage of typing a year, so "2026" arrives
// as 0002, 0020, 0202, then 2026. None of these may throw while drawing.
describe('previewSetup while a year is being typed', () => {
  test.each(['0002-11-29', '0020-11-29', '0202-11-29'])('%s counts as a past date', (planEndDate) => {
    expect(previewSetup({ ...worked, today: '2026-11-04', planEndDate })).toEqual({ kind: 'planEndPassed' });
  });
});
