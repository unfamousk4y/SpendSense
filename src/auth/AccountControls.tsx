import { useState } from 'react';
import { signOut } from './useAuth';
import styles from './AccountControls.module.css';

/** Who is signed in, and Sign out. useAuth notices the sign-out and shows the sign-in screen. */
export function AccountControls({ email }: { email: string }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={styles.controls}>
      <span className={styles.who}>Signed in as {email}</span>
      <button
        type="button"
        className={styles.signOut}
        onClick={async () => {
          setError(await signOut());
        }}
      >
        Sign out
      </button>
      {error && (
        <span className={styles.error} role="alert">
          Could not sign out: {error}
        </span>
      )}
    </div>
  );
}
