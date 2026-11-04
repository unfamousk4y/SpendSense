// The only code that reads and writes SpendSense's tables. It turns database
// rows into the ledger the pure rules work with, and back. No rules live here,
// and a client is passed in, so the access tests can run this exact code as
// each test user.
//
// Writes report success or a message for the screen. Nothing here logs: rows
// hold a student's spending. Raw database messages are not shown to students.
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { AllowanceChange } from '../domain/allowanceChange';
import type { CategoryId, NeedOrWant } from '../domain/categories';
import type { WeekClosure } from '../domain/closure';
import type { IsoDate } from '../domain/dates';
import { planForNewWeek, type AccountLedger, type Ledger, type WeekPlan } from '../domain/ledger';
import type { Currency } from '../domain/money';
import type { SavingsRelease } from '../domain/release';
import type { Purchase } from '../domain/week';

export type SaveResult = { ok: true } | { ok: false; message: string };

export type LoadedLedger = {
  ledger: Ledger;
  /** Each account's row id, which new purchases are linked to. */
  accountIds: Partial<Record<Currency, string>>;
};

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
  // PostgREST's codes for a missing or expired session token.
  return error.code === 'PGRST301' || error.code === 'PGRST303' ? SESSION_ENDED : SAVE_FAILED;
}

export async function loadLedger(client: SupabaseClient, today: IsoDate): Promise<LoadResult> {
  const first = await readLedger(client, today);
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
  const [accounts, purchases, plans, changes, closures, releases] = await Promise.all([
    client.from('accounts').select('*'),
    client.from('purchases').select('*').order('created_at'),
    client.from('week_plans').select('*').order('week_start'),
    client.from('allowance_changes').select('*').order('created_at'),
    client.from('week_closures').select('*').order('week_start'),
    client.from('savings_releases').select('*').order('created_at'),
  ]);
  if (accounts.error || purchases.error || plans.error || changes.error || closures.error || releases.error) {
    return { ok: false, message: LOAD_FAILED };
  }

  const ledger: Ledger = { today, accounts: {} };
  const accountIds: LoadedLedger['accountIds'] = {};
  for (const row of accounts.data) {
    const currency: Currency = row.currency;
    accountIds[currency] = row.id;
    ledger.accounts[currency] = toAccount(row, {
      purchases: purchases.data.filter((p) => p.account_id === row.id).map(toPurchase),
      weeks: plans.data.filter((plan) => plan.account_id === row.id).map((plan) => toWeekPlan(plan, changes.data)),
      closures: closures.data.filter((c) => c.account_id === row.id).map((c) => toClosure(c, currency)),
      releases: releases.data.filter((r) => r.account_id === row.id).map(toRelease),
    });
  }
  return { ok: true, loaded: { ledger, accountIds } };
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
  const { error } = await client.from('purchases').insert({ id: purchase.id, account_id: accountId, ...purchaseColumns(purchase) });
  if (!error) return { ok: true };
  if (error.code !== UNIQUE_VIOLATION) return { ok: false, message: saveMessage(error) };

  const found = await client.from('purchases').select('id').eq('id', purchase.id);
  return !found.error && found.data.length === 1 ? { ok: true } : { ok: false, message: SAVE_FAILED };
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
function toAccount(row: any, parts: Pick<AccountLedger, 'purchases' | 'weeks' | 'closures' | 'releases'>): AccountLedger {
  return {
    currency: row.currency,
    openingDate: row.opening_date,
    openingCashCents: row.opening_cash_cents,
    openingProtectedCents: row.opening_protected_cents,
    commitmentsCents: row.commitments_cents,
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
