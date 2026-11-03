// The one Supabase client the browser uses. It only ever has the publishable
// key: what a signed-in student may read or change is decided by row-level
// security in the database, never by this file.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/** null when .env.local is missing, so the screen can say so instead of crashing. */
export const supabase: SupabaseClient | null =
  url && publishableKey
    ? createClient(url, publishableKey, {
        // PKCE: Google sends back a one-time code, and only this browser holds
        // the matching secret needed to swap it for a session.
        auth: { flowType: 'pkce' },
      })
    : null;
