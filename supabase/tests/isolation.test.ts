// Two different signed-in users must never read, change, delete or link to
// each other's rows. Every attack below runs as user B against user A's data, through
// the same publishable key a browser uses. Fictional data only.
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { signIn, type TestUser } from './clients.ts'

let a: TestUser
let b: TestUser
let aAccountId: string
let bAccountId: string
let aPurchaseId: string
let bPurchaseId: string

const MONDAY = '2026-11-02'

// Postgres error codes: 42501 = not allowed (privilege or row-level security),
// 23503 = foreign key (the linked row does not exist for this owner),
// 23514 = check constraint (a value outside the allowed range).
const NOT_ALLOWED = '42501'
const FOREIGN_KEY = '23503'
const CHECK = '23514'

async function resetOwnData(user: TestUser) {
  // Deleting the user's accounts cascades to everything that belongs to them.
  const { error } = await user.client.from('accounts').delete().eq('user_id', user.userId)
  if (error) throw new Error(`Cleanup failed: ${error.message}`)
}

async function createAccount(user: TestUser): Promise<string> {
  const { data, error } = await user.client
    .from('accounts')
    .insert({
      currency: 'USD',
      opening_date: MONDAY,
      opening_cash_cents: 100000,
      opening_protected_cents: 20000,
      plan_end_date: '2026-11-29',
    })
    .select('id')
    .single()
  if (error) throw new Error(`Could not create a test account: ${error.message}`)
  // Entries must be dated in a week that has a plan, as in the real app.
  const plan = await user.client.from('week_plans').insert({
    account_id: data.id,
    week_start: MONDAY,
    recommended_cents: 15000,
    starting_allowance_cents: 15000,
  })
  if (plan.error) throw new Error(`Could not create a test week plan: ${plan.error.message}`)
  return data.id
}

async function createPurchase(user: TestUser, accountId: string, cents: number): Promise<string> {
  const id = crypto.randomUUID()
  const { error } = await user.client
    .from('purchases')
    .insert({ id, account_id: accountId, date: '2026-11-03', merchant: 'Fictional café', need_or_want: 'want', cents })
  if (error) throw new Error(`Could not create a test purchase: ${error.message}`)
  return id
}

beforeAll(async () => {
  a = await signIn('A')
  b = await signIn('B')
  await Promise.all([resetOwnData(a), resetOwnData(b)])
  aAccountId = await createAccount(a)
  bAccountId = await createAccount(b)
  aPurchaseId = await createPurchase(a, aAccountId, 450)
  bPurchaseId = await createPurchase(b, bAccountId, 999)
})

afterAll(async () => {
  if (a) await resetOwnData(a)
  if (b) await resetOwnData(b)
  await Promise.all([a?.client.auth.signOut(), b?.client.auth.signOut()])
})

describe('each user sees only their own rows', () => {
  test('A sees exactly their own account and purchase', async () => {
    const accounts = await a.client.from('accounts').select('id, user_id')
    expect(accounts.error).toBeNull()
    expect(accounts.data).toEqual([{ id: aAccountId, user_id: a.userId }])

    const purchases = await a.client.from('purchases').select('id')
    expect(purchases.data).toEqual([{ id: aPurchaseId }])
  })

  test("B asking for A's account or purchase by id gets nothing", async () => {
    const account = await b.client.from('accounts').select('id').eq('id', aAccountId)
    expect(account.error).toBeNull()
    expect(account.data).toEqual([])

    const purchase = await b.client.from('purchases').select('id').eq('id', aPurchaseId)
    expect(purchase.data).toEqual([])
  })

  test('a signed-out visitor is refused outright', async () => {
    const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await anon.from('purchases').select('id')
    expect(data).toBeNull()
    expect(error?.code).toBe(NOT_ALLOWED)
  })
})

describe("B cannot read A's plans, changes, closures or releases", () => {
  // Weeks before MONDAY: closing a week needs a date the database does not
  // consider ahead of it.
  const CLOSED_WEEK = '2026-10-19'
  const OPEN_WEEK = '2026-10-26'

  beforeAll(async () => {
    const plans = await a.client
      .from('week_plans')
      .insert([CLOSED_WEEK, OPEN_WEEK].map((week_start) => ({
        account_id: aAccountId,
        week_start,
        recommended_cents: 15000,
        starting_allowance_cents: 15000,
      })))
      .select('id, week_start')
    if (plans.error) throw new Error(`Could not create week plans: ${plans.error.message}`)

    const openPlan = plans.data.find((plan) => plan.week_start === OPEN_WEEK)
    const results = await Promise.all([
      a.client.rpc('change_allowance', {
        p_id: crypto.randomUUID(),
        p_week_plan_id: openPlan?.id,
        p_made_on: OPEN_WEEK,
        p_to_cents: 14000,
        p_suggested_cents: null,
      }),
      a.client.rpc('release_savings', {
        p_id: crypto.randomUUID(),
        p_account_id: aAccountId,
        p_made_on: OPEN_WEEK,
        p_cents: 100,
      }),
      a.client.rpc('close_ended_weeks', { p_account_id: aAccountId, p_today: OPEN_WEEK }),
    ])
    for (const { error } of results) {
      if (error) throw new Error(`Could not create A's rows: ${error.message}`)
    }
  })

  // B owns only the week plan its own account was set up with, so anything more
  // belongs to someone else. A's count shows the rows exist: an empty result for
  // B is not an empty table.
  test.each([
    ['week_plans', 3, 1],
    ['allowance_changes', 1, 0],
    ['week_closures', 1, 0],
    ['savings_releases', 1, 0],
  ])('%s', async (table, aRowCount, bRowCount) => {
    const asB = await b.client.from(table).select('id')
    expect(asB.error).toBeNull()
    expect(asB.data).toHaveLength(bRowCount)

    const asA = await a.client.from(table).select('id')
    expect(asA.data).toHaveLength(aRowCount)

    const aIds = asA.data!.map((row) => row.id)
    expect(asB.data!.filter((row) => aIds.includes(row.id))).toEqual([])
  })
})

describe("B cannot change or delete A's rows", () => {
  test("updating A's purchase changes no rows", async () => {
    const { data, error } = await b.client.from('purchases').update({ cents: 1 }).eq('id', aPurchaseId).select('id')
    expect(error).toBeNull()
    expect(data).toEqual([])

    const check = await a.client.from('purchases').select('cents').eq('id', aPurchaseId).single()
    expect(check.data?.cents).toBe(450)
  })

  test("deleting A's purchase and account removes nothing", async () => {
    const purchase = await b.client.from('purchases').delete().eq('id', aPurchaseId).select('id')
    expect(purchase.data).toEqual([])
    const account = await b.client.from('accounts').delete().eq('id', aAccountId).select('id')
    expect(account.data).toEqual([])

    const check = await a.client.from('purchases').select('id').eq('id', aPurchaseId)
    expect(check.data).toEqual([{ id: aPurchaseId }])
  })
})

describe('B cannot forge ownership or links', () => {
  test("inserting a purchase that claims A's user_id is refused", async () => {
    const { error } = await b.client.from('purchases').insert({
      id: crypto.randomUUID(),
      user_id: a.userId,
      account_id: aAccountId,
      date: '2026-11-03',
      need_or_want: 'need',
      cents: 100,
    })
    expect(error?.code).toBe(NOT_ALLOWED)
  })

  test("inserting B's own purchase into A's account is refused", async () => {
    const { error } = await b.client
      .from('purchases')
      .insert({ id: crypto.randomUUID(), account_id: aAccountId, date: '2026-11-03', need_or_want: 'need', cents: 100 })
    expect(error?.code).toBe(FOREIGN_KEY)
  })

  test("moving B's purchase into A's account is refused", async () => {
    const { error } = await b.client.from('purchases').update({ account_id: aAccountId }).eq('id', bPurchaseId)
    // There is no right to change this column at all, so it stops before the foreign key.
    expect(error?.code).toBe('42501')
  })

  test("handing B's account over to A is refused", async () => {
    const { error } = await b.client.from('accounts').update({ user_id: a.userId }).eq('id', bAccountId)
    expect(error?.code).toBe(NOT_ALLOWED)
  })

  test("a week plan for A's account is refused", async () => {
    const { error } = await b.client.from('week_plans').insert({
      account_id: aAccountId,
      // A week A has no plan for yet, so only the ownership check can refuse it.
      week_start: '2026-11-09',
      recommended_cents: 15000,
      starting_allowance_cents: 15000,
    })
    expect(error?.code).toBe(FOREIGN_KEY)
  })

  test("reusing A's purchase id is refused and does not reveal or touch A's row", async () => {
    const { error } = await b.client
      .from('purchases')
      .insert({ id: aPurchaseId, account_id: bAccountId, date: '2026-11-03', need_or_want: 'need', cents: 100 })
    expect(error).not.toBeNull()
    const check = await a.client.from('purchases').select('cents').eq('id', aPurchaseId).single()
    expect(check.data?.cents).toBe(450)
  })
})

describe('closures and releases cannot be written from the browser yet', () => {
  test('even for your own account, inserting a closure is refused', async () => {
    const { error } = await b.client.from('week_closures').insert({
      account_id: bAccountId,
      week_start: MONDAY,
      allowance_cents: 15000,
      spent_cents: 0,
      leftover_cents: 15000,
      protected_cents: 15000,
    })
    expect(error?.code).toBe(NOT_ALLOWED)
  })

  test('even for your own account, inserting a release is refused', async () => {
    const { error } = await b.client
      .from('savings_releases')
      .insert({ id: crypto.randomUUID(), account_id: bAccountId, made_on: MONDAY, cents: 100 })
    expect(error?.code).toBe(NOT_ALLOWED)
  })
})

describe('the database rejects impossible values on its own', () => {
  test('a purchase of 0 cents', async () => {
    const { error } = await a.client
      .from('purchases')
      .insert({ id: crypto.randomUUID(), account_id: aAccountId, date: '2026-11-03', need_or_want: 'need', cents: 0 })
    expect(error?.code).toBe(CHECK)
  })

  test('a currency other than USD or BSD', async () => {
    const { error } = await a.client.from('accounts').insert({
      currency: 'EUR',
      opening_date: MONDAY,
      opening_cash_cents: 0,
      opening_protected_cents: 0,
      plan_end_date: '2026-11-29',
    })
    expect(error?.code).toBe(CHECK)
  })

  test('a week plan that does not start on a Monday', async () => {
    const { error } = await a.client.from('week_plans').insert({
      account_id: aAccountId,
      week_start: '2026-11-03',
      recommended_cents: 0,
      starting_allowance_cents: 0,
    })
    expect(error?.code).toBe(CHECK)
  })
})
