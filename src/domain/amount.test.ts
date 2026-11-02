import { describe, expect, test } from 'vitest';
import { MAX_AMOUNT_CENTS, parseAmount } from './amount';

// Expected values were agreed in the session 2 cases table before the code was written.
describe('parseAmount', () => {
  test.each([
    ['12.50', 1250],
    ['12.5', 1250],
    ['12', 1200],
    ['0.99', 99],
    ['.5', 50],
    ['0.01', 1],
  ])('reads %j as %i cents', (text, cents) => {
    expect(parseAmount(text)).toEqual({ kind: 'ok', cents });
  });

  test.each([
    ['1.15', 115],
    ['0.29', 29],
    ['19.99', 1999],
    ['4.35', 435],
  ])('is exact where parseFloat * 100 is not: %j is %i cents', (text, cents) => {
    expect(parseAmount(text)).toEqual({ kind: 'ok', cents });
  });

  test('ignores surrounding spaces', () => {
    expect(parseAmount('  7.25 ')).toEqual({ kind: 'ok', cents: 725 });
  });

  test('ignores one leading $ shown by the input; currency comes from the account', () => {
    expect(parseAmount('$12.50')).toEqual({ kind: 'ok', cents: 1250 });
  });

  test('accepts exactly the 100,000.00 limit and rejects one cent more', () => {
    expect(parseAmount('100000')).toEqual({ kind: 'ok', cents: MAX_AMOUNT_CENTS });
    expect(parseAmount('100000.01')).toEqual({ kind: 'invalid', reason: 'tooLarge' });
    expect(parseAmount('99999999999999999999')).toEqual({ kind: 'invalid', reason: 'tooLarge' });
  });

  test.each(['12.505', '12.500', '0.001'])('%j has too many decimals', (text) => {
    expect(parseAmount(text)).toEqual({ kind: 'invalid', reason: 'tooManyDecimals' });
  });

  test.each(['', '   '])('%j is empty', (text) => {
    expect(parseAmount(text)).toEqual({ kind: 'invalid', reason: 'empty' });
  });

  test.each(['0', '0.00', '$0', '.0'])('%j is not a positive amount', (text) => {
    expect(parseAmount(text)).toEqual({ kind: 'invalid', reason: 'notPositive' });
  });

  test.each(['-5', '$$12', '1,250', '1e3', '12.', '.', '$', 'abc', '$ 12', '12 50'])(
    '%j is not a valid format',
    (text) => {
      expect(parseAmount(text)).toEqual({ kind: 'invalid', reason: 'format' });
    },
  );
});
