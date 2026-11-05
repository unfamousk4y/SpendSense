// Dated bills, from PRODUCT_PLAN.md: B is the total of unpaid commitments due on
// or before the plan end, and "a payment reduces C and marks the corresponding
// B entry paid atomically". Pure: all money is integer cents in ONE currency.
//
// Payment details live on the bill itself, and both C and B are worked out from
// them, so one saved row changes both together. A payment is not spending: it
// never counts against the weekly allowance.
import { midweekSuggestion, type MidweekSuggestion } from './allowanceChange';
import type { IsoDate } from './dates';

/** The name the database gives the one bill it makes from the setup total. */
export const SETUP_BILL_NAME = 'Bills from setup';

export type Bill = {
  /** One per opening of the form, so a repeated save is the same bill. */
  id: string;
  name: string;
  dueOn: IsoDate;
  /** The amount expected. */
  cents: number;
  /** Set together with paidCents once it has been paid. */
  paidOn?: IsoDate;
  /** What it actually cost, which can differ from the amount expected. */
  paidCents?: number;
};

/** B: unpaid bills due by the plan end. Overdue ones still count; later ones do not yet. */
export function unpaidBillsCents(bills: Bill[], planEndDate: IsoDate): number {
  return bills
    .filter((bill) => bill.paidOn === undefined && bill.dueOn <= planEndDate)
    .reduce((total, bill) => total + bill.cents, 0);
}

/** What has left cash for bills: all payments, or only those dated before a day. */
export function billPaymentsCents(bills: Bill[], before?: IsoDate): number {
  return bills
    .filter((bill) => bill.paidOn !== undefined && (before === undefined || bill.paidOn < before))
    .reduce((total, bill) => total + (bill.paidCents ?? 0), 0);
}

export type BillSide = { commitmentsCents: number; freeCents: number };

export type BillPreview = {
  before: BillSide;
  after: BillSide;
  /** Whether the bill as typed counts towards B. Due after the plan end, it does not. */
  counted: boolean;
  /** A fresh suggestion for this week if the change is saved. Only ever offered. */
  suggestion: MidweekSuggestion;
};

/**
 * What adding or editing an unpaid bill does. Only B and F move: cash does not
 * change until a bill is paid, and the allowance never changes by itself.
 */
export function previewBillChange({
  before,
  after,
  planEndDate,
  commitmentsCents,
  freeCents,
  spentCents,
  daysThisWeek,
  daysLeft,
}: {
  /** The bill as saved now, when editing. */
  before?: Bill;
  after: Bill;
  planEndDate: IsoDate;
  commitmentsCents: number;
  freeCents: number;
  spentCents: number;
  daysThisWeek: number;
  daysLeft: number;
}): BillPreview {
  const countedAfter = unpaidBillsCents([after], planEndDate);
  const changeCents = countedAfter - unpaidBillsCents(before ? [before] : [], planEndDate);
  const afterFreeCents = freeCents - changeCents;
  return {
    before: { commitmentsCents, freeCents },
    after: { commitmentsCents: commitmentsCents + changeCents, freeCents: afterFreeCents },
    counted: countedAfter > 0,
    suggestion: midweekSuggestion({ spentCents, freeCents: afterFreeCents, daysThisWeek, daysLeft }),
  };
}

/** Appends a bill unless one with the same id is already recorded. */
export function addBillOnce(bills: Bill[], bill: Bill): Bill[] {
  if (bills.some((existing) => existing.id === bill.id)) return bills;
  return [...bills, bill];
}

export function updateBill(bills: Bill[], bill: Bill): Bill[] {
  return bills.map((existing) => (existing.id === bill.id ? bill : existing));
}

export function removeBill(bills: Bill[], id: string): Bill[] {
  return bills.filter((existing) => existing.id !== id);
}

export type BillPayment = { paidOn: IsoDate; paidCents: number };

export type PaymentSide = { cashCents: number; commitmentsCents: number; freeCents: number };

/**
 * What paying a bill does, or correcting a payment already made. Paid exactly
 * as expected, C and B fall together and F does not move. Anything different
 * from what B had reserved moves F by that difference.
 */
export function previewBillPayment({
  bill,
  payment,
  planEndDate,
  currentCashCents,
  commitmentsCents,
  freeCents,
}: {
  bill: Bill;
  payment: BillPayment;
  planEndDate: IsoDate;
  currentCashCents: number;
  commitmentsCents: number;
  freeCents: number;
}): { before: PaymentSide; after: PaymentSide } {
  const paidBill = recordPayment(bill, payment);
  const cashChange = billPaymentsCents([bill]) - billPaymentsCents([paidBill]);
  const commitmentsChange = unpaidBillsCents([paidBill], planEndDate) - unpaidBillsCents([bill], planEndDate);
  return {
    before: { cashCents: currentCashCents, commitmentsCents, freeCents },
    after: {
      cashCents: currentCashCents + cashChange,
      commitmentsCents: commitmentsCents + commitmentsChange,
      freeCents: freeCents + cashChange - commitmentsChange,
    },
  };
}

export function recordPayment(bill: Bill, payment: BillPayment): Bill {
  return { ...bill, ...payment };
}

export function undoPayment({ id, name, dueOn, cents }: Bill): Bill {
  return { id, name, dueOn, cents };
}
