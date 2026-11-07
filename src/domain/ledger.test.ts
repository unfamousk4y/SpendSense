import { describe, expect, test } from 'vitest';
import { demoLedger } from '../fixtures/demoWeek';
import { accountCash, hasEndedWeekToClose, ledgerReducer, wantsGuideForNewPlan, planForNewWeek, weekAccount, type Ledger, type LedgerAction } from './ledger';

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
    expect(tuesday.accounts.USD!.closures).toHaveLength(1);
    expect(tuesday.accounts.BSD!.closures).toHaveLength(1);
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

  test('passes the plan end date: the last week closes on Mon Nov 30, with no new plan, and then the demo waits', () => {
    const end = run(demoLedger, ...nextDays(25));
    expect(end.today).toBe('2026-11-30');
    expect(end.accounts.USD!.closures.map((closure) => closure.weekStart)).toEqual([
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
      '2026-11-23',
    ]);
    expect(end.accounts.USD!.weeks.some((week) => week.weekStart === '2026-11-30')).toBe(false);
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
    const old = monday.accounts.USD!.purchases[0];
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
    const moved = { ...added.accounts.USD!.purchases.at(-1)!, date: '2026-11-08' };
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

describe('ledger: an account set up partway through a week', () => {
  const account = { ...demoLedger.accounts.USD!, openingDate: '2026-11-04', purchases: [] };
  const started: Ledger = { today: '2026-11-05', accounts: { USD: account } };
  const purchaseOn = (date: string): LedgerAction => ({
    type: 'addPurchase',
    currency: 'USD',
    purchase: { id: date, date, merchant: '', cents: 100 },
  });

  test('a purchase before the opening date is ignored: the opening cash already reflects it', () => {
    expect(ledgerReducer(started, purchaseOn('2026-11-03'))).toBe(started);
  });

  test('a purchase on the opening date is recorded', () => {
    expect(ledgerReducer(started, purchaseOn('2026-11-04')).accounts.USD!.purchases).toHaveLength(1);
  });

  test('an account in the other currency is simply absent, and actions on it change nothing', () => {
    expect(ledgerReducer(started, { type: 'deletePurchase', currency: 'BSD', id: 'x' })).toBe(started);
  });
});

describe('planForNewWeek', () => {
  const usd = demoLedger.accounts.USD!;

  test('no plan needed when this week already has one', () => {
    expect(planForNewWeek(usd, '2026-11-05')).toBeNull();
  });

  // Cash 960 (40 spent), P 200, B 200: F = 560. Mon Nov 9 to Nov 29 is 21 days.
  // floor(56000 * 7 / 21) = 18666.
  test('a new Monday suggests from current free cash', () => {
    expect(planForNewWeek(usd, '2026-11-09')).toEqual({
      weekStart: '2026-11-09',
      recommendedCents: 18666,
      startingAllowanceCents: 18666,
      // Wants left 235.50, with 7 of the 21 days this week.
      wantsGuideCents: 7850,
      changes: [],
    });
  });

  // Wed Nov 11 to Sun is 5 days; through Nov 29 is 19. floor(56000 * 5 / 19) = 14736.
  test('first opened on a Wednesday, the week counts from today', () => {
    expect(planForNewWeek(usd, '2026-11-11')).toMatchObject({ weekStart: '2026-11-09', recommendedCents: 14736 });
  });

  test('after the plan end date there is nothing to plan', () => {
    expect(planForNewWeek(usd, '2026-11-30')).toBeNull();
  });
});

describe('hasEndedWeekToClose', () => {
  const usd = demoLedger.accounts.USD!;

  test('not during the week, including its Sunday', () => {
    expect(hasEndedWeekToClose(usd, '2026-11-08')).toBe(false);
  });

  test('from the following Monday', () => {
    expect(hasEndedWeekToClose(usd, '2026-11-09')).toBe(true);
  });

  test('not once that week has a closure', () => {
    const closed = run(demoLedger, ...toMonday).accounts.USD!;
    expect(hasEndedWeekToClose(closed, '2026-11-09')).toBe(false);
  });
});

// The demo's USD account on Thu Nov 5: cash 960, protected 200, bills 200, so F = 560.
describe('ledger: income with a confirmed split', () => {
  const splitPayment = { id: 'pay-1', date: '2026-11-05', cents: 10000, savingsCents: 2000, wantsCents: 3000 };
  const add = (income = splitPayment): LedgerAction => ({ type: 'addIncome', currency: 'USD', income });
  const release = (cents: number): LedgerAction => ({
    type: 'releaseSavings',
    currency: 'USD',
    release: { id: 'rel-1', madeOn: '2026-11-05', cents },
  });

  test('the savings share is protected: P 200 -> 220, and F rises only by the other 80', () => {
    const after = run(demoLedger, add());
    expect(weekAccount(after, 'USD').protectedCents).toBe(22000);
    // F = 1,060 - 220 - 200 = 640, up 80 from 560.
    expect(accountCash(after.accounts.USD!)).toEqual({ currentCashCents: 106000, protectedCents: 22000 });
  });

  test('a payment with no split protects nothing, as before', () => {
    const after = run(demoLedger, add({ id: 'pay-2', date: '2026-11-05', cents: 10000 } as typeof splitPayment));
    expect(weekAccount(after, 'USD').protectedCents).toBe(20000);
  });

  test('a double tap records the payment and its savings once', () => {
    const after = run(demoLedger, add(), add());
    expect(after.accounts.USD!.income).toHaveLength(1);
    expect(weekAccount(after, 'USD').protectedCents).toBe(22000);
  });

  test('deleting the payment takes its savings with it', () => {
    const after = run(demoLedger, add(), { type: 'deleteIncome', currency: 'USD', id: 'pay-1' });
    expect(weekAccount(after, 'USD').protectedCents).toBe(20000);
  });

  test('deleting is refused once its savings have been released', () => {
    const released = run(demoLedger, add(), release(22000));
    expect(weekAccount(released, 'USD').protectedCents).toBe(0);
    const after = run(released, { type: 'deleteIncome', currency: 'USD', id: 'pay-1' });
    expect(after).toBe(released);
  });

  test('lowering the savings share is refused once it has been released', () => {
    const released = run(demoLedger, add(), release(22000));
    const after = run(released, { type: 'updateIncome', currency: 'USD', income: { ...splitPayment, savingsCents: 1000 } });
    expect(after).toBe(released);
  });

  test('editing the source of a released payment still works', () => {
    const released = run(demoLedger, add(), release(22000));
    const after = run(released, { type: 'updateIncome', currency: 'USD', income: { ...splitPayment, source: 'Tutoring' } });
    expect(after.accounts.USD!.income[0].source).toBe('Tutoring');
  });

  test.each([
    ['shares larger than the payment', { savingsCents: 8000, wantsCents: 3000 }],
    ['a negative share', { savingsCents: -1, wantsCents: 0 }],
    ['a fraction of a cent', { savingsCents: 0.5, wantsCents: 0 }],
  ])('refuses %s', (_name, shares) => {
    expect(run(demoLedger, add({ ...splitPayment, ...shares }))).toBe(demoLedger);
  });

  test('setting money aside that would deepen a shortfall is refused', () => {
    // A 700 bill makes F = 960 - 200 - 900 = -140. The 100 payment still leaves it at -40.
    const short = run(demoLedger, {
      type: 'addBill',
      currency: 'USD',
      bill: { id: 'big-bill', name: 'Tuition', dueOn: '2026-11-20', cents: 70000 },
    });
    expect(run(short, add())).toBe(short);
    const unsaved = run(short, add({ ...splitPayment, savingsCents: 0 }));
    expect(unsaved.accounts.USD!.income).toHaveLength(1);
  });
});

// The demo's USD account on Thu Nov 5: F = 560, wants pool 240, 4.50 spent on wants, guide 60.
describe('ledger: wants', () => {
  const want = (id: string, cents: number, date = '2026-11-05'): LedgerAction => ({
    type: 'addPurchase',
    currency: 'USD',
    purchase: { id, date, merchant: 'Fictional', needOrWant: 'want', cents },
  });
  const need = (id: string, cents: number): LedgerAction => ({
    type: 'addPurchase',
    currency: 'USD',
    purchase: { id, date: '2026-11-05', merchant: 'Fictional', needOrWant: 'need', cents },
  });

  test('wants left: the 240 pool less the 4.50 already spent', () => {
    expect(weekAccount(demoLedger, 'USD')).toMatchObject({ wantsGuideCents: 6000, wantsLeftCents: 23550, wantsCoveredElsewhereCents: 0 });
  });

  test('a want lowers wants left, but the guide stays where it was', () => {
    expect(weekAccount(run(demoLedger, want('w', 1000)), 'USD')).toMatchObject({ wantsGuideCents: 6000, wantsLeftCents: 22550 });
  });

  test('a need leaves wants alone while the cash can still cover them', () => {
    expect(weekAccount(run(demoLedger, need('n', 1000)), 'USD')).toMatchObject({ wantsLeftCents: 23550, wantsCoveredElsewhereCents: 0 });
  });

  test('needs that eat into the cash behind wants are reported, not hidden', () => {
    // F = 560 - 400 = 160, which is 75.50 less than the 235.50 of wants.
    expect(weekAccount(run(demoLedger, need('n', 40000)), 'USD')).toMatchObject({ wantsLeftCents: 16000, wantsCoveredElsewhereCents: 7550 });
  });

  test('wants from income this week raise the guide by the share of days left', () => {
    // Thu Nov 5 through Sun Nov 29 is 25 days, 4 of them this week: 30 * 4 / 25 = 4.80.
    const after = run(demoLedger, {
      type: 'addIncome',
      currency: 'USD',
      income: { id: 'pay', date: '2026-11-05', cents: 10000, savingsCents: 2000, wantsCents: 3000 },
    });
    expect(weekAccount(after, 'USD')).toMatchObject({ wantsGuideCents: 6480, wantsLeftCents: 26550 });
  });

  test('closing a week moves the unused guide to savings, and the next guide is smaller', () => {
    // Allowance 150, spent 40, so 110 is protected. Guide 60 less 4.50 spent: 55.50 moves.
    // Wants left 235.50 - 55.50 = 180. Nov 9 through Nov 29 is 21 days, 7 this week: 60.
    const after = run(demoLedger, ...toMonday);
    expect(weekAccount(after, 'USD')).toMatchObject({ wantsLeftCents: 18000, wantsGuideCents: 6000 });
  });

  test('an overspent week moves nothing', () => {
    // Spending 150 more on wants makes it 190 of 150: nothing protected, nothing moved.
    const after = run(demoLedger, want('w', 15000), ...toMonday);
    expect(after.accounts.USD!.closures[0]).toMatchObject({ protectedCents: 0 });
    expect(weekAccount(after, 'USD')).toMatchObject({ wantsLeftCents: 8550 });
  });

  test('a new plan works out its first guide from the new end date', () => {
    // Wants left 235.50. Nov 5 through Dec 2 is 28 days, 4 this week: 33.64.
    expect(wantsGuideForNewPlan(demoLedger.accounts.USD!, '2026-11-05', '2026-12-02')).toBe(3364);
  });
});
