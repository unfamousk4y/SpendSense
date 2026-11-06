import { supabase } from '../data/supabaseClient';

/**
 * Leaves this page for Google. Google returns to Supabase, which returns here
 * (redirectTo) with a one-time code that the client swaps for a session.
 * Resolves with a message only if it could not start.
 */
export async function startGoogleSignIn(): Promise<string | null> {
  if (!supabase) return null;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
  return error ? error.message : null;
}
