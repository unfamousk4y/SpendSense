import { describe, expect, test } from 'vitest';
import { suggestAllowance } from './allowance';

// Expected values were worked out by hand from PRODUCT_PLAN.md before the code was written.
describe('suggestAllowance', () => {
  test('worked example: $600 free over 28 days suggests $150 for a full week', () => {
    expect(suggestAllowance({ freeCents: 60000, daysThisWeek: 7, daysLeft: 28 })).toEqual({
      kind: 'ok',
      suggestedCents: 15000,
      shortfallCents: 0,
    });
  });

  test('worked example after closure: $450 free over 21 days still suggests $150', () => {
    expect(suggestAllowance({ freeCents: 45000, daysThisWeek: 7, daysLeft: 21 })).toEqual({
      kind: 'ok',
      suggestedCents: 15000,
      shortfallCents: 0,
    });
  });

  // 70000 / 9 = 7777.78. Rounding to nearest would give 7778, so this case
  // distinguishes floor from round (a .33 fraction would not).
  test('rounds down to the cent: $100 over 9 days gives 7777 cents, not 7778', () => {
    expect(suggestAllowance({ freeCents: 10000, daysThisWeek: 7, daysLeft: 9 })).toEqual({
      kind: 'ok',
      suggestedCents: 7777,
      shortfallCents: 0,
    });
  });

  test('partial week (Friday to Sunday) gets only its 3 days of 10', () => {
    expect(suggestAllowance({ freeCents: 60000, daysThisWeek: 3, daysLeft: 10 })).toEqual({
      kind: 'ok',
      suggestedCents: 18000,
      shortfallCents: 0,
    });
  });

  test('final partial week before the end date receives all free cash', () => {
    expect(suggestAllowance({ freeCents: 12345, daysThisWeek: 3, daysLeft: 3 })).toEqual({
      kind: 'ok',
      suggestedCents: 12345,
      shortfallCents: 0,
    });
  });

  test('zero free cash suggests nothing and reports no shortfall', () => {
    expect(suggestAllowance({ freeCents: 0, daysThisWeek: 7, daysLeft: 28 })).toEqual({
      kind: 'ok',
      suggestedCents: 0,
      shortfallCents: 0,
    });
  });

  test('negative free cash suggests nothing and shows the full deficit', () => {
    expect(suggestAllowance({ freeCents: -5000, daysThisWeek: 7, daysLeft: 28 })).toEqual({
      kind: 'ok',
      suggestedCents: 0,
      shortfallCents: 5000,
    });
  });

  test('an ended plan asks for a new plan instead of dividing by zero', () => {
    expect(suggestAllowance({ freeCents: 60000, daysThisWeek: 7, daysLeft: 0 })).toEqual({
      kind: 'planExpired',
    });
    expect(suggestAllowance({ freeCents: 60000, daysThisWeek: 7, daysLeft: -4 })).toEqual({
      kind: 'planExpired',
    });
  });

  test('rejects fractional cents and impossible day counts as programming errors', () => {
    expect(() => suggestAllowance({ freeCents: 100.5, daysThisWeek: 7, daysLeft: 28 })).toThrow(RangeError);
    expect(() => suggestAllowance({ freeCents: 60000, daysThisWeek: 8, daysLeft: 28 })).toThrow(RangeError);
    expect(() => suggestAllowance({ freeCents: 60000, daysThisWeek: 0, daysLeft: 28 })).toThrow(RangeError);
    expect(() => suggestAllowance({ freeCents: 60000, daysThisWeek: 7, daysLeft: 3 })).toThrow(RangeError);
    expect(() => suggestAllowance({ freeCents: Number.NaN, daysThisWeek: 7, daysLeft: 28 })).toThrow(RangeError);
  });
});
