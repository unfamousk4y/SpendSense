import type { SupabaseClient } from '@supabase/supabase-js';
import { useState } from 'react';
import { deleteMyAccount, exportOwnData, type SaveResult } from '../data/ledgerStore';
import { localDateIn } from '../domain/dates';
import { DeleteAccountDialog } from './DeleteAccountDialog';
import { expectSignOut, signOut } from './useAuth';
import styles from './AccountControls.module.css';

/** Saves text as a file on the student's device. Nothing leaves the browser. */
function saveFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

type AccountControlsProps = { client: SupabaseClient; email: string };

/** Who is signed in, their data, and Sign out. useAuth notices the sign-out and shows the sign-in screen. */
export function AccountControls({ client, email }: AccountControlsProps) {
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function downloadData() {
    setDownloading(true);
    setError(null);
    const now = new Date();
    const result = await exportOwnData(client, now.toISOString());
    setDownloading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const today = localDateIn(now, Intl.DateTimeFormat().resolvedOptions().timeZone);
    saveFile(`spendsense-data-${today}.json`, JSON.stringify(result.file, null, 2));
  }

  async function deleteAccount(): Promise<SaveResult> {
    const deleted = await deleteMyAccount(client);
    if (!deleted.ok) return deleted;
    // Local: the sign-in no longer exists on the server, so only this browser's
    // copy is left to clear. If this fails, Try again is safe and repeats it.
    expectSignOut();
    const { error: signOutError } = await client.auth.signOut({ scope: 'local' });
    return signOutError ? { ok: false, message: 'Your account is deleted, but you could not be signed out here. Try again.' } : { ok: true };
  }

  return (
    <div className={styles.controls}>
      <span className={styles.who}>Signed in as {email}</span>
      <button type="button" className={styles.signOut} onClick={downloadData} disabled={downloading}>
        {downloading ? 'Preparing your data' : 'Download my data'}
      </button>
      <button
        type="button"
        className={styles.signOut}
        onClick={async () => {
          const problem = await signOut();
          setError(problem && `Could not sign out: ${problem}`);
        }}
      >
        Sign out
      </button>
      <button type="button" className={styles.signOut} onClick={() => setConfirmingDelete(true)}>
        Delete my account
      </button>
      {error && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
      {confirmingDelete && (
        <DeleteAccountDialog
          downloading={downloading}
          onDownload={downloadData}
          onDelete={deleteAccount}
          onClose={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}
