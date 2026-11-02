// Where one account's current cash is right now, split into four parts that
// always add up to current cash: C = protected + bills + this week + later weeks.

export type AllocationKey = 'protected' | 'bills' | 'thisWeek' | 'laterWeeks';

export type AllocationSegment = {
  key: AllocationKey;
  cents: number;
  /** Whole percent of current cash; all four always sum to exactly 100 (or all 0). */
  percent: number;
};

export type CashAllocation =
  | { kind: 'ok'; totalCents: number; segments: AllocationSegment[] }
  /** Protected savings and bills exceed cash: there is no honest way to draw this as parts. */
  | { kind: 'shortfall'; shortfallCents: number };

export function allocateCash({
  currentCashCents,
  protectedCents,
  commitmentsCents,
  weekRemainingCents,
}: {
  currentCashCents: number;
  protectedCents: number;
  commitmentsCents: number;
  /** Chosen allowance minus spending this week; negative when overspent. */
  weekRemainingCents: number;
}): CashAllocation {
  const freeCents = currentCashCents - protectedCents - commitmentsCents;
  if (freeCents < 0) {
    return { kind: 'shortfall', shortfallCents: -freeCents };
  }

  // Overspending leaves nothing for this week. If the allowance is larger than
  // the free cash that actually exists, only the existing cash can be shown.
  const thisWeekCents = Math.min(Math.max(weekRemainingCents, 0), freeCents);
  const parts: [AllocationKey, number][] = [
    ['protected', protectedCents],
    ['bills', commitmentsCents],
    ['thisWeek', thisWeekCents],
    ['laterWeeks', freeCents - thisWeekCents],
  ];

  const percents = wholePercentsSummingTo100(parts.map(([, cents]) => cents), currentCashCents);
  return {
    kind: 'ok',
    totalCents: currentCashCents,
    segments: parts.map(([key, cents], i) => ({ key, cents, percent: percents[i] })),
  };
}

/**
 * Rounding each share separately can show 33% + 33% + 33% = 99%. Instead round
 * every share down, then give the missing points to the shares that lost the
 * most in rounding (the "largest remainder" method). Earlier parts win ties.
 */
function wholePercentsSummingTo100(values: number[], total: number): number[] {
  if (total === 0) {
    return values.map(() => 0);
  }
  // value * 100 / total stays exact enough here: values are integer cents.
  const exact = values.map((value) => (value * 100) / total);
  const floored = exact.map(Math.floor);
  let missing = 100 - floored.reduce((sum, p) => sum + p, 0);

  const byRemainder = exact
    .map((share, i) => ({ i, remainder: share - floored[i] }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  for (const { i } of byRemainder) {
    if (missing === 0) break;
    floored[i] += 1;
    missing -= 1;
  }
  return floored;
}
