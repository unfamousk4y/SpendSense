import { useEffect, useRef, useState } from 'react';
import formStyles from '../features/week/PurchaseDialog.module.css';
import { startGoogleSignIn } from './startGoogleSignIn';

type SessionExpiredDialogProps = { draftKept: boolean; onClose: () => void };

/**
 * Asks the student to sign back in, over whatever form they had open. Signing in
 * leaves the page. Purchases, income and bills come back afterwards; for other
 * forms, Not now lets them see what they typed before they go.
 */
export function SessionExpiredDialog({ draftKept, onClose }: SessionExpiredDialogProps) {
  const [redirecting, setRedirecting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  async function signIn() {
    setProblem(null);
    setRedirecting(true);
    const message = await startGoogleSignIn();
    if (message) {
      setProblem(message);
      setRedirecting(false);
    }
  }

  return (
    <dialog ref={dialogRef} className={formStyles.dialog} aria-labelledby="session-title" onClose={onClose}>
      <div className={formStyles.form}>
        <h2 id="session-title" className={formStyles.title}>
          Sign in again
        </h2>
        <p>
          Your sign-in has expired, so this was not saved. Everything you saved earlier is safe.{' '}
          {draftKept
            ? 'What you typed comes back after you sign in, ready to check and save.'
            : 'Signing in reloads the page, so anything not yet saved will need to be entered again.'}
        </p>
        {problem && (
          <p className={formStyles.error} role="alert">
            Sign-in did not start: {problem}
          </p>
        )}
        <button type="button" className={formStyles.save} onClick={() => void signIn()} disabled={redirecting}>
          {redirecting ? 'Opening Google' : 'Sign in again'}
        </button>
        <button type="button" className={formStyles.close} onClick={onClose} disabled={redirecting}>
          Not now
        </button>
      </div>
    </dialog>
  );
}
