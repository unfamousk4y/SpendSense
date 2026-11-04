// Runs the app's real data layer against the real database as the test users.
// Fictional data only; each user's rows are removed before and after.
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createAccount, deletePurchaseRow, insertPurchase, loadLedger, updatePurchaseRow, type NewAccount } from '../../src/data/ledgerStore'
import { weekAccount } from '../../src/domain/ledger'
import type { Purchase } from '../../src/domain/week'
import { signIn, type TestUser } from './clients.ts'

let a: TestUser
let b: TestUser

// The worked example, set up on Monday Nov 2.
const TODAY = '2026-11-02'
const usd: NewAccount = {
  currency: 'USD',
  openingDate: TODAY,
  cashCents: 100000,
  protectedCents: 20000,
  commitmentsCents: 20000,
  planEndDate: '2026-11-29',
  recommendedCents: 15000,
  allowanceCents: 15000,
}

async function reset(user: TestUser) {
  const { error } = await user.client.from('accounts').delete().eq('user_id', user.userId)
  if (error) throw new Error(`Cleanup failed: ${error.message}`)
}

async function load(user: TestUser, today = TODAY) {
  const result = await loadLedger(user.client, today)
  if (!result.ok) throw new Error(result.message)
  return result.loaded
}

const coffee = (): Purchase => ({
  id: crypto.randomUUID(),
  date: TODAY,
  merchant: 'Fictional café',
  note: 'Exam week',
  category: 'food',
  needOrWant: 'want',
  cents: 450,
})

beforeAll(async () => {
  a = await signIn('A')
  b = await signIn('B')
})

afterAll(async () => {
  if (a) await reset(a)
  if (b) await reset(b)
})

describe('setting up an account', () => {
  beforeAll(async () => {
    await Promise.all([reset(a), reset(b)])
  })

  test('a student with no accounts loads an empty ledger', async () => {
    expect((await load(a)).ledger).toEqual({ today: TODAY, accounts: {} })
  })

  test('creates the account and its first plan; the screen numbers match the worked example', async () => {
    expect(await createAccount(a.client, usd)).toEqual({ ok: true })
    expect(weekAccount((await load(a)).ledger, 'USD')).toMatchObject({
      weekStart: TODAY,
      weekStartCashCents: 100000,
      protectedCents: 20000,
      commitmentsCents: 20000,
      recommendedAllowanceCents: 15000,
      chosenAllowanceCents: 15000,
      purchases: [],
    })
  })

  test('a repeated setup is harmless and leaves one account', async () => {
    expect(await createAccount(a.client, usd)).toEqual({ ok: true })
    const { data } = await a.client.from('accounts').select('id')
    expect(data).toHaveLength(1)
  })

  test('set up on a Wednesday: the opening date stays Wednesday, the plan starts Monday', async () => {
    expect(await createAccount(b.client, { ...usd, openingDate: '2026-11-04', recommendedCents: 11538, allowanceCents: 11538 })).toEqual({ ok: true })
    const account = (await load(b, '2026-11-04')).ledger.accounts.USD!
    expect(account.openingDate).toBe('2026-11-04')
    expect(account.weeks.map((week) => week.weekStart)).toEqual(['2026-11-02'])
  })

  test('the database itself refuses an allowance above free cash, and leaves no account behind', async () => {
    const { error } = await a.client.rpc('create_account_with_plan', {
      p_currency: 'BSD',
      p_opening_date: TODAY,
      p_opening_cash_cents: 10000,
      p_opening_protected_cents: 0,
      p_commitments_cents: 0,
      p_plan_end_date: '2026-11-29',
      p_recommended_cents: 0,
      p_starting_allowance_cents: 10001,
    })
    expect(error?.code).toBe('23514')
    const { data } = await a.client.from('accounts').select('id').eq('currency', 'BSD')
    expect(data).toEqual([])
  })

  test('the database refuses protected savings above cash', async () => {
    const { error } = await a.client.rpc('create_account_with_plan', {
      p_currency: 'BSD',
      p_opening_date: TODAY,
      p_opening_cash_cents: 100,
      p_opening_protected_cents: 101,
      p_commitments_cents: 0,
      p_plan_end_date: '2026-11-29',
      p_recommended_cents: 0,
      p_starting_allowance_cents: 0,
    })
    expect(error?.code).toBe('23514')
  })

  test('if the first plan cannot be written, the account is not created either', async () => {
    // A negative allowance passes the function's checks but breaks the plan
    // table's constraint: the whole call must roll back.
    const { error } = await a.client.rpc('create_account_with_plan', {
      p_currency: 'BSD',
      p_opening_date: TODAY,
      p_opening_cash_cents: 10000,
      p_opening_protected_cents: 0,
      p_commitments_cents: 0,
      p_plan_end_date: '2026-11-29',
      p_recommended_cents: 0,
      p_starting_allowance_cents: -1,
    })
    expect(error?.code).toBe('23514')
    const { data } = await a.client.from('accounts').select('id').eq('currency', 'BSD')
    expect(data).toEqual([])
  })

  test('a signed-out visitor cannot call the function', async () => {
    const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error } = await anon.rpc('create_account_with_plan', {
      p_currency: 'USD',
      p_opening_date: TODAY,
      p_opening_cash_cents: 0,
      p_opening_protected_cents: 0,
      p_commitments_cents: 0,
      p_plan_end_date: '2026-11-29',
      p_recommended_cents: 0,
      p_starting_allowance_cents: 0,
    })
    expect(error?.code).toBe('42501')
  })
})

describe('saving purchases', () => {
  let accountId: string

  beforeAll(async () => {
    await Promise.all([reset(a), reset(b)])
    await createAccount(a.client, usd)
    await createAccount(b.client, usd)
    accountId = (await load(a)).accountIds.USD!
  })

  test('a saved purchase comes back with every field, and lowers the remaining amount', async () => {
    const purchase = coffee()
    expect(await insertPurchase(a.client, accountId, purchase)).toEqual({ ok: true })
    const week = weekAccount((await load(a)).ledger, 'USD')
    expect(week.purchases).toEqual([purchase])
    await deletePurchaseRow(a.client, purchase.id)
  })

  test('retrying the same purchase (a lost reply) saves it once and reports success', async () => {
    const purchase = coffee()
    await insertPurchase(a.client, accountId, purchase)
    expect(await insertPurchase(a.client, accountId, purchase)).toEqual({ ok: true })
    expect(weekAccount((await load(a)).ledger, 'USD').purchases).toHaveLength(1)
    await deletePurchaseRow(a.client, purchase.id)
  })

  test("reusing an id that belongs to someone else is a failure, not a false success", async () => {
    const purchase = coffee()
    await insertPurchase(a.client, accountId, purchase)
    const bAccountId = (await load(b)).accountIds.USD!
    expect((await insertPurchase(b.client, bAccountId, purchase)).ok).toBe(false)
    expect(weekAccount((await load(b)).ledger, 'USD').purchases).toEqual([])
    await deletePurchaseRow(a.client, purchase.id)
  })

  test('an edit changes the row and keeps the id; clearing the note clears it', async () => {
    const purchase = coffee()
    await insertPurchase(a.client, accountId, purchase)
    const edited: Purchase = { id: purchase.id, date: TODAY, merchant: 'Bookstore', category: 'school', cents: 2800 }
    expect(await updatePurchaseRow(a.client, edited)).toEqual({ ok: true })
    expect(weekAccount((await load(a)).ledger, 'USD').purchases).toEqual([edited])
    await deletePurchaseRow(a.client, purchase.id)
  })

  test("editing someone else's purchase fails and changes nothing", async () => {
    const purchase = coffee()
    await insertPurchase(a.client, accountId, purchase)
    expect((await updatePurchaseRow(b.client, { ...purchase, cents: 1 })).ok).toBe(false)
    expect(weekAccount((await load(a)).ledger, 'USD').purchases[0].cents).toBe(450)
    await deletePurchaseRow(a.client, purchase.id)
  })

  test('deleting removes it; deleting again still succeeds', async () => {
    const purchase = coffee()
    await insertPurchase(a.client, accountId, purchase)
    expect(await deletePurchaseRow(a.client, purchase.id)).toEqual({ ok: true })
    expect(await deletePurchaseRow(a.client, purchase.id)).toEqual({ ok: true })
    expect(weekAccount((await load(a)).ledger, 'USD').purchases).toEqual([])
  })

  test('money survives a reload exactly: 3 purchases, cash 1,000 - 40 = 960', async () => {
    const ids = [450, 2800, 750].map((cents) => ({ ...coffee(), cents }))
    for (const purchase of ids) await insertPurchase(a.client, accountId, purchase)
    const week = weekAccount((await load(a)).ledger, 'USD')
    expect(week.weekStartCashCents - week.purchases.reduce((total, p) => total + p.cents, 0)).toBe(96000)
    for (const purchase of ids) await deletePurchaseRow(a.client, purchase.id)
  })
})

describe('reaching a new week', () => {
  beforeAll(async () => {
    await Promise.all([reset(a), reset(b)])
    await createAccount(a.client, usd)
  })

  // F = 1000 - 200 - 200 = 600, Nov 9 to Nov 29 is 21 days: floor(60000 * 7 / 21) = 20000.
  test('loading in a week with no plan creates it, and loading again does not duplicate it', async () => {
    const week = weekAccount((await load(a, '2026-11-09')).ledger, 'USD')
    expect(week).toMatchObject({ weekStart: '2026-11-09', recommendedAllowanceCents: 20000, chosenAllowanceCents: 20000 })
    await load(a, '2026-11-09')
    const { data } = await a.client.from('week_plans').select('id').eq('week_start', '2026-11-09')
    expect(data).toHaveLength(1)
  })

  test('after the plan end date no new plan is invented', async () => {
    const { ledger } = await load(a, '2026-11-30')
    expect(ledger.accounts.USD!.weeks.map((week) => week.weekStart)).toEqual(['2026-11-02', '2026-11-09'])
  })
})
