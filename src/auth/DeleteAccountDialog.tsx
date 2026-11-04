import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SaveResult } from '../data/ledgerStore';
// Same sheet, title row, text box and main button as the other forms.
import formStyles from '../features/week/PurchaseDialog.module.css';
import styles from './AccountControls.module.css';

const CONFIRMATION = 'DELETE';

type DeleteAccountDialogProps = {
  downloading: boolean;
  onDownload: () => void;
  /** Resolves when the deletion is confirmed or has failed. On success the student is signed out. */
  onDelete: () => Promise<SaveResult>;
  onClose: () => void;
};

export function DeleteAccountDialog({ downloading, onDownload, onDelete, onClose }: DeleteAccountDialogProps) {
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Same focus handling as the other forms: remember the opener once (the
  // effect runs twice in development) and return focus to it on removal.
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!openerRef.current && document.activeElement instanceof HTMLElement) {
      openerRef.current = document.activeElement;
    }
    const opener = openerRef.current;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    inputRef.current?.focus();
    return () => opener?.focus();
  }, []);

  const confirmed = typed.trim() === CONFIRMATION;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (deleting || !confirmed) return;
    setDeleting(true);
    setError(null);
    const result = await onDelete();
    if (!result.ok) {
      setDeleting(false);
      setError(result.message);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={formStyles.dialog}
      aria-labelledby="delete-account-title"
      onClose={onClose}
      // Escape must not hide a deletion that is still on its way.
      onCancel={(event) => {
        if (deleting) event.preventDefault();
      }}
    >
      <form className={formStyles.form} onSubmit={handleSubmit} noValidate>
        <div className={formStyles.titleRow}>
          <h2 id="delete-account-title" className={formStyles.title}>
            Delete my account
          </h2>
          <button type="button" className={formStyles.close} onClick={onClose} disabled={deleting}>
            Close
          </button>
        </div>

        <p className={styles.explain}>
          This permanently removes your sign-in and everything you have saved here: your USD and BSD accounts,
          purchases, weekly plans, closed weeks and savings records. It cannot be undone.
        </p>
        <p className={styles.explain}>Your real bank accounts and money are not affected.</p>

        <button type="button" className={styles.signOut} onClick={onDownload} disabled={downloading || deleting}>
          {downloading ? 'Preparing your data' : 'Download my data first'}
        </button>

        <label className={formStyles.field}>
          <span className={formStyles.label}>Type {CONFIRMATION} to confirm</span>
          <input
            ref={inputRef}
            className={formStyles.textInput}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
        </label>

        {error && (
          <p className={formStyles.error} role="alert">
            {error}
          </p>
        )}

        <button type="submit" className={`${formStyles.save} ${styles.danger}`} disabled={!confirmed || deleting}>
          {deleting ? 'Deleting' : error ? 'Try again' : 'Delete my account'}
        </button>
      </form>
    </dialog>
  );
}
