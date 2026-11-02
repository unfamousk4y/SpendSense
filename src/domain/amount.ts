// Turns what a student types into integer cents. It works on the text itself
// and never goes through a floating-point number, so "1.15" is exactly 115
// (parseFloat("1.15") * 100 is 114.99999999999999).
//
// USD and BSD both use 2 decimal places. The currency always comes from the
// selected account, never from this text: a "$" is accepted only because the
// input shows one, and it is ignored.

/** 100,000.00: a sanity limit that catches extra-zero typos, not a budget rule. */
export const MAX_AMOUNT_CENTS = 10_000_000;

export type AmountInvalidReason =
  | 'empty'
  | 'format'
  | 'commaDecimal'
  | 'tooManyDecimals'
  | 'notPositive'
  | 'tooLarge';

export type AmountParseResult =
  | { kind: 'ok'; cents: number }
  | { kind: 'invalid'; reason: AmountInvalidReason };

// Optional "$", whole dollars, then optional "." with at least one digit.
// Whole dollars are either plain digits ("1250") or correctly grouped
// thousands ("1,250", "12,345"); a comma anywhere else does not match.
// Any number of decimal digits matches here so "12.505" can get the specific
// tooManyDecimals reason instead of a generic format error.
const AMOUNT = /^\$?(\d{1,3}(?:,\d{3})+|\d*)(?:\.(\d+))?$/;

// "12,50" or "1,5": in many countries the comma is the decimal point. Removing
// it would silently turn 12,50 into 1250.00, so this gets its own reason.
const COMMA_AS_DECIMAL = /^\$?\d+,\d{1,2}$/;

// Bad input is an expected user situation, so every problem is returned as a
// reason for the screen to explain. Nothing here throws.
export function parseAmount(text: string): AmountParseResult {
  const trimmed = text.trim();
  if (trimmed === '') {
    return invalid('empty');
  }

  if (COMMA_AS_DECIMAL.test(trimmed)) {
    return invalid('commaDecimal');
  }

  const match = AMOUNT.exec(trimmed);
  // The pattern has already checked where the commas are, so they can go.
  const whole = (match?.[1] ?? '').replaceAll(',', '');
  const fraction = match?.[2] ?? '';
  // The pattern also matches "$" alone, which has no digits at all.
  if (!match || (whole === '' && fraction === '')) {
    return invalid('format');
  }
  if (fraction.length > 2) {
    return invalid('tooManyDecimals');
  }

  // "5" means 50 cents, so pad on the right. Both parts are whole numbers.
  const cents = Number(whole || '0') * 100 + Number(fraction.padEnd(2, '0'));

  if (cents === 0) {
    return invalid('notPositive');
  }
  // Very long digit strings lose precision in Number, but they are still far
  // above the limit, so this comparison stays correct.
  if (cents > MAX_AMOUNT_CENTS) {
    return invalid('tooLarge');
  }
  return { kind: 'ok', cents };
}

function invalid(reason: AmountInvalidReason): AmountParseResult {
  return { kind: 'invalid', reason };
}
