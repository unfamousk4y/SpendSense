// Dated bills through the real data layer, as the test users, using the
// publishable key only. Fictional data only.
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { createAccount, deleteBillRow, exportOwnData, insertBill, loadLedger, payBillKeepRest, payBillRow, saveAllowanceChange, undoBillPaymentRow, updateBillRow, type NewAccount } from '../../src/data/ledgerStore'
import type { Bill } from '../../src/domain/bills'
import { weekAccount } from '../../src/domain/ledger'
import { signIn, type TestUser } from './clients.ts'

let a: TestUser
let b: TestUser

const WEEK_1 = '2026-10-19'
const WEEK_2 = '2026-10-26'
const PLAN_END = '2026-11-15'
const CLOSED = 'SS001'
const CHECK = '23514'

// C 960, P 200, with no bills yet.
const usd: NewAccount = {
  currency: 'USD',
  openingDate: WEEK_1,
  cashCents: 96000,
  protectedCents: 20000,
  commitmentsCents: 0,
  planEndDate: PLAN_END,
  recommendedCents: 15000,
  allowanceCents: 15000,
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

async function addBill(user: TestUser, accountId: string, cents: number, overrides: Record<string, unknown> = {}): Promise<string> {
  const id = crypto.randomUUID()
  const { error } = await user.client
    .from('bills')
    .insert({ id, account_id: accountId, name: 'Fictional bill', due_on: '2026-11-01', cents, ...overrides })
  if (error) throw new Error(`Could not add a bill: ${error.message}`)
  return id
}

function pay(user: TestUser, id: string, paidOn: string, cents: number) {
  return user.client.from('bills').update({ paid_on: paidOn, paid_cents: cents }).eq('id', id)
}

/**
 * The database's own free cash, found from its allowance rule: with nothing
 * spent, this allowance fits and one cent more does not.
 */
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

describe('setup', () => {
  test('the total becomes one bill due on the plan end, and the screen numbers are unchanged', async () => {
    await start(a, { ...usd, commitmentsCents: 20000 })
    const week = weekAccount((await load(a)).ledger, 'USD')
    expect(week.commitmentsCents).toBe(20000)
    expect(week.bills).toEqual([{ id: expect.any(String), name: 'Bills from setup', dueOn: PLAN_END, cents: 20000 }])
  })

  test('no total means no bill', async () => {
    await start(a)
    expect(weekAccount((await load(a)).ledger, 'USD').bills).toEqual([])
  })

  test('a repeated setup leaves one bill', async () => {
    await start(a, { ...usd, commitmentsCents: 20000 })
    expect(await createAccount(a.client, { ...usd, commitmentsCents: 20000 })).toEqual({ ok: true })
    expect(weekAccount((await load(a)).ledger, 'USD').bills).toHaveLength(1)
  })
})

describe('the database counts bills the same way the app does', () => {
  let accountId: string
  let rent: string

  beforeEach(async () => {
    accountId = await start(a)
    rent = await addBill(a, accountId, 15000)
    await addBill(a, accountId, 5000)
  })

  test('worked example: bills of 150 and 50 leave free cash 560', async () => {
    expect(weekAccount((await load(a)).ledger, 'USD').commitmentsCents).toBe(20000)
    await expectDatabaseFreeCash(a, 56000)
  })

  test('paying exactly 150: B 50, free cash still 560', async () => {
    expect((await pay(a, rent, WEEK_1, 15000)).error).toBeNull()
    expect(weekAccount((await load(a)).ledger, 'USD').commitmentsCents).toBe(5000)
    await expectDatabaseFreeCash(a, 56000)
  })

  test('paying 160 for that bill: B 50, free cash 550', async () => {
    expect((await pay(a, rent, WEEK_1, 16000)).error).toBeNull()
    expect(weekAccount((await load(a)).ledger, 'USD').commitmentsCents).toBe(5000)
    await expectDatabaseFreeCash(a, 55000)
  })

  test('adding a new 100 bill: free cash 460', async () => {
    await addBill(a, accountId, 10000)
    await expectDatabaseFreeCash(a, 46000)
  })

  test('a bill due after the plan end is not counted, in either place', async () => {
    await addBill(a, accountId, 10000, { due_on: '2026-11-16' })
    expect(weekAccount((await load(a)).ledger, 'USD').commitmentsCents).toBe(20000)
    await expectDatabaseFreeCash(a, 56000)
  })

  test('a bill due on the plan end, and an overdue one, are counted in both', async () => {
    await addBill(a, accountId, 1000, { due_on: PLAN_END })
    await addBill(a, accountId, 2000, { due_on: '2026-01-01' })
    expect(weekAccount((await load(a)).ledger, 'USD').commitmentsCents).toBe(23000)
    await expectDatabaseFreeCash(a, 53000)
  })

  test('a payment leaves next week starting with less cash, and is not spending', async () => {
    await pay(a, rent, WEEK_1, 16000)
    const week = weekAccount((await load(a, WEEK_2)).ledger, 'USD')
    expect(week.weekStartCashCents).toBe(80000)
    expect(week.previousClosure).toMatchObject({ spentCents: 0, leftoverCents: 15000, protectedCents: 15000 })
  })
})

describe('closing a week sees bills as they were then', () => {
  let accountId: string
  let bill: string

  beforeEach(async () => {
    // Free cash 1,000 - 200 = 800 at setup, so 300 fits. The bill then leaves 10.
    accountId = await start(a, { ...usd, cashCents: 100000, recommendedCents: 30000, allowanceCents: 30000 })
    bill = await addBill(a, accountId, 79000)
  })

  test('unpaid: free cash 10 is the limit', async () => {
    expect(weekAccount((await load(a, WEEK_2)).ledger, 'USD').protectedCents).toBe(20000 + 1000)
  })

  test('paid after the week ended: it still counted as unpaid for that week', async () => {
    // The real order: a week's plan exists before anything can be dated in it.
    await a.client.from('week_plans').insert({ account_id: accountId, week_start: WEEK_2, recommended_cents: 0, starting_allowance_cents: 0 })
    expect((await pay(a, bill, WEEK_2, 79000)).error).toBeNull()
    expect(weekAccount((await load(a, WEEK_2)).ledger, 'USD').protectedCents).toBe(20000 + 1000)
  })

  test('paid during the week, for 10 more than expected: free cash 0 protects nothing', async () => {
    expect((await pay(a, bill, WEEK_1, 80000)).error).toBeNull()
    expect(weekAccount((await load(a, WEEK_2)).ledger, 'USD').protectedCents).toBe(20000)
  })
})

describe('payments and closed weeks', () => {
  let accountId: string
  let paidBill: string
  let unpaidBill: string

  beforeEach(async () => {
    accountId = await start(a)
    paidBill = await addBill(a, accountId, 15000)
    unpaidBill = await addBill(a, accountId, 5000)
    await pay(a, paidBill, WEEK_1, 15000)
    await load(a, WEEK_2) // Closes week 1.
  })

  test('a payment in a closed week cannot be changed, undone or deleted', async () => {
    expect((await pay(a, paidBill, WEEK_1, 1)).error?.code).toBe(CLOSED)
    expect((await pay(a, paidBill, WEEK_2, 15000)).error?.code).toBe(CLOSED)
    expect((await a.client.from('bills').update({ paid_on: null, paid_cents: null }).eq('id', paidBill)).error?.code).toBe(CLOSED)
    expect((await a.client.from('bills').update({ name: 'Changed' }).eq('id', paidBill)).error?.code).toBe(CLOSED)
    expect((await a.client.from('bills').delete().eq('id', paidBill)).error?.code).toBe(CLOSED)
  })

  test('a new payment cannot be dated in a closed week', async () => {
    expect((await pay(a, unpaidBill, WEEK_1, 5000)).error?.code).toBe(CLOSED)
  })

  test('a paid bill cannot be added into a closed week', async () => {
    const { error } = await a.client.from('bills').insert({
      id: crypto.randomUUID(), account_id: accountId, name: 'Fictional bill', due_on: WEEK_1, cents: 100, paid_on: WEEK_1, paid_cents: 100,
    })
    expect(error?.code).toBe(CLOSED)
  })

  test('an unpaid bill can still change, and the closed week keeps its stored amounts', async () => {
    const before = weekAccount((await load(a, WEEK_2)).ledger, 'USD').previousClosure
    expect((await a.client.from('bills').update({ cents: 9000 }).eq('id', unpaidBill)).error).toBeNull()
    const week = weekAccount((await load(a, WEEK_2)).ledger, 'USD')
    expect(week.commitmentsCents).toBe(9000)
    expect(week.previousClosure).toEqual(before)
    expect((await a.client.from('bills').delete().eq('id', unpaidBill)).error).toBeNull()
    expect(weekAccount((await load(a, WEEK_2)).ledger, 'USD').commitmentsCents).toBe(0)
  })

  test('a payment in the open week can be undone', async () => {
    expect((await pay(a, unpaidBill, WEEK_2, 5000)).error).toBeNull()
    expect((await a.client.from('bills').update({ paid_on: null, paid_cents: null }).eq('id', unpaidBill)).error).toBeNull()
    expect(weekAccount((await load(a, WEEK_2)).ledger, 'USD').commitmentsCents).toBe(5000)
  })

  test('deleting the whole account still works, even with a payment in a closed week', async () => {
    expect((await a.client.from('accounts').delete().eq('id', accountId)).error).toBeNull()
    expect((await a.client.from('bills').select('id')).data).toEqual([])
  })
})

describe('what a bill row can hold', () => {
  let accountId: string
  let bill: string

  beforeEach(async () => {
    accountId = await start(a)
    bill = await addBill(a, accountId, 5000)
  })

  test('a payment date still to come is refused', async () => {
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
    expect((await pay(a, bill, future, 5000)).error?.code).toBe('SS005')
  })

  test('a payment before the account opened is refused', async () => {
    expect((await pay(a, bill, '2026-10-18', 5000)).error?.code).toBe(CLOSED)
  })

  test('a paid date without an amount, or an amount without a date, is refused', async () => {
    expect((await a.client.from('bills').update({ paid_on: WEEK_1 }).eq('id', bill)).error?.code).toBe(CHECK)
    expect((await a.client.from('bills').update({ paid_cents: 5000 }).eq('id', bill)).error?.code).toBe(CHECK)
  })

  test('zero, negative and oversized amounts are refused', async () => {
    for (const cents of [0, -100, 10000001]) {
      expect((await a.client.from('bills').update({ cents }).eq('id', bill)).error?.code).toBe(CHECK)
      expect((await pay(a, bill, WEEK_1, cents)).error?.code).toBe(CHECK)
    }
  })

  test('an empty or overlong name is refused', async () => {
    for (const name of ['', '   ', 'x'.repeat(61)]) {
      expect((await a.client.from('bills').update({ name }).eq('id', bill)).error?.code).toBe(CHECK)
    }
  })

  test('USD bills leave a BSD account alone', async () => {
    expect((await createAccount(a.client, { ...usd, currency: 'BSD', commitmentsCents: 3000, recommendedCents: 0, allowanceCents: 0 })).ok).toBe(true)
    const { ledger } = await load(a)
    expect(weekAccount(ledger, 'USD').commitmentsCents).toBe(5000)
    expect(weekAccount(ledger, 'BSD').commitmentsCents).toBe(3000)
  })

  test('appears in the export, without the owner id', async () => {
    const result = await exportOwnData(a.client, '2026-11-04T12:00:00.000Z')
    if (!result.ok) throw new Error(result.message)
    expect(result.file.bills).toHaveLength(1)
    expect(result.file.bills[0]).toMatchObject({ id: bill, due_on: '2026-11-01', cents: 5000, paid_on: null, paid_cents: null })
    expect(JSON.stringify(result.file.bills)).not.toContain('user_id')
  })
})

describe('user B and signed-out visitors', () => {
  let accountId: string
  let bAccountId: string
  let bill: string

  beforeEach(async () => {
    accountId = await start(a)
    bAccountId = await start(b)
    bill = await addBill(a, accountId, 5000)
  })

  test("B sees none of A's bills", async () => {
    const asB = await b.client.from('bills').select('id')
    expect(asB.error).toBeNull()
    expect(asB.data).toEqual([])
  })

  test("B cannot change, pay or delete A's bill", async () => {
    expect((await b.client.from('bills').update({ cents: 1 }).eq('id', bill).select('id')).data).toEqual([])
    expect((await pay(b, bill, WEEK_1, 5000).select('id')).data).toEqual([])
    await b.client.from('bills').delete().eq('id', bill)
    expect(weekAccount((await load(a)).ledger, 'USD').bills).toEqual([
      { id: bill, name: 'Fictional bill', dueOn: '2026-11-01', cents: 5000 },
    ])
  })

  test("B cannot add a bill to A's account, by link or by claiming to be A", async () => {
    const row = { name: 'Forged', due_on: WEEK_1, cents: 100, account_id: accountId }
    expect((await b.client.from('bills').insert({ id: crypto.randomUUID(), ...row })).error).not.toBeNull()
    const claimed = await b.client.from('bills').insert({ id: crypto.randomUUID(), user_id: a.userId, ...row })
    expect(claimed.error?.code).toBe('42501')
    expect(weekAccount((await load(a)).ledger, 'USD').bills).toHaveLength(1)
  })

  test("B cannot move their own bill into A's account", async () => {
    const own = await addBill(b, bAccountId, 100)
    const { error } = await b.client.from('bills').update({ account_id: accountId }).eq('id', own)
    expect(error?.code).toBe('42501')
  })

  test('a signed-out visitor is refused', async () => {
    const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error } = await anon.from('bills').select('id')
    expect(error?.code).toBe('42501')
  })
})

describe('saving bills through the data layer', () => {
  let accountId: string
  const newBill = (overrides: Partial<Bill> = {}): Bill => ({ id: crypto.randomUUID(), name: 'Fictional rent', dueOn: '2026-11-01', cents: 15000, ...overrides })
  const bills = async (user: TestUser) => weekAccount((await load(user)).ledger, 'USD').bills

  beforeEach(async () => {
    accountId = await start(a)
    await start(b)
  })

  test('comes back with every field', async () => {
    const bill = newBill()
    expect(await insertBill(a.client, accountId, bill)).toEqual({ ok: true })
    expect(await bills(a)).toEqual([bill])
  })

  test('a retry after a lost reply saves it once and reports success', async () => {
    const bill = newBill()
    await insertBill(a.client, accountId, bill)
    expect(await insertBill(a.client, accountId, bill)).toEqual({ ok: true })
    expect(await bills(a)).toEqual([bill])
  })

  test('an edit changes the row, and a second delete still succeeds', async () => {
    const bill = newBill()
    await insertBill(a.client, accountId, bill)
    const edited = { ...bill, name: 'Fictional fee', dueOn: '2026-11-02', cents: 100 }
    expect(await updateBillRow(a.client, edited)).toEqual({ ok: true })
    expect(await bills(a)).toEqual([edited])
    expect(await deleteBillRow(a.client, bill.id)).toEqual({ ok: true })
    expect(await deleteBillRow(a.client, bill.id)).toEqual({ ok: true })
    expect(await bills(a)).toEqual([])
  })

  test('editing a bill that is gone says so', async () => {
    expect(await updateBillRow(a.client, newBill())).toEqual({ ok: false, message: 'That bill no longer exists. Reload the page to see the latest.' })
  })

  test("B's edit of A's bill fails, and reusing A's id is a failure, not a false success", async () => {
    const bill = newBill()
    await insertBill(a.client, accountId, bill)
    const bAccountId = (await load(b)).accountIds.USD!
    expect((await updateBillRow(b.client, { ...bill, cents: 1 })).ok).toBe(false)
    expect((await insertBill(b.client, bAccountId, bill)).ok).toBe(false)
    await deleteBillRow(b.client, bill.id)
    expect(await bills(a)).toEqual([bill])
    expect(await bills(b)).toEqual([])
  })
})

describe('paying through the data layer', () => {
  let accountId: string
  const rent: Bill = { id: '', name: 'Fictional rent', dueOn: '2026-11-01', cents: 15000 }
  let bill: Bill

  beforeEach(async () => {
    accountId = await start(a)
    await start(b)
    bill = { ...rent, id: crypto.randomUUID() }
    await insertBill(a.client, accountId, bill)
  })

  test('the payment comes back on the bill, with the worked example numbers', async () => {
    expect(await payBillRow(a.client, bill.id, { paidOn: WEEK_1, paidCents: 16000 })).toEqual({ ok: true })
    const week = weekAccount((await load(a)).ledger, 'USD')
    expect(week.bills).toEqual([{ ...bill, paidOn: WEEK_1, paidCents: 16000 }])
    expect(week.billPaymentsThisWeekCents).toBe(16000)
    expect(week.commitmentsCents).toBe(0)
  })

  test('saving the same payment again takes the money out once', async () => {
    await payBillRow(a.client, bill.id, { paidOn: WEEK_1, paidCents: 15000 })
    expect(await payBillRow(a.client, bill.id, { paidOn: WEEK_1, paidCents: 15000 })).toEqual({ ok: true })
    expect(weekAccount((await load(a)).ledger, 'USD').billPaymentsThisWeekCents).toBe(15000)
  })

  test('undoing makes it unpaid again, and undoing twice still succeeds', async () => {
    await payBillRow(a.client, bill.id, { paidOn: WEEK_1, paidCents: 15000 })
    expect(await undoBillPaymentRow(a.client, bill.id)).toEqual({ ok: true })
    expect(await undoBillPaymentRow(a.client, bill.id)).toEqual({ ok: true })
    const week = weekAccount((await load(a)).ledger, 'USD')
    expect(week.bills).toEqual([bill])
    expect(week.commitmentsCents).toBe(15000)
  })

  test('a date still to come gets its own message', async () => {
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
    expect(await payBillRow(a.client, bill.id, { paidOn: future, paidCents: 15000 })).toEqual({
      ok: false,
      message: 'A payment can only be recorded once it has been made.',
    })
  })

  test('a closed week gets its own message, for paying and for undoing', async () => {
    const closed = 'That week is closed, so it can no longer be changed. Reload the page to see the latest.'
    const other: Bill = { ...rent, id: crypto.randomUUID() }
    await insertBill(a.client, accountId, other)
    await payBillRow(a.client, bill.id, { paidOn: WEEK_1, paidCents: 15000 })
    await load(a, WEEK_2) // Closes week 1.
    expect(await payBillRow(a.client, other.id, { paidOn: WEEK_1, paidCents: 15000 })).toEqual({ ok: false, message: closed })
    expect(await undoBillPaymentRow(a.client, bill.id)).toEqual({ ok: false, message: closed })
  })

  test("B cannot pay or undo A's bill through the data layer", async () => {
    expect((await payBillRow(b.client, bill.id, { paidOn: WEEK_1, paidCents: 1 })).ok).toBe(false)
    await payBillRow(a.client, bill.id, { paidOn: WEEK_1, paidCents: 15000 })
    expect((await undoBillPaymentRow(b.client, bill.id)).ok).toBe(false)
    expect(weekAccount((await load(a)).ledger, 'USD').billPaymentsThisWeekCents).toBe(15000)
  })
})

describe('paying part of a bill and still owing the rest', () => {
  let accountId: string
  let bill: Bill
  const part = { paidOn: WEEK_1, paidCents: 5000 }

  beforeEach(async () => {
    accountId = await start(a)
    await start(b)
    bill = { id: crypto.randomUUID(), name: 'Fictional rent', dueOn: '2026-11-01', cents: 15000 }
    await insertBill(a.client, accountId, bill)
    await addBill(a, accountId, 5000)
  })

  test('worked example: paying 50 of 150 leaves B 150 and free cash 560', async () => {
    const restId = crypto.randomUUID()
    expect(await payBillKeepRest(a.client, bill.id, part, restId)).toEqual({ ok: true })
    const week = weekAccount((await load(a)).ledger, 'USD')
    expect(week.bills).toContainEqual({ ...bill, cents: 5000, paidOn: WEEK_1, paidCents: 5000 })
    expect(week.bills).toContainEqual({ ...bill, id: restId, cents: 10000 })
    expect(week.commitmentsCents).toBe(15000)
    expect(week.billPaymentsThisWeekCents).toBe(5000)
    await expectDatabaseFreeCash(a, 56000)
  })

  test('saving it again splits once and reports success', async () => {
    const restId = crypto.randomUUID()
    await payBillKeepRest(a.client, bill.id, part, restId)
    expect(await payBillKeepRest(a.client, bill.id, part, restId)).toEqual({ ok: true })
    expect(weekAccount((await load(a)).ledger, 'USD').bills).toHaveLength(3)
  })

  test('the same id with a different amount is refused, not treated as a retry', async () => {
    const restId = crypto.randomUUID()
    await payBillKeepRest(a.client, bill.id, part, restId)
    expect((await payBillKeepRest(a.client, bill.id, { paidOn: WEEK_1, paidCents: 1000 }, restId)).ok).toBe(false)
    expect(weekAccount((await load(a)).ledger, 'USD').billPaymentsThisWeekCents).toBe(5000)
  })

  test('an amount that leaves nothing owed is refused', async () => {
    for (const paidCents of [15000, 16000]) {
      expect((await payBillKeepRest(a.client, bill.id, { paidOn: WEEK_1, paidCents }, crypto.randomUUID())).ok).toBe(false)
    }
    expect((await payBillKeepRest(a.client, bill.id, { paidOn: WEEK_1, paidCents: 0 }, crypto.randomUUID())).ok).toBe(false)
    expect(weekAccount((await load(a)).ledger, 'USD').bills).toHaveLength(2)
  })

  test('a date still to come and a closed week are refused, and nothing is split', async () => {
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
    expect((await payBillKeepRest(a.client, bill.id, { paidOn: future, paidCents: 5000 }, crypto.randomUUID())).ok).toBe(false)
    await load(a, WEEK_2) // Closes week 1.
    expect((await payBillKeepRest(a.client, bill.id, part, crypto.randomUUID())).ok).toBe(false)
    const week = weekAccount((await load(a, WEEK_2)).ledger, 'USD')
    expect(week.bills).toHaveLength(2)
    expect(week.commitmentsCents).toBe(20000)
  })

  test('undoing leaves two unpaid bills that add up to the original', async () => {
    await payBillKeepRest(a.client, bill.id, part, crypto.randomUUID())
    expect(await undoBillPaymentRow(a.client, bill.id)).toEqual({ ok: true })
    const week = weekAccount((await load(a)).ledger, 'USD')
    expect(week.commitmentsCents).toBe(20000)
    expect(week.billPaymentsThisWeekCents).toBe(0)
    await expectDatabaseFreeCash(a, 56000)
  })

  test("B cannot split A's bill", async () => {
    expect((await payBillKeepRest(b.client, bill.id, part, crypto.randomUUID())).ok).toBe(false)
    const week = weekAccount((await load(a)).ledger, 'USD')
    expect(week.bills).toHaveLength(2)
    expect(week.billPaymentsThisWeekCents).toBe(0)
    expect(weekAccount((await load(b)).ledger, 'USD').bills).toEqual([])
  })

  test("all or nothing: when the second step fails on A's id, B's bill is left unpaid", async () => {
    const bAccountId = (await load(b)).accountIds.USD!
    const own: Bill = { id: crypto.randomUUID(), name: 'Fictional fee', dueOn: '2026-11-01', cents: 15000 }
    await insertBill(b.client, bAccountId, own)
    expect((await payBillKeepRest(b.client, own.id, part, bill.id)).ok).toBe(false)
    expect(weekAccount((await load(b)).ledger, 'USD').bills).toEqual([own])
    expect(weekAccount((await load(a)).ledger, 'USD').bills).toContainEqual(bill)
  })

  test('a signed-out visitor is refused', async () => {
    const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error } = await anon.rpc('pay_bill_keep_rest', { p_bill_id: bill.id, p_rest_id: crypto.randomUUID(), p_paid_on: WEEK_1, p_paid_cents: 5000 })
    expect(error?.code).toBe('42501')
  })
})
