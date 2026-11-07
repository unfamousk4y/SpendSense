// Starting a new account: from what the student says is true today, work out
// free cash and the first week's suggested allowance. Pure, in one currency.
//
// The first week is usually partial: someone setting up on a Wednesday gets
// the share for Wednesday through Sunday, using the same rule as every week.
import { previewAllowanceChange } from './allowanceChange';
import { freeCashCents, suggestAllowance } from './allowance';
import { mondayOf, planDays, type IsoDate } from './dates';
import { splitOpening, wantsLeft, weeklyWantsGuide, type Split, type SplitAmounts } from './split';

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

export type SplitSetupPreview =
  | (Extract<SetupPreview, { kind: 'ok' }> &
      SplitAmounts & {
        /** The savings already held plus the new savings share. */
        protectedCents: number;
        wantsLeftCents: number;
        coveredElsewhereCents: number;
        wantsGuideCents: number;
      })
  | Exclude<SetupPreview, { kind: 'ok' }>;

/**
 * Setup with a split. Savings the student already has stay out of it, and its
 * savings share then counts as protected, so the allowance is worked out after it.
 */
export function previewSetupWithSplit({
  today,
  cashCents,
  alreadySavedCents,
  commitmentsCents,
  planEndDate,
  split,
}: Omit<SetupInput, 'protectedCents'> & { alreadySavedCents: number; split: Split }): SplitSetupPreview {
  if (alreadySavedCents > cashCents) return { kind: 'protectedAboveCash' };

  const opening = splitOpening({ cashCents, alreadySavedCents, billsCents: commitmentsCents, split });
  const preview = previewSetup({ today, cashCents, protectedCents: opening.protectedCents, commitmentsCents, planEndDate });
  if (preview.kind !== 'ok') return preview;

  const left = wantsLeft({
    wantsPoolCents: opening.wantsCents,
    wantsSpentCents: 0,
    movedToSavingsCents: 0,
    freeCents: preview.freeCents,
  });
  return {
    ...preview,
    ...opening,
    ...left,
    wantsGuideCents: weeklyWantsGuide({
      wantsLeftCents: left.wantsLeftCents,
      daysThisWeek: preview.daysThisWeek,
      daysLeft: preview.daysLeft,
    }),
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
