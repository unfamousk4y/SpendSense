import { describe, expect, test } from 'vitest';
import { previewRelease, recordRelease, type SavingsRelease } from './release';

// Hand-worked from the closure worked example: after closing the week of
// Nov 2, P = USD 310 and F = USD 450 (cash 960 and bills 200 never change here).
describe('previewRelease', () => {
  test('releasing $50 of $310: P 260, F 500', () => {
    expect(previewRelease({ releaseCents: 5000, protectedCents: 31000, freeCents: 45000 })).toEqual({
      kind: 'ok',
      before: { protectedCents: 31000, freeCents: 45000 },
      after: { protectedCents: 26000, freeCents: 50000 },
    });
  });

  test('releasing everything is allowed: P 0, F 760', () => {
    expect(previewRelease({ releaseCents: 31000, protectedCents: 31000, freeCents: 45000 })).toMatchObject({
      after: { protectedCents: 0, freeCents: 76000 },
    });
  });

  test('one cent more than protected is refused', () => {
    expect(previewRelease({ releaseCents: 31001, protectedCents: 31000, freeCents: 45000 })).toEqual({
      kind: 'moreThanProtected',
      protectedCents: 31000,
    });
  });

  test('with nothing protected there is nothing to release', () => {
    expect(previewRelease({ releaseCents: 100, protectedCents: 0, freeCents: 45000 })).toEqual({
      kind: 'nothingProtected',
    });
  });

  // A shortfall is exactly when a student may need savings: releasing $30
  // into F = -$20 brings it to +$10.
  test('release into negative free cash brings it up by the same amount', () => {
    expect(previewRelease({ releaseCents: 3000, protectedCents: 5000, freeCents: -2000 })).toMatchObject({
      after: { protectedCents: 2000, freeCents: 1000 },
    });
  });

  test('zero, negative or fractional amounts are programming errors', () => {
    expect(() => previewRelease({ releaseCents: 0, protectedCents: 31000, freeCents: 0 })).toThrow(RangeError);
    expect(() => previewRelease({ releaseCents: -1, protectedCents: 31000, freeCents: 0 })).toThrow(RangeError);
    expect(() => previewRelease({ releaseCents: 1.5, protectedCents: 31000, freeCents: 0 })).toThrow(RangeError);
  });
});

describe('recordRelease', () => {
  test('a double tap on Release records it once', () => {
    const release: SavingsRelease = { id: 'r1', madeOn: '2026-11-09', cents: 5000 };
    const once = recordRelease([], release);
    expect(once).toEqual([release]);
    expect(recordRelease(once, { ...release })).toBe(once);
  });
});
