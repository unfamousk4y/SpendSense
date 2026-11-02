// Display formatting for integer cents. Uses whole-number math only, so the
// shown digits always match the stored cents exactly.

export type Currency = 'USD' | 'BSD';

/** 123456 -> "1,234.56"; -1000 -> "−10.00" (U+2212 minus, read as "minus" by screen readers). */
export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`cents must be a whole number (got ${cents})`);
  }
  const sign = cents < 0 ? '−' : '';
  const abs = Math.abs(cents);
  const rest = abs % 100;
  // Subtracting the remainder first makes the division exact.
  const whole = (abs - rest) / 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${grouped}.${String(rest).padStart(2, '0')}`;
}
