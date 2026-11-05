// Starting a new plan through the real data layer, as the test users, using the
// publishable key only. Fictional data only.
//
// The database refuses a "today" more than a day from its own clock, so these
// tests use the real date, with accounts whose plans ended in the past.
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { createAccount, insertBill, loadLedger, startNewPlan, type NewAccount } from '../../src/data/ledgerStore'
import { addDays, mondayOf } from '../../src/domain/dates'
import { accountCash, weekAccount } from '../../src/domain/ledger'
import { previewNewPlan } from '../../src/domain/newPlan'
import { signIn, type TestUser } from './clients.ts'

let a: TestUser
let b: TestUser

const TODAY = new Date().toISOString().slice(0, 10)
const PAST_END = '2026-10-18'
const STILL_RUNNING = 'Your plan is still running. Reload the page to see the latest.'
const TOO_MUCH = 'That does not fit inside your free cash now. Reload the page to see the latest.'

// Cash 810, savings 310, and an allowance of 0, so closing its week protects nothing.
const ended: NewAccount = {
  currency: 'USD',
  openingDate: '2026-10-05',
  cashCents: 81000,
  protectedCents: 31000,
  commitmentsCents: 0,
  planEndDate: PAST_END,
  recommendedCents: 0,
  allowanceCents: 0,
}

async function reset(user: TestUser) {
  const { error } = await user.client.from('accounts').delete().eq('user_id', user.userId)
  if (error) throw new Error(`Cleanup failed: ${error.message}`)
}

async function load(user: TestUser) {
  const result = await loadLedger(user.client, TODAY)
  if (!result.ok) throw new Error(result.message)
  return result.loaded
}

async function start(user: TestUser, account: NewAccount = ended): Promise<string> {
  await reset(user)
  const created = await createAccount(user.client, account)
  if (!created.ok) throw new Error(created.message)
  return (await load(user)).accountIds[account.currency]!
}

/** Phone 50, due before the old end date, and a deposit of 300 due in 40 days. */
async function addBills(user: TestUser, accountId: string) {
  await insertBill(user.client, accountId, { id: crypto.randomUUID(), name: 'Fictional phone', dueOn: '2026-10-10', cents: 5000 })
  await insertBill(user.client, accountId, { id: crypto.randomUUID(), name: 'Fictional deposit', dueOn: addDays(TODAY, 40), cents: 30000 })
}

const week = (allowanceCents: number, recommendedCents = allowanceCents) => ({ recommendedCents, allowanceCents })

beforeAll(async () => {
  a = await signIn('A')
  b = await signIn('B')
})

afterAll(async () => {
  if (a) await reset(a)
  if (b) await reset(b)
})

describe('starting a new plan in a week with no plan', () => {
  let accountId: string

  beforeEach(async () => {
    accountId = await start(a)
    await addBills(a, accountId)
  })

  test('an account past its end date has no plan this week until one is started', async () => {
    const { ledger } = await load(a)
    expect(ledger.accounts.USD!.weeks.some((plan) => plan.weekStart === mondayOf(TODAY))).toBe(false)
  })

  test('worked example, deposit inside the plan: free cash 150 is the limit', async () => {
    const end = addDays(TODAY, 60)
    expect((await startNewPlan(a.client, accountId, TODAY, end, week(15001))).ok).toBe(false)
    expect(await startNewPlan(a.client, accountId, TODAY, end, week(15000))).toEqual({ ok: true })
    const account = weekAccount((await load(a)).ledger, 'USD')
    expect(account).toMatchObject({ planEndDate: end, commitmentsCents: 35000, chosenAllowanceCents: 15000, weekStart: mondayOf(TODAY) })
  })

  test('worked example, deposit after the plan: free cash 450 is the limit', async () => {
    const end = addDays(TODAY, 20)
    expect(await startNewPlan(a.client, accountId, TODAY, end, week(45001))).toEqual({ ok: false, message: TOO_MUCH })
    expect(await startNewPlan(a.client, accountId, TODAY, end, week(45000))).toEqual({ ok: true })
    expect(weekAccount((await load(a)).ledger, 'USD').commitmentsCents).toBe(5000)
  })

  test('a refused allowance leaves the end date where it was', async () => {
    await startNewPlan(a.client, accountId, TODAY, addDays(TODAY, 60), week(15001))
    expect((await load(a)).ledger.accounts.USD!.planEndDate).toBe(PAST_END)
  })

  test('the suggestion the browser previews is accepted by the database', async () => {
    const end = addDays(TODAY, 60)
    const account = (await load(a)).ledger.accounts.USD!
    const preview = previewNewPlan({ today: TODAY, endDate: end, ...accountCash(account), bills: account.bills, spentCents: 0 })
    if (preview.kind !== 'ok') throw new Error('Expected a preview')
    expect(preview).toMatchObject({ commitmentsCents: 35000, freeCents: 15000, shortfallCents: 0 })
    expect(await startNewPlan(a.client, accountId, TODAY, end, week(preview.suggestedCents))).toEqual({ ok: true })
  })

  test('saving it again changes nothing, even with a different allowance', async () => {
    const end = addDays(TODAY, 60)
    await startNewPlan(a.client, accountId, TODAY, end, week(10000))
    expect(await startNewPlan(a.client, accountId, TODAY, end, week(5000))).toEqual({ ok: true })
    const { ledger } = await load(a)
    expect(weekAccount(ledger, 'USD').chosenAllowanceCents).toBe(10000)
    expect(ledger.accounts.USD!.weeks.filter((plan) => plan.weekStart === mondayOf(TODAY))).toHaveLength(1)
  })

  test('a week with no plan must be given an allowance', async () => {
    expect((await startNewPlan(a.client, accountId, TODAY, addDays(TODAY, 60))).ok).toBe(false)
    expect((await load(a)).ledger.accounts.USD!.planEndDate).toBe(PAST_END)
  })

  test('a negative allowance is refused', async () => {
    expect((await startNewPlan(a.client, accountId, TODAY, addDays(TODAY, 60), week(-100))).ok).toBe(false)
  })

  test('a plan that cannot cover its bills allows nothing above zero', async () => {
    await insertBill(a.client, accountId, { id: crypto.randomUUID(), name: 'Fictional fee', dueOn: addDays(TODAY, 1), cents: 30000 })
    const end = addDays(TODAY, 60)
    // Free cash 810 - 310 - 650 = -150.
    expect((await startNewPlan(a.client, accountId, TODAY, end, week(1, 0))).ok).toBe(false)
    expect(await startNewPlan(a.client, accountId, TODAY, end, week(0))).toEqual({ ok: true })
  })

  test('dates: an end before today, and a today that is not today, are refused', async () => {
    expect((await startNewPlan(a.client, accountId, TODAY, addDays(TODAY, -1), week(0))).ok).toBe(false)
    expect((await startNewPlan(a.client, accountId, addDays(TODAY, 3), addDays(TODAY, 60), week(0))).ok).toBe(false)
    expect((await startNewPlan(a.client, accountId, addDays(TODAY, -3), addDays(TODAY, 60), week(0))).ok).toBe(false)
    expect((await load(a)).ledger.accounts.USD!.planEndDate).toBe(PAST_END)
  })

  test('history carries over: an earlier closure is unchanged', async () => {
    const withAllowance = await start(a, { ...ended, recommendedCents: 1000, allowanceCents: 1000 })
    const closures = (await load(a)).ledger.accounts.USD!.closures
    expect(closures).toHaveLength(1)
    expect(closures[0]).toMatchObject({ protectedCents: 1000 })
    await startNewPlan(a.client, withAllowance, TODAY, addDays(TODAY, 60), week(0))
    expect((await load(a)).ledger.accounts.USD!.closures).toEqual(closures)
  })

  test('USD leaves a BSD account alone', async () => {
    expect((await createAccount(a.client, { ...ended, currency: 'BSD' })).ok).toBe(true)
    await startNewPlan(a.client, accountId, TODAY, addDays(TODAY, 60), week(0))
    expect((await load(a)).ledger.accounts.BSD!.planEndDate).toBe(PAST_END)
  })
})

describe('starting a new plan in a week that has one', () => {
  // Ends today, so this week's plan already exists from the load.
  const endsToday: NewAccount = { ...ended, openingDate: mondayOf(TODAY), planEndDate: TODAY, recommendedCents: 2000, allowanceCents: 2000 }

  test('moves the date and keeps the allowance, whatever is sent', async () => {
    const accountId = await start(a, endsToday)
    const end = addDays(TODAY, 60)
    expect(await startNewPlan(a.client, accountId, TODAY, end, week(9000))).toEqual({ ok: true })
    expect(weekAccount((await load(a)).ledger, 'USD')).toMatchObject({ planEndDate: end, chosenAllowanceCents: 2000 })
  })

  test('needs no allowance', async () => {
    const accountId = await start(a, endsToday)
    expect(await startNewPlan(a.client, accountId, TODAY, addDays(TODAY, 60))).toEqual({ ok: true })
  })

  test('a plan that has not reached its last day is refused', async () => {
    const running = addDays(TODAY, 5)
    const accountId = await start(a, { ...endsToday, planEndDate: running })
    expect(await startNewPlan(a.client, accountId, TODAY, addDays(TODAY, 60))).toEqual({ ok: false, message: STILL_RUNNING })
    expect((await load(a)).ledger.accounts.USD!.planEndDate).toBe(running)
  })
})

describe('user B and signed-out visitors', () => {
  let accountId: string

  beforeEach(async () => {
    accountId = await start(a)
    await start(b)
  })

  test("B cannot start a plan on A's account", async () => {
    expect((await startNewPlan(b.client, accountId, TODAY, addDays(TODAY, 60), week(0))).ok).toBe(false)
    const { ledger } = await load(a)
    expect(ledger.accounts.USD!.planEndDate).toBe(PAST_END)
    expect(ledger.accounts.USD!.weeks.some((plan) => plan.weekStart === mondayOf(TODAY))).toBe(false)
  })

  test('nobody can change the end date directly, even on their own account', async () => {
    const { error } = await a.client.from('accounts').update({ plan_end_date: addDays(TODAY, 60) }).eq('id', accountId)
    expect(error?.code).toBe('42501')
  })

  test('a signed-out visitor is refused', async () => {
    const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error } = await anon.rpc('start_new_plan', {
      p_account_id: accountId,
      p_today: TODAY,
      p_end_date: addDays(TODAY, 60),
      p_recommended_cents: 0,
      p_starting_allowance_cents: 0,
    })
    expect(error?.code).toBe('42501')
  })
})
