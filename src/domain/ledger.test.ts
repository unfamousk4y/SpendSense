import { describe, expect, test } from 'vitest';
import { demoLedger } from '../fixtures/demoWeek';
import { ledgerReducer, weekAccount, type Ledger, type LedgerAction } from './ledger';

// Expected values worked out by hand. The demo starts Thu Nov 5 in the week of
// Nov 2 with USD 1,000 opening cash, 200 protected, 200 bills, allowance 150,
// 40 spent; BSD 345.50, 50 protected, 120 bills, allowance 45, 25.50 spent.

function run(state: Ledger, ...actions: LedgerAction[]): Ledger {
  return actions.reduce(ledgerReducer, state);
}
const nextDays = (count: number): LedgerAction[] => Array.from({ length: count }, () => ({ type: 'nextDay' }));
// Thu Nov 5 -> Mon Nov 9 is four steps.
const toMonday = nextDays(4);

describe('ledger: moving through the week', () => {
  test('the starting screen matches the demo: cash 1,000 at week start, 200 protected, 150 allowance', () => {
    expect(weekAccount(demoLedger, 'USD')).toMatchObject({
      weekStart: '2026-11-02',
      weekStartCashCents: 100000,
      protectedCents: 20000,
      chosenAllowanceCents: 15000,
      previousClosure: undefined,
    });
    expect(weekAccount(demoLedger, 'USD').purchases).toHaveLength(3);
  });

  test('Thursday to Friday only changes the date', () => {
    const friday = run(demoLedger, { type: 'nextDay' });
    expect(friday.today).toBe('2026-11-06');
    expect(friday.accounts).toBe(demoLedger.accounts);
  });

  test('worked example: Monday closes the week, protecting 110; P 310, cash 960, new allowance 150', () => {
    const monday = run(demoLedger, ...toMonday);
    expect(monday.today).toBe('2026-11-09');
    expect(weekAccount(monday, 'USD')).toMatchObject({
      weekStart: '2026-11-09',
      weekStartCashCents: 96000,
      protectedCents: 31000,
      commitmentsCents: 20000,
      // F = 960 - 310 - 200 = 450 over 21 days, 7 of them this week.
      recommendedAllowanceCents: 15000,
      chosenAllowanceCents: 15000,
      purchases: [],
      previousClosure: { weekStart: '2026-11-02', leftoverCents: 11000, protectedCents: 11000 },
    });
  });

  test('BSD closes separately: protects 19.50, P 69.50, new suggestion 43.50', () => {
    const monday = run(demoLedger, ...toMonday);
    // F after = 320.00 - 69.50 - 120.00 = 130.50; floor(13050 * 7 / 21) = 4350.
    expect(weekAccount(monday, 'BSD')).toMatchObject({
      weekStartCashCents: 32000,
      protectedCents: 6950,
      recommendedAllowanceCents: 4350,
      previousClosure: { currency: 'BSD', protectedCents: 1950 },
    });
  });

  test('several fast taps chain: Saturday to Tuesday closes the week once', () => {
    const saturday = run(demoLedger, ...nextDays(2));
    const tuesday = run(saturday, ...nextDays(3));
    expect(tuesday.today).toBe('2026-11-10');
    expect(tuesday.accounts.USD.closures).toHaveLength(1);
    expect(tuesday.accounts.BSD.closures).toHaveLength(1);
  });

  test('a midweek change to 180 is what closes: 140 protected, next suggestion 140', () => {
    const changed = run(
      demoLedger,
      {
        type: 'changeAllowance',
        currency: 'USD',
        change: { id: 'c1', madeOn: '2026-11-05', fromCents: 15000, toCents: 18000, suggestedCents: 12960 },
      },
      ...toMonday,
    );
    // F after = 960 - 340 - 200 = 420; floor(42000 * 7 / 21) = 14000.
    expect(weekAccount(changed, 'USD')).toMatchObject({
      protectedCents: 34000,
      recommendedAllowanceCents: 14000,
      allowanceChanges: [],
    });
  });

  test('an overspent week protects nothing and the lower cash lowers the next suggestion', () => {
    const overspent = run(
      demoLedger,
      { type: 'addPurchase', currency: 'USD', purchase: { id: 'big', date: '2026-11-05', merchant: 'Laptop repair', cents: 11500 } },
      ...toMonday,
    );
    // Spent 155 of 150. F after = 845 - 200 - 200 = 445; floor(44500 * 7 / 21) = 14833.
    expect(weekAccount(overspent, 'USD')).toMatchObject({
      protectedCents: 20000,
      recommendedAllowanceCents: 14833,
      previousClosure: { leftoverCents: -500, protectedCents: 0 },
    });
  });

  test('stops at the plan end date: three weeks closed by Sun Nov 29, then nothing changes', () => {
    const end = run(demoLedger, ...nextDays(24));
    expect(end.today).toBe('2026-11-29');
    expect(end.accounts.USD.closures.map((closure) => closure.weekStart)).toEqual([
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
    ]);
    expect(ledgerReducer(end, { type: 'nextDay' })).toBe(end);
  });
});

describe('ledger: closed weeks and future dates are not editable', () => {
  const monday = run(demoLedger, ...toMonday);

  test('adding a purchase dated in the closed week is ignored', () => {
    const action: LedgerAction = {
      type: 'addPurchase',
      currency: 'USD',
      purchase: { id: 'late', date: '2026-11-04', merchant: 'Backdated', cents: 500 },
    };
    expect(ledgerReducer(monday, action)).toBe(monday);
  });

  test('editing or deleting a purchase from the closed week is ignored', () => {
    const old = monday.accounts.USD.purchases[0];
    expect(ledgerReducer(monday, { type: 'updatePurchase', currency: 'USD', purchase: { ...old, cents: 1 } })).toBe(monday);
    expect(ledgerReducer(monday, { type: 'deletePurchase', currency: 'USD', id: old.id })).toBe(monday);
  });

  test('moving an open-week purchase back into a closed week is ignored', () => {
    const added = ledgerReducer(monday, {
      type: 'addPurchase',
      currency: 'USD',
      purchase: { id: 'new', date: '2026-11-09', merchant: 'Café', cents: 300 },
    });
    expect(weekAccount(added, 'USD').purchases).toHaveLength(1);
    const moved = { ...added.accounts.USD.purchases.at(-1)!, date: '2026-11-08' };
    expect(ledgerReducer(added, { type: 'updatePurchase', currency: 'USD', purchase: moved })).toBe(added);
  });

  test('a purchase dated after today is ignored', () => {
    const action: LedgerAction = {
      type: 'addPurchase',
      currency: 'USD',
      purchase: { id: 'future', date: '2026-11-06', merchant: 'Tomorrow', cents: 500 },
    };
    expect(ledgerReducer(demoLedger, action)).toBe(demoLedger);
  });
});

describe('ledger: releasing protected savings', () => {
  const monday = run(demoLedger, ...toMonday);
  const release = (id: string, cents: number): LedgerAction => ({
    type: 'releaseSavings',
    currency: 'USD',
    release: { id, madeOn: '2026-11-09', cents },
  });

  test('releasing 50 of 310: P 260, cash still 960, the allowance unchanged', () => {
    const released = ledgerReducer(monday, release('r1', 5000));
    expect(weekAccount(released, 'USD')).toMatchObject({
      protectedCents: 26000,
      weekStartCashCents: 96000,
      chosenAllowanceCents: 15000,
    });
  });

  test('a double tap records the release once', () => {
    const once = ledgerReducer(monday, release('r1', 5000));
    expect(ledgerReducer(once, release('r1', 5000))).toBe(once);
  });

  test('more than is protected is ignored, even if the dialog were bypassed', () => {
    expect(ledgerReducer(monday, release('r2', 31001))).toBe(monday);
  });

  test('BSD is untouched by a USD release', () => {
    const released = ledgerReducer(monday, release('r1', 5000));
    expect(released.accounts.BSD).toBe(monday.accounts.BSD);
  });

  // Released money is free cash again, so the next closure is capped by more
  // free cash and the next suggestion grows. Week of Nov 9: allowance 150,
  // nothing spent, F = 450 + 50 = 500, so 150 is protected (P 260 + 150 = 410);
  // then F = 960 - 410 - 200 = 350 over 14 days: floor(35000 * 7 / 14) = 17500.
  test('the next week uses the released cash: closure 150, then a 175 suggestion', () => {
    const nextWeek = run(monday, release('r1', 5000), ...nextDays(7));
    expect(weekAccount(nextWeek, 'USD')).toMatchObject({
      protectedCents: 41000,
      recommendedAllowanceCents: 17500,
      previousClosure: { protectedCents: 15000 },
    });
  });
});
