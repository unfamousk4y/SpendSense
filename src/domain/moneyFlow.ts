// Where this week's allowance went: one stream per spending category plus what
// is left. Streams always add up to totalCents, which is the allowance, or the
// amount spent when that is larger (overspending is drawn, never hidden).
import { spendingByCategory } from './categoryBreakdown';
import type { Purchase } from './week';

export type FlowStream = {
  /** Stable key: a category id, "none" for uncategorized, or "remaining". */
  key: string;
  label: string;
  cents: number;
  kind: 'spent' | 'remaining';
};

export type MoneyFlow = {
  totalCents: number;
  allowanceCents: number;
  /** Spending beyond the allowance; 0 when within it. */
  overspentCents: number;
  streams: FlowStream[];
};

export function moneyFlow(allowanceCents: number, purchases: Purchase[]): MoneyFlow {
  const { groups, totalCents: spentCents } = spendingByCategory(purchases);
  const streams: FlowStream[] = groups.map((group) => ({
    key: group.category ?? 'none',
    label: group.label,
    cents: group.cents,
    kind: 'spent',
  }));

  const leftCents = allowanceCents - spentCents;
  if (leftCents > 0) {
    streams.push({ key: 'remaining', label: 'Left to spend', cents: leftCents, kind: 'remaining' });
  }

  return {
    totalCents: Math.max(allowanceCents, spentCents),
    allowanceCents,
    overspentCents: Math.max(0, -leftCents),
    streams,
  };
}
