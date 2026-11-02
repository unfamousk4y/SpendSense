import { describe, expect, test } from 'vitest';
import { freeCashCents, suggestAllowance } from '../domain/allowance';
import { planDays } from '../domain/dates';
import { summarizeWeek } from '../domain/week';
import { DEMO_WEEK_START, demoAccounts } from './demoWeek';

// Keeps the demo honest: each fixture's "suggested" number must be what the
// real rule produces from the cash the account had at the start of the week.
describe.each(Object.values(demoAccounts))('$currency demo fixture', (account) => {
  test('recommended allowance matches suggestAllowance at the start of the week', () => {
    const freeAtWeekStart = freeCashCents({ ...account, currentCashCents: account.weekStartCashCents });
    const days = planDays(DEMO_WEEK_START, account.planEndDate);

    expect(suggestAllowance({ freeCents: freeAtWeekStart, ...days })).toEqual({
      kind: 'ok',
      suggestedCents: account.recommendedAllowanceCents,
      shortfallCents: 0,
    });
  });

  test('every purchase falls inside the demo week', () => {
    expect(() => summarizeWeek(DEMO_WEEK_START, account.chosenAllowanceCents, account.purchases)).not.toThrow();
  });
});

test('USD fixture still produces the worked example: 1000 - 40 = 960 current cash', () => {
  const usd = demoAccounts.USD;
  const spent = summarizeWeek(DEMO_WEEK_START, usd.chosenAllowanceCents, usd.purchases).spentCents;
  expect(usd.weekStartCashCents - spent).toBe(96000);
});
