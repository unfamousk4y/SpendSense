import { useEffect, useRef, useState } from 'react';
import type { SaveResult } from '../../data/ledgerStore';
import type { BalanceCorrection } from '../../domain/correction';
import type { Currency } from '../../domain/money';
import { Money } from '../../ui/Money';
import formStyles from './PurchaseDialog.module.css';
import styles from './AdjustAllowanceDialog.module.css';

type UndoCorrectionDialogProps = {
  currency: Currency;
  correction: BalanceCorrection;
  dateLabel: string;
  currentCashCents: number;
  /** Resolves when the undo is confirmed or has failed. On success the parent closes this. */
  onUndo: (correction: BalanceCorrection) => Promise<SaveResult>;
  onClose: () => void;
};

/** A saved correction cannot be edited: a wrong one is undone and entered again. */
export function UndoCorrectionDialog({ currency, correction, dateLabel, currentCashCents, onUndo, onClose }: UndoCorrectionDialogProps) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDialogElement>(null);
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
    return () => opener?.focus();
  }, []);

  async function handleUndo() {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    const result = await onUndo(correction);
    if (!result.ok) {
      setSaving(false);
      setSaveError(result.message);
    }
  }

  const lowered = correction.differenceCents < 0;

  return (
    <dialog
      ref={dialogRef}
      className={formStyles.dialog}
      aria-labelledby="undo-correction-title"
      onClose={onClose}
      // Escape must not hide a save that is still on its way.
      onCancel={(event) => {
        if (saving) event.preventDefault();
      }}
    >
      <div className={formStyles.form}>
        <div className={formStyles.titleRow}>
          <h2 id="undo-correction-title" className={formStyles.title}>
            Balance correction
          </h2>
          <button type="button" className={formStyles.close} onClick={onClose} disabled={saving}>
            Close
          </button>
        </div>

        <p className={styles.hint}>
          {dateLabel}: {lowered ? 'lowered' : 'raised'} cash by{' '}
          <Money cents={Math.abs(correction.differenceCents)} currency={currency} />.
          {correction.note && <> Note: {correction.note}</>}
        </p>
        <p className={styles.hint}>
          Undoing puts cash back to <Money cents={currentCashCents - correction.differenceCents} currency={currency} />. If the
          amount was wrong, undo this and enter the correction again.
        </p>

        {saveError && (
          <p className={formStyles.error} role="alert">
            {saveError}
          </p>
        )}

        <button type="button" className={formStyles.save} onClick={() => void handleUndo()}>
          {saving ? 'Undoing' : saveError ? 'Try again' : 'Undo correction'}
        </button>
      </div>
    </dialog>
  );
}
