// Balance corrections through the real data layer, as the test users, using the
// publishable key only. Fictional data only.
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { createAccount, deleteCorrectionRow, exportOwnData, insertCorrection, loadLedger, saveAllowanceChange, type NewAccount } from '../../src/data/ledgerStore'
import type { BalanceCorrection } from '../../src/domain/correction'
import { accountCash, weekAccount } from '../../src/domain/ledger'
import { signIn, type TestUser } from './clients.ts'

let a: TestUser
let b: TestUser

const WEEK_1 = '2026-10-19'
const WEEK_2 = '2026-10-26'

// C 960, P 200, B 200, F 560.
const usd: NewAccount = {
  currency: 'USD',
  openingDate: WEEK_1,
  cashCents: 96000,
  protectedCents: 20000,
  commitmentsCents: 20000,
  planEndDate: '2026-11-15',
  recommendedCents: 15000,
  allowanceCents: 15000,
}

const correction = (overrides: Partial<BalanceCorrection> = {}): BalanceCorrection => ({
  id: crypto.randomUUID(),
  date: WEEK_1,
  differenceCents: -2000,
  note: 'Fictional bank fee',
  ...overrides,
})

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

/** Saves as the form does: with the cash the student can see right now. */
async function save(user: TestUser, accountId: string, saved: BalanceCorrection) {
  const seen = (await load(user)).ledger.accounts.USD
  return insertCorrection(user.client, accountId, saved, seen ? accountCash(seen).currentCashCents : 0)
}

/** The database's own free cash, found from its allowance rule, with nothing spent. */
async function expectDatabaseFreeCash(user: TestUser, cents: number) {
  const plan = (await load(user)).weekPlanIds.USD![WEEK_1]
  const change = (toCents: number) =>
    saveAllowanceChange(user.client, plan, { id: crypto.randomUUID(), madeOn: WEEK_1, fromCents: 0, toCents, suggestedCents: null })
  expect((await change(cents + 1)).ok).toBe(false)
  expect(await change(cents)).toEqual({ ok: true })
}

beforeAll(async () => {
  a = await signIn('A')
  b = await signIn('B')
})

afterAll(async () => {
  if (a) await reset(a)
  if (b) await reset(b)
})

describe('recording a correction', () => {
  let accountId: string

  beforeEach(async () => {
    accountId = await start(a)
  })

  test('comes back with every field', async () => {
    const saved = correction()
    expect(await save(a, accountId, saved)).toEqual({ ok: true })
    expect(weekAccount((await load(a)).ledger, 'USD').corrections).toEqual([saved])
  })

  test('without a note, none comes back', async () => {
    const { note: _note, ...withoutNote } = correction()
    await save(a, accountId, withoutNote)
    expect(weekAccount((await load(a)).ledger, 'USD').corrections).toEqual([withoutNote])
  })

  test('worked example: bank says 940, free cash 540 in the database', async () => {
    await save(a, accountId, correction())
    await expectDatabaseFreeCash(a, 54000)
  })

  test('worked example: bank says 1,000, free cash 600 in the database', async () => {
    await save(a, accountId, correction({ differenceCents: 4000 }))
    await expectDatabaseFreeCash(a, 60000)
  })

  test('a retry after a lost reply saves it once and reports success', async () => {
    const saved = correction()
    await save(a, accountId, saved)
    expect(await save(a, accountId, saved)).toEqual({ ok: true })
    await expectDatabaseFreeCash(a, 54000)
  })

  test('undoing restores free cash, and undoing twice still succeeds', async () => {
    const saved = correction()
    await save(a, accountId, saved)
    expect(await deleteCorrectionRow(a.client, saved.id)).toEqual({ ok: true })
    expect(await deleteCorrectionRow(a.client, saved.id)).toEqual({ ok: true })
    await expectDatabaseFreeCash(a, 56000)
  })

  test('a saved correction cannot be edited: there is no update right', async () => {
    const saved = correction()
    await save(a, accountId, saved)
    const { error } = await a.client.from('balance_corrections').update({ difference_cents: 1 }).eq('id', saved.id)
    expect(error?.code).toBe('42501')
  })

  test('USD corrections leave a BSD account alone', async () => {
    expect((await createAccount(a.client, { ...usd, currency: 'BSD' })).ok).toBe(true)
    await save(a, accountId, correction())
    const { ledger } = await load(a)
    expect(weekAccount(ledger, 'USD').corrections).toHaveLength(1)
    expect(weekAccount(ledger, 'BSD').corrections).toEqual([])
  })

  test('a date still to come gets its own message', async () => {
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
    expect(await save(a, accountId, correction({ date: future }))).toEqual({
      ok: false,
      message: 'A correction can only be dated today or earlier.',
    })
  })

  test('a date before the account opened is refused', async () => {
    expect((await save(a, accountId, correction({ date: '2026-10-18' }))).ok).toBe(false)
  })

  test('zero and oversized amounts are refused, in either direction', async () => {
    for (const differenceCents of [0, 10000001, -10000001]) {
      expect((await save(a, accountId, correction({ differenceCents }))).ok).toBe(false)
    }
    for (const differenceCents of [10000000, -10000000]) {
      expect((await save(a, accountId, correction({ differenceCents }))).ok).toBe(true)
    }
  })

  test('a note that is too long is refused', async () => {
    expect((await save(a, accountId, correction({ note: 'x'.repeat(121) }))).ok).toBe(false)
  })

  test('appears in the export, without the owner id', async () => {
    const saved = correction()
    await save(a, accountId, saved)
    const result = await exportOwnData(a.client, '2026-11-05T12:00:00.000Z')
    if (!result.ok) throw new Error(result.message)
    expect(result.file.balance_corrections).toHaveLength(1)
    expect(result.file.balance_corrections[0]).toMatchObject({ id: saved.id, corrected_on: WEEK_1, difference_cents: -2000, note: 'Fictional bank fee' })
    expect(JSON.stringify(result.file.balance_corrections)).not.toContain('user_id')
  })
})

describe('corrections and closing a week', () => {
  let accountId: string

  beforeEach(async () => {
    accountId = await start(a)
  })

  test('counted in the week it is dated: cash carries over, and the closure is unaffected while it fits', async () => {
    await save(a, accountId, correction())
    const week = weekAccount((await load(a, WEEK_2)).ledger, 'USD')
    expect(week.weekStartCashCents).toBe(94000)
    expect(week.previousClosure).toMatchObject({ spentCents: 0, leftoverCents: 15000, protectedCents: 15000 })
  })

  test('worked example: bank says 350, free cash -50, so the week protects nothing', async () => {
    await save(a, accountId, correction({ differenceCents: -61000 }))
    expect(weekAccount((await load(a, WEEK_2)).ledger, 'USD').previousClosure).toMatchObject({ leftoverCents: 15000, protectedCents: 0 })
  })

  test('dated after the week ended, it does not limit that week', async () => {
    // The real order: a week's plan exists before anything can be dated in it.
    await a.client.from('week_plans').insert({ account_id: accountId, week_start: WEEK_2, recommended_cents: 0, starting_allowance_cents: 0 })
    await save(a, accountId, correction({ date: WEEK_2, differenceCents: -61000 }))
    const week = weekAccount((await load(a, WEEK_2)).ledger, 'USD')
    expect(week.previousClosure).toMatchObject({ protectedCents: 15000 })
    expect(week.corrections).toHaveLength(1)
  })

  test('adding to or undoing in a closed week is refused, and the closure keeps its amounts', async () => {
    const saved = correction()
    await save(a, accountId, saved)
    const closed = weekAccount((await load(a, WEEK_2)).ledger, 'USD')
    expect((await save(a, accountId, correction())).ok).toBe(false)
    expect((await deleteCorrectionRow(a.client, saved.id)).ok).toBe(false)
    expect(weekAccount((await load(a, WEEK_2)).ledger, 'USD')).toEqual(closed)
  })

  test('deleting the whole account still works, even with a correction in a closed week', async () => {
    await save(a, accountId, correction())
    await load(a, WEEK_2)
    expect((await a.client.from('accounts').delete().eq('id', accountId)).error).toBeNull()
    expect((await a.client.from('balance_corrections').select('id')).data).toEqual([])
  })
})

describe('user B and signed-out visitors', () => {
  let accountId: string
  let bAccountId: string
  let saved: BalanceCorrection

  beforeEach(async () => {
    accountId = await start(a)
    bAccountId = await start(b)
    saved = correction()
    await save(a, accountId, saved)
  })

  test("B sees none of A's corrections", async () => {
    const asB = await b.client.from('balance_corrections').select('id')
    expect(asB.error).toBeNull()
    expect(asB.data).toEqual([])
  })

  test("B cannot undo A's correction", async () => {
    await deleteCorrectionRow(b.client, saved.id)
    expect(weekAccount((await load(a)).ledger, 'USD').corrections).toEqual([saved])
  })

  test("B cannot add to A's account, by link or by claiming to be A", async () => {
    expect((await save(b, accountId, correction())).ok).toBe(false)
    const claimed = await b.client.from('balance_corrections').insert({
      id: crypto.randomUUID(), user_id: a.userId, account_id: accountId, corrected_on: WEEK_1, difference_cents: 100,
    })
    expect(claimed.error?.code).toBe('42501')
    expect(weekAccount((await load(a)).ledger, 'USD').corrections).toHaveLength(1)
  })

  test("reusing A's id is a failure, not a false success", async () => {
    expect((await save(b, bAccountId, saved)).ok).toBe(false)
    expect(weekAccount((await load(b)).ledger, 'USD').corrections).toEqual([])
  })

  test('a signed-out visitor is refused', async () => {
    const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error } = await anon.from('balance_corrections').select('id')
    expect(error?.code).toBe('42501')
  })
})
