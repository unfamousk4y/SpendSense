import { expect, test } from 'vitest';
import { formatCents } from './money';

test.each([
  [11000, '110.00'],
  [5, '0.05'],
  [50, '0.50'],
  [0, '0.00'],
  [100000, '1,000.00'],
  [123456789, '1,234,567.89'],
  [-1000, '−10.00'],
])('formats %i cents as %j', (cents, text) => {
  expect(formatCents(cents)).toBe(text);
});

test('rejects fractional cents', () => {
  expect(() => formatCents(10.5)).toThrow(RangeError);
});
