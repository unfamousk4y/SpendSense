// The money split, as the test users, using the publishable key only. Fictional
// data only. Written against migration 14, so these need it applied first.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { createAccount, deleteIncomeRow, exportOwnData, insertIncome as insertIncomeRow, loadLedger, updateSplit, type NewAccount } from '../../src/data/ledgerStore'
import { accountCash } from '../../src/domain/ledger'
import { signIn, type TestUser } from './clients.ts'

let a: TestUser
let b: TestUser

const WEEK_1 = '2026-10-19'
const WEEK_2 = '2026-10-26'
const WEEK_3 = '2026-11-02'

// F starts at 1,000 - 200 - 0 = 800.
const usd: NewAccount = {
  currency: 'USD',
  openingDate: WEEK_1,
  cashCents: 100000,
  protectedCents: 20000,
  commitmentsCents: 0,
  planEndDate: '2026-11-15',
  recommendedCents: 15000,
  allowanceCents: 15000,
}

async function reset(user: TestUser) {
  const { error } = await user.client.from('accounts').delete().eq('user_id', user.userId)
  if (error) throw new Error(`Cleanup failed: ${error.message}`)
}

async function start(user: TestUser, account: NewAccount = usd): Promise<string> {
  await reset(user)
  const created = await createAccount(user.client, account)
  if (!created.ok) throw new Error(created.message)
  const { data, error } = await user.client.from('accounts').select('id').eq('currency', account.currency).single()
  if (error) throw new Error(error.message)
  return data.id
}

function insertIncome(user: TestUser, accountId: string, fields: Record<string, unknown> = {}) {
  const id = crypto.randomUUID()
  const row = { id, account_id: accountId, received_on: WEEK_1, cents: 10000, savings_cents: 2000, wants_cents: 3000, ...fields }
  return user.client.from('income_receipts').insert(row).then(({ error }) => ({ id, error }))
}

function release(user: TestUser, accountId: string, cents: number) {
  return user.client.rpc('release_savings', {
    p_id: crypto.randomUUID(),
    p_account_id: accountId,
    p_made_on: WEEK_1,
    p_cents: cents,
  })
}

beforeAll(async () => {
  a = await signIn('A')
  b = await signIn('B')
})

afterAll(async () => {
  if (a) await reset(a)
  if (b) await reset(b)
})

describe('the split on an account', () => {
  beforeEach(async () => {
    await reset(a)
  })

  test('an account made without a split gets the suggested one, with no wants yet', async () => {
    await start(a)
    const { data } = await a.client
      .from('accounts')
      .select('needs_percent, wants_percent, savings_percent, opening_wants_cents')
      .single()
    expect(data).toEqual({ needs_percent: 50, wants_percent: 30, savings_percent: 20, opening_wants_cents: 0 })
    const { data: plan } = await a.client.from('week_plans').select('wants_guide_cents').single()
    expect(plan?.wants_guide_cents).toBe(0)
  })

  test('setup saves a chosen split, the opening wants share and the first wants guide', async () => {
    const { error } = await a.client.rpc('create_account_with_plan', {
      p_currency: 'USD',
      p_opening_date: WEEK_1,
      p_opening_cash_cents: 100000,
      p_opening_protected_cents: 52000,
      p_commitments_cents: 15000,
      p_plan_end_date: '2026-11-15',
      p_recommended_cents: 8250,
      p_starting_allowance_cents: 8250,
      p_needs_percent: 50,
      p_wants_percent: 40,
      p_savings_percent: 10,
      p_opening_wants_cents: 18000,
      p_wants_guide_cents: 4500,
    })
    expect(error).toBeNull()
    const { data } = await a.client.from('accounts').select('wants_percent, savings_percent, opening_wants_cents').single()
    expect(data).toEqual({ wants_percent: 40, savings_percent: 10, opening_wants_cents: 18000 })
    const { data: plan } = await a.client.from('week_plans').select('wants_guide_cents').single()
    expect(plan?.wants_guide_cents).toBe(4500)
  })

  test('a student can change their own default split', async () => {
    const accountId = await start(a)
    const { error } = await a.client
      .from('accounts')
      .update({ needs_percent: 70, wants_percent: 30, savings_percent: 0 })
      .eq('id', accountId)
    expect(error).toBeNull()
  })

  test.each([
    ['totals under 100', { needs_percent: 50, wants_percent: 30, savings_percent: 10 }],
    ['a negative percent', { needs_percent: 120, wants_percent: -40, savings_percent: 20 }],
  ])('refuses a split with %s', async (_name, split) => {
    const accountId = await start(a)
    const { error } = await a.client.from('accounts').update(split).eq('id', accountId)
    expect(error).not.toBeNull()
  })

  test('opening shares larger than the cash are refused', async () => {
    const { error } = await a.client.from('accounts').insert({
      currency: 'USD',
      opening_date: WEEK_1,
      opening_cash_cents: 10000,
      opening_protected_cents: 6000,
      opening_wants_cents: 5000,
      plan_end_date: '2026-11-15',
    })
    expect(error).not.toBeNull()
  })

  test('opening amounts still cannot be changed directly', async () => {
    const accountId = await start(a)
    for (const change of [{ opening_cash_cents: 1 }, { opening_protected_cents: 1 }, { opening_wants_cents: 1 }]) {
      const { error } = await a.client.from('accounts').update(change).eq('id', accountId)
      expect(error).not.toBeNull()
    }
  })

  test("another student cannot change someone's split", async () => {
    const accountId = await start(a)
    const { data } = await b.client.from('accounts').update({ needs_percent: 0, wants_percent: 0, savings_percent: 100 }).eq('id', accountId).select('id')
    expect(data).toEqual([])
    const { data: mine } = await a.client.from('accounts').select('savings_percent').single()
    expect(mine?.savings_percent).toBe(20)
  })
})

describe('savings from a payment', () => {
  let accountId: string

  beforeEach(async () => {
    await reset(b)
    accountId = await start(a)
  })

  test('they count toward protected savings: 200 + 20 can be released, and no more', async () => {
    expect((await insertIncome(a, accountId)).error).toBeNull()
    expect((await release(a, accountId, 22001)).error?.code).toBe('SS002')
    expect((await release(a, accountId, 22000)).error).toBeNull()
  })

  test('a payment with no split leaves savings where they were', async () => {
    await insertIncome(a, accountId, { savings_cents: 0, wants_cents: 0 })
    expect((await release(a, accountId, 20001)).error?.code).toBe('SS002')
  })

  test('a repeated save of the same id counts once', async () => {
    const { id } = await insertIncome(a, accountId)
    const repeat = await a.client
      .from('income_receipts')
      .insert({ id, account_id: accountId, received_on: WEEK_1, cents: 10000, savings_cents: 2000, wants_cents: 3000 })
    expect(repeat.error).not.toBeNull()
    expect((await release(a, accountId, 22001)).error?.code).toBe('SS002')
  })

  test.each([
    ['shares larger than the payment', { savings_cents: 8000, wants_cents: 3000 }],
    ['a negative savings share', { savings_cents: -1 }],
    ['a negative wants share', { wants_cents: -1 }],
    ['an unknown kind of income', { income_kind: 'salary' }],
  ])('refuses %s', async (_name, fields) => {
    expect((await insertIncome(a, accountId, fields)).error).not.toBeNull()
  })

  test('deleting the payment takes its savings with it', async () => {
    const { id } = await insertIncome(a, accountId)
    expect((await a.client.from('income_receipts').delete().eq('id', id)).error).toBeNull()
    expect((await release(a, accountId, 20001)).error?.code).toBe('SS002')
  })

  test('deleting is refused once its savings have been released', async () => {
    const { id } = await insertIncome(a, accountId)
    await release(a, accountId, 22000)
    const { error } = await a.client.from('income_receipts').delete().eq('id', id)
    expect(error?.code).toBe('SS009')
  })

  test('lowering the share is refused once it has been released, but changing the source is not', async () => {
    const { id } = await insertIncome(a, accountId)
    await release(a, accountId, 22000)
    expect((await a.client.from('income_receipts').update({ savings_cents: 1000 }).eq('id', id)).error?.code).toBe('SS009')
    expect((await a.client.from('income_receipts').update({ source: 'Tutoring' }).eq('id', id)).error).toBeNull()
  })

  test('two tabs deleting at once cannot take savings below zero', async () => {
    const first = await insertIncome(a, accountId)
    const second = await insertIncome(a, accountId)
    // P = 200 + 20 + 20 = 240. After this release P = 20, so only one delete fits.
    await release(a, accountId, 22000)
    const results = await Promise.all(
      [first.id, second.id].map((id) => a.client.from('income_receipts').delete().eq('id', id)),
    )
    expect(results.filter(({ error }) => error === null)).toHaveLength(1)
    expect(results.filter(({ error }) => error?.code === 'SS009')).toHaveLength(1)
  })

  test('deleting the account still works after savings were released', async () => {
    await insertIncome(a, accountId)
    await release(a, accountId, 22000)
    const { error } = await a.client.from('accounts').delete().eq('id', accountId)
    expect(error).toBeNull()
  })

  test("another student cannot add income to someone's account", async () => {
    const { error } = await insertIncome(b, accountId)
    expect(error).not.toBeNull()
    expect((await release(a, accountId, 20001)).error?.code).toBe('SS002')
  })

  test("another student cannot change or delete someone's payment", async () => {
    const { id } = await insertIncome(a, accountId)
    const changed = await b.client.from('income_receipts').update({ savings_cents: 0 }).eq('id', id).select('id')
    const deleted = await b.client.from('income_receipts').delete().eq('id', id).select('id')
    expect(changed.data).toEqual([])
    expect(deleted.data).toEqual([])
    expect((await release(a, accountId, 22000)).error).toBeNull()
  })

  test('forging another owner on a payment is refused', async () => {
    const { error } = await insertIncome(a, accountId, { user_id: b.userId })
    expect(error).not.toBeNull()
  })
})

describe('savings during a shortfall', () => {
  // 1,000 cash, 200 protected, a 900 bill: F = -100.
  let accountId: string

  beforeEach(async () => {
    accountId = await start(a, { ...usd, commitmentsCents: 90000, recommendedCents: 0, allowanceCents: 0 })
  })

  test('a share that would leave free cash below zero is refused', async () => {
    // 100 in brings F to 0, so even 0.01 set aside is too much.
    expect((await insertIncome(a, accountId, { savings_cents: 1, wants_cents: 0 })).error?.code).toBe('SS010')
  })

  test('the same payment with nothing set aside is fine', async () => {
    expect((await insertIncome(a, accountId, { savings_cents: 0, wants_cents: 0 })).error).toBeNull()
  })

  test('savings up to exactly the free cash are fine', async () => {
    // 150 in brings F to 50.
    expect((await insertIncome(a, accountId, { cents: 15000, savings_cents: 5000, wants_cents: 0 })).error).toBeNull()
  })

  test('an old payment can still be edited when its savings do not grow', async () => {
    const { id } = await insertIncome(a, accountId, { cents: 15000, savings_cents: 5000, wants_cents: 0 })
    await a.client.from('purchases').insert({ id: crypto.randomUUID(), account_id: accountId, date: WEEK_1, cents: 10000 })
    expect((await a.client.from('income_receipts').update({ source: 'Tutoring' }).eq('id', id)).error).toBeNull()
    expect((await a.client.from('income_receipts').update({ savings_cents: 5001 }).eq('id', id)).error?.code).toBe('SS010')
  })
})

describe('closing a week', () => {
  test('savings from a later week do not reduce what an earlier week protects', async () => {
    // 100 cash and a 100 allowance, so the closure is capped by F = 100 exactly.
    const accountId = await start(a, { ...usd, cashCents: 10000, protectedCents: 0, recommendedCents: 10000, allowanceCents: 10000 })
    await a.client.from('week_plans').insert({ account_id: accountId, week_start: WEEK_2, recommended_cents: 0, starting_allowance_cents: 0 })
    await insertIncome(a, accountId, { received_on: WEEK_2, cents: 5000, savings_cents: 1000, wants_cents: 0 })

    expect((await a.client.rpc('close_ended_weeks', { p_account_id: accountId, p_today: WEEK_2 })).error).toBeNull()

    const { data } = await a.client.from('week_closures').select('protected_cents').eq('week_start', WEEK_1).single()
    expect(data?.protected_cents).toBe(10000)
  })

  test('a payment in a closed week cannot be changed or deleted', async () => {
    const accountId = await start(a)
    const { id } = await insertIncome(a, accountId)
    await a.client.rpc('close_ended_weeks', { p_account_id: accountId, p_today: WEEK_2 })
    expect((await a.client.from('income_receipts').update({ savings_cents: 0 }).eq('id', id)).error?.code).toBe('SS001')
    expect((await a.client.from('income_receipts').delete().eq('id', id)).error?.code).toBe('SS001')
  })
})

describe('starting a new plan and exporting', () => {
  test('a new plan can save a wants guide with its first week', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const accountId = await start(a, { ...usd, planEndDate: WEEK_3 })
    const { error } = await a.client.rpc('start_new_plan', {
      p_account_id: accountId,
      p_today: today,
      p_end_date: '2027-06-30',
      p_recommended_cents: 5000,
      p_starting_allowance_cents: 5000,
      p_wants_guide_cents: 1500,
    })
    expect(error).toBeNull()
    const { data } = await a.client.from('week_plans').select('wants_guide_cents').order('week_start', { ascending: false }).limit(1).single()
    expect(data?.wants_guide_cents).toBe(1500)
  })

  test('the export includes the split and the confirmed amounts', async () => {
    const accountId = await start(a)
    await insertIncome(a, accountId, { income_kind: 'regular' })
    const result = await exportOwnData(a.client, '2026-11-06T00:00:00Z')
    if (!result.ok) throw new Error(result.message)
    expect(result.file.accounts[0]).toMatchObject({ needs_percent: 50, wants_percent: 30, savings_percent: 20, opening_wants_cents: 0 })
    expect(result.file.income_receipts[0]).toMatchObject({ income_kind: 'regular', savings_cents: 2000, wants_cents: 3000 })
    expect(result.file.week_plans[0]).toHaveProperty('wants_guide_cents', 0)
  })
})

describe('through the real data layer', () => {
  const split = { needsPercent: 60, wantsPercent: 30, savingsPercent: 10 }

  async function ledgerOf(user: TestUser) {
    const result = await loadLedger(user.client, WEEK_1)
    if (!result.ok) throw new Error(result.message)
    return result.loaded.ledger.accounts.USD!
  }

  test('setup saves the split, opening wants and guide, and they load back', async () => {
    await start(a, { ...usd, split, openingWantsCents: 18000, wantsGuideCents: 4500 })
    const account = await ledgerOf(a)
    expect(account.split).toEqual(split)
    expect(account.openingWantsCents).toBe(18000)
    expect(account.weeks[0].wantsGuideCents).toBe(4500)
  })

  test('a split payment saves, loads back and counts toward protected savings', async () => {
    const accountId = await start(a)
    const income = { id: crypto.randomUUID(), date: WEEK_1, cents: 10000, kind: 'regular' as const, savingsCents: 2000, wantsCents: 3000 }
    expect(await insertIncomeRow(a.client, accountId, income)).toEqual({ ok: true })
    const account = await ledgerOf(a)
    expect(account.income).toEqual([income])
    expect(accountCash(account)).toEqual({ currentCashCents: 110000, protectedCents: 22000 })
  })

  test('an unsplit one-off reads back exactly as it was saved', async () => {
    const accountId = await start(a)
    const income = { id: crypto.randomUUID(), date: WEEK_1, cents: 10000 }
    await insertIncomeRow(a.client, accountId, income)
    expect((await ledgerOf(a)).income).toEqual([income])
  })

  test('changing the default split leaves earlier payments as they were', async () => {
    const accountId = await start(a)
    const income = { id: crypto.randomUUID(), date: WEEK_1, cents: 10000, savingsCents: 2000, wantsCents: 3000 }
    await insertIncomeRow(a.client, accountId, income)
    expect(await updateSplit(a.client, accountId, split)).toEqual({ ok: true })
    const account = await ledgerOf(a)
    expect(account.split).toEqual(split)
    expect(account.income).toEqual([income])
  })

  test('updateSplit reports failure for an account owned by someone else', async () => {
    const accountId = await start(a)
    expect((await updateSplit(b.client, accountId, split)).ok).toBe(false)
  })

  test('the database refusals reach the student as plain messages', async () => {
    const accountId = await start(a)
    const income = { id: crypto.randomUUID(), date: WEEK_1, cents: 10000, savingsCents: 2000 }
    await insertIncomeRow(a.client, accountId, income)
    await release(a, accountId, 22000)
    const refused = await deleteIncomeRow(a.client, income.id)
    expect(refused).toEqual({
      ok: false,
      message: 'Some of the savings from this payment have already been released, so it cannot be changed that way. Reload the page to see the latest.',
    })
  })
})
