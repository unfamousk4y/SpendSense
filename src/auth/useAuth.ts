import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { supabase } from '../data/supabaseClient';

export type AuthState =
  | { status: 'notConfigured' }
  | { status: 'checking' }
  /** sessionLost: it ended without the student choosing to sign out here. */
  | { status: 'signedOut'; sessionLost: boolean }
  | { status: 'signedIn'; session: Session };

/**
 * Whether someone is signed in. Supabase keeps the session in this browser's
 * storage and refreshes it; onAuthStateChange tells us about every change
 * (returning from Google, signing out, an expired session).
 */
let signingOut = false;

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>(() =>
    supabase ? { status: 'checking' } : { status: 'notConfigured' },
  );

  useEffect(() => {
    if (!supabase) return;
    // Fires once straight away with the current session (INITIAL_SESSION),
    // then again on every sign-in, sign-out or refresh.
    let hadSession = false;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const sessionLost = hadSession && !session && !signingOut;
      hadSession = session !== null;
      signingOut = false;
      setState(session ? { status: 'signedIn', session } : { status: 'signedOut', sessionLost });
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return state;
}

/** The next sign-out is the student's own choice, so it is not reported as a lost session. */
export function expectSignOut(): void {
  signingOut = true;
}

/** Ends the session in this browser; useAuth then reports signedOut. */
export async function signOut(): Promise<string | null> {
  if (!supabase) return null;
  expectSignOut();
  const { error } = await supabase.auth.signOut();
  if (error) signingOut = false;
  return error ? error.message : null;
}
