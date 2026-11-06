import { describe, expect, test } from 'vitest';
import { tiltDegrees } from './tilt';

const edgeTravel = (sizePx: number) => Math.sin((tiltDegrees(sizePx) * Math.PI) / 180) * (sizePx / 2);

describe('how far a panel tilts', () => {
  test('a small panel stops at the steepest allowed angle', () => {
    expect(tiltDegrees(190)).toBe(2.5);
  });

  test('a wider panel tilts less, so its edge travels no further', () => {
    expect(tiltDegrees(1258)).toBeLessThan(tiltDegrees(600));
    expect(edgeTravel(600)).toBeCloseTo(9);
    expect(edgeTravel(1258)).toBeCloseTo(9);
  });

  test('no size is ever steeper than the limit or breaks the sum', () => {
    for (const size of [0, 1, 18, 19, 100, 5000]) {
      const degrees = tiltDegrees(size);
      expect(Number.isFinite(degrees)).toBe(true);
      expect(degrees).toBeGreaterThan(0);
      expect(degrees).toBeLessThanOrEqual(2.5);
    }
  });
});
