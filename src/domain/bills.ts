// Dated bills, from PRODUCT_PLAN.md: B is the total of unpaid commitments due on
// or before the plan end, and "a payment reduces C and marks the corresponding
// B entry paid atomically". Pure: all money is integer cents in ONE currency.
//
// Payment details live on the bill itself, and both C and B are worked out from
// them, so one saved row changes both together. A payment is not spending: it
// never counts against the weekly allowance.
import type { IsoDate } from './dates';

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
