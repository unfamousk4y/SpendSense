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

  test.each(['-5', '$$12', '1e3', '12.', '.', '$', 'abc', '$ 12', '12 50'])(
    '%j is not a valid format',
    (text) => {
      expect(parseAmount(text)).toEqual({ kind: 'invalid', reason: 'format' });
    },
  );

  // Commas approved 2026-11-02, but only as thousands separators.
  describe('thousands commas', () => {
    test.each([
      ['1,000.00', 100000],
      ['1,000', 100000],
      ['1,250', 125000],
      ['$1,250.50', 125050],
      ['12,345.67', 1234567],
      ['100,000', 10000000],
    ])('reads %j as %i cents', (text, cents) => {
      expect(parseAmount(text)).toEqual({ kind: 'ok', cents });
    });

    test('the limit still applies with commas', () => {
      expect(parseAmount('100,000.01')).toEqual({ kind: 'invalid', reason: 'tooLarge' });
    });

    test('decimal rules still apply with commas', () => {
      expect(parseAmount('1,000.505')).toEqual({ kind: 'invalid', reason: 'tooManyDecimals' });
    });

    // In many countries the comma is the decimal point. Silently dropping it
    // would turn 12,50 into 1250.00, so ask for a period instead.
    test.each(['12,50', '1,5', '10,00', '$12,50'])('%j looks like a comma used for cents', (text) => {
      expect(parseAmount(text)).toEqual({ kind: 'invalid', reason: 'commaDecimal' });
    });

    test.each(['1,00,000', '1,2345', ',500', '1,,000', '1,000,', '12,345,67'])(
      '%j has commas in the wrong place',
      (text) => {
        expect(parseAmount(text)).toEqual({ kind: 'invalid', reason: 'format' });
      },
    );
  });
});
