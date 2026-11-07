// The checked database operations from migration 3, run as the real test users
// through the app's data layer. Dates are in the past on purpose: the database
// refuses a "today" ahead of its own clock. Fictional data only.
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import {
  createAccount,
  deletePurchaseRow,
  insertPurchase,
  loadLedger,
  saveAllowanceChange,
  saveRelease,
  updatePurchaseRow,
  type NewAccount,
} from '../../src/data/ledgerStore'
import { freeCashCents } from '../../src/domain/allowance'
import { closeWeek } from '../../src/domain/closure'
import { addDays } from '../../src/domain/dates'
import { weekAccount } from '../../src/domain/ledger'
import type { Purchase } from '../../src/domain/week'
import { signIn, type TestUser } from './clients.ts'

let a: TestUser
let b: TestUser

// The worked example, starting exactly 28 days before its plan ends.
const WEEK_1 = '2026-10-05' // a Monday
const WEEK_2 = '2026-10-12'
const WEEK_3 = '2026-10-19'
const usd: NewAccount = {
  currency: 'USD',
  openingDate: WEEK_1,
  cashCents: 100000,
  protectedCents: 20000,
  commitmentsCents: 20000,
  planEndDate: '2026-11-01',
  recommendedCents: 15000,
  allowanceCents: 15000,
}

async function reset(user: TestUser) {
  const { error } = await user.client.from('accounts').delete().eq('user_id', user.userId)
  if (error) throw new Error(`Cleanup failed: ${error.message}`)
}

async function load(user: TestUser, today: string) {
  const result = await loadLedger(user.client, today)
  if (!result.ok) throw new Error(result.message)
  return result.loaded
}

const spend = (date: string, cents: number): Purchase => ({ id: crypto.randomUUID(), date, merchant: 'Fictional', needOrWant: 'need', cents })

async function start(user: TestUser, account: NewAccount = usd): Promise<string> {
  const created = await createAccount(user.client, account)
  if (!created.ok) throw new Error(created.message)
  return (await load(user, account.openingDate)).accountIds[account.currency]!
}

async function closures(user: TestUser) {
  const { data, error } = await user.client.from('week_closures').select('*').order('week_start')
  if (error) throw new Error(error.message)
  return data
}

beforeAll(async () => {
  a = await signIn('A')
  b = await signIn('B')
})

beforeEach(async () => {
  await Promise.all([reset(a), reset(b)])
})

afterAll(async () => {
  if (a) await reset(a)
  if (b) await reset(b)
})

describe('closing a week', () => {
  // Worked example: 150 allowance, 40 spent. Protects 110: P 310, C 960, B 200,
  // and 450 free over the remaining 21 days suggests 150 again.
  test('the worked example, exactly', async () => {
    const accountId = await start(a)
    await insertPurchase(a.client, accountId, spend('2026-10-06', 4000))

    const week = weekAccount((await load(a, WEEK_2)).ledger, 'USD')

    expect(week).toMatchObject({
      weekStart: WEEK_2,
      weekStartCashCents: 96000,
      protectedCents: 31000,
      commitmentsCents: 20000,
      recommendedAllowanceCents: 15000,
      previousClosure: { weekStart: WEEK_1, spentCents: 4000, leftoverCents: 11000, protectedCents: 11000 },
    })
    expect(freeCashCents({ currentCashCents: 96000, protectedCents: week.protectedCents, commitmentsCents: 20000 })).toBe(45000)
  })

  test('loading again changes nothing: one closure, the same numbers', async () => {
    await start(a)
    const once = weekAccount((await load(a, WEEK_2)).ledger, 'USD')
    const twice = weekAccount((await load(a, WEEK_2)).ledger, 'USD')
    expect(twice.protectedCents).toBe(once.protectedCents)
    expect(await closures(a)).toHaveLength(1)
  })

  test('calling the function again directly closes nothing more', async () => {
    const accountId = await start(a)
    await load(a, WEEK_2)
    const { data, error } = await a.client.rpc('close_ended_weeks', { p_account_id: accountId, p_today: WEEK_2 })
    expect(error).toBeNull()
    expect(data).toBe(0)
    expect(await closures(a)).toHaveLength(1)
  })

  test('two tabs closing at the same moment still make one closure', async () => {
    const accountId = await start(a)
    const calls = await Promise.all(
      [1, 2, 3].map(() => a.client.rpc('close_ended_weeks', { p_account_id: accountId, p_today: WEEK_2 })),
    )
    expect(calls.map((call) => call.error)).toEqual([null, null, null])
    expect(calls.map((call) => call.data).sort()).toEqual([0, 0, 1])
    expect(await closures(a)).toHaveLength(1)
  })

  test('a week still in progress does not close', async () => {
    const accountId = await start(a)
    const { data } = await a.client.rpc('close_ended_weeks', { p_account_id: accountId, p_today: addDays(WEEK_1, 6) })
    expect(data).toBe(0)
    expect(await closures(a)).toEqual([])
  })

  test('uses the allowance in force after a midweek change: 180 closes as 140 protected', async () => {
    const accountId = await start(a)
    await insertPurchase(a.client, accountId, spend('2026-10-06', 4000))
    const planId = (await load(a, WEEK_1)).weekPlanIds.USD![WEEK_1]
    await saveAllowanceChange(a.client, planId, { id: crypto.randomUUID(), madeOn: WEEK_1, fromCents: 15000, toCents: 18000, suggestedCents: null })
    expect((await closures(a)).length).toBe(0)
    expect(weekAccount((await load(a, WEEK_2)).ledger, 'USD').protectedCents).toBe(34000)
  })

  test('an overspent week protects nothing, and the numbers show why', async () => {
    const accountId = await start(a)
    await insertPurchase(a.client, accountId, spend('2026-10-06', 15500))
    const week = weekAccount((await load(a, WEEK_2)).ledger, 'USD')
    expect(week.protectedCents).toBe(20000)
    expect(week.previousClosure).toMatchObject({ leftoverCents: -500, protectedCents: 0 })
  })

  // Parity: the database and the pure rule must give the same answer. The plan
  // for week 3 is inserted directly, so its allowance can exceed free cash.
  test.each([
    { name: 'leftover capped by free cash', allowance: 90000, spent: 1000 },
    { name: 'leftover inside free cash', allowance: 10000, spent: 2500 },
    { name: 'overspent', allowance: 1000, spent: 2500 },
    { name: 'spent exactly', allowance: 2500, spent: 2500 },
  ])('matches the pure closeWeek rule: $name', async ({ allowance, spent }) => {
    const accountId = await start(a)
    // Week 1 closes, protecting 150 (P 350), and week 2 gets a 150 plan.
    await load(a, WEEK_2)
    const { error } = await a.client
      .from('week_plans')
      .insert({ account_id: accountId, week_start: WEEK_3, recommended_cents: 0, starting_allowance_cents: allowance })
    expect(error).toBeNull()
    await insertPurchase(a.client, accountId, spend(addDays(WEEK_3, 1), spent))

    const expected = closeWeek({
      currency: 'USD',
      weekStart: WEEK_3,
      allowanceCents: allowance,
      spentCents: spent,
      // Week 2 closes first with nothing spent, protecting another 150: P 500.
      // Cash 1000 - spent, B 200.
      freeCents: 100000 - spent - 50000 - 20000,
      closures: [],
    })
    if (expected.kind !== 'closed') throw new Error('expected a closure')

    const { error: closeError } = await a.client.rpc('close_ended_weeks', { p_account_id: accountId, p_today: addDays(WEEK_3, 7) })
    expect(closeError).toBeNull()
    const row = (await closures(a)).find((closure) => closure.week_start === WEEK_3)
    expect(row).toMatchObject({
      allowance_cents: expected.closure.allowanceCents,
      spent_cents: expected.closure.spentCents,
      leftover_cents: expected.closure.leftoverCents,
      protected_cents: expected.closure.protectedCents,
    })
  })

  test('closes oldest first, and invents nothing for a week with no plan', async () => {
    const accountId = await start(a)
    // Weeks 1 and 3 are planned; week 2 was never opened.
    await a.client
      .from('week_plans')
      .insert({ account_id: accountId, week_start: WEEK_3, recommended_cents: 0, starting_allowance_cents: 5000 })
    await load(a, addDays(WEEK_3, 7))
    expect((await closures(a)).map((closure) => closure.week_start)).toEqual([WEEK_1, WEEK_3])
  })

  test('a date ahead of the database clock is refused', async () => {
    const accountId = await start(a)
    const future = addDays(new Date().toISOString().slice(0, 10), 3)
    const { error } = await a.client.rpc('close_ended_weeks', { p_account_id: accountId, p_today: future })
    expect(error?.code).toBe('22023')
  })

  test('after the plan end date, the last week closes and no plan is invented', async () => {
    await start(a)
    const { ledger } = await load(a, '2026-11-02')
    expect(ledger.accounts.USD!.weeks.map((week) => week.weekStart)).toEqual([WEEK_1])
    expect(await closures(a)).toHaveLength(1)
  })

  test('USD closing leaves BSD alone', async () => {
    await start(a)
    await start(a, { ...usd, currency: 'BSD', openingDate: WEEK_2, cashCents: 34550, protectedCents: 5000, commitmentsCents: 12000, recommendedCents: 4000, allowanceCents: 4000 })
    const { ledger } = await load(a, addDays(WEEK_2, 1))
    expect(ledger.accounts.USD!.closures).toHaveLength(1)
    expect(ledger.accounts.BSD!.closures).toEqual([])
    expect(weekAccount(ledger, 'BSD').protectedCents).toBe(5000)
  })
})

describe('closed weeks stay as they are', () => {
  let accountId: string
  let closedPurchase: Purchase

  beforeEach(async () => {
    accountId = await start(a)
    closedPurchase = spend('2026-10-06', 4000)
    await insertPurchase(a.client, accountId, closedPurchase)
    await load(a, WEEK_2)
  })

  const unchanged = async () => {
    const { data } = await a.client.from('purchases').select('id, cents, date')
    expect(data).toEqual([{ id: closedPurchase.id, cents: 4000, date: '2026-10-06' }])
  }

  test('adding to a closed week is refused', async () => {
    const result = await insertPurchase(a.client, accountId, spend('2026-10-07', 100))
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('closed') })
    await unchanged()
  })

  test('editing a purchase in a closed week is refused', async () => {
    expect((await updatePurchaseRow(a.client, { ...closedPurchase, cents: 1 })).ok).toBe(false)
    await unchanged()
  })

  test('moving a purchase out of a closed week is refused', async () => {
    expect((await updatePurchaseRow(a.client, { ...closedPurchase, date: WEEK_2 })).ok).toBe(false)
    await unchanged()
  })

  test('moving a purchase into a closed week is refused', async () => {
    const open = spend(WEEK_2, 300)
    await insertPurchase(a.client, accountId, open)
    expect((await updatePurchaseRow(a.client, { ...open, date: '2026-10-06' })).ok).toBe(false)
  })

  test('deleting a purchase in a closed week is refused', async () => {
    expect((await deletePurchaseRow(a.client, closedPurchase.id)).ok).toBe(false)
    await unchanged()
  })

  test('changing the allowance of a closed week is refused', async () => {
    const planId = (await load(a, WEEK_2)).weekPlanIds.USD![WEEK_1]
    const result = await saveAllowanceChange(a.client, planId, { id: crypto.randomUUID(), madeOn: WEEK_2, fromCents: 15000, toCents: 1000, suggestedCents: null })
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('closed') })
  })

  test('the open week can still be changed', async () => {
    const open = spend(WEEK_2, 300)
    expect(await insertPurchase(a.client, accountId, open)).toEqual({ ok: true })
    expect(await updatePurchaseRow(a.client, { ...open, cents: 400 })).toEqual({ ok: true })
    expect(await deletePurchaseRow(a.client, open.id)).toEqual({ ok: true })
  })

  test('a student can still delete their whole account, closed weeks included', async () => {
    const { error } = await a.client.from('accounts').delete().eq('id', accountId)
    expect(error).toBeNull()
    expect(await closures(a)).toEqual([])
    const { data } = await a.client.from('purchases').select('id')
    expect(data).toEqual([])
  })
})

test('a purchase dated before the account opened is refused by the database', async () => {
  const accountId = await start(a, { ...usd, openingDate: '2026-10-07' })
  expect((await insertPurchase(a.client, accountId, spend('2026-10-06', 100))).ok).toBe(false)
  expect(await insertPurchase(a.client, accountId, spend('2026-10-07', 100))).toEqual({ ok: true })
})

describe('releasing savings', () => {
  const release = (cents: number) => ({ id: crypto.randomUUID(), madeOn: WEEK_1, cents })

  test('releasing 50 of 200: P 150, F up by 50, cash and allowance unchanged, and it survives a reload', async () => {
    const accountId = await start(a)
    expect(await saveRelease(a.client, accountId, release(5000))).toEqual({ ok: true })
    expect(weekAccount((await load(a, WEEK_1)).ledger, 'USD')).toMatchObject({
      protectedCents: 15000,
      weekStartCashCents: 100000,
      chosenAllowanceCents: 15000,
    })
  })

  test('retrying the same release records it once', async () => {
    const accountId = await start(a)
    const once = release(5000)
    await saveRelease(a.client, accountId, once)
    expect(await saveRelease(a.client, accountId, once)).toEqual({ ok: true })
    expect(weekAccount((await load(a, WEEK_1)).ledger, 'USD').protectedCents).toBe(15000)
  })

  test('exactly what is protected is allowed; one cent more is refused', async () => {
    const accountId = await start(a)
    expect((await saveRelease(a.client, accountId, release(20001))).ok).toBe(false)
    expect(await saveRelease(a.client, accountId, release(20000))).toEqual({ ok: true })
    expect((await saveRelease(a.client, accountId, release(1))).ok).toBe(false)
  })

  test('several releases at the same moment cannot take out more than is protected', async () => {
    const accountId = await start(a)
    const results = await Promise.all([1, 2, 3].map(() => saveRelease(a.client, accountId, release(15000))))
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(weekAccount((await load(a, WEEK_1)).ledger, 'USD').protectedCents).toBe(5000)
  })

  test('zero or negative amounts are refused', async () => {
    const accountId = await start(a)
    expect((await saveRelease(a.client, accountId, release(0))).ok).toBe(false)
    expect((await saveRelease(a.client, accountId, release(-500))).ok).toBe(false)
    expect(weekAccount((await load(a, WEEK_1)).ledger, 'USD').protectedCents).toBe(20000)
  })

  test('released money flows into the next closure and suggestion', async () => {
    const accountId = await start(a)
    await saveRelease(a.client, accountId, release(5000))
    // Closure protects the full 150: P = 150 + 150 = 300. F = 1000 - 300 - 200 = 500.
    // floor(50000 * 7 / 21) = 16666.
    expect(weekAccount((await load(a, WEEK_2)).ledger, 'USD')).toMatchObject({
      protectedCents: 30000,
      recommendedAllowanceCents: 16666,
    })
  })
})

describe('changing the allowance: the database applies the rule', () => {
  const to = (toCents: number) => ({ id: crypto.randomUUID(), madeOn: WEEK_1, fromCents: 0, toCents, suggestedCents: null })
  let accountId: string
  let planId: string

  beforeEach(async () => {
    accountId = await start(a)
    await insertPurchase(a.client, accountId, spend(WEEK_1, 4000))
    planId = (await load(a, WEEK_1)).weekPlanIds.USD![WEEK_1]
  })

  // S = 40, F = 560: a total of 600 leaves exactly the 560 that is free.
  test('compares A - S with F: 600 is allowed, 600.01 is refused', async () => {
    const refused = await saveAllowanceChange(a.client, planId, to(60001))
    expect(refused).toMatchObject({ ok: false, message: expect.stringContaining('free cash') })
    expect(await saveAllowanceChange(a.client, planId, to(60000))).toEqual({ ok: true })
  })

  test('a reduction below what is spent is allowed', async () => {
    expect(await saveAllowanceChange(a.client, planId, to(3000))).toEqual({ ok: true })
    expect(weekAccount((await load(a, WEEK_1)).ledger, 'USD').chosenAllowanceCents).toBe(3000)
  })

  test('the database records the real "from" amount, whatever the browser sent', async () => {
    const change = to(18000)
    await saveAllowanceChange(a.client, planId, change)
    const saved = weekAccount((await load(a, WEEK_1)).ledger, 'USD').allowanceChanges
    expect(saved).toEqual([{ ...change, fromCents: 15000 }])
  })
})

describe('direct writes are closed off', () => {
  test('allowance history cannot be written or rewritten directly', async () => {
    await start(a)
    const planId = (await load(a, WEEK_1)).weekPlanIds.USD![WEEK_1]
    const id = crypto.randomUUID()
    const insert = await a.client.from('allowance_changes').insert({ id, week_plan_id: planId, made_on: WEEK_1, from_cents: 0, to_cents: 999999 })
    expect(insert.error?.code).toBe('42501')

    await saveAllowanceChange(a.client, planId, { id, madeOn: WEEK_1, fromCents: 15000, toCents: 16000, suggestedCents: null })
    expect((await a.client.from('allowance_changes').update({ to_cents: 999999 }).eq('id', id)).error?.code).toBe('42501')
    expect((await a.client.from('allowance_changes').delete().eq('id', id)).error?.code).toBe('42501')
  })

  test('opening balances and plan snapshots cannot be edited', async () => {
    const accountId = await start(a)
    expect((await a.client.from('accounts').update({ opening_cash_cents: 999999 }).eq('id', accountId)).error?.code).toBe('42501')
    expect((await a.client.from('week_plans').update({ starting_allowance_cents: 999999 }).eq('account_id', accountId)).error?.code).toBe('42501')
    expect((await a.client.from('week_plans').delete().eq('account_id', accountId)).error?.code).toBe('42501')
  })

  test('closures and releases cannot be changed or removed', async () => {
    const accountId = await start(a)
    await load(a, WEEK_2)
    expect((await a.client.from('week_closures').update({ protected_cents: 0 }).eq('account_id', accountId)).error?.code).toBe('42501')
    expect((await a.client.from('week_closures').delete().eq('account_id', accountId)).error?.code).toBe('42501')
  })
})

describe('user B attacking user A through the functions', () => {
  let accountId: string
  let planId: string

  beforeEach(async () => {
    accountId = await start(a)
    await start(b)
    planId = (await load(a, WEEK_1)).weekPlanIds.USD![WEEK_1]
  })

  test("B cannot close A's week", async () => {
    const { error } = await b.client.rpc('close_ended_weeks', { p_account_id: accountId, p_today: WEEK_2 })
    expect(error?.code).toBe('42501')
    expect(await closures(a)).toEqual([])
  })

  test("B cannot release A's savings", async () => {
    expect((await saveRelease(b.client, accountId, { id: crypto.randomUUID(), madeOn: WEEK_1, cents: 100 })).ok).toBe(false)
    expect(weekAccount((await load(a, WEEK_1)).ledger, 'USD').protectedCents).toBe(20000)
  })

  test("B cannot change A's allowance", async () => {
    const result = await saveAllowanceChange(b.client, planId, { id: crypto.randomUUID(), madeOn: WEEK_1, fromCents: 15000, toCents: 1, suggestedCents: null })
    expect(result.ok).toBe(false)
    expect(weekAccount((await load(a, WEEK_1)).ledger, 'USD').chosenAllowanceCents).toBe(15000)
  })

  test("reusing A's release id is a failure, and does not touch A's row", async () => {
    const taken = { id: crypto.randomUUID(), madeOn: WEEK_1, cents: 100 }
    await saveRelease(a.client, accountId, taken)
    const bAccountId = (await load(b, WEEK_1)).accountIds.USD!
    expect((await saveRelease(b.client, bAccountId, taken)).ok).toBe(false)
    expect(weekAccount((await load(b, WEEK_1)).ledger, 'USD').protectedCents).toBe(20000)
    expect(weekAccount((await load(a, WEEK_1)).ledger, 'USD').protectedCents).toBe(19900)
  })

  test("reusing A's allowance change id is a failure", async () => {
    const taken = { id: crypto.randomUUID(), madeOn: WEEK_1, fromCents: 15000, toCents: 14000, suggestedCents: null }
    await saveAllowanceChange(a.client, planId, taken)
    const bPlanId = (await load(b, WEEK_1)).weekPlanIds.USD![WEEK_1]
    expect((await saveAllowanceChange(b.client, bPlanId, taken)).ok).toBe(false)
  })

  test('B never sees A in the data the functions touch', async () => {
    await load(a, WEEK_2)
    expect(await closures(b)).toEqual([])
  })

  test('the private helpers cannot be reached from the browser', async () => {
    const { error } = await b.client.schema('private').rpc('protected_cents', { p_account_id: accountId })
    expect(error).not.toBeNull()
  })

  test('a signed-out visitor cannot call any of the functions', async () => {
    const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const close = await anon.rpc('close_ended_weeks', { p_account_id: accountId, p_today: WEEK_2 })
    const free = await anon.rpc('release_savings', { p_id: crypto.randomUUID(), p_account_id: accountId, p_made_on: WEEK_1, p_cents: 1 })
    const change = await anon.rpc('change_allowance', { p_id: crypto.randomUUID(), p_week_plan_id: planId, p_made_on: WEEK_1, p_to_cents: 1, p_suggested_cents: null })
    expect([close.error?.code, free.error?.code, change.error?.code]).toEqual(['42501', '42501', '42501'])
  })
})
