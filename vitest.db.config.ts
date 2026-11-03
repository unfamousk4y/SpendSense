import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// Runs only the Supabase access tests, against the project in .env.test.
// loadEnv with an empty prefix reads every name in .env.test (not only VITE_
// ones) into this test process. Nothing here is bundled into the app.
export default defineConfig({
  test: {
    include: ['supabase/tests/**/*.test.ts'],
    env: loadEnv('test', process.cwd(), ''),
    // Real network calls: allow more than the 5 second default.
    testTimeout: 20_000,
    // One file at a time, so tests that create and clean up rows never overlap.
    fileParallelism: false,
  },
})
