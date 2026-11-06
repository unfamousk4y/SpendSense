import { useEffect, useState } from 'react';
import { hasDraft } from '../data/formDraft';
import { ThemeSwitch } from '../ui/ThemeSwitch';
import { signInFailureFromAddress } from './signInFailure';
import { startGoogleSignIn } from './startGoogleSignIn';
import styles from './SignInScreen.module.css';

type SignInScreenProps = {
  /** .env.local is missing: explain instead of offering a button that cannot work. */
  notConfigured: boolean;
  /** The last session ended without the student choosing to sign out. */
  sessionLost?: boolean;
  /** Development only: open the fictional demo without an account. */
  onTryDemo?: () => void;
};

export function SignInScreen({ notConfigured, sessionLost, onTryDemo }: SignInScreenProps) {
  const [error, setError] = useState<string | null>(() => signInFailureFromAddress(window.location.href));
  const [redirecting, setRedirecting] = useState(false);

  // Remove the error from the address once shown, so a reload does not repeat it.
  useEffect(() => {
    if (signInFailureFromAddress(window.location.href)) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  async function signInWithGoogle() {
    setError(null);
    setRedirecting(true);
    const message = await startGoogleSignIn();
    if (message) {
      setError(message);
      setRedirecting(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>SpendSense</h1>
        <p className={styles.lead}>See what is left to spend this week, from money you have actually received.</p>

        {sessionLost && (
          <p className={styles.lead} role="status">
            You have been signed out, so sign in again to continue. Everything you saved is safe.{' '}
            {hasDraft()
              ? 'What you were saving comes back after you sign in, ready to check and save.'
              : 'Anything not yet saved will need to be entered again.'}
          </p>
        )}

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

        <p className={styles.note}>
          You enter everything yourself, so the numbers are only as current as your last entry. SpendSense does not
          connect to your bank, import files or move money. It is an early beta, so use Download my data regularly to
          keep your own copy.
        </p>

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
