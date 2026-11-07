// A student's export must hold all of their rows, exactly, and nobody else's.
// Fictional data only; each user's rows are removed before and after.
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createAccount, exportOwnData, insertPurchase, loadLedger, saveAllowanceChange, saveRelease } from '../../src/data/ledgerStore'
import { signIn, type TestUser } from './clients.ts'

let a: TestUser
let b: TestUser

const WEEK_1 = '2026-10-19'
const WEEK_2 = '2026-10-26'
const EXPORTED_AT = '2026-11-04T12:00:00.000Z'

async function reset(user: TestUser) {
  const { error } = await user.client.from('accounts').delete().eq('user_id', user.userId)
  if (error) throw new Error(`Cleanup failed: ${error.message}`)
}

async function startAccount(user: TestUser) {
  const created = await createAccount(user.client, {
    currency: 'USD',
    openingDate: WEEK_1,
    cashCents: 100000,
    protectedCents: 20000,
    commitmentsCents: 20000,
    planEndDate: '2026-11-15',
    recommendedCents: 15000,
    allowanceCents: 15000,
  })
  if (!created.ok) throw new Error(created.message)
}

async function exported(user: TestUser, pageSize?: number) {
  const result = await exportOwnData(user.client, EXPORTED_AT, pageSize)
  if (!result.ok) throw new Error(result.message)
  return result.file
}

beforeAll(async () => {
  a = await signIn('A')
  b = await signIn('B')
  await Promise.all([reset(a), reset(b)])
})

afterAll(async () => {
  if (a) await reset(a)
  if (b) await reset(b)
})

describe('exporting a student’s own data', () => {
  const purchaseCents = [450, 1, 1999, 10000000, 725]
  let bPurchaseId: string

  beforeAll(async () => {
    await startAccount(a)
    await startAccount(b)

    // Closes week 1, protecting the full 150, and plans week 2.
    const loaded = await loadLedger(a.client, WEEK_2)
    if (!loaded.ok) throw new Error(loaded.message)
    const accountId = loaded.loaded.accountIds.USD!
    const planId = loaded.loaded.weekPlanIds.USD![WEEK_2]

    for (const cents of purchaseCents) {
      const saved = await insertPurchase(a.client, accountId, {
        id: crypto.randomUUID(),
        date: WEEK_2,
        merchant: 'Fictional café',
        needOrWant: 'want',
        cents,
      })
      if (!saved.ok) throw new Error(saved.message)
    }
    const change = await saveAllowanceChange(a.client, planId, {
      id: crypto.randomUUID(),
      madeOn: WEEK_2,
      fromCents: 15000,
      toCents: 14000,
      suggestedCents: null,
    })
    if (!change.ok) throw new Error(change.message)
    const release = await saveRelease(a.client, accountId, { id: crypto.randomUUID(), madeOn: WEEK_2, cents: 100 })
    if (!release.ok) throw new Error(release.message)

    const bLoaded = await loadLedger(b.client, WEEK_1)
    if (!bLoaded.ok) throw new Error(bLoaded.message)
    bPurchaseId = crypto.randomUUID()
    const bSaved = await insertPurchase(b.client, bLoaded.loaded.accountIds.USD!, {
      id: bPurchaseId,
      date: WEEK_1,
      merchant: 'Fictional bookshop',
      needOrWant: 'need',
      cents: 999,
    })
    if (!bSaved.ok) throw new Error(bSaved.message)
  })

  test('holds every table, with exact amounts', async () => {
    const file = await exported(a)

    expect(file.format).toBe('spendsense-export')
    expect(file.version).toBe(1)
    expect(file.exportedAt).toBe(EXPORTED_AT)

    expect(file.accounts).toHaveLength(1)
    expect(file.accounts[0]).toMatchObject({
      currency: 'USD',
      opening_date: WEEK_1,
      opening_cash_cents: 100000,
      opening_protected_cents: 20000,
      plan_end_date: '2026-11-15',
    })
    expect(file.accounts[0]).not.toHaveProperty('commitments_cents')
    expect(file.bills).toHaveLength(1)
    expect(file.bills[0]).toMatchObject({ name: 'Bills from setup', due_on: '2026-11-15', cents: 20000, paid_on: null, paid_cents: null })
    expect(file.purchases.map((row) => row.cents).toSorted((x, y) => Number(x) - Number(y))).toEqual(
      purchaseCents.toSorted((x, y) => x - y),
    )
    expect(file.week_plans.map((row) => row.week_start)).toEqual([WEEK_1, WEEK_2])
    expect(file.allowance_changes).toHaveLength(1)
    expect(file.allowance_changes[0]).toMatchObject({ from_cents: 15000, to_cents: 14000 })
    expect(file.week_closures).toHaveLength(1)
    expect(file.week_closures[0]).toMatchObject({ week_start: WEEK_1, protected_cents: 15000 })
    expect(file.savings_releases).toHaveLength(1)
    expect(file.savings_releases[0]).toMatchObject({ cents: 100 })
  })

  test('holds nobody else’s rows, and no user ids', async () => {
    const text = JSON.stringify(await exported(a))
    expect(text).not.toContain(bPurchaseId)
    expect(text).not.toContain(b.userId)
    expect(text).not.toContain(a.userId)
    expect(text).not.toContain('user_id')
  })

  test('reads every row when they span several pages', async () => {
    const file = await exported(a, 2)
    expect(file.purchases).toHaveLength(purchaseCents.length)
    expect(new Set(file.purchases.map((row) => row.id)).size).toBe(purchaseCents.length)
    expect(file.week_plans).toHaveLength(2)
  })

  test('only reads: a week that has ended is not closed by exporting', async () => {
    // B's week 1 has ended and has not been closed.
    await exported(b)
    expect((await b.client.from('week_closures').select('id')).data).toEqual([])
  })

  test('a signed-out visitor gets a failure, not a partial or empty file', async () => {
    const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const result = await exportOwnData(anon, EXPORTED_AT)
    expect(result.ok).toBe(false)
  })
})
