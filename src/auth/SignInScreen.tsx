import { useEffect, useState } from 'react';
import { supabase } from '../data/supabaseClient';
import { ThemeSwitch } from '../ui/ThemeSwitch';
import styles from './SignInScreen.module.css';

type SignInScreenProps = {
  /** .env.local is missing: explain instead of offering a button that cannot work. */
  notConfigured: boolean;
  /** Development only: open the fictional demo without an account. */
  onTryDemo?: () => void;
};

/**
 * If Google or Supabase sends the student back with an error, it arrives in
 * the address (?error_description=... or #error_description=...). Reading has
 * no side effects, because React may call a state initializer twice in
 * development; removing it from the address happens in an effect below.
 */
function errorFromAddress(): string | null {
  const url = new URL(window.location.href);
  const fromHash = new URLSearchParams(url.hash.slice(1));
  return url.searchParams.get('error_description') ?? fromHash.get('error_description');
}

export function SignInScreen({ notConfigured, onTryDemo }: SignInScreenProps) {
  const [error, setError] = useState<string | null>(errorFromAddress);
  const [redirecting, setRedirecting] = useState(false);

  // Remove the error from the address once shown, so a reload does not repeat it.
  useEffect(() => {
    if (errorFromAddress()) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  async function signInWithGoogle() {
    if (!supabase) return;
    setError(null);
    setRedirecting(true);
    // Leaves this page for Google. Google returns to Supabase, which returns
    // here (redirectTo) with a one-time code that the client swaps for a session.
    const { error: startError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (startError) {
      setError(startError.message);
      setRedirecting(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>SpendSense</h1>
        <p className={styles.lead}>See what is left to spend this week, from money you have actually received.</p>

        {notConfigured ? (
          <p className={styles.problem} role="alert">
            Sign-in is not set up on this computer yet: .env.local with the Supabase URL and publishable key is
            missing.
          </p>
        ) : (
          <button type="button" className={styles.google} onClick={signInWithGoogle} disabled={redirecting}>
            {redirecting ? 'Opening Google' : 'Continue with Google'}
          </button>
        )}

        {/* role="alert" reads the problem out as soon as it appears. */}
        {error && (
          <p className={styles.problem} role="alert">
            Sign-in did not finish: {error}
          </p>
        )}

        {onTryDemo && (
          <button type="button" className={styles.demo} onClick={onTryDemo}>
            Try the demo without signing in (development only)
          </button>
        )}
      </div>
      <footer className={styles.footer}>
        <ThemeSwitch />
      </footer>
    </main>
  );
}
