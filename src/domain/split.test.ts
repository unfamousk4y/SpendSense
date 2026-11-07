import { describe, expect, test } from 'vitest';
import { allocateCashBySplit } from './allocation';
import { freeCashCents, suggestAllowance } from './allowance';
import {
  SUGGESTED_SPLIT,
  isValidSplit,
  splitMoneyIn,
  splitOpening,
  wantsLeft,
  wantsMovedToSavings,
  wantsStatus,
  weeklyWantsGuide,
} from './split';

// Expected values worked out by hand.
describe('the worked example: 1,000 cash, 400 already saved, a 150 bill, 28 days left', () => {
  const opening = splitOpening({ cashCents: 100000, alreadySavedCents: 40000, billsCents: 15000, split: SUGGESTED_SPLIT });

  test('the split applies only to the 600 not already saved', () => {
    expect(opening).toEqual({
      savingsCents: 12000,
      wantsCents: 18000,
      needsCents: 30000,
      savingsCappedCents: 0,
      protectedCents: 52000,
    });
  });

  test('allowance 82.50 a week, of which 45.00 is for wants and 37.50 for other needs', () => {
    const freeCents = freeCashCents({ currentCashCents: 100000, protectedCents: opening.protectedCents, commitmentsCents: 15000 });
    expect(freeCents).toBe(33000);
    expect(suggestAllowance({ freeCents, daysThisWeek: 7, daysLeft: 28 })).toEqual({
      kind: 'ok',
      suggestedCents: 8250,
      shortfallCents: 0,
    });

    const left = wantsLeft({ wantsPoolCents: opening.wantsCents, wantsSpentCents: 0, movedToSavingsCents: 0, freeCents });
    expect(left).toEqual({ wantsLeftCents: 18000, coveredElsewhereCents: 0 });
    expect(weeklyWantsGuide({ wantsLeftCents: left.wantsLeftCents, daysThisWeek: 7, daysLeft: 28 })).toBe(4500);
  });

  test('the donut adds up to the 1,000: 520 + 150 + 150 + 180', () => {
    expect(
      allocateCashBySplit({ currentCashCents: 100000, protectedCents: 52000, commitmentsCents: 15000, wantsLeftCents: 18000 }),
    ).toEqual({
      kind: 'ok',
      totalCents: 100000,
      segments: [
        { key: 'protected', cents: 52000, percent: 52 },
        { key: 'bills', cents: 15000, percent: 15 },
        { key: 'needs', cents: 15000, percent: 15 },
        { key: 'wants', cents: 18000, percent: 18 },
      ],
    });
  });
});

describe('isValidSplit', () => {
  test('the suggested split is valid, and so is saving nothing or everything', () => {
    expect(isValidSplit(SUGGESTED_SPLIT)).toBe(true);
    expect(isValidSplit({ needsPercent: 70, wantsPercent: 30, savingsPercent: 0 })).toBe(true);
    expect(isValidSplit({ needsPercent: 0, wantsPercent: 0, savingsPercent: 100 })).toBe(true);
  });

  test.each([
    ['totals under 100', { needsPercent: 50, wantsPercent: 30, savingsPercent: 10 }],
    ['totals over 100', { needsPercent: 60, wantsPercent: 30, savingsPercent: 20 }],
    ['a negative percent', { needsPercent: 120, wantsPercent: -40, savingsPercent: 20 }],
    ['a fraction of a percent', { needsPercent: 49.5, wantsPercent: 30.5, savingsPercent: 20 }],
    ['not a number', { needsPercent: Number.NaN, wantsPercent: 50, savingsPercent: 50 }],
  ])('refuses %s', (_name, split) => {
    expect(isValidSplit(split)).toBe(false);
  });
});

describe('splitMoneyIn', () => {
  test('a 100 payment with room to spare: 20 saved, 30 wants, 50 needs', () => {
    expect(splitMoneyIn({ cents: 10000, split: SUGGESTED_SPLIT, freeAfterCents: 50000 })).toEqual({
      savingsCents: 2000,
      wantsCents: 3000,
      needsCents: 5000,
      savingsCappedCents: 0,
    });
  });

  test('rounding: 100.01 keeps every cent, and the spare cent goes to needs', () => {
    // Savings 2000.2 -> 2000, wants 3000.3 -> 3000, needs gets the other 5001.
    expect(splitMoneyIn({ cents: 10001, split: SUGGESTED_SPLIT, freeAfterCents: 50000 })).toMatchObject({
      savingsCents: 2000,
      wantsCents: 3000,
      needsCents: 5001,
    });
  });

  test('the shares add up to the amount for awkward amounts and percents', () => {
    const split = { needsPercent: 33, wantsPercent: 33, savingsPercent: 34 };
    for (const cents of [0, 1, 2, 3, 99, 101, 12345, 99999]) {
      const { savingsCents, wantsCents, needsCents } = splitMoneyIn({ cents, split, freeAfterCents: 1000000 });
      expect(savingsCents + wantsCents + needsCents).toBe(cents);
      expect(needsCents).toBeGreaterThanOrEqual(0);
    }
  });

  test('0% savings sets nothing aside, and 100% sets it all aside', () => {
    expect(
      splitMoneyIn({ cents: 10000, split: { needsPercent: 70, wantsPercent: 30, savingsPercent: 0 }, freeAfterCents: 50000 }),
    ).toMatchObject({ savingsCents: 0, wantsCents: 3000, needsCents: 7000 });
    expect(
      splitMoneyIn({ cents: 10000, split: { needsPercent: 0, wantsPercent: 0, savingsPercent: 100 }, freeAfterCents: 50000 }),
    ).toMatchObject({ savingsCents: 10000, wantsCents: 0, needsCents: 0 });
  });

  test('already short of money: nothing is set aside, and the app can say how much was asked', () => {
    expect(splitMoneyIn({ cents: 10000, split: SUGGESTED_SPLIT, freeAfterCents: -20000 })).toEqual({
      savingsCents: 0,
      wantsCents: 3000,
      needsCents: 7000,
      savingsCappedCents: 2000,
    });
  });

  test('only 5 free: savings stop at 5 instead of the 20 asked for', () => {
    expect(splitMoneyIn({ cents: 10000, split: SUGGESTED_SPLIT, freeAfterCents: 500 })).toEqual({
      savingsCents: 500,
      wantsCents: 3000,
      needsCents: 6500,
      savingsCappedCents: 1500,
    });
  });

  test('refuses an invalid split, a negative amount and fractions of a cent', () => {
    expect(() => splitMoneyIn({ cents: 10000, split: { needsPercent: 1, wantsPercent: 1, savingsPercent: 1 }, freeAfterCents: 0 })).toThrow(RangeError);
    expect(() => splitMoneyIn({ cents: -1, split: SUGGESTED_SPLIT, freeAfterCents: 0 })).toThrow(RangeError);
    expect(() => splitMoneyIn({ cents: 10.5, split: SUGGESTED_SPLIT, freeAfterCents: 0 })).toThrow(RangeError);
  });
});

describe('splitOpening', () => {
  test('all of the balance already saved: nothing left to split', () => {
    expect(splitOpening({ cashCents: 40000, alreadySavedCents: 40000, billsCents: 0, split: SUGGESTED_SPLIT })).toEqual({
      savingsCents: 0,
      wantsCents: 0,
      needsCents: 0,
      savingsCappedCents: 0,
      protectedCents: 40000,
    });
  });

  test('bills bigger than the cash: no new savings, and existing savings stay as they are', () => {
    // 100 cash, 10 saved, 200 of bills: F is -110, so nothing more is set aside.
    expect(splitOpening({ cashCents: 10000, alreadySavedCents: 1000, billsCents: 20000, split: SUGGESTED_SPLIT })).toMatchObject({
      savingsCents: 0,
      savingsCappedCents: 1800,
      protectedCents: 1000,
    });
  });

  test('refuses savings larger than the cash', () => {
    expect(() => splitOpening({ cashCents: 100, alreadySavedCents: 101, billsCents: 0, split: SUGGESTED_SPLIT })).toThrow(RangeError);
  });
});

describe('wantsLeft', () => {
  test('spending and money moved to savings both reduce it', () => {
    expect(wantsLeft({ wantsPoolCents: 18000, wantsSpentCents: 3000, movedToSavingsCents: 2000, freeCents: 33000 })).toEqual({
      wantsLeftCents: 13000,
      coveredElsewhereCents: 0,
    });
  });

  test('bills bigger than the needs share take the extra from wants', () => {
    // 1,000 cash, 600 of bills: savings 200, wants 300, needs 500. F = 200, so
    // only 200 of the 300 wants exists. Bills ran 100 past the needs share.
    const freeCents = freeCashCents({ currentCashCents: 100000, protectedCents: 20000, commitmentsCents: 60000 });
    expect(wantsLeft({ wantsPoolCents: 30000, wantsSpentCents: 0, movedToSavingsCents: 0, freeCents })).toEqual({
      wantsLeftCents: 20000,
      coveredElsewhereCents: 10000,
    });
    expect(
      allocateCashBySplit({ currentCashCents: 100000, protectedCents: 20000, commitmentsCents: 60000, wantsLeftCents: 20000 }),
    ).toMatchObject({
      segments: [
        { key: 'protected', cents: 20000 },
        { key: 'bills', cents: 60000 },
        { key: 'needs', cents: 0 },
        { key: 'wants', cents: 20000 },
      ],
    });
  });

  test('negative free cash leaves nothing for wants', () => {
    expect(wantsLeft({ wantsPoolCents: 18000, wantsSpentCents: 0, movedToSavingsCents: 0, freeCents: -500 })).toEqual({
      wantsLeftCents: 0,
      coveredElsewhereCents: 18000,
    });
  });

  test('spending past the pool stops at zero', () => {
    expect(wantsLeft({ wantsPoolCents: 1000, wantsSpentCents: 2500, movedToSavingsCents: 0, freeCents: 33000 })).toEqual({
      wantsLeftCents: 0,
      coveredElsewhereCents: 0,
    });
  });
});

describe('weeklyWantsGuide', () => {
  test('a partial week gets its share of the days, rounded down', () => {
    // 100 over 10 days, 3 of them this week: 30. 100.01 would be 30.003 -> 30.00.
    expect(weeklyWantsGuide({ wantsLeftCents: 10000, daysThisWeek: 3, daysLeft: 10 })).toBe(3000);
    expect(weeklyWantsGuide({ wantsLeftCents: 10001, daysThisWeek: 3, daysLeft: 10 })).toBe(3000);
  });

  test('a plan that has ended gets no guide', () => {
    expect(weeklyWantsGuide({ wantsLeftCents: 10000, daysThisWeek: 1, daysLeft: 0 })).toBe(0);
  });
});

describe('wantsStatus', () => {
  test('within the guide', () => {
    expect(wantsStatus({ savedGuideCents: 4500, allowanceCents: 8250, wantsSpentCents: 1000 })).toEqual({
      guideCents: 4500,
      leftCents: 3500,
      overCents: 0,
    });
  });

  test('exactly on the guide is not over it', () => {
    expect(wantsStatus({ savedGuideCents: 4500, allowanceCents: 8250, wantsSpentCents: 4500 })).toEqual({
      guideCents: 4500,
      leftCents: 0,
      overCents: 0,
    });
  });

  test('12.00 over the guide', () => {
    expect(wantsStatus({ savedGuideCents: 4500, allowanceCents: 8250, wantsSpentCents: 5700 })).toEqual({
      guideCents: 4500,
      leftCents: 0,
      overCents: 1200,
    });
  });

  test('the guide is never shown above a lowered allowance', () => {
    expect(wantsStatus({ savedGuideCents: 4500, allowanceCents: 3000, wantsSpentCents: 1000 })).toEqual({
      guideCents: 3000,
      leftCents: 2000,
      overCents: 0,
    });
  });
});

describe('wantsMovedToSavings', () => {
  test('unused wants move with the closing week', () => {
    expect(wantsMovedToSavings({ protectedByClosureCents: 5000, guideCents: 4500, wantsSpentCents: 1000 })).toBe(3500);
  });

  test('no more than the closure actually protected', () => {
    expect(wantsMovedToSavings({ protectedByClosureCents: 3250, guideCents: 4500, wantsSpentCents: 1000 })).toBe(3250);
  });

  test('nothing moves when the guide was used up or passed', () => {
    expect(wantsMovedToSavings({ protectedByClosureCents: 5000, guideCents: 4500, wantsSpentCents: 4500 })).toBe(0);
    expect(wantsMovedToSavings({ protectedByClosureCents: 5000, guideCents: 4500, wantsSpentCents: 6000 })).toBe(0);
  });
});

describe('allocateCashBySplit', () => {
  test('wants are never drawn larger than the free cash', () => {
    expect(
      allocateCashBySplit({ currentCashCents: 50000, protectedCents: 10000, commitmentsCents: 10000, wantsLeftCents: 90000 }),
    ).toMatchObject({
      segments: [
        { key: 'protected', cents: 10000 },
        { key: 'bills', cents: 10000 },
        { key: 'needs', cents: 0 },
        { key: 'wants', cents: 30000 },
      ],
    });
  });

  test('a shortfall is reported, not drawn', () => {
    expect(
      allocateCashBySplit({ currentCashCents: 10000, protectedCents: 5000, commitmentsCents: 8000, wantsLeftCents: 0 }),
    ).toEqual({ kind: 'shortfall', shortfallCents: 3000 });
  });
});
