// Signs in as one of the two test users from .env.test. Each test user gets
// its own client, so every request carries that user's session, exactly as a
// browser would. Only the publishable key is used: the same access a student's
// browser has. No secret key exists anywhere in this project.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type TestUser = { client: SupabaseClient; userId: string }

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is missing from .env.test`)
  return value
}

export async function signIn(which: 'A' | 'B'): Promise<TestUser> {
  const client = createClient(required('SUPABASE_URL'), required('SUPABASE_PUBLISHABLE_KEY'), {
    // Tests run in Node: keep the session in memory, never on disk.
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await client.auth.signInWithPassword({
    email: required(`TEST_USER_${which}_EMAIL`),
    password: required(`TEST_USER_${which}_PASSWORD`),
  })
  // Report the reason only; never echo the email or password.
  if (error || !data.user) throw new Error(`Test user ${which} could not sign in: ${error?.message ?? 'no user'}`)
  return { client, userId: data.user.id }
}
