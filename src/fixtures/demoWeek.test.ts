import { describe, expect, test } from 'vitest';
import { freeCashCents, suggestAllowance } from '../domain/allowance';
import { planDays } from '../domain/dates';
import { DEMO_WEEK_START, demoAccounts } from './demoWeek';

// Keeps the demo honest: each fixture's "suggested" number must be what the
// real rule produces from the cash the account had at the start of the week.
describe.each(Object.values(demoAccounts))('$currency demo fixture', (account) => {
  test('recommended allowance matches suggestAllowance at the start of the week', () => {
    const spentCents = account.purchases.reduce((sum, p) => sum + p.cents, 0);
    const freeAtWeekStart = freeCashCents({ ...account, currentCashCents: account.currentCashCents + spentCents });
    const days = planDays(DEMO_WEEK_START, account.planEndDate);

    expect(suggestAllowance({ freeCents: freeAtWeekStart, ...days })).toEqual({
      kind: 'ok',
      suggestedCents: account.recommendedAllowanceCents,
      shortfallCents: 0,
    });
  });
});
