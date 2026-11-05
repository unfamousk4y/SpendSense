// Starting a new plan, from PRODUCT_PLAN.md: "If the end date has passed, request
// a new plan". Everything carries over: only the end date moves. So B and F are
// worked out again against the new date, and nothing else changes. Pure: all
// money is integer cents in ONE currency.
import { freeCashCents } from './allowance';
import { midweekSuggestion } from './allowanceChange';
import { unpaidBillsCents, type Bill } from './bills';
import { planDays, type IsoDate } from './dates';

export type NewPlanPreview =
  | {
      kind: 'ok';
      /** B under the new end date. */
      commitmentsCents: number;
      /** F under the new end date. May be negative. */
      freeCents: number;
      daysLeft: number;
      /** A suggested total for this week: what is already spent, plus a share of free cash. */
      suggestedCents: number;
      /** How far free cash is below zero; 0 when it is not. */
      shortfallCents: number;
      /** Unpaid bills due after the new end date, which are not counted. */
      billsAfterEnd: Bill[];
    }
  // A date the student can correct, explained on screen.
  | { kind: 'endPassed' };

/** The new plan button appears on the plan's last day and stays after it. */
export function canStartNewPlan(planEndDate: IsoDate, today: IsoDate): boolean {
  return today >= planEndDate;
}

export function previewNewPlan({
  today,
  endDate,
  currentCashCents,
  protectedCents,
  bills,
  spentCents,
}: {
  today: IsoDate;
  endDate: IsoDate;
  currentCashCents: number;
  protectedCents: number;
  bills: Bill[];
  /** Spending recorded this week so far. */
  spentCents: number;
}): NewPlanPreview {
  const commitmentsCents = unpaidBillsCents(bills, endDate);
  const freeCents = freeCashCents({ currentCashCents, protectedCents, commitmentsCents });
  const { daysThisWeek, daysLeft } = planDays(today, endDate);
  const suggestion = midweekSuggestion({ spentCents, freeCents, daysThisWeek, daysLeft });
  if (suggestion.kind === 'planExpired') return { kind: 'endPassed' };

  return {
    kind: 'ok',
    commitmentsCents,
    freeCents,
    daysLeft,
    suggestedCents: suggestion.totalCents,
    shortfallCents: suggestion.shortfallCents,
    billsAfterEnd: bills.filter((bill) => bill.paidOn === undefined && bill.dueOn > endDate),
  };
}
