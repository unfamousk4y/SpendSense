import { describe, expect, test } from 'vitest';
import { freeCashCents } from './allowance';
import { closeWeek, type WeekClosure } from './closure';

// Expected values worked out by hand from PRODUCT_PLAN.md before the code ran.
const usdWeek = {
  currency: 'USD' as const,
  weekStart: '2026-11-02',
  allowanceCents: 15000,
  spentCents: 4000,
  freeCents: 56000,
  closures: [] as WeekClosure[],
};

describe('closeWeek', () => {
  test('worked example: $150 allowance, $40 spent protects $110', () => {
    expect(closeWeek(usdWeek)).toEqual({
      kind: 'closed',
      closure: {
        currency: 'USD',
        weekStart: '2026-11-02',
        allowanceCents: 15000,
        spentCents: 4000,
        leftoverCents: 11000,
        protectedCents: 11000,
      },
    });
  });

  test('worked example afterwards: P 310, C still 960, B 200, so $450 free', () => {
    const result = closeWeek(usdWeek);
    if (result.kind !== 'closed') throw new Error('expected a closure');
    const protectedAfter = 20000 + result.closure.protectedCents;
    expect(protectedAfter).toBe(31000);
    expect(freeCashCents({ currentCashCents: 96000, protectedCents: protectedAfter, commitmentsCents: 20000 })).toBe(45000);
  });

  test('closing again changes nothing and returns the original closure', () => {
    const first = closeWeek(usdWeek);
    if (first.kind !== 'closed') throw new Error('expected a closure');
    // Different numbers on the retry must not produce a second or different closure.
    expect(closeWeek({ ...usdWeek, spentCents: 1000, closures: [first.closure] })).toEqual({
      kind: 'alreadyClosed',
      closure: first.closure,
    });
  });

  test('uses the allowance in force: changed midweek to $180, so $140 is protected', () => {
    expect(closeWeek({ ...usdWeek, allowanceCents: 18000 })).toMatchObject({
      closure: { leftoverCents: 14000, protectedCents: 14000 },
    });
  });

  test('a new bill dropped free cash to $60: the $110 leftover is capped at $60', () => {
    expect(closeWeek({ ...usdWeek, freeCents: 6000 })).toMatchObject({
      closure: { leftoverCents: 11000, protectedCents: 6000 },
    });
  });

  // F is a ceiling, not an amount to add. 19.50 leftover with 150.00 free
  // protects 19.50 (the leftover is already inside F).
  test('BSD: $45.00 allowance, $25.50 spent, $150.00 free protects $19.50', () => {
    expect(
      closeWeek({ ...usdWeek, currency: 'BSD', allowanceCents: 4500, spentCents: 2550, freeCents: 15000 }),
    ).toMatchObject({ closure: { currency: 'BSD', leftoverCents: 1950, protectedCents: 1950 } });
  });

  test('overspent by $5 protects nothing and records the overspend', () => {
    expect(closeWeek({ ...usdWeek, spentCents: 15500 })).toMatchObject({
      closure: { leftoverCents: -500, protectedCents: 0 },
    });
  });

  test('negative free cash protects nothing, never a negative amount', () => {
    expect(closeWeek({ ...usdWeek, freeCents: -2000 })).toMatchObject({
      closure: { leftoverCents: 11000, protectedCents: 0 },
    });
  });

  test('leftover exactly equal to free cash is protected in full', () => {
    expect(closeWeek({ ...usdWeek, freeCents: 11000 })).toMatchObject({ closure: { protectedCents: 11000 } });
  });

  test('a closed USD week does not count as closed for BSD', () => {
    const usd = closeWeek(usdWeek);
    if (usd.kind !== 'closed') throw new Error('expected a closure');
    expect(
      closeWeek({ ...usdWeek, currency: 'BSD', allowanceCents: 4500, spentCents: 2550, freeCents: 15000, closures: [usd.closure] }),
    ).toMatchObject({ kind: 'closed', closure: { currency: 'BSD' } });
  });

  test('a later week is closed separately from an earlier one', () => {
    const first = closeWeek(usdWeek);
    if (first.kind !== 'closed') throw new Error('expected a closure');
    expect(closeWeek({ ...usdWeek, weekStart: '2026-11-09', closures: [first.closure] })).toMatchObject({
      kind: 'closed',
      closure: { weekStart: '2026-11-09' },
    });
  });

  test('fractional or negative amounts are programming errors', () => {
    expect(() => closeWeek({ ...usdWeek, spentCents: 10.5 })).toThrow(RangeError);
    expect(() => closeWeek({ ...usdWeek, allowanceCents: -1 })).toThrow(RangeError);
  });
});
