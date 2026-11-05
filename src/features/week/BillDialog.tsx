import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SaveResult } from '../../data/ledgerStore';
import { parseAmount, type AmountInvalidReason } from '../../domain/amount';
import { previewBillChange, type Bill } from '../../domain/bills';
import type { IsoDate } from '../../domain/dates';
import { formatCents, type Currency } from '../../domain/money';
import { Money } from '../../ui/Money';
// Same sheet, title row, amount box and Save button as the other forms.
import formStyles from './PurchaseDialog.module.css';
import styles from './AdjustAllowanceDialog.module.css';

type BillDialogProps = {
  currency: Currency;
  /** Present when editing: the form starts filled in and offers Delete. */
  existing?: Bill;
  planEndDate: IsoDate;
  planEndLabel: string;
  commitmentsCents: number;
  freeCents: number;
  spentCents: number;
  allowanceCents: number;
  daysThisWeek: number;
  daysLeft: number;
  /** Resolves when the save is confirmed or has failed. On success the parent closes the form. */
  onSave: (bill: Bill) => Promise<SaveResult>;
  onDelete: (bill: Bill) => Promise<SaveResult>;
  onClose: () => void;
};

const AMOUNT_MESSAGES: Record<AmountInvalidReason, string> = {
  empty: 'Enter how much the bill is.',
  format: 'Use numbers only, like 150.00 or 1,250.00.',
  commaDecimal: 'Use a period for cents, like 12.50.',
  tooManyDecimals: 'Please only use 2 decimals.',
  notPositive: 'Enter an amount above 0.',
  tooLarge: 'Amounts above 100,000.00 are not supported.',
};

export function BillDialog({
  currency,
  existing,
  planEndDate,
  planEndLabel,
  commitmentsCents,
  freeCents,
  spentCents,
  allowanceCents,
  daysThisWeek,
  daysLeft,
  onSave,
  onDelete,
  onClose,
}: BillDialogProps) {
  // An edit keeps its id; a new bill gets one per opening of the form, which
  // every attempt to save reuses, so a retry cannot add the bill twice.
  const [billId] = useState(() => existing?.id ?? crypto.randomUUID());
  const [name, setName] = useState(existing?.name ?? '');
  const [amountText, setAmountText] = useState(existing ? formatCents(existing.cents) : '');
  const [dueOn, setDueOn] = useState(existing?.dueOn ?? '');
  // Set only when Save is pressed, so half-typed text is not flagged early.
  const [showProblems, setShowProblems] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const dueRef = useRef<HTMLInputElement>(null);
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
    nameRef.current?.focus();
    return () => opener?.focus();
  }, []);

  // Worked out from what is typed on every render, never kept in state.
  const trimmedName = name.trim();
  const parsed = parseAmount(amountText);
  const draft: Bill | null =
    trimmedName && parsed.kind === 'ok' && dueOn ? { ...existing, id: billId, name: trimmedName, cents: parsed.cents, dueOn } : null;
  const preview = draft
    ? previewBillChange({ before: existing, after: draft, planEndDate, commitmentsCents, freeCents, spentCents, daysThisWeek, daysLeft })
    : null;

  const nameProblem = showProblems && !trimmedName;
  const amountProblem = showProblems && parsed.kind === 'invalid' ? parsed.reason : null;
  const dueProblem = showProblems && !dueOn;

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
    if (!draft) {
      setShowProblems(true);
      (!trimmedName ? nameRef : parsed.kind !== 'ok' ? amountRef : dueRef).current?.focus();
      return;
    }
    void run(() => onSave(draft));
  }

  return (
    <dialog
      ref={dialogRef}
      className={formStyles.dialog}
      aria-labelledby="bill-title"
      onClose={onClose}
      // Escape must not hide a save that is still on its way.
      onCancel={(event) => {
        if (saving) event.preventDefault();
      }}
    >
      <form className={formStyles.form} onSubmit={handleSubmit} noValidate>
        <div className={formStyles.titleRow}>
          <h2 id="bill-title" className={formStyles.title}>
            {existing ? 'Edit bill' : 'Add bill'}
          </h2>
          <button type="button" className={formStyles.close} onClick={onClose} disabled={saving}>
            Close
          </button>
        </div>

        <label className={formStyles.field}>
          <span className={formStyles.label}>Bill name</span>
          <input
            ref={nameRef}
            className={`${formStyles.textInput} ${nameProblem ? formStyles.invalid : ''}`}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setShowProblems(false);
            }}
            maxLength={60}
            autoComplete="off"
            placeholder="Rent, phone, tuition"
            aria-invalid={nameProblem}
            aria-describedby={nameProblem ? 'bill-name-error' : undefined}
          />
          {nameProblem && (
            <span id="bill-name-error" className={formStyles.error}>
              Enter a name for this bill.
            </span>
          )}
        </label>

        <label className={formStyles.field}>
          <span className={formStyles.label}>Amount</span>
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
                setShowProblems(false);
              }}
              aria-label={`Bill amount in ${currency}`}
              aria-invalid={amountProblem !== null}
              aria-describedby={amountProblem ? 'bill-amount-error' : undefined}
            />
          </span>
          {amountProblem && (
            <span id="bill-amount-error" className={formStyles.error}>
              {AMOUNT_MESSAGES[amountProblem]}
            </span>
          )}
        </label>

        <label className={formStyles.field}>
          <span className={formStyles.label}>Due date</span>
          <input
            ref={dueRef}
            type="date"
            className={`${formStyles.textInput} ${dueProblem ? formStyles.invalid : ''}`}
            value={dueOn}
            onChange={(event) => {
              setDueOn(event.target.value);
              setShowProblems(false);
            }}
            aria-invalid={dueProblem}
            aria-describedby={dueProblem ? 'bill-due-error' : undefined}
          />
          {dueProblem && (
            <span id="bill-due-error" className={formStyles.error}>
              Choose the date this bill is due.
            </span>
          )}
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
              {!preview.counted && <>This bill is due after your plan ends on {planEndLabel}, so it is listed but not counted. </>}
              {preview.after.freeCents < 0 && <>Your plan would be short by <Money cents={-preview.after.freeCents} currency={currency} />. </>}
              This week’s allowance stays at <Money cents={allowanceCents} currency={currency} /> unless you change it.
              {preview.suggestion.kind === 'ok' && (
                <>
                  {' '}
                  With this saved, the suggestion for this week would be{' '}
                  <Money cents={preview.suggestion.totalCents} currency={currency} />.
                </>
              )}
            </p>
          </>
        )}

        {existing && (
          <div className={formStyles.deleteArea}>
            {confirmingDelete ? (
              <div className={formStyles.confirm} role="group" aria-labelledby="bill-confirm-text">
                <p id="bill-confirm-text" className={formStyles.confirmText}>
                  Delete {existing.name}, <Money cents={existing.cents} currency={currency} />?
                </p>
                <div className={formStyles.confirmButtons}>
                  <button type="button" className={formStyles.secondary} onClick={() => setConfirmingDelete(false)}>
                    Cancel
                  </button>
                  <button type="button" className={formStyles.danger} onClick={() => void run(() => onDelete(existing))}>
                    {saving ? 'Deleting' : 'Delete'}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className={formStyles.deleteLink} onClick={() => setConfirmingDelete(true)}>
                Delete bill
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
          {saving ? 'Saving' : saveError ? 'Try again' : existing ? 'Save changes' : 'Save bill'}
        </button>
      </form>
    </dialog>
  );
}
