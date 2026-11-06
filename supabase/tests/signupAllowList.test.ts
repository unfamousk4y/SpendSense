// The invite list must stay out of the browser's reach: nobody should be able to
// read it, add themselves, or use the hook to test who was invited. Whether the
// hook itself lets the right people in is checked on the beta project with a real
// sign-in, because these tests cannot sign in with Google.
import { createClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, test } from 'vitest'
import { signIn, type TestUser } from './clients.ts'

const event = { metadata: {}, user: { email: 'someone@example.test' } }

let student: TestUser

beforeAll(async () => {
  student = await signIn('A')
})

function visitor() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

describe('signup allow-list access', () => {
  test.each([
    ['a signed-out visitor', () => visitor()],
    ['a signed-in student', () => student.client],
  ])('%s cannot call the hook', async (_who, client) => {
    const { data, error } = await client().rpc('hook_signup_allow_list', { event })
    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })

  test.each([
    ['a signed-out visitor', () => visitor()],
    ['a signed-in student', () => student.client],
  ])('%s cannot read or add to the list', async (_who, client) => {
    const list = () => client().schema('private').from('signup_allow_list')
    const read = await list().select('email')
    expect(read.error).not.toBeNull()
    expect(read.data).toBeNull()
    const added = await list().insert({ email: 'intruder@example.test' })
    expect(added.error).not.toBeNull()
  })
})
