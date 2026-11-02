import { expect, test } from 'vitest';
import { purchaseTitle } from './categories';

test('uses the merchant when one was entered', () => {
  expect(purchaseTitle({ merchant: 'Campus café', category: 'food' })).toBe('Campus café');
});

test('falls back to the category label when Where was left blank', () => {
  expect(purchaseTitle({ merchant: '   ', category: 'phoneBills' })).toBe('Phone & bills');
});

test('falls back to "Purchase" when neither was entered', () => {
  expect(purchaseTitle({ merchant: '' })).toBe('Purchase');
});
