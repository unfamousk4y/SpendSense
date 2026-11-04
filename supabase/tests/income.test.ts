// Received income through the real data layer, as the test users, using the
// publishable key only. Fictional data only.
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { createAccount, deleteIncomeRow, exportOwnData, insertIncome, loadLedger, saveAllowanceChange, updateIncomeRow, type NewAccount } from '../../src/data/ledgerStore'
import type { IncomeReceipt } from '../../src/domain/income'
import { sumIncome } from '../../src/domain/income'
import { weekAccount } from '../../src/domain/ledger'
import { signIn, type TestUser } from './clients.ts'

let a: TestUser
let b: TestUser

const WEEK_1 = '2026-10-19'
const WEEK_2 = '2026-10-26'
const WEEK_3 = '2026-11-02'

const usd: NewAccount = {
  currency: 'USD',
  openingDate: WEEK_1,
  cashCents: 100000,
  protectedCents: 20000,
  commitmentsCents: 20000,
  planEndDate: '2026-11-15',
  recommendedCents: 15000,
  allowanceCents: 15000,
}

const received = (overrides: Partial<IncomeReceipt> = {}): IncomeReceipt => ({
  id: crypto.randomUUID(),
  date: WEEK_1,
  cents: 30000,
  source: 'Fictional aid',
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

/** Starts a fresh USD account and returns its id. */
async function start(user: TestUser, account: NewAccount = usd): Promise<string> {
  await reset(user)
  const created = await createAccount(user.client, account)
  if (!created.ok) throw new Error(created.message)
  return (await load(user)).accountIds[account.currency]!
}

/** Current cash, as the screen works it out. */
function cash(loaded: Awaited<ReturnType<typeof load>>, currency: 'USD' | 'BSD' = 'USD') {
  const week = weekAccount(loaded.ledger, currency)
  return week.weekStartCashCents + sumIncome(week.income) - week.purchases.reduce((total, p) => total + p.cents, 0)
}

beforeAll(async () => {
  a = await signIn('A')
  b = await signIn('B')
})

afterAll(async () => {
  if (a) await reset(a)
  if (b) await reset(b)
})

describe('recording income', () => {
  let accountId: string

  beforeEach(async () => {
    accountId = await start(a)
  })

  test('comes back with every field and raises cash by exactly that amount', async () => {
    const income = received()
    expect(await insertIncome(a.client, accountId, income)).toEqual({ ok: true })
    const loaded = await load(a)
    expect(weekAccount(loaded.ledger, 'USD').income).toEqual([income])
    expect(cash(loaded)).toBe(130000)
  })

  test('a retry after a lost reply saves it once and reports success', async () => {
    const income = received()
    await insertIncome(a.client, accountId, income)
    expect(await insertIncome(a.client, accountId, income)).toEqual({ ok: true })
    expect(cash(await load(a))).toBe(130000)
  })

  test('an edit changes the row and clearing the source clears it; deleting restores cash', async () => {
    const income = received()
    await insertIncome(a.client, accountId, income)
    const edited: IncomeReceipt = { id: income.id, date: WEEK_1, cents: 100 }
    expect(await updateIncomeRow(a.client, edited)).toEqual({ ok: true })
    const loaded = await load(a)
    expect(weekAccount(loaded.ledger, 'USD').income).toEqual([edited])
    expect(cash(loaded)).toBe(100100)

    expect(await deleteIncomeRow(a.client, income.id)).toEqual({ ok: true })
    expect(await deleteIncomeRow(a.client, income.id)).toEqual({ ok: true })
    expect(cash(await load(a))).toBe(100000)
  })

  test('USD income leaves a BSD account alone', async () => {
    const bsd = await createAccount(a.client, { ...usd, currency: 'BSD', cashCents: 50000, protectedCents: 0, commitmentsCents: 0 })
    expect(bsd.ok).toBe(true)
    await insertIncome(a.client, accountId, received())
    const loaded = await load(a)
    expect(cash(loaded, 'USD')).toBe(130000)
    expect(cash(loaded, 'BSD')).toBe(50000)
  })

  test('a future date is refused with the student-facing message', async () => {
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
    const result = await insertIncome(a.client, accountId, received({ date: future }))
    expect(result).toEqual({ ok: false, message: 'Income can only be recorded once it has been received.' })
    expect(cash(await load(a))).toBe(100000)
  })

  test('a date before the account opened is refused', async () => {
    expect((await insertIncome(a.client, accountId, received({ date: '2026-10-18' }))).ok).toBe(false)
  })

  test('zero, negative and oversized amounts are refused by the database', async () => {
    for (const cents of [0, -100, 10000001]) {
      expect((await insertIncome(a.client, accountId, received({ cents }))).ok).toBe(false)
    }
  })

  test('appears in the export', async () => {
    const income = received()
    await insertIncome(a.client, accountId, income)
    const result = await exportOwnData(a.client, '2026-11-04T12:00:00.000Z')
    if (!result.ok) throw new Error(result.message)
    expect(result.file.income_receipts).toHaveLength(1)
    expect(result.file.income_receipts[0]).toMatchObject({ id: income.id, received_on: WEEK_1, cents: 30000 })
    expect(JSON.stringify(result.file.income_receipts)).not.toContain('user_id')
  })
})

describe('income and closed weeks', () => {
  let accountId: string
  let income: IncomeReceipt

  beforeEach(async () => {
    accountId = await start(a)
    income = received()
    await insertIncome(a.client, accountId, income)
    await load(a, WEEK_2) // Closes week 1.
  })

  test('cash carries into the next week', async () => {
    expect(weekAccount((await load(a, WEEK_2)).ledger, 'USD').weekStartCashCents).toBe(130000)
  })

  test('adding, editing, moving or deleting in a closed week is refused', async () => {
    expect((await insertIncome(a.client, accountId, received())).ok).toBe(false)
    expect((await updateIncomeRow(a.client, { ...income, cents: 1 })).ok).toBe(false)
    expect((await updateIncomeRow(a.client, { ...income, date: WEEK_2 })).ok).toBe(false)
    expect((await deleteIncomeRow(a.client, income.id)).ok).toBe(false)
    expect(weekAccount((await load(a, WEEK_2)).ledger, 'USD').weekStartCashCents).toBe(130000)
  })

  test('moving income into a closed week is refused', async () => {
    const open = received({ date: WEEK_2 })
    await insertIncome(a.client, accountId, open)
    expect((await updateIncomeRow(a.client, { ...open, date: WEEK_1 })).ok).toBe(false)
  })
})

describe('the database counts income the same way the app does', () => {
  test('closure: income raises the cap when free cash was the limit', async () => {
    // Free cash without income: 1,000 - 200 - 790 = 10, so only 10 could close.
    const tight = { ...usd, commitmentsCents: 79000, recommendedCents: 1000, allowanceCents: 1000 }
    const accountId = await start(a, tight)
    const plan = (await load(a)).weekPlanIds.USD![WEEK_1]
    await insertIncome(a.client, accountId, received({ cents: 5000 }))
    const raised = await saveAllowanceChange(a.client, plan, { id: crypto.randomUUID(), madeOn: WEEK_1, fromCents: 1000, toCents: 6000, suggestedCents: null })
    expect(raised).toEqual({ ok: true })

    const closed = (await load(a, WEEK_2)).ledger
    // Allowance 60, nothing spent, free cash 10 + 50 = 60: protects all 60.
    expect(weekAccount(closed, 'USD').protectedCents).toBe(20000 + 6000)
  })

  test('allowance: income that arrived is spendable, and one cent more than free cash is refused', async () => {
    const accountId = await start(a)
    await insertIncome(a.client, accountId, received({ cents: 10000 }))
    const plan = (await load(a)).weekPlanIds.USD![WEEK_1]
    // Free cash 1,100 - 200 - 200 = 700.
    const fits = await saveAllowanceChange(a.client, plan, { id: crypto.randomUUID(), madeOn: WEEK_1, fromCents: 15000, toCents: 70000, suggestedCents: null })
    expect(fits).toEqual({ ok: true })
    const tooMuch = await saveAllowanceChange(a.client, plan, { id: crypto.randomUUID(), madeOn: WEEK_1, fromCents: 70000, toCents: 70001, suggestedCents: null })
    expect(tooMuch.ok).toBe(false)
  })

  test('the new week plan suggested from the browser includes income', async () => {
    const accountId = await start(a)
    await insertIncome(a.client, accountId, received())
    // Week 1 protects 150. Week 2: cash 1,300, P 350, B 200, F 750, over 21 days (7 this week).
    expect(weekAccount((await load(a, WEEK_2)).ledger, 'USD').recommendedAllowanceCents).toBe(25000)
  })

  test('closing two weeks in a row counts income in the right week', async () => {
    const accountId = await start(a)
    await insertIncome(a.client, accountId, received())
    await load(a, WEEK_2)
    await insertIncome(a.client, accountId, received({ date: WEEK_2, cents: 1000 }))
    expect(weekAccount((await load(a, WEEK_3)).ledger, 'USD').weekStartCashCents).toBe(131000)
  })
})

describe('user B and signed-out visitors', () => {
  let accountId: string
  let bAccountId: string
  let income: IncomeReceipt

  beforeEach(async () => {
    accountId = await start(a)
    bAccountId = await start(b)
    income = received()
    await insertIncome(a.client, accountId, income)
  })

  test("B sees none of A's income", async () => {
    const asB = await b.client.from('income_receipts').select('id')
    expect(asB.error).toBeNull()
    expect(asB.data).toEqual([])
  })

  test("B cannot change or delete A's income", async () => {
    expect((await updateIncomeRow(b.client, { ...income, cents: 1 })).ok).toBe(false)
    await deleteIncomeRow(b.client, income.id)
    expect(cash(await load(a))).toBe(130000)
  })

  test("B cannot add income to A's account, by link or by claiming to be A", async () => {
    expect((await insertIncome(b.client, accountId, received())).ok).toBe(false)
    const claimed = await b.client.from('income_receipts').insert({ id: crypto.randomUUID(), user_id: a.userId, account_id: accountId, received_on: WEEK_1, cents: 100 })
    expect(claimed.error?.code).toBe('42501')
    expect(cash(await load(a))).toBe(130000)
  })

  test("B cannot move their own income into A's account", async () => {
    const own = received()
    await insertIncome(b.client, bAccountId, own)
    const { error } = await b.client.from('income_receipts').update({ account_id: accountId }).eq('id', own.id)
    expect(error?.code).toBe('23503')
  })

  test("reusing A's id is a failure, not a false success", async () => {
    expect((await insertIncome(b.client, bAccountId, income)).ok).toBe(false)
    expect(cash(await load(b))).toBe(100000)
  })

  test('a signed-out visitor is refused', async () => {
    const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error } = await anon.from('income_receipts').select('id')
    expect(error?.code).toBe('42501')
  })
})
