// delete_my_account removes a sign-in for good, so it must never succeed as user
// A or B: only the refusals are tested as them. The real deletion runs as a
// throwaway user signed up here, which needs "Confirm email" off on this
// project (development only). Fictional data only.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createAccount, deleteMyAccount, insertPurchase, loadLedger, saveAllowanceChange, saveRelease } from '../../src/data/ledgerStore'
import { signIn, type TestUser } from './clients.ts'

const WEEK_1 = '2026-10-19'
const WEEK_2 = '2026-10-26'
const TABLES = ['accounts', 'purchases', 'week_plans', 'allowance_changes', 'week_closures', 'savings_releases']

function newClient(): SupabaseClient {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function rowCounts(client: SupabaseClient): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const table of TABLES) {
    const { data, error } = await client.from(table).select('id')
    if (error) throw new Error(`Could not read ${table}: ${error.message}`)
    counts[table] = data.length
  }
  return counts
}

/** The worked example with every kind of row, including a closed week. */
async function fillAccount(client: SupabaseClient) {
  const created = await createAccount(client, {
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

  const first = await loadLedger(client, WEEK_1)
  if (!first.ok) throw new Error(first.message)
  const accountId = first.loaded.accountIds.USD!
  // Dated in week 1, which closes below: the purchase guard must still let it go.
  const closedPurchase = await insertPurchase(client, accountId, { id: crypto.randomUUID(), date: WEEK_1, merchant: 'Fictional café', cents: 450 })
  if (!closedPurchase.ok) throw new Error(closedPurchase.message)

  const second = await loadLedger(client, WEEK_2)
  if (!second.ok) throw new Error(second.message)
  const openPurchase = await insertPurchase(client, accountId, { id: crypto.randomUUID(), date: WEEK_2, merchant: 'Fictional bookshop', cents: 725 })
  if (!openPurchase.ok) throw new Error(openPurchase.message)
  const change = await saveAllowanceChange(client, second.loaded.weekPlanIds.USD![WEEK_2], {
    id: crypto.randomUUID(),
    madeOn: WEEK_2,
    fromCents: 15000,
    toCents: 14000,
    suggestedCents: null,
  })
  if (!change.ok) throw new Error(change.message)
  const release = await saveRelease(client, accountId, { id: crypto.randomUUID(), madeOn: WEEK_2, cents: 100 })
  if (!release.ok) throw new Error(release.message)
}

const FULL_ACCOUNT = { accounts: 1, purchases: 2, week_plans: 2, allowance_changes: 1, week_closures: 1, savings_releases: 1 }
const NOTHING = { accounts: 0, purchases: 0, week_plans: 0, allowance_changes: 0, week_closures: 0, savings_releases: 0 }

let b: TestUser

beforeAll(async () => {
  b = await signIn('B')
})

afterAll(async () => {
  await b?.client.auth.signOut()
})

describe('delete_my_account refusals', () => {
  test('a signed-out visitor cannot call it', async () => {
    const { error } = await newClient().rpc('delete_my_account')
    expect(error?.code).toBe('42501')
  })

  test('it cannot be aimed at someone else: it accepts no user id', async () => {
    const { error } = await b.client.rpc('delete_my_account', { p_user_id: crypto.randomUUID() })
    expect(error).not.toBeNull()
    const stillThere = await b.client.auth.getUser()
    expect(stillThere.data.user?.id).toBe(b.userId)
  })
})

describe('deleting a whole account', () => {
  const email = `deletion-test-${crypto.randomUUID()}@example.com`
  const password = crypto.randomUUID()
  const throwaway = newClient()

  async function resetB() {
    const { error } = await b.client.from('accounts').delete().eq('user_id', b.userId)
    if (error) throw new Error(`Cleanup failed: ${error.message}`)
  }

  beforeAll(async () => {
    const { data, error } = await throwaway.auth.signUp({ email, password })
    if (error) throw new Error(`Could not sign up a throwaway user: ${error.message}`)
    if (!data.session) throw new Error('No session after sign-up: is "Confirm email" on for this project?')
    await resetB()
    await fillAccount(throwaway)
    await fillAccount(b.client)
  })

  afterAll(async () => {
    // Removes the throwaway user even if an earlier test failed.
    await throwaway.rpc('delete_my_account')
    await resetB()
  })

  test('removes every row, closed weeks included, and leaves other students alone', async () => {
    expect(await rowCounts(throwaway)).toEqual(FULL_ACCOUNT)

    expect(await deleteMyAccount(throwaway)).toEqual({ ok: true })

    expect(await rowCounts(throwaway)).toEqual(NOTHING)
    expect(await rowCounts(b.client)).toEqual(FULL_ACCOUNT)
  })

  test('the sign-in is gone: the same email and password are refused', async () => {
    const { data, error } = await newClient().auth.signInWithPassword({ email, password })
    expect(error).not.toBeNull()
    expect(data.session).toBeNull()
  })

  test('deleting again is harmless, so a retry after a lost reply is safe', async () => {
    expect(await deleteMyAccount(throwaway)).toEqual({ ok: true })
    expect(await rowCounts(b.client)).toEqual(FULL_ACCOUNT)
  })

  test('the leftover session cannot save anything under the deleted user', async () => {
    const created = await createAccount(throwaway, {
      currency: 'USD',
      openingDate: WEEK_1,
      cashCents: 1000,
      protectedCents: 0,
      commitmentsCents: 0,
      planEndDate: '2026-11-15',
      recommendedCents: 0,
      allowanceCents: 0,
    })
    expect(created.ok).toBe(false)
    expect(await rowCounts(throwaway)).toEqual(NOTHING)
  })
})
