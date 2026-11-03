import react from '@vitejs/plugin-react'
// vitest/config's defineConfig is Vite's, plus typing for the `test` section.
import { configDefaults, defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // Database tests need the network and .env.test; they run separately
    // with `npm run test:db` so `npm test` stays fast and offline.
    exclude: [...configDefaults.exclude, 'supabase/**'],
  },
})
