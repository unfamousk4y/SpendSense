import { describe, expect, test } from 'vitest';
import { addDays, daysBetween, localDateIn, mondayOf, planDays } from './dates';
import { suggestAllowance } from './allowance';

// Expected values were worked out by hand on a calendar. 2026-11-02 is a Monday.
describe('planDays', () => {
  test('worked example: Monday with 28 days left is a full week', () => {
    expect(planDays('2026-11-02', '2026-11-29')).toEqual({ daysThisWeek: 7, daysLeft: 28 });
  });

  test('Friday start counts Friday, Saturday and Sunday', () => {
    expect(planDays('2026-11-06', '2026-11-15')).toEqual({ daysThisWeek: 3, daysLeft: 10 });
  });

  test('a 7-day plan that crosses a Monday is split: 5 days this week, 7 left', () => {
    expect(planDays('2026-11-04', '2026-11-10')).toEqual({ daysThisWeek: 5, daysLeft: 7 });
  });

  test('Sunday is the last day of the week', () => {
    expect(planDays('2026-11-08', '2026-11-29')).toEqual({ daysThisWeek: 1, daysLeft: 22 });
  });

  test('a plan ending midweek cuts the week short', () => {
    expect(planDays('2026-11-23', '2026-11-25')).toEqual({ daysThisWeek: 3, daysLeft: 3 });
  });

  test('a plan ending today still has one day', () => {
    expect(planDays('2026-11-29', '2026-11-29')).toEqual({ daysThisWeek: 1, daysLeft: 1 });
  });

  test('a plan that ended yesterday has no days', () => {
    expect(planDays('2026-11-30', '2026-11-29')).toEqual({ daysThisWeek: 0, daysLeft: 0 });
  });

  test('the US daylight saving change on 2026-11-01 does not lose or add a day', () => {
    expect(planDays('2026-10-26', '2026-11-08')).toEqual({ daysThisWeek: 7, daysLeft: 14 });
  });

  test('crosses the new year', () => {
    expect(planDays('2026-12-31', '2027-01-03')).toEqual({ daysThisWeek: 4, daysLeft: 4 });
  });

  test('counts the leap day (6 days if February 29 were missed)', () => {
    expect(planDays('2028-02-28', '2028-03-05')).toEqual({ daysThisWeek: 7, daysLeft: 7 });
  });

  test('rejects malformed and impossible dates', () => {
    expect(() => planDays('2026-02-30', '2026-03-31')).toThrow(RangeError);
    expect(() => planDays('2026-11-2', '2026-11-29')).toThrow(RangeError);
    expect(() => planDays('2026-11-02', '')).toThrow(RangeError);
  });

  test('feeds suggestAllowance: worked example dates give $150', () => {
    const days = planDays('2026-11-02', '2026-11-29');
    expect(suggestAllowance({ freeCents: 60000, ...days })).toEqual({
      kind: 'ok',
      suggestedCents: 15000,
      shortfallCents: 0,
    });
  });

  test('feeds suggestAllowance: an ended plan becomes planExpired', () => {
    const days = planDays('2026-11-30', '2026-11-29');
    expect(suggestAllowance({ freeCents: 60000, ...days })).toEqual({ kind: 'planExpired' });
  });
});

describe('localDateIn', () => {
  // 03:00 UTC on Nov 2 is 22:00 on Nov 1 in Nassau (UTC-5 after DST ends).
  const lateEveningInNassau = new Date('2026-11-02T03:00:00Z');

  test('uses the student time zone, not UTC, to decide today', () => {
    expect(localDateIn(lateEveningInNassau, 'America/Nassau')).toBe('2026-11-01');
    expect(localDateIn(lateEveningInNassau, 'UTC')).toBe('2026-11-02');
  });

  test('a zone ahead of UTC can already be on the next day', () => {
    // 20:00 UTC on Nov 1 is 05:00 on Nov 2 in Tokyo (UTC+9).
    expect(localDateIn(new Date('2026-11-01T20:00:00Z'), 'Asia/Tokyo')).toBe('2026-11-02');
  });

  test('rejects an unknown time zone name', () => {
    expect(() => localDateIn(lateEveningInNassau, 'Mars/Olympus')).toThrow(RangeError);
  });
});

describe('daysBetween and addDays', () => {
  test('counts calendar days in either direction', () => {
    expect(daysBetween('2026-11-02', '2026-11-05')).toBe(3);
    expect(daysBetween('2026-11-05', '2026-11-02')).toBe(-3);
    expect(daysBetween('2026-11-02', '2026-11-02')).toBe(0);
  });

  test('adds days across a week end, a leap day and a new year', () => {
    expect(addDays('2026-11-02', 6)).toBe('2026-11-08');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-11-02', -1)).toBe('2026-11-01');
  });
});

describe('mondayOf', () => {
  test.each([
    ['2026-11-02', '2026-11-02'], // Monday is its own week start
    ['2026-11-05', '2026-11-02'], // Thursday
    ['2026-11-08', '2026-11-02'], // Sunday still belongs to the week before Monday
    ['2026-11-09', '2026-11-09'],
    ['2027-01-01', '2026-12-28'], // Friday; the week starts in the previous year
  ])('%s is in the week of %s', (date, monday) => {
    expect(mondayOf(date)).toBe(monday);
  });
});

describe('years below 100', () => {
  test('year 0002 is a real date in year 2, not 1902', () => {
    expect(daysBetween('0002-11-29', '0002-11-30')).toBe(1);
    expect(addDays('0002-11-29', 1)).toBe('0002-11-30');
    expect(daysBetween('0002-11-29', '2026-11-29')).toBeGreaterThan(700000);
  });
});
