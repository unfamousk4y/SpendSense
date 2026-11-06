import { describe, expect, test } from 'vitest';
import { areaPoints, blendYs, dayX, easeInOut, lineYs, polylinePoints, revealEnd, TRACE_HEIGHT, TRACE_WIDTH } from './traceGeometry';

describe('spending chart geometry', () => {
  test('zero sits on the baseline, and the largest amount near the top', () => {
    const [zero, top] = lineYs([0, 15000], 15000);
    expect(zero).toBe(TRACE_HEIGHT);
    expect(top).toBeLessThan(20);
  });

  test('a larger amount is always drawn higher', () => {
    const [a, b, c] = lineYs([100, 200, 300], 300);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });

  test('Sunday ends at the right edge', () => {
    expect(dayX(6)).toBe(TRACE_WIDTH);
  });

  test('the line starts from zero at the start of the week', () => {
    expect(polylinePoints([100]).startsWith(`0,${TRACE_HEIGHT} `)).toBe(true);
  });

  test('the fill closes down to the baseline under the last day', () => {
    expect(areaPoints([100, 50]).endsWith(` ${dayX(1)},${TRACE_HEIGHT}`)).toBe(true);
  });

  test('the draw ends on the last day with data, not the end of the week', () => {
    expect(revealEnd(2)).toBe(dayX(2));
  });

  test('blending ends exactly on the real line', () => {
    expect(blendYs([0, 10], [100, 20], 0)).toEqual([0, 10]);
    expect(blendYs([0, 10], [100, 20], 0.5)).toEqual([50, 15]);
    expect(blendYs([0, 10], [100, 20], 1)).toEqual([100, 20]);
  });

  test('easing starts and ends exactly', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
  });
});
