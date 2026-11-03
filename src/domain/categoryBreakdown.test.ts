import { describe, expect, test } from 'vitest';
import { spendingByCategory } from './categoryBreakdown';
import type { Purchase } from './week';

// USD demo week: Campus café 4.50 (Food, want), Bookstore 28.00 (School, need),
// Bus pass 7.50 (Transport, need). Hand-worked totals below.
const usdWeek: Purchase[] = [
  { id: 'a', date: '2026-11-03', merchant: 'Campus café', category: 'food', needOrWant: 'want', cents: 450 },
  { id: 'b', date: '2026-11-04', merchant: 'Bookstore', category: 'school', needOrWant: 'need', cents: 2800 },
  { id: 'c', date: '2026-11-05', merchant: 'Bus pass top-up', category: 'transport', needOrWant: 'need', cents: 750 },
];

describe('spendingByCategory', () => {
  test('groups the USD week by category, largest first, with need/want totals', () => {
    const result = spendingByCategory(usdWeek);
    expect(result.groups.map((g) => [g.label, g.cents, g.purchases.length])).toEqual([
      ['School', 2800, 1],
      ['Transport', 750, 1],
      ['Food', 450, 1],
    ]);
    expect(result).toMatchObject({ totalCents: 4000, needCents: 3550, wantCents: 450, untaggedCents: 0 });
  });

  test('purchases with no category go in a last "No category" group, even when larger', () => {
    const quick: Purchase = { id: 'd', date: '2026-11-05', merchant: '', cents: 825 };
    const result = spendingByCategory([...usdWeek, quick]);
    expect(result.groups.map((g) => [g.label, g.cents])).toEqual([
      ['School', 2800],
      ['Transport', 750],
      ['Food', 450],
      ['No category', 825],
    ]);
    // 4000 + 8.25; the untagged 8.25 is neither need nor want.
    expect(result).toMatchObject({ totalCents: 4825, needCents: 3550, wantCents: 450, untaggedCents: 825 });
  });

  test('several purchases in one category add up inside one group', () => {
    const lunch: Purchase = { id: 'e', date: '2026-11-05', merchant: 'Fish fry', category: 'food', needOrWant: 'want', cents: 1200 };
    const food = spendingByCategory([...usdWeek, lunch]).groups.find((g) => g.category === 'food');
    expect(food?.cents).toBe(1650);
    expect(food?.purchases.map((p) => p.id)).toEqual(['a', 'e']);
  });

  test('equal totals keep the fixed category order', () => {
    const tie: Purchase[] = [
      { id: 'x', date: '2026-11-05', merchant: '', category: 'fun', cents: 500 },
      { id: 'y', date: '2026-11-05', merchant: '', category: 'food', cents: 500 },
    ];
    expect(spendingByCategory(tie).groups.map((g) => g.label)).toEqual(['Food', 'Fun']);
  });

  test('an empty week has no groups and zero totals', () => {
    expect(spendingByCategory([])).toEqual({
      groups: [],
      totalCents: 0,
      needCents: 0,
      wantCents: 0,
      untaggedCents: 0,
    });
  });
});
