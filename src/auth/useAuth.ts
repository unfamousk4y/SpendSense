import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { supabase } from '../data/supabaseClient';

export type AuthState =
  | { status: 'notConfigured' }
  | { status: 'checking' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; session: Session };

/**
 * Whether someone is signed in. Supabase keeps the session in this browser's
 * storage and refreshes it; onAuthStateChange tells us about every change
 * (returning from Google, signing out, an expired session).
 */
export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>(() =>
    supabase ? { status: 'checking' } : { status: 'notConfigured' },
  );

  useEffect(() => {
    if (!supabase) return;
    // Fires once straight away with the current session (INITIAL_SESSION),
    // then again on every sign-in, sign-out or refresh.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(session ? { status: 'signedIn', session } : { status: 'signedOut' });
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return state;
}

/** Ends the session in this browser; useAuth then reports signedOut. */
export async function signOut(): Promise<string | null> {
  if (!supabase) return null;
  const { error } = await supabase.auth.signOut();
  return error ? error.message : null;
}
