import { describe, expect, test } from 'vitest';
import { billPaymentsCents, unpaidBillsCents, type Bill } from './bills';
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
