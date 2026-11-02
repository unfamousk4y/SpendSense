import { describe, expect, test } from 'vitest';
import { addPurchaseOnce, summarizeWeek, type Purchase } from './week';

const workedExamplePurchases: Purchase[] = [
  { id: 'a', date: '2026-11-03', merchant: 'Campus café', cents: 450 },
  { id: 'b', date: '2026-11-04', merchant: 'Bookstore', cents: 2800 },
  { id: 'c', date: '2026-11-05', merchant: 'Bus pass top-up', cents: 750 },
];

describe('summarizeWeek', () => {
  test('worked example: $150 allowance, $40 spent leaves $110', () => {
    expect(summarizeWeek('2026-11-02', 15000, workedExamplePurchases)).toEqual({
      spentCents: 4000,
      remainingCents: 11000,
      cumulativeCents: [0, 450, 3250, 4000, 4000, 4000, 4000],
      // 15000 * n / 7, rounded down: 2142.86, 4285.71, 6428.57, 8571.43, ...
      evenPaceCents: [2142, 4285, 6428, 8571, 10714, 12857, 15000],
    });
  });

  test('shows overspending as a negative remaining amount instead of hiding it', () => {
    expect(summarizeWeek('2026-11-02', 3000, workedExamplePurchases).remainingCents).toBe(-1000);
  });

  test('an empty week has spent nothing and the whole allowance remains', () => {
    const summary = summarizeWeek('2026-11-02', 15000, []);
    expect(summary.spentCents).toBe(0);
    expect(summary.remainingCents).toBe(15000);
  });

  test('rejects a week that does not start on Monday', () => {
    expect(() => summarizeWeek('2026-11-03', 15000, [])).toThrow(RangeError);
  });

  test('rejects a purchase dated outside the week', () => {
    const lateEntry: Purchase = { id: 'x', date: '2026-11-09', merchant: 'Next Monday', cents: 100 };
    expect(() => summarizeWeek('2026-11-02', 15000, [lateEntry])).toThrow(RangeError);
  });
});

describe('addPurchaseOnce', () => {
  const lunch: Purchase = { id: 'entry-1', date: '2026-11-05', merchant: 'Fish fry', cents: 1200 };

  test('adds a new purchase without changing the original list', () => {
    const before = [...workedExamplePurchases];
    const after = addPurchaseOnce(before, lunch);
    expect(after).toHaveLength(4);
    expect(before).toHaveLength(3);
  });

  test('a second save with the same id (double tap or retry) changes nothing', () => {
    const once = addPurchaseOnce(workedExamplePurchases, lunch);
    const twice = addPurchaseOnce(once, { ...lunch });
    expect(twice).toBe(once);
    expect(summarizeWeek('2026-11-02', 15000, twice).spentCents).toBe(5200);
  });
});
