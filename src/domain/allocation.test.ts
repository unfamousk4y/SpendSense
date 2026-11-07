import { describe, expect, test } from 'vitest';
import { allocateCashBySplit } from './allocation';

// Hand-worked. Percent rounding: floor every share, then hand the missing
// points to the largest remainders.
describe('allocateCashBySplit', () => {
  test('USD demo: 960 = 200 protected + 200 bills + 324.50 needs + 235.50 wants', () => {
    // Exact shares 20.83, 20.83, 33.80, 24.53 -> floors 20, 20, 33, 24 (97);
    // the 3 missing points go to the two 20.83s, then 33.80.
    expect(
      allocateCashBySplit({ currentCashCents: 96000, protectedCents: 20000, commitmentsCents: 20000, wantsLeftCents: 23550 }),
    ).toEqual({
      kind: 'ok',
      totalCents: 96000,
      segments: [
        { key: 'protected', cents: 20000, percent: 21 },
        { key: 'bills', cents: 20000, percent: 21 },
        { key: 'needs', cents: 32450, percent: 34 },
        { key: 'wants', cents: 23550, percent: 24 },
      ],
    });
  });

  test('three equal parts show 34/33/33, never 99%', () => {
    const result = allocateCashBySplit({ currentCashCents: 300, protectedCents: 100, commitmentsCents: 100, wantsLeftCents: 100 });
    expect(result.kind === 'ok' && result.segments.map((s) => s.percent)).toEqual([34, 33, 0, 33]);
  });

  test('no wants left: the cash is still all accounted for', () => {
    const result = allocateCashBySplit({ currentCashCents: 96000, protectedCents: 20000, commitmentsCents: 20000, wantsLeftCents: 0 });
    expect(result.kind === 'ok' && result.segments.map((s) => s.cents)).toEqual([20000, 20000, 56000, 0]);
  });

  test('wants are capped by the free cash that actually exists', () => {
    const result = allocateCashBySplit({ currentCashCents: 50000, protectedCents: 20000, commitmentsCents: 20000, wantsLeftCents: 15000 });
    expect(result.kind === 'ok' && result.segments.map((s) => s.cents)).toEqual([20000, 20000, 0, 10000]);
  });

  test('savings plus bills above cash is a shortfall, not a chart', () => {
    expect(
      allocateCashBySplit({ currentCashCents: 10000, protectedCents: 5000, commitmentsCents: 8000, wantsLeftCents: 0 }),
    ).toEqual({ kind: 'shortfall', shortfallCents: 3000 });
  });

  test('zero cash shows all zero percents instead of dividing by zero', () => {
    const result = allocateCashBySplit({ currentCashCents: 0, protectedCents: 0, commitmentsCents: 0, wantsLeftCents: 0 });
    expect(result.kind === 'ok' && result.segments.map((s) => s.percent)).toEqual([0, 0, 0, 0]);
  });
});
