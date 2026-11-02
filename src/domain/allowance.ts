// Pure allowance rule from PRODUCT_PLAN.md. No React, database or clock access:
// every input is passed in. All money is integer cents in ONE currency; callers
// run this separately for USD and BSD and never combine the results.

export type AllowanceInput = {
  /** F = current cash - protected savings - unpaid commitments, in cents. May be negative. */
  freeCents: number;
  /** d: days left in this week and on or before the plan end date, inclusive. */
  daysThisWeek: number;
  /** D: days from today through the plan end date, inclusive. 0 or less means the plan has ended. */
  daysLeft: number;
};

export type AllowanceSuggestion =
  | { kind: 'ok'; suggestedCents: number; shortfallCents: number }
  | { kind: 'planExpired' };

export function suggestAllowance({
  freeCents,
  daysThisWeek,
  daysLeft,
}: AllowanceInput): AllowanceSuggestion {
  requireSafeInteger(freeCents, 'freeCents');
  requireSafeInteger(daysThisWeek, 'daysThisWeek');
  requireSafeInteger(daysLeft, 'daysLeft');

  // A passed end date is a real user situation, not a bug: ask for a new plan
  // instead of dividing by zero.
  if (daysLeft <= 0) {
    return { kind: 'planExpired' };
  }

  // These can only happen if our own date code is wrong, so fail loudly.
  if (daysThisWeek < 1 || daysThisWeek > 7 || daysThisWeek > daysLeft) {
    throw new RangeError(
      `daysThisWeek must be 1-7 and no more than daysLeft (got ${daysThisWeek} of ${daysLeft})`,
    );
  }

  // Never hide a deficit: suggest nothing and report how far short the plan is.
  if (freeCents < 0) {
    return { kind: 'ok', suggestedCents: 0, shortfallCents: -freeCents };
  }

  const product = freeCents * daysThisWeek;
  requireSafeInteger(product, 'freeCents * daysThisWeek');

  // Round down so we never suggest a fraction of a cent more than exists.
  // The dropped remainder stays in free cash for later weeks.
  return {
    kind: 'ok',
    suggestedCents: Math.floor(product / daysLeft),
    shortfallCents: 0,
  };
}

function requireSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a whole number within the safe integer range (got ${value})`);
  }
}
