import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SaveResult } from '../../data/ledgerStore';
import { centsOrZero, parseAmount } from '../../domain/amount';
import { remainingOverFreeCash } from '../../domain/allowanceChange';
import { previewCorrection, type BalanceCorrection } from '../../domain/correction';
import type { IsoDate } from '../../domain/dates';
import type { Currency } from '../../domain/money';
import { Money } from '../../ui/Money';
// Same sheet, title row, amount box and Save button as the other forms.
import formStyles from './PurchaseDialog.module.css';
import styles from './AdjustAllowanceDialog.module.css';

type CorrectBalanceDialogProps = {
  currency: Currency;
  today: IsoDate;
  currentCashCents: number;
  freeCents: number;
  spentCents: number;
  remainingCents: number;
  allowanceCents: number;
  daysThisWeek: number;
  daysLeft: number;
  /** Resolves when the save is confirmed or has failed. On success the parent closes the form. */
  onSave: (correction: BalanceCorrection) => Promise<SaveResult>;
  onClose: () => void;
};

export function CorrectBalanceDialog({
  currency,
  today,
  currentCashCents,
  freeCents,
  spentCents,
  remainingCents,
  allowanceCents,
  daysThisWeek,
  daysLeft,
  onSave,
  onClose,
}: CorrectBalanceDialogProps) {
  // One per opening of the form, which every attempt to save reuses, so a retry
  // cannot apply the correction twice.
  const [correctionId] = useState(() => crypto.randomUUID());
  const [balanceText, setBalanceText] = useState('');
  const [note, setNote] = useState('');
  // Set only when Save is pressed, so half-typed text is not flagged early.
  const [showProblem, setShowProblem] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const balanceRef = useRef<HTMLInputElement>(null);
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
    balanceRef.current?.focus();
    return () => opener?.focus();
  }, []);

  // Worked out from the typed text on every render, never kept in state. 0 is a
  // real balance; null means the text is not an amount.
  const actualCents = balanceText.trim() === '' ? null : centsOrZero(parseAmount(balanceText));
  const preview =
    actualCents === null
      ? null
      : previewCorrection({ actualCents, currentCashCents, freeCents, spentCents, daysThisWeek, daysLeft });
  const ok = preview?.kind === 'ok' ? preview : null;
  const overFreeCash = ok && remainingOverFreeCash({ remainingCents, freeCents: ok.after.freeCents });

  const problem =
    preview?.kind === 'tooLarge'
      ? 'That is more than 100,000.00 away from the cash shown. Check the amount.'
      : showProblem && balanceText.trim() === ''
        ? 'Enter the balance you can see.'
        : showProblem && actualCents === null
          ? 'Use numbers only, like 940.00.'
          : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (preview?.kind === 'noDifference') return;
    if (!ok) {
      setShowProblem(true);
      balanceRef.current?.focus();
      return;
    }
    setSaving(true);
    setSaveError(null);
    const result = await onSave({
      id: correctionId,
      date: today,
      differenceCents: ok.differenceCents,
      ...(note.trim() && { note: note.trim() }),
    });
    if (!result.ok) {
      setSaving(false);
      setSaveError(result.message);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={formStyles.dialog}
      aria-labelledby="correct-title"
      onClose={onClose}
      // Escape must not hide a save that is still on its way.
      onCancel={(event) => {
        if (saving) event.preventDefault();
      }}
    >
      <form className={formStyles.form} onSubmit={handleSubmit} noValidate>
        <div className={formStyles.titleRow}>
          <h2 id="correct-title" className={formStyles.title}>
            Correct balance
          </h2>
          <button type="button" className={formStyles.close} onClick={onClose} disabled={saving}>
            Close
          </button>
        </div>

        <p className={styles.hint}>
          Forgot something? If you missed a purchase this week, add it as spending. If money arrived, add it as income. Use
          this only for a difference you cannot explain or cannot fix any other way.
        </p>

        <label className={formStyles.field}>
          <span className={formStyles.label}>Your actual balance now</span>
          <span className={`${formStyles.amountBox} ${problem ? formStyles.invalid : ''}`}>
            <span className={formStyles.prefix} aria-hidden="true">
              {currency} $
            </span>
            <input
              ref={balanceRef}
              className={formStyles.amountInput}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={balanceText}
              onChange={(event) => {
                setBalanceText(event.target.value);
                setShowProblem(false);
              }}
              aria-label={`Your actual balance now in ${currency}`}
              aria-invalid={problem !== null}
              aria-describedby={problem ? 'correct-error' : 'correct-shown'}
            />
          </span>
          {problem ? (
            <span id="correct-error" className={formStyles.error}>
              {problem}
            </span>
          ) : (
            <span id="correct-shown" className={styles.footnote}>
              SpendSense shows <Money cents={currentCashCents} currency={currency} />.
            </span>
          )}
        </label>

        <label className={formStyles.field}>
          <span className={formStyles.label}>
            Note <span className={formStyles.optional}>optional</span>
          </span>
          <input
            className={formStyles.textInput}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={120}
            placeholder="Bank fee, unknown difference"
          />
        </label>

        {preview?.kind === 'noDifference' && (
          <p className={styles.footnote} role="status">
            That matches the cash shown, so there is nothing to correct.
          </p>
        )}

        {ok && (
          <>
            <table className={styles.preview}>
              <caption className={styles.caption}>Before and after</caption>
              <thead>
                <tr>
                  <td />
                  <th scope="col">Now</th>
                  <th scope="col">After saving</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Cash</th>
                  <td>
                    <Money cents={ok.before.cashCents} currency={currency} />
                  </td>
                  <td className={styles.changed}>
                    <Money cents={ok.after.cashCents} currency={currency} />
                  </td>
                </tr>
                <tr>
                  <th scope="row">Free cash for the rest of the plan</th>
                  <td className={ok.before.freeCents < 0 ? styles.negative : ''}>
                    <Money cents={ok.before.freeCents} currency={currency} />
                  </td>
                  <td className={ok.after.freeCents < 0 ? styles.negative : styles.changed}>
                    <Money cents={ok.after.freeCents} currency={currency} />
                  </td>
                </tr>
              </tbody>
            </table>
            <p className={styles.footnote}>
              That is <Money cents={Math.abs(ok.differenceCents)} currency={currency} />{' '}
              {ok.differenceCents < 0 ? 'less' : 'more'} than SpendSense shows. A correction is not spending, so this week’s
              remaining amount stays at <Money cents={remainingCents} currency={currency} /> and your allowance at{' '}
              <Money cents={allowanceCents} currency={currency} /> unless you change it.
              {ok.after.freeCents < 0 && (
                <>
                  {' '}
                  Your plan would be short by <Money cents={-ok.after.freeCents} currency={currency} />.
                </>
              )}
              {overFreeCash && (
                <>
                  {' '}
                  {overFreeCash.availableCents > 0 ? (
                    <>
                      Only <Money cents={overFreeCash.availableCents} currency={currency} /> of that remaining amount would be
                      available, so you may want to adjust your allowance.
                    </>
                  ) : (
                    'None of that remaining amount would be available, so you may want to adjust your allowance.'
                  )}
                </>
              )}
              {ok.suggestion.kind === 'ok' && (
                <>
                  {' '}
                  With this saved, the suggestion for this week would be{' '}
                  <Money cents={ok.suggestion.totalCents} currency={currency} />.
                </>
              )}
            </p>
          </>
        )}

        {saveError && (
          <p className={formStyles.error} role="alert">
            {saveError}
          </p>
        )}

        <button type="submit" className={formStyles.save} disabled={preview?.kind === 'noDifference'}>
          {saving ? 'Saving' : saveError ? 'Try again' : 'Save correction'}
        </button>
      </form>
    </dialog>
  );
}
