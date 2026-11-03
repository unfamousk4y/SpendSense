import { describe, expect, test } from 'vitest';
import { moneyFlow } from './moneyFlow';
import type { Purchase } from './week';

const usdWeek: Purchase[] = [
  { id: 'a', date: '2026-11-03', merchant: 'Campus café', category: 'food', cents: 450 },
  { id: 'b', date: '2026-11-04', merchant: 'Bookstore', category: 'school', cents: 2800 },
  { id: 'c', date: '2026-11-05', merchant: 'Bus pass top-up', category: 'transport', cents: 750 },
];

const streamsOf = (flow: ReturnType<typeof moneyFlow>) => flow.streams.map((s) => [s.label, s.cents, s.kind]);

describe('moneyFlow', () => {
  test('worked example: $150 allowance flows into $40 of categories and $110 left', () => {
    const flow = moneyFlow(15000, usdWeek);
    expect(streamsOf(flow)).toEqual([
      ['School', 2800, 'spent'],
      ['Transport', 750, 'spent'],
      ['Food', 450, 'spent'],
      ['Left to spend', 11000, 'remaining'],
    ]);
    expect(flow).toMatchObject({ totalCents: 15000, allowanceCents: 15000, overspentCents: 0 });
  });

  test('streams always add up to the total drawn', () => {
    const flow = moneyFlow(15000, usdWeek);
    expect(flow.streams.reduce((sum, s) => sum + s.cents, 0)).toBe(flow.totalCents);
  });

  test('overspent: the total is what was spent, nothing is left, and the excess is reported', () => {
    // $30 allowance, $40 spent: draw $40 of streams, mark $10 over.
    const flow = moneyFlow(3000, usdWeek);
    expect(streamsOf(flow).map(([label]) => label)).toEqual(['School', 'Transport', 'Food']);
    expect(flow).toMatchObject({ totalCents: 4000, allowanceCents: 3000, overspentCents: 1000 });
  });

  test('spending exactly the allowance leaves no "Left to spend" stream', () => {
    const flow = moneyFlow(4000, usdWeek);
    expect(flow.streams.some((s) => s.kind === 'remaining')).toBe(false);
    expect(flow.overspentCents).toBe(0);
  });

  test('an empty week is one stream: everything is still left to spend', () => {
    expect(streamsOf(moneyFlow(15000, []))).toEqual([['Left to spend', 15000, 'remaining']]);
  });

  test('no allowance and no spending draws nothing instead of dividing by zero', () => {
    expect(moneyFlow(0, [])).toEqual({ totalCents: 0, allowanceCents: 0, overspentCents: 0, streams: [] });
  });
});
