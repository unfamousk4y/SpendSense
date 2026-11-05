// The only code that reads and writes SpendSense's tables. It turns database
// rows into the ledger the pure rules work with, and back. No rules live here,
// and a client is passed in, so the access tests can run this exact code as
// each test user.
//
// Writes report success or a message for the screen. Nothing here logs: rows
// hold a student's spending. Raw database messages are not shown to students.
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { AllowanceChange } from '../domain/allowanceChange';
import type { Bill, BillPayment } from '../domain/bills';
import type { CategoryId, NeedOrWant } from '../domain/categories';
import type { WeekClosure } from '../domain/closure';
import type { BalanceCorrection } from '../domain/correction';
import type { IsoDate } from '../domain/dates';
import type { IncomeReceipt } from '../domain/income';
import { hasEndedWeekToClose, planForNewWeek, type AccountLedger, type Ledger, type WeekPlan } from '../domain/ledger';
import type { Currency } from '../domain/money';
import type { SavingsRelease } from '../domain/release';
import type { Purchase } from '../domain/week';

export type SaveResult = { ok: true } | { ok: false; message: string };

export type LoadedLedger = {
  ledger: Ledger;
  /** Each account's row id, which new purchases are linked to. */
  accountIds: Partial<Record<Currency, string>>;
  /** Each week plan's row id by its Monday, which allowance changes are linked to. */
  weekPlanIds: Partial<Record<Currency, Record<IsoDate, string>>>;
};

// Rows arrive untyped until generated database types are worth adding.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export type LoadResult = { ok: true; loaded: LoadedLedger } | { ok: false; message: string };

export type NewAccount = {
  currency: Currency;
  openingDate: IsoDate;
  cashCents: number;
  protectedCents: number;
  commitmentsCents: number;
  planEndDate: IsoDate;
  recommendedCents: number;
  allowanceCents: number;
};

const UNIQUE_VIOLATION = '23505';
const SAVE_FAILED = 'Could not save. Check your connection and try again.';
const LOAD_FAILED = 'Could not load your account. Check your connection and try again.';
const SESSION_ENDED = 'Your sign-in has expired. Reload the page and sign in again.';

function saveMessage(error: PostgrestError): string {
  switch (error.code) {
    // PostgREST's codes for a missing or expired session token.
    case 'PGRST301':
    case 'PGRST303':
      return SESSION_ENDED;
    // The rules in the database's checked operations. The forms check these
    // first, so a student sees these only if another tab got there before them.
    case 'SS001':
      return 'That week is closed, so it can no longer be changed. Reload the page to see the latest.';
    case 'SS002':
      return 'That is more than is protected now. Reload the page to see the latest.';
    case 'SS003':
      return 'That does not fit inside your free cash now. Reload the page to see the latest.';
    case 'SS004':
      return 'Income can only be recorded once it has been received.';
    case 'SS005':
      return 'A payment can only be recorded once it has been made.';
    case 'SS007':
      return 'A correction can only be dated today or earlier.';
    case 'SS006':
      return 'Your plan is still running. Reload the page to see the latest.';
    default:
      return SAVE_FAILED;
  }
}

export async function loadLedger(client: SupabaseClient, today: IsoDate): Promise<LoadResult> {
  const start = await readLedger(client, today);
  if (!start.ok) return start;

  // Close any week that has ended, before planning a new one from the result.
  // The database works out the amounts and ignores weeks already closed.
  const toClose = Object.values(start.loaded.ledger.accounts).filter((account) => account && hasEndedWeekToClose(account, today));
  for (const account of toClose) {
    const accountId = account && start.loaded.accountIds[account.currency];
    const { error } = await client.rpc('close_ended_weeks', { p_account_id: accountId, p_today: today });
    if (error) return { ok: false, message: LOAD_FAILED };
  }
  const first = toClose.length > 0 ? await readLedger(client, today) : start;
  if (!first.ok) return first;

  // An account may have reached a week it has no plan for yet.
  const newPlans: { account_id: string; week_start: string; recommended_cents: number; starting_allowance_cents: number }[] = [];
  for (const account of Object.values(first.loaded.ledger.accounts)) {
    const plan = account && planForNewWeek(account, today);
    const accountId = account && first.loaded.accountIds[account.currency];
    if (plan && accountId) {
      newPlans.push({
        account_id: accountId,
        week_start: plan.weekStart,
        recommended_cents: plan.recommendedCents,
        starting_allowance_cents: plan.startingAllowanceCents,
      });
    }
  }
  if (newPlans.length === 0) return first;

  // ignoreDuplicates: another tab may have just created the same week's plan,
  // which the (account_id, week_start) uniqueness rule makes harmless.
  const { error } = await client
    .from('week_plans')
    .upsert(newPlans, { onConflict: 'account_id,week_start', ignoreDuplicates: true });
  if (error) return { ok: false, message: LOAD_FAILED };
  return readLedger(client, today);
}

async function readLedger(client: SupabaseClient, today: IsoDate): Promise<LoadResult> {
  // Row-level security limits every one of these to the signed-in student.
  const [accounts, purchases, income, corrections, bills, plans, changes, closures, releases] = await Promise.all([
    readAllRows(client, 'accounts'),
    readAllRows(client, 'purchases'),
    readAllRows(client, 'income_receipts'),
    readAllRows(client, 'balance_corrections'),
    readAllRows(client, 'bills'),
    readAllRows(client, 'week_plans', 'week_start'),
    readAllRows(client, 'allowance_changes'),
    readAllRows(client, 'week_closures', 'week_start'),
    readAllRows(client, 'savings_releases'),
  ]);
  if (!accounts || !purchases || !income || !corrections || !bills || !plans || !changes || !closures || !releases) {
    return { ok: false, message: LOAD_FAILED };
  }

  const ledger: Ledger = { today, accounts: {} };
  const accountIds: LoadedLedger['accountIds'] = {};
  const weekPlanIds: LoadedLedger['weekPlanIds'] = {};
  for (const row of accounts) {
    const currency: Currency = row.currency;
    accountIds[currency] = row.id;
    weekPlanIds[currency] = Object.fromEntries(
      plans.filter((plan) => plan.account_id === row.id).map((plan) => [plan.week_start, plan.id]),
    );
    ledger.accounts[currency] = toAccount(row, {
      purchases: purchases.filter((p) => p.account_id === row.id).map(toPurchase),
      income: income.filter((receipt) => receipt.account_id === row.id).map(toIncome),
      corrections: corrections.filter((correction) => correction.account_id === row.id).map(toCorrection),
      bills: bills.filter((bill) => bill.account_id === row.id).map(toBill),
      weeks: plans.filter((plan) => plan.account_id === row.id).map((plan) => toWeekPlan(plan, changes)),
      closures: closures.filter((c) => c.account_id === row.id).map((c) => toClosure(c, currency)),
      releases: releases.filter((r) => r.account_id === row.id).map(toRelease),
    });
  }
  return { ok: true, loaded: { ledger, accountIds, weekPlanIds } };
}

// The most rows the hosted database returns for one request by default.
const ROWS_PER_REQUEST = 1000;

const EXPORT_TABLES = ['accounts', 'purchases', 'income_receipts', 'balance_corrections', 'bills', 'week_plans', 'allowance_changes', 'week_closures', 'savings_releases'] as const;

export type OwnDataExport = {
  format: 'spendsense-export';
  version: 1;
  exportedAt: string;
  note: string;
} & Record<(typeof EXPORT_TABLES)[number], Record<string, unknown>[]>;

export type ExportResult = { ok: true; file: OwnDataExport } | { ok: false; message: string };

/**
 * Everything the signed-in student has saved, as stored. Row-level security
 * limits every read to them, and it only reads, so no week is closed by it.
 * Any failed read fails the whole export: a partial file could pass for a
 * complete one.
 */
export async function exportOwnData(client: SupabaseClient, exportedAt: string, pageSize = ROWS_PER_REQUEST): Promise<ExportResult> {
  const tables = await Promise.all(EXPORT_TABLES.map((table) => readAllRows(client, table, 'created_at', pageSize)));
  const [accounts, purchases, income_receipts, balance_corrections, bills, week_plans, allowance_changes, week_closures, savings_releases] = tables;
  if (!accounts || !purchases || !income_receipts || !balance_corrections || !bills || !week_plans || !allowance_changes || !week_closures || !savings_releases) {
    return { ok: false, message: 'Could not download your data. Check your connection and try again.' };
  }
  return {
    ok: true,
    file: {
      format: 'spendsense-export',
      version: 1,
      exportedAt,
      note: 'Amounts ending in _cents or named cents are whole cents: 1050 means 10.50. USD and BSD accounts are separate.',
      accounts,
      purchases,
      income_receipts,
      balance_corrections,
      bills,
      week_plans,
      allowance_changes,
      week_closures,
      savings_releases,
    },
  };
}

/**
 * Every row of a table, across as many requests as it takes. Stopping at the
 * first request would quietly leave money out of the totals. null if any fails.
 */
async function readAllRows(client: SupabaseClient, table: string, orderBy = 'created_at', pageSize = ROWS_PER_REQUEST): Promise<Row[] | null> {
  const rows: Row[] = [];
  while (true) {
    const { data, error } = await client
      .from(table)
      .select('*')
      // id breaks ties, so no row can be skipped or repeated between pages.
      .order(orderBy)
      .order('id')
      .range(rows.length, rows.length + pageSize - 1);
    if (error) return null;
    // The owner's id is of no use to the student, and the file may get shared.
    rows.push(...data.map(({ user_id: _ownerId, ...row }) => row));
    if (data.length < pageSize) return rows;
  }
}

/**
 * Deletes the signed-in student's sign-in and everything saved under it, in one
 * transaction. If the reply is lost it may already have worked, so the message
 * does not claim otherwise; trying again is safe, with nothing left to delete.
 */
export async function deleteMyAccount(client: SupabaseClient): Promise<SaveResult> {
  const { error } = await client.rpc('delete_my_account');
  if (!error) return { ok: true };
  const message = saveMessage(error);
  return { ok: false, message: message === SAVE_FAILED ? 'Could not confirm your account was deleted. Check your connection and try again.' : message };
}

/** Creates the account and its first week plan in one transaction. */
export async function createAccount(client: SupabaseClient, account: NewAccount): Promise<SaveResult> {
  const { error } = await client.rpc('create_account_with_plan', {
    p_currency: account.currency,
    p_opening_date: account.openingDate,
    p_opening_cash_cents: account.cashCents,
    p_opening_protected_cents: account.protectedCents,
    p_commitments_cents: account.commitmentsCents,
    p_plan_end_date: account.planEndDate,
    p_recommended_cents: account.recommendedCents,
    p_starting_allowance_cents: account.allowanceCents,
  });
  // Already there (a double tap, or a reply lost on the way back): one
  // account per currency is a database rule, so this retry changed nothing.
  if (!error || error.code === UNIQUE_VIOLATION) return { ok: true };
  return { ok: false, message: saveMessage(error) };
}

/**
 * Saves a new purchase. The id is made once per opening of the form, so if a
 * reply was lost and the student retries, the database refuses the repeat;
 * finding the row confirms the first attempt worked. If the id is not visible
 * to this student, it is someone else's and nothing was saved.
 */
export async function insertPurchase(client: SupabaseClient, accountId: string, purchase: Purchase): Promise<SaveResult> {
  return insertOnce(client, 'purchases', { id: purchase.id, account_id: accountId, ...purchaseColumns(purchase) });
}

/** Saves received income, with the same retry safety as a new purchase. */
export async function insertIncome(client: SupabaseClient, accountId: string, income: IncomeReceipt): Promise<SaveResult> {
  return insertOnce(client, 'income_receipts', { id: income.id, account_id: accountId, ...incomeColumns(income) });
}

/** Saves a balance correction, with the same retry safety as a new purchase. */
export async function insertCorrection(client: SupabaseClient, accountId: string, correction: BalanceCorrection): Promise<SaveResult> {
  return insertOnce(client, 'balance_corrections', {
    id: correction.id,
    account_id: accountId,
    corrected_on: correction.date,
    difference_cents: correction.differenceCents,
    note: correction.note ?? null,
  });
}

/** Undoing something already gone is a success, as with purchases. */
export async function deleteCorrectionRow(client: SupabaseClient, id: string): Promise<SaveResult> {
  const { error } = await client.from('balance_corrections').delete().eq('id', id);
  return error ? { ok: false, message: saveMessage(error) } : { ok: true };
}

/** Saves a new unpaid bill, with the same retry safety as a new purchase. */
export async function insertBill(client: SupabaseClient, accountId: string, bill: Bill): Promise<SaveResult> {
  return insertOnce(client, 'bills', { id: bill.id, account_id: accountId, ...billColumns(bill) });
}

async function insertOnce(client: SupabaseClient, table: string, row: { id: string } & Row): Promise<SaveResult> {
  const { error } = await client.from(table).insert(row);
  if (!error) return { ok: true };
  if (error.code !== UNIQUE_VIOLATION) return { ok: false, message: saveMessage(error) };

  const found = await client.from(table).select('id').eq('id', row.id);
  return !found.error && found.data.length === 1 ? { ok: true } : { ok: false, message: SAVE_FAILED };
}

/**
 * Saves an allowance change. The database re-checks the rule and reads the
 * "from" amount itself. Saving the same id again has nothing left to do.
 */
export async function saveAllowanceChange(client: SupabaseClient, weekPlanId: string, change: AllowanceChange): Promise<SaveResult> {
  const { error } = await client.rpc('change_allowance', {
    p_id: change.id,
    p_week_plan_id: weekPlanId,
    p_made_on: change.madeOn,
    p_to_cents: change.toCents,
    p_suggested_cents: change.suggestedCents,
  });
  return error ? { ok: false, message: saveMessage(error) } : { ok: true };
}

/** Saves a release of protected savings, with the same retry safety. */
export async function saveRelease(client: SupabaseClient, accountId: string, release: SavingsRelease): Promise<SaveResult> {
  const { error } = await client.rpc('release_savings', {
    p_id: release.id,
    p_account_id: accountId,
    p_made_on: release.madeOn,
    p_cents: release.cents,
  });
  return error ? { ok: false, message: saveMessage(error) } : { ok: true };
}

/**
 * Moves the plan's end date and, if this week has no plan yet, creates it, in
 * one transaction. The database re-checks the rules, and saving it again
 * changes nothing. A week that has a plan keeps its allowance.
 */
export async function startNewPlan(
  client: SupabaseClient,
  accountId: string,
  today: IsoDate,
  endDate: IsoDate,
  week?: { recommendedCents: number; allowanceCents: number },
): Promise<SaveResult> {
  const { error } = await client.rpc('start_new_plan', {
    p_account_id: accountId,
    p_today: today,
    p_end_date: endDate,
    p_recommended_cents: week?.recommendedCents ?? null,
    p_starting_allowance_cents: week?.allowanceCents ?? null,
  });
  return error ? { ok: false, message: saveMessage(error) } : { ok: true };
}

export async function updatePurchaseRow(client: SupabaseClient, purchase: Purchase): Promise<SaveResult> {
  const { data, error } = await client.from('purchases').update(purchaseColumns(purchase)).eq('id', purchase.id).select('id');
  if (error) return { ok: false, message: saveMessage(error) };
  return data.length === 1 ? { ok: true } : { ok: false, message: 'That purchase no longer exists. Reload the page to see the latest.' };
}

/** Deleting something already gone is a success: the student's goal is met. */
export async function deletePurchaseRow(client: SupabaseClient, id: string): Promise<SaveResult> {
  const { error } = await client.from('purchases').delete().eq('id', id);
  return error ? { ok: false, message: saveMessage(error) } : { ok: true };
}

export async function updateIncomeRow(client: SupabaseClient, income: IncomeReceipt): Promise<SaveResult> {
  const { data, error } = await client.from('income_receipts').update(incomeColumns(income)).eq('id', income.id).select('id');
  if (error) return { ok: false, message: saveMessage(error) };
  return data.length === 1 ? { ok: true } : { ok: false, message: 'That entry no longer exists. Reload the page to see the latest.' };
}

/** Deleting something already gone is a success, as with purchases. */
export async function deleteIncomeRow(client: SupabaseClient, id: string): Promise<SaveResult> {
  const { error } = await client.from('income_receipts').delete().eq('id', id);
  return error ? { ok: false, message: saveMessage(error) } : { ok: true };
}

/** Changes what a bill is. Whether it has been paid is saved separately. */
export async function updateBillRow(client: SupabaseClient, bill: Bill): Promise<SaveResult> {
  const { data, error } = await client.from('bills').update(billColumns(bill)).eq('id', bill.id).select('id');
  if (error) return { ok: false, message: saveMessage(error) };
  return data.length === 1 ? { ok: true } : { ok: false, message: 'That bill no longer exists. Reload the page to see the latest.' };
}

/** Deleting something already gone is a success, as with purchases. */
export async function deleteBillRow(client: SupabaseClient, id: string): Promise<SaveResult> {
  const { error } = await client.from('bills').delete().eq('id', id);
  return error ? { ok: false, message: saveMessage(error) } : { ok: true };
}

/**
 * One row update, so cash and unpaid bills change together. Saving the same
 * payment again changes nothing, so a retry cannot take the money out twice.
 */
export async function payBillRow(client: SupabaseClient, id: string, payment: BillPayment): Promise<SaveResult> {
  return setPayment(client, id, { paid_on: payment.paidOn, paid_cents: payment.paidCents });
}

/** Pays part of a bill and keeps the rest owed, in one transaction. Saving it again changes nothing. */
export async function payBillKeepRest(client: SupabaseClient, id: string, payment: BillPayment, restId: string): Promise<SaveResult> {
  const { error } = await client.rpc('pay_bill_keep_rest', {
    p_bill_id: id,
    p_rest_id: restId,
    p_paid_on: payment.paidOn,
    p_paid_cents: payment.paidCents,
  });
  return error ? { ok: false, message: saveMessage(error) } : { ok: true };
}

export async function undoBillPaymentRow(client: SupabaseClient, id: string): Promise<SaveResult> {
  return setPayment(client, id, { paid_on: null, paid_cents: null });
}

async function setPayment(client: SupabaseClient, id: string, columns: { paid_on: string | null; paid_cents: number | null }): Promise<SaveResult> {
  const { data, error } = await client.from('bills').update(columns).eq('id', id).select('id');
  if (error) return { ok: false, message: saveMessage(error) };
  return data.length === 1 ? { ok: true } : { ok: false, message: 'That bill no longer exists. Reload the page to see the latest.' };
}

function billColumns(bill: Bill) {
  return { name: bill.name, due_on: bill.dueOn, cents: bill.cents };
}

function incomeColumns(income: IncomeReceipt) {
  return {
    received_on: income.date,
    // null, not undefined: clearing the source on an edit must clear it in the row.
    source: income.source ?? null,
    cents: income.cents,
  };
}

function purchaseColumns(purchase: Purchase) {
  return {
    date: purchase.date,
    merchant: purchase.merchant,
    // null, not undefined: clearing a note on an edit must clear it in the row.
    note: purchase.note ?? null,
    category: purchase.category ?? null,
    need_or_want: purchase.needOrWant ?? null,
    cents: purchase.cents,
  };
}

// Rows arrive untyped until generated database types are worth adding. These
// functions are the one place that knows the column names.
/* eslint-disable @typescript-eslint/no-explicit-any */
function toAccount(row: any, parts: Pick<AccountLedger, 'purchases' | 'income' | 'corrections' | 'bills' | 'weeks' | 'closures' | 'releases'>): AccountLedger {
  return {
    currency: row.currency,
    openingDate: row.opening_date,
    openingCashCents: row.opening_cash_cents,
    openingProtectedCents: row.opening_protected_cents,
    planEndDate: row.plan_end_date,
    ...parts,
  };
}

function toPurchase(row: any): Purchase {
  return {
    id: row.id,
    date: row.date,
    merchant: row.merchant,
    ...(row.note !== null && { note: row.note as string }),
    ...(row.category !== null && { category: row.category as CategoryId }),
    ...(row.need_or_want !== null && { needOrWant: row.need_or_want as NeedOrWant }),
    cents: row.cents,
  };
}

function toIncome(row: any): IncomeReceipt {
  return {
    id: row.id,
    date: row.received_on,
    cents: row.cents,
    ...(row.source !== null && { source: row.source as string }),
  };
}

function toCorrection(row: any): BalanceCorrection {
  return {
    id: row.id,
    date: row.corrected_on,
    differenceCents: row.difference_cents,
    ...(row.note !== null && { note: row.note as string }),
  };
}

function toBill(row: any): Bill {
  return {
    id: row.id,
    name: row.name,
    dueOn: row.due_on,
    cents: row.cents,
    ...(row.paid_on !== null && { paidOn: row.paid_on as IsoDate, paidCents: row.paid_cents as number }),
  };
}

function toWeekPlan(row: any, changes: any[]): WeekPlan {
  return {
    weekStart: row.week_start,
    recommendedCents: row.recommended_cents,
    startingAllowanceCents: row.starting_allowance_cents,
    changes: changes.filter((change) => change.week_plan_id === row.id).map(toAllowanceChange),
  };
}

function toAllowanceChange(row: any): AllowanceChange {
  return {
    id: row.id,
    madeOn: row.made_on,
    fromCents: row.from_cents,
    toCents: row.to_cents,
    suggestedCents: row.suggested_cents,
  };
}

function toClosure(row: any, currency: Currency): WeekClosure {
  return {
    currency,
    weekStart: row.week_start,
    allowanceCents: row.allowance_cents,
    spentCents: row.spent_cents,
    leftoverCents: row.leftover_cents,
    protectedCents: row.protected_cents,
  };
}

function toRelease(row: any): SavingsRelease {
  return { id: row.id, madeOn: row.made_on, cents: row.cents };
}
