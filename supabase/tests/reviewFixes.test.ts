// Regressions for the quality review's findings, through the real data layer, as
// the test users, using the publishable key only. Fictional data only.
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { createAccount, insertCorrection, insertPurchase, loadLedger, type NewAccount } from '../../src/data/ledgerStore'
import { accountCash, weekAccount } from '../../src/domain/ledger'
import { signIn, type TestUser } from './clients.ts'

let a: TestUser
let b: TestUser

const WEEK_1 = '2026-10-19'
const WEEK_2 = '2026-10-26'
const ROUNDS = 10

// C 960, P 200, no bills, F 760, and an allowance of all of it, so anything that
// lowers free cash lowers what closing the week protects.
const usd: NewAccount = {
  currency: 'USD',
  openingDate: WEEK_1,
  cashCents: 96000,
  protectedCents: 20000,
  commitmentsCents: 0,
  planEndDate: '2026-11-15',
  recommendedCents: 76000,
  allowanceCents: 76000,
}

async function reset(user: TestUser) {
  const { error } = await user.client.from('accounts').delete().eq('user_id', user.userId)
  if (error) throw new Error(`Cleanup failed: ${error.message}`)
}

async function load(user: TestUser, today = WEEK_1) {
  const result = await loadLedger(user.client, today)
  if (!result.ok) throw new Error(result.message)
  return result.loaded
}

async function start(user: TestUser, account: NewAccount = usd): Promise<string> {
  await reset(user)
  const created = await createAccount(user.client, account)
  if (!created.ok) throw new Error(created.message)
  return (await load(user)).accountIds[account.currency]!
}

const close = (user: TestUser, accountId: string) => user.client.rpc('close_ended_weeks', { p_account_id: accountId, p_today: WEEK_2 })

async function closure(user: TestUser) {
  const { data, error } = await user.client.from('week_closures').select('spent_cents, protected_cents').single()
  if (error) throw new Error(error.message)
  return data
}

beforeAll(async () => {
  a = await signIn('A')
  b = await signIn('B')
})

afterAll(async () => {
  if (a) await reset(a)
  if (b) await reset(b)
})

describe('a save racing the week closing', () => {
  test('a purchase is either refused, or counted in the closure', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const accountId = await start(a)
      const [saved, closed] = await Promise.all([
        insertPurchase(a.client, accountId, { id: crypto.randomUUID(), date: WEEK_1, merchant: 'Fictional', needOrWant: 'need', cents: 300 }),
        close(a, accountId),
      ])
      expect(closed.error).toBeNull()
      const stored = await closure(a)
      expect(stored.spent_cents).toBe(saved.ok ? 300 : 0)
    }
  })

  test('a correction is either refused, or counted in what the closure protects', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const accountId = await start(a)
      const [saved, closed] = await Promise.all([
        insertCorrection(a.client, accountId, { id: crypto.randomUUID(), date: WEEK_1, differenceCents: -30000 }, 96000),
        close(a, accountId),
      ])
      expect(closed.error).toBeNull()
      expect((await closure(a)).protected_cents).toBe(saved.ok ? 46000 : 76000)
    }
  })

  test('a bill payment is either refused, or counted in what the closure protects', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const accountId = await start(a)
      const id = crypto.randomUUID()
      // Due after the plan ends, so it only affects free cash once paid.
      const added = await a.client.from('bills').insert({ id, account_id: accountId, name: 'Fictional', due_on: '2026-12-01', cents: 30000 })
      expect(added.error).toBeNull()
      const [paid, closed] = await Promise.all([
        a.client.from('bills').update({ paid_on: WEEK_1, paid_cents: 30000 }).eq('id', id),
        close(a, accountId),
      ])
      expect(closed.error).toBeNull()
      expect((await closure(a)).protected_cents).toBe(paid.error ? 76000 : 46000)
    }
  })
})

describe('entries must be dated in a week with a plan', () => {
  let accountId: string
  const NO_PLAN = WEEK_2
  const CLOSED = 'SS001'

  beforeEach(async () => {
    accountId = await start(a)
  })

  test('a purchase, income, payment and correction are all refused', async () => {
    const purchase = await a.client.from('purchases').insert({ id: crypto.randomUUID(), account_id: accountId, date: NO_PLAN, need_or_want: 'need', cents: 100 })
    expect(purchase.error?.code).toBe(CLOSED)
    const income = await a.client.from('income_receipts').insert({ id: crypto.randomUUID(), account_id: accountId, received_on: NO_PLAN, cents: 100 })
    expect(income.error?.code).toBe(CLOSED)
    const payment = await a.client.from('bills').insert({
      id: crypto.randomUUID(), account_id: accountId, name: 'Fictional', due_on: WEEK_1, cents: 100, paid_on: NO_PLAN, paid_cents: 100,
    })
    expect(payment.error?.code).toBe(CLOSED)
    expect((await insertCorrection(a.client, accountId, { id: crypto.randomUUID(), date: NO_PLAN, differenceCents: -100 }, 96000)).ok).toBe(false)
    expect(accountCash((await load(a)).ledger.accounts.USD!).currentCashCents).toBe(96000)
  })

  test('moving a purchase into a week with no plan is refused', async () => {
    const id = crypto.randomUUID()
    await a.client.from('purchases').insert({ id, account_id: accountId, date: WEEK_1, need_or_want: 'need', cents: 100 })
    expect((await a.client.from('purchases').update({ date: NO_PLAN }).eq('id', id)).error?.code).toBe(CLOSED)
  })

  test('an unpaid bill can still be due in any week', async () => {
    const unpaid = await a.client.from('bills').insert({ id: crypto.randomUUID(), account_id: accountId, name: 'Fictional', due_on: NO_PLAN, cents: 100 })
    expect(unpaid.error).toBeNull()
  })
})

describe('an entry cannot change account or currency', () => {
  let usdId: string
  let bsdId: string
  const NO_RIGHT = '42501'

  beforeEach(async () => {
    usdId = await start(a)
    expect((await createAccount(a.client, { ...usd, currency: 'BSD' })).ok).toBe(true)
    bsdId = (await load(a)).accountIds.BSD!
  })

  test('a purchase, income and a bill all stay in their account', async () => {
    const purchase = crypto.randomUUID()
    const income = crypto.randomUUID()
    const bill = crypto.randomUUID()
    await a.client.from('purchases').insert({ id: purchase, account_id: usdId, date: WEEK_1, need_or_want: 'need', cents: 100 })
    await a.client.from('income_receipts').insert({ id: income, account_id: usdId, received_on: WEEK_1, cents: 100 })
    await a.client.from('bills').insert({ id: bill, account_id: usdId, name: 'Fictional', due_on: WEEK_1, cents: 100 })

    expect((await a.client.from('purchases').update({ account_id: bsdId }).eq('id', purchase)).error?.code).toBe(NO_RIGHT)
    expect((await a.client.from('income_receipts').update({ account_id: bsdId }).eq('id', income)).error?.code).toBe(NO_RIGHT)
    expect((await a.client.from('bills').update({ account_id: bsdId }).eq('id', bill)).error?.code).toBe(NO_RIGHT)

    const { ledger } = await load(a)
    expect(weekAccount(ledger, 'BSD')).toMatchObject({ purchases: [], income: [], bills: [] })
  })

  test('the owner column cannot be changed either', async () => {
    const id = crypto.randomUUID()
    await a.client.from('purchases').insert({ id, account_id: usdId, date: WEEK_1, need_or_want: 'need', cents: 100 })
    expect((await a.client.from('purchases').update({ user_id: b.userId }).eq('id', id)).error?.code).toBe(NO_RIGHT)
  })

  test('the ordinary edits still work', async () => {
    const purchase = crypto.randomUUID()
    await a.client.from('purchases').insert({ id: purchase, account_id: usdId, date: WEEK_1, need_or_want: 'need', cents: 100 })
    expect((await a.client.from('purchases').update({ cents: 200, merchant: 'Fictional', note: 'n', category: 'food', need_or_want: 'need', date: WEEK_1 }).eq('id', purchase)).error).toBeNull()
  })
})

describe('opening amounts', () => {
  const row = { currency: 'USD', opening_date: WEEK_1, plan_end_date: '2026-11-15' }

  beforeEach(() => reset(a))

  test('negative cash is refused, even when inserted directly', async () => {
    const { error } = await a.client.from('accounts').insert({ ...row, opening_cash_cents: -1, opening_protected_cents: 0 })
    expect(error?.code).toBe('23514')
  })

  test('protected savings above cash are refused', async () => {
    const { error } = await a.client.from('accounts').insert({ ...row, opening_cash_cents: 100, opening_protected_cents: 101 })
    expect(error?.code).toBe('23514')
  })

  test('zero cash, and savings equal to cash, are allowed', async () => {
    const { error } = await a.client.from('accounts').insert({ ...row, opening_cash_cents: 0, opening_protected_cents: 0 })
    expect(error).toBeNull()
  })
})

describe('a correction worked out from stale cash', () => {
  const STALE = 'Your cash changed on another tab or device. Reload the page and check the difference again.'
  let accountId: string
  const lower = () => ({ id: crypto.randomUUID(), date: WEEK_1, differenceCents: -2000 })

  beforeEach(async () => {
    accountId = await start(a)
  })

  test('two tabs saving the same difference apply it once', async () => {
    const results = await Promise.all([insertCorrection(a.client, accountId, lower(), 96000), insertCorrection(a.client, accountId, lower(), 96000)])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.find((result) => !result.ok)).toEqual({ ok: false, message: STALE })
    expect(accountCash((await load(a)).ledger.accounts.USD!).currentCashCents).toBe(94000)
  })

  test('a purchase saved in another tab makes the form refuse', async () => {
    await insertPurchase(a.client, accountId, { id: crypto.randomUUID(), date: WEEK_1, merchant: 'Fictional', needOrWant: 'need', cents: 100 })
    expect(await insertCorrection(a.client, accountId, lower(), 96000)).toEqual({ ok: false, message: STALE })
  })

  test('a retry after a lost reply still succeeds, though its first attempt changed the cash', async () => {
    const saved = lower()
    await insertCorrection(a.client, accountId, saved, 96000)
    expect(await insertCorrection(a.client, accountId, saved, 96000)).toEqual({ ok: true })
    expect(accountCash((await load(a)).ledger.accounts.USD!).currentCashCents).toBe(94000)
  })

  test('browsers can no longer insert one directly', async () => {
    const { error } = await a.client.from('balance_corrections').insert({ id: crypto.randomUUID(), account_id: accountId, corrected_on: WEEK_1, difference_cents: -100 })
    expect(error?.code).toBe('42501')
  })

  test('a signed-out visitor cannot call it', async () => {
    const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error } = await anon.rpc('save_balance_correction', {
      p_id: crypto.randomUUID(), p_account_id: accountId, p_corrected_on: WEEK_1, p_difference_cents: -100, p_note: null, p_seen_cash_cents: 96000,
    })
    expect(error?.code).toBe('42501')
  })
})

describe('a session the database no longer accepts', () => {
  test('a rejected token reports that the sign-in has expired', async () => {
    const stale = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: 'Bearer not-a-real-token' } },
    })
    const result = await insertPurchase(stale, crypto.randomUUID(), { id: crypto.randomUUID(), date: WEEK_1, merchant: 'Fictional', needOrWant: 'need', cents: 100 })
    expect(result).toEqual({ ok: false, message: 'Your sign-in has expired. Sign in again to save this.' })
  })
})
