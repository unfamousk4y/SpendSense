import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SaveResult } from '../../data/ledgerStore';
import { parseAmount, type AmountInvalidReason } from '../../domain/amount';
import type { IsoDate } from '../../domain/dates';
import type { Currency } from '../../domain/money';
import { previewRelease, type SavingsRelease } from '../../domain/release';
import { Money } from '../../ui/Money';
// Same sheet, title row, amount box and Save button as the other forms.
import formStyles from './PurchaseDialog.module.css';
import styles from './AdjustAllowanceDialog.module.css';

type ReleaseSavingsDialogProps = {
  currency: Currency;
  today: IsoDate;
  protectedCents: number;
  freeCents: number;
  currentCashCents: number;
  /** Resolves when the save is confirmed or has failed. On success the parent closes the form. */
  onSave: (release: SavingsRelease) => Promise<SaveResult>;
  onClose: () => void;
};

const AMOUNT_MESSAGES: Record<AmountInvalidReason, string> = {
  empty: 'Enter how much to release.',
  format: 'Use numbers only, like 50.00 or 1,250.00.',
  commaDecimal: 'Use a period for cents, like 12.50.',
  tooManyDecimals: 'Please only use 2 decimals.',
  notPositive: 'Enter an amount above 0.',
  tooLarge: 'Amounts above 100,000.00 are not supported.',
};

export function ReleaseSavingsDialog({
  currency,
  today,
  protectedCents,
  freeCents,
  currentCashCents,
  onSave,
  onClose,
}: ReleaseSavingsDialogProps) {
  // One id per opening of the form, reused by every attempt to save.
  const [releaseId] = useState(() => crypto.randomUUID());
  const [amountText, setAmountText] = useState('');
  // Set only when Release is pressed, so half-typed text is not flagged early.
  const [showProblem, setShowProblem] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  // Same focus handling as the allowance form: remember the opener once (the
  // effect runs twice in development) and return focus to it on removal.
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!openerRef.current && document.activeElement instanceof HTMLElement) {
      openerRef.current = document.activeElement;
    }
    const opener = openerRef.current;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    amountRef.current?.focus();
    return () => opener?.focus();
  }, []);

  // Worked out from the typed text on every render, never kept in state.
  const parsed = parseAmount(amountText);
  const preview =
    parsed.kind === 'ok' && protectedCents >= 0
      ? previewRelease({ releaseCents: parsed.cents, protectedCents, freeCents })
      : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (parsed.kind !== 'ok' || preview?.kind !== 'ok') {
      setShowProblem(true);
      amountRef.current?.focus();
      return;
    }
    setSaving(true);
    setSaveError(null);
    const saved = await onSave({ id: releaseId, madeOn: today, cents: parsed.cents });
    if (!saved.ok) {
      setSaving(false);
      setSaveError(saved.message);
    }
  }

  const tooMuch = preview?.kind === 'moreThanProtected';
  const formatProblem = parsed.kind === 'invalid' && showProblem;

  return (
    <dialog
      ref={dialogRef}
      className={formStyles.dialog}
      aria-labelledby="release-title"
      onClose={onClose}
      // Escape must not hide a save that is still on its way.
      onCancel={(event) => {
        if (saving) event.preventDefault();
      }}
    >
      <form className={formStyles.form} onSubmit={handleSubmit} noValidate>
        <div className={formStyles.titleRow}>
          <h2 id="release-title" className={formStyles.title}>
            Release protected savings
          </h2>
          <button type="button" className={formStyles.close} onClick={onClose} disabled={saving}>
            Close
          </button>
        </div>

        <dl className={styles.facts}>
          <dt>Protected now</dt>
          <dd>
            <Money cents={protectedCents} currency={currency} />
          </dd>
          <dt>Free cash for the rest of the plan</dt>
          <dd>
            <Money cents={freeCents} currency={currency} />
          </dd>
        </dl>

        {protectedCents === 0 ? (
          <p className={styles.hint}>Nothing is protected yet, so there is nothing to release.</p>
        ) : (
          <>
            <label className={formStyles.field}>
              <span className={formStyles.label}>Amount to release</span>
              <span className={`${formStyles.amountBox} ${tooMuch || formatProblem ? formStyles.invalid : ''}`}>
                <span className={formStyles.prefix} aria-hidden="true">
                  {currency} $
                </span>
                <input
                  ref={amountRef}
                  className={formStyles.amountInput}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  value={amountText}
                  onChange={(event) => {
                    setAmountText(event.target.value);
                    setShowProblem(false);
                  }}
                  aria-label={`Amount to release in ${currency}`}
                  aria-invalid={tooMuch || formatProblem}
                  aria-describedby="release-message"
                />
              </span>
            </label>

            <div id="release-message" role="status" className={styles.message}>
              {formatProblem && parsed.kind === 'invalid' && (
                <p className={formStyles.error}>{AMOUNT_MESSAGES[parsed.reason]}</p>
              )}
              {preview?.kind === 'moreThanProtected' && (
                <p className={formStyles.error}>
                  You can release up to <Money cents={preview.protectedCents} currency={currency} />.
                </p>
              )}
            </div>

            {preview?.kind === 'ok' && (
              <table className={styles.preview}>
                <caption className={styles.caption}>Before and after</caption>
                <thead>
                  <tr>
                    <td />
                    <th scope="col">Now</th>
                    <th scope="col">After releasing</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Protected savings</th>
                    <td>
                      <Money cents={preview.before.protectedCents} currency={currency} />
                    </td>
                    <td className={styles.changed}>
                      <Money cents={preview.after.protectedCents} currency={currency} />
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Free cash for the rest of the plan</th>
                    <td className={preview.before.freeCents < 0 ? styles.negative : ''}>
                      <Money cents={preview.before.freeCents} currency={currency} />
                    </td>
                    <td className={preview.after.freeCents < 0 ? styles.negative : styles.changed}>
                      <Money cents={preview.after.freeCents} currency={currency} />
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Cash</th>
                    <td>
                      <Money cents={currentCashCents} currency={currency} />
                    </td>
                    <td>
                      <Money cents={currentCashCents} currency={currency} />
                    </td>
                  </tr>
                </tbody>
              </table>
            )}

            <p className={styles.footnote}>
              Nothing moves between bank accounts: this only stops setting the money aside. This week’s allowance
              stays the same; adjust it afterwards if you want to spend some of it.
            </p>

            {saveError && (
              <p className={formStyles.error} role="alert">
                {saveError}
              </p>
            )}

            <button type="submit" className={formStyles.save}>
              {saving ? 'Saving' : saveError ? 'Try again' : 'Release savings'}
            </button>
          </>
        )}
      </form>
    </dialog>
  );
}
