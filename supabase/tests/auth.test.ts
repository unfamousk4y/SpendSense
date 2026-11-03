import { afterAll, expect, test } from 'vitest'
import { signIn, type TestUser } from './clients.ts'

const users: TestUser[] = []

afterAll(async () => {
  await Promise.all(users.map((user) => user.client.auth.signOut()))
})

test('both test users can sign in and are different people', async () => {
  const a = await signIn('A')
  const b = await signIn('B')
  users.push(a, b)
  expect(a.userId).not.toBe(b.userId)
})
