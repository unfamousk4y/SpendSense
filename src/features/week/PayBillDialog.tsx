import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SaveResult } from '../../data/ledgerStore';
import { parseAmount, type AmountInvalidReason } from '../../domain/amount';
import { previewBillPayment, type Bill, type BillPayment } from '../../domain/bills';
import type { IsoDate } from '../../domain/dates';
import { formatCents, type Currency } from '../../domain/money';
import { Money } from '../../ui/Money';
// Same sheet, title row, amount box and Save button as the other forms.
import formStyles from './PurchaseDialog.module.css';
import styles from './AdjustAllowanceDialog.module.css';

type PayBillDialogProps = {
  currency: Currency;
  bill: Bill;
  /** Days it may be dated, newest first; the first is today. Never a day to come. */
  dates: { date: IsoDate; label: string }[];
  planEndDate: IsoDate;
  planEndLabel: string;
  currentCashCents: number;
  commitmentsCents: number;
  freeCents: number;
  remainingCents: number;
  /** Resolves when the save is confirmed or has failed. On success the parent closes the form. */
  onPay: (bill: Bill, payment: BillPayment) => Promise<SaveResult>;
  onUndo: (bill: Bill) => Promise<SaveResult>;
  onClose: () => void;
};

const AMOUNT_MESSAGES: Record<AmountInvalidReason, string> = {
  empty: 'Enter how much you paid.',
  format: 'Use numbers only, like 150.00 or 1,250.00.',
  commaDecimal: 'Use a period for cents, like 12.50.',
  tooManyDecimals: 'Please only use 2 decimals.',
  notPositive: 'Enter an amount above 0.',
  tooLarge: 'Amounts above 100,000.00 are not supported.',
};

/** Paying a bill, or, for one already paid this week, correcting or undoing that. */
export function PayBillDialog({
  currency,
  bill,
  dates,
  planEndDate,
  planEndLabel,
  currentCashCents,
  commitmentsCents,
  freeCents,
  remainingCents,
  onPay,
  onUndo,
  onClose,
}: PayBillDialogProps) {
  const alreadyPaid = bill.paidOn !== undefined;
  const [amountText, setAmountText] = useState(formatCents(bill.paidCents ?? bill.cents));
  const [paidOn, setPaidOn] = useState(bill.paidOn ?? dates[0].date);
  // Set only when Save is pressed, so half-typed text is not flagged early.
  const [showProblem, setShowProblem] = useState(false);
  const [confirmingUndo, setConfirmingUndo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
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
    amountRef.current?.focus();
    return () => opener?.focus();
  }, []);

  // Worked out from the typed text on every render, never kept in state.
  const parsed = parseAmount(amountText);
  const preview =
    parsed.kind === 'ok'
      ? previewBillPayment({
          bill,
          payment: { paidOn, paidCents: parsed.cents },
          planEndDate,
          currentCashCents,
          commitmentsCents,
          freeCents,
        })
      : null;
  const amountProblem = parsed.kind === 'invalid' && showProblem ? parsed.reason : null;

  async function run(save: () => Promise<SaveResult>) {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    const result = await save();
    if (!result.ok) {
      setSaving(false);
      setSaveError(result.message);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (parsed.kind !== 'ok') {
      setShowProblem(true);
      amountRef.current?.focus();
      return;
    }
    void run(() => onPay(bill, { paidOn, paidCents: parsed.cents }));
  }

  return (
    <dialog
      ref={dialogRef}
      className={formStyles.dialog}
      aria-labelledby="pay-title"
      onClose={onClose}
      // Escape must not hide a save that is still on its way.
      onCancel={(event) => {
        if (saving) event.preventDefault();
      }}
    >
      <form className={formStyles.form} onSubmit={handleSubmit} noValidate>
        <div className={formStyles.titleRow}>
          <h2 id="pay-title" className={formStyles.title}>
            {alreadyPaid ? `Payment for ${bill.name}` : `Pay ${bill.name}`}
          </h2>
          <button type="button" className={formStyles.close} onClick={onClose} disabled={saving}>
            Close
          </button>
        </div>

        <p className={styles.hint}>
          Record this once you have paid it. The bill was <Money cents={bill.cents} currency={currency} />; if it came in
          different, enter what you actually paid. Nothing moves between bank accounts.
        </p>

        <label className={formStyles.field}>
          <span className={formStyles.label}>Amount paid</span>
          <span className={`${formStyles.amountBox} ${amountProblem ? formStyles.invalid : ''}`}>
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
              aria-label={`Amount paid in ${currency}`}
              aria-invalid={amountProblem !== null}
              aria-describedby={amountProblem ? 'pay-amount-error' : undefined}
            />
          </span>
          {amountProblem && (
            <span id="pay-amount-error" className={formStyles.error}>
              {AMOUNT_MESSAGES[amountProblem]}
            </span>
          )}
        </label>

        <label className={formStyles.field}>
          <span className={formStyles.label}>Date paid</span>
          <select className={formStyles.textInput} value={paidOn} onChange={(event) => setPaidOn(event.target.value)}>
            {dates.map((option, index) => (
              <option key={option.date} value={option.date}>
                {index === 0 ? `${option.label} (today)` : option.label}
              </option>
            ))}
          </select>
        </label>

        {preview && (
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
                    <Money cents={preview.before.cashCents} currency={currency} />
                  </td>
                  <td className={styles.changed}>
                    <Money cents={preview.after.cashCents} currency={currency} />
                  </td>
                </tr>
                <tr>
                  <th scope="row">Unpaid bills due by {planEndLabel}</th>
                  <td>
                    <Money cents={preview.before.commitmentsCents} currency={currency} />
                  </td>
                  <td className={styles.changed}>
                    <Money cents={preview.after.commitmentsCents} currency={currency} />
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
              </tbody>
            </table>
            <p className={styles.footnote}>
              A bill payment is not spending, so this week’s remaining amount stays at{' '}
              <Money cents={remainingCents} currency={currency} />.
            </p>
          </>
        )}

        {alreadyPaid && (
          <div className={formStyles.deleteArea}>
            {confirmingUndo ? (
              <div className={formStyles.confirm} role="group" aria-labelledby="pay-confirm-text">
                <p id="pay-confirm-text" className={formStyles.confirmText}>
                  Undo this payment? <Money cents={bill.paidCents ?? 0} currency={currency} /> goes back into cash and{' '}
                  {bill.name} is unpaid again.
                </p>
                <div className={formStyles.confirmButtons}>
                  <button type="button" className={formStyles.secondary} onClick={() => setConfirmingUndo(false)}>
                    Cancel
                  </button>
                  <button type="button" className={formStyles.danger} onClick={() => void run(() => onUndo(bill))}>
                    {saving ? 'Undoing' : 'Undo payment'}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className={formStyles.deleteLink} onClick={() => setConfirmingUndo(true)}>
                Undo payment
              </button>
            )}
          </div>
        )}

        {saveError && (
          <p className={formStyles.error} role="alert">
            {saveError}
          </p>
        )}

        <button type="submit" className={formStyles.save}>
          {saving ? 'Saving' : saveError ? 'Try again' : alreadyPaid ? 'Save changes' : 'Save payment'}
        </button>
      </form>
    </dialog>
  );
}
