import { describe, expect, test } from 'vitest';
import { addBillOnce, billPaymentsCents, previewBillChange, removeBill, unpaidBillsCents, updateBill, type Bill } from './bills';
import { demoLedger } from '../fixtures/demoWeek';
import { freeCashCents } from './allowance';
import { weekAccount, ledgerReducer, type Ledger, type LedgerAction } from './ledger';

const PLAN_END = '2026-11-29';
const rent: Bill = { id: 'rent', name: 'Rent', dueOn: '2026-11-20', cents: 15000 };
const phone: Bill = { id: 'phone', name: 'Phone', dueOn: '2026-11-25', cents: 5000 };
const paid = (bill: Bill, paidOn: string, paidCents = bill.cents): Bill => ({ ...bill, paidOn, paidCents });

describe('unpaid bills (B)', () => {
  test('adds up the unpaid bills due by the plan end', () => {
    expect(unpaidBillsCents([rent, phone], PLAN_END)).toBe(20000);
  });

  test('a bill due exactly on the plan end counts; one due the day after does not', () => {
    expect(unpaidBillsCents([{ ...rent, dueOn: PLAN_END }], PLAN_END)).toBe(15000);
    expect(unpaidBillsCents([{ ...rent, dueOn: '2026-11-30' }], PLAN_END)).toBe(0);
  });

  test('an overdue unpaid bill still counts', () => {
    expect(unpaidBillsCents([{ ...rent, dueOn: '2026-01-01' }], PLAN_END)).toBe(15000);
  });

  test('a paid bill does not count', () => {
    expect(unpaidBillsCents([paid(rent, '2026-11-03'), phone], PLAN_END)).toBe(5000);
  });

  test('no bills is zero', () => {
    expect(unpaidBillsCents([], PLAN_END)).toBe(0);
  });
});

describe('bill payments', () => {
  test('counts the amount actually paid, not the amount expected', () => {
    expect(billPaymentsCents([paid(rent, '2026-11-03', 16000), phone])).toBe(16000);
  });

  test('only payments dated before the given day, when one is given', () => {
    const bills = [paid(rent, '2026-11-08'), paid(phone, '2026-11-09')];
    expect(billPaymentsCents(bills, '2026-11-09')).toBe(15000);
    expect(billPaymentsCents(bills)).toBe(20000);
  });
});

describe('the plan rule, to the cent', () => {
  // C 960, P 200, B 200, F 560.
  const free = (cash: number, bills: Bill[]) =>
    freeCashCents({
      currentCashCents: cash - billPaymentsCents(bills),
      protectedCents: 20000,
      commitmentsCents: unpaidBillsCents(bills, PLAN_END),
    });

  test('before paying: F 560', () => {
    expect(free(96000, [rent, phone])).toBe(56000);
  });

  test('paying exactly 150 leaves F at 560', () => {
    expect(free(96000, [paid(rent, '2026-11-05'), phone])).toBe(56000);
  });

  test('paying 160 for a 150 bill takes F to 550', () => {
    expect(free(96000, [paid(rent, '2026-11-05', 16000), phone])).toBe(55000);
  });

  test('adding a new 100 bill takes F to 460', () => {
    expect(free(96000, [rent, phone, { id: 'new', name: 'Fee', dueOn: '2026-11-10', cents: 10000 }])).toBe(46000);
  });
});

describe('bills in the ledger', () => {
  const run = (state: Ledger, ...actions: LedgerAction[]) => actions.reduce(ledgerReducer, state);
  const toMonday: LedgerAction[] = Array.from({ length: 4 }, () => ({ type: 'nextDay' }));
  const withUsdBills = (bills: Bill[]): Ledger => ({
    ...demoLedger,
    accounts: { ...demoLedger.accounts, USD: { ...demoLedger.accounts.USD!, bills } },
  });

  test('the week screen gets B worked out from the bills, and the list itself', () => {
    const account = weekAccount(demoLedger, 'USD');
    expect(account.commitmentsCents).toBe(20000);
    expect(account.bills.map((bill) => bill.cents)).toEqual([15000, 5000]);
  });

  test('USD and BSD bills stay apart', () => {
    expect(weekAccount(demoLedger, 'BSD').commitmentsCents).toBe(12000);
    const changed = withUsdBills([]);
    expect(weekAccount(changed, 'BSD').commitmentsCents).toBe(12000);
    expect(weekAccount(changed, 'USD').commitmentsCents).toBe(0);
  });

  test('a bill due after the plan end is listed but not counted', () => {
    const later = { ...rent, dueOn: '2026-12-15' };
    const account = weekAccount(withUsdBills([later]), 'USD');
    expect(account.bills).toEqual([later]);
    expect(account.commitmentsCents).toBe(0);
  });

  test('a payment made last week comes out of the cash this week starts with, and not out of spending', () => {
    const account = weekAccount(run(withUsdBills([paid(rent, '2026-11-03', 16000), phone]), ...toMonday), 'USD');
    // 1,000 - 40 of purchases - 160 for the bill.
    expect(account.weekStartCashCents).toBe(80000);
    expect(account.commitmentsCents).toBe(5000);
    // Spending is still 40, so the leftover and what it protects are unchanged.
    expect(account.previousClosure).toMatchObject({ spentCents: 4000, leftoverCents: 11000, protectedCents: 11000 });
  });
});

// Hand-worked, Wed Nov 4 with the plan ending Nov 29: 5 days this week, 26 left.
// Bills 200, free cash 560; 40 already spent.
describe('previewBillChange', () => {
  const now = { planEndDate: PLAN_END, commitmentsCents: 20000, freeCents: 56000, spentCents: 4000, daysThisWeek: 5, daysLeft: 26 };
  const fee: Bill = { id: 'fee', name: 'Fee', dueOn: '2026-11-10', cents: 10000 };

  test('adding a 100 bill: B 300, free cash 460, new suggestion 128.46 for the week', () => {
    expect(previewBillChange({ after: fee, ...now })).toEqual({
      before: { commitmentsCents: 20000, freeCents: 56000 },
      after: { commitmentsCents: 30000, freeCents: 46000 },
      counted: true,
      // 460.00 x 5 / 26 = 88.4615..., rounded down to 88.46, plus the 40.00 spent.
      suggestion: { kind: 'ok', totalCents: 12846, remainingCents: 8846, shortfallCents: 0 },
    });
  });

  test('lowering a bill from 150 to 120: B 170, free cash 590', () => {
    const preview = previewBillChange({ before: rent, after: { ...rent, cents: 12000 }, ...now });
    expect(preview.after).toEqual({ commitmentsCents: 17000, freeCents: 59000 });
  });

  test('moving a bill past the plan end takes it out: B 50, free cash 710', () => {
    const preview = previewBillChange({ before: rent, after: { ...rent, dueOn: '2026-11-30' }, ...now });
    expect(preview.after).toEqual({ commitmentsCents: 5000, freeCents: 71000 });
    expect(preview.counted).toBe(false);
  });

  test('moving a bill back inside the plan end puts it in: B 300, free cash 460', () => {
    const later = { ...fee, dueOn: '2026-11-30' };
    expect(previewBillChange({ before: later, after: fee, ...now }).after).toEqual({ commitmentsCents: 30000, freeCents: 46000 });
  });

  test('a new bill due after the plan end changes nothing', () => {
    const preview = previewBillChange({ after: { ...fee, dueOn: '2026-12-01' }, ...now });
    expect(preview.after).toEqual(preview.before);
    expect(preview.counted).toBe(false);
  });

  test('a bill too big for the plan shows the shortfall, and the suggestion adds nothing to what is spent', () => {
    const preview = previewBillChange({ after: { ...fee, cents: 60000 }, ...now });
    expect(preview.after.freeCents).toBe(-4000);
    expect(preview.suggestion).toEqual({ kind: 'ok', totalCents: 4000, remainingCents: 0, shortfallCents: 4000 });
  });
});

describe('bill records', () => {
  test('adding the same id twice keeps one', () => {
    expect(addBillOnce(addBillOnce([], rent), { ...rent, cents: 1 })).toEqual([rent]);
  });

  test('an update and a removal touch only that bill', () => {
    const changed = { ...rent, cents: 100 };
    expect(updateBill([rent, phone], changed)).toEqual([changed, phone]);
    expect(removeBill([rent, phone], 'rent')).toEqual([phone]);
  });
});

describe('changing bills in the ledger', () => {
  const run = (state: Ledger, ...actions: LedgerAction[]) => actions.reduce(ledgerReducer, state);
  const toMonday: LedgerAction[] = Array.from({ length: 4 }, () => ({ type: 'nextDay' }));
  const fee: Bill = { id: 'fee', name: 'Fee', dueOn: '2026-11-10', cents: 10000 };
  const add: LedgerAction = { type: 'addBill', currency: 'USD', bill: fee };

  test('adding raises B and leaves cash, savings and the allowance alone', () => {
    const before = weekAccount(demoLedger, 'USD');
    const after = weekAccount(run(demoLedger, add), 'USD');
    expect(after.commitmentsCents).toBe(30000);
    expect(after.weekStartCashCents).toBe(before.weekStartCashCents);
    expect(after.protectedCents).toBe(before.protectedCents);
    expect(after.chosenAllowanceCents).toBe(before.chosenAllowanceCents);
  });

  test('a retry after a lost reply counts once', () => {
    expect(weekAccount(run(demoLedger, add, add), 'USD').commitmentsCents).toBe(30000);
  });

  test('USD changes leave BSD alone', () => {
    expect(weekAccount(run(demoLedger, add), 'BSD')).toEqual(weekAccount(demoLedger, 'BSD'));
  });

  test('editing and deleting change B', () => {
    const edited = run(demoLedger, add, { type: 'updateBill', currency: 'USD', bill: { ...fee, cents: 500 } });
    expect(weekAccount(edited, 'USD').commitmentsCents).toBe(20500);
    expect(weekAccount(run(edited, { type: 'deleteBill', currency: 'USD', id: 'fee' }), 'USD').commitmentsCents).toBe(20000);
  });

  test('an unpaid bill can change after a week closes, and the closure keeps what it stored', () => {
    const monday = run(demoLedger, ...toMonday);
    const closure = weekAccount(monday, 'USD').previousClosure;
    const changed = weekAccount(run(monday, add), 'USD');
    expect(changed.commitmentsCents).toBe(30000);
    expect(changed.previousClosure).toEqual(closure);
  });

  test('a bill paid in a closed week cannot be changed or deleted', () => {
    const paidBill = paid(fee, '2026-11-03');
    const monday = run(demoLedger, { type: 'addBill', currency: 'USD', bill: paidBill }, ...toMonday);
    const edited = run(monday, { type: 'updateBill', currency: 'USD', bill: { ...paidBill, cents: 1 } });
    const deleted = run(monday, { type: 'deleteBill', currency: 'USD', id: 'fee' });
    expect(weekAccount(edited, 'USD').bills).toContainEqual(paidBill);
    expect(weekAccount(deleted, 'USD').bills).toContainEqual(paidBill);
  });
});
