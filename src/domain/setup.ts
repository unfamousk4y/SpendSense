// Starting a new account: from what the student says is true today, work out
// free cash and the first week's suggested allowance. Pure, in one currency.
//
// The first week is usually partial: someone setting up on a Wednesday gets
// the share for Wednesday through Sunday, using the same rule as every week.
import { previewAllowanceChange } from './allowanceChange';
import { freeCashCents, suggestAllowance } from './allowance';
import { mondayOf, planDays, type IsoDate } from './dates';

export type SetupInput = {
  today: IsoDate;
  cashCents: number;
  protectedCents: number;
  commitmentsCents: number;
  planEndDate: IsoDate;
};

export type SetupPreview =
  | {
      kind: 'ok';
      weekStart: IsoDate;
      freeCents: number;
      daysThisWeek: number;
      daysLeft: number;
      suggestedCents: number;
      /** How far free cash is below zero; 0 when it is not. */
      shortfallCents: number;
    }
  // Expected student situations, explained on screen.
  | { kind: 'planEndPassed' }
  | { kind: 'protectedAboveCash' };

export function previewSetup({ today, cashCents, protectedCents, commitmentsCents, planEndDate }: SetupInput): SetupPreview {
  // Protected savings are part of the cash, not extra money.
  if (protectedCents > cashCents) return { kind: 'protectedAboveCash' };

  const freeCents = freeCashCents({ currentCashCents: cashCents, protectedCents, commitmentsCents });
  const days = planDays(today, planEndDate);
  const suggestion = suggestAllowance({ freeCents, ...days });
  if (suggestion.kind === 'planExpired') return { kind: 'planEndPassed' };

  return {
    kind: 'ok',
    weekStart: mondayOf(today),
    freeCents,
    ...days,
    suggestedCents: suggestion.suggestedCents,
    shortfallCents: suggestion.shortfallCents,
  };
}

/**
 * Whether a chosen first allowance fits. Nothing is spent yet, so this is the
 * midweek rule with S = 0: above the suggestion is fine up to free cash.
 */
export function firstAllowanceFits(chosenCents: number, suggestedCents: number, freeCents: number): boolean {
  const preview = previewAllowanceChange({
    currentAllowanceCents: suggestedCents,
    proposedAllowanceCents: chosenCents,
    spentCents: 0,
    freeCents,
  });
  return preview.kind !== 'exceedsFreeCash';
}
