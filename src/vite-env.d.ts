/// <reference types="vite/client" />

// Browser settings from .env.local. Only publishable values may use the VITE_
// prefix: Vite copies them into the JavaScript every visitor downloads.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
