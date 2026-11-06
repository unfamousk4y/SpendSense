import { useEffect, useRef, useState, type FormEvent } from 'react';
import { parseAmount, type AmountInvalidReason } from '../../domain/amount';
import { CATEGORIES, purchaseTitle, type CategoryId, type NeedOrWant } from '../../domain/categories';
import type { SaveResult } from '../../data/ledgerStore';
import type { IsoDate } from '../../domain/dates';
import { formatCents, type Currency } from '../../domain/money';
import type { Purchase } from '../../domain/week';
import { Money } from '../../ui/Money';
import styles from './PurchaseDialog.module.css';

type PurchaseDialogProps = {
  currency: Currency;
  /** Days the purchase may be dated, newest first; the first is today. */
  dates: { date: IsoDate; label: string }[];
  /** Present when editing: the form starts filled in and offers Delete. */
  existing?: Purchase;
  /** What the student was saving when their session ended. Not saved yet. */
  restored?: Purchase;
  /** Resolves when the save is confirmed or has failed. On success the parent closes the form. */
  onSave: (purchase: Purchase) => Promise<SaveResult>;
  onDelete?: (id: string) => Promise<SaveResult>;
  onClose: () => void;
};

// The screen's wording for each reason parseAmount can return.
const AMOUNT_MESSAGES: Record<AmountInvalidReason, string> = {
  empty: 'Enter an amount.',
  format: 'Use numbers only, like 12.50 or 1,250.00.',
  commaDecimal: 'Use a period for cents, like 12.50.',
  tooManyDecimals: 'Please only use 2 decimals.',
  notPositive: 'Enter an amount above 0.',
  tooLarge: 'Amounts above 100,000.00 are not supported.',
};

/** A restored date may have left the list if days passed while signed out. */
function startingDate(start: Purchase | undefined, dates: { date: IsoDate }[]): IsoDate {
  return start && dates.some((option) => option.date === start.date) ? start.date : dates[0].date;
}

export function PurchaseDialog({ currency, dates, existing, restored, onSave, onDelete, onClose }: PurchaseDialogProps) {
  const isEditing = existing !== undefined;
  const start = restored ?? existing;

  // The id belongs to one real purchase for its whole life: an edit keeps the
  // existing one; a new entry gets one id per opening of the form, which every
  // save attempt reuses, so addPurchaseOnce can ignore a double tap.
  const [entryId] = useState(() => start?.id ?? crypto.randomUUID());

  // Controlled inputs: each box shows exactly what is in state. When editing,
  // they start from the existing purchase.
  const [amountText, setAmountText] = useState(start ? formatCents(start.cents) : '');
  const [category, setCategory] = useState<CategoryId | null>(start?.category ?? null);
  const [needOrWant, setNeedOrWant] = useState<NeedOrWant | null>(start?.needOrWant ?? null);
  const [merchant, setMerchant] = useState(start?.merchant ?? '');
  const [note, setNote] = useState(start?.note ?? '');
  const [date, setDate] = useState(startingDate(start, dates));
  const [amountError, setAmountError] = useState<AmountInvalidReason | null>(null);
  // Delete asks first, inside the form, so one mis-tap cannot remove a purchase.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // While a save is on its way the form stays open and cannot be sent again. If
  // it fails, everything typed is still here and the student can retry, with
  // the same id, so a save that actually got through cannot be duplicated.
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // A ref is a handle to the real browser element, for the few things React
  // does not do itself: opening a <dialog> as a modal and moving focus.
  const dialogRef = useRef<HTMLDialogElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  const openerRef = useRef<HTMLElement | null>(null);

  // On mount: open as a modal (dims the page, keeps keyboard focus inside,
  // Escape closes it) and put the cursor in the amount box. On unmount: return
  // focus to the button that opened the form.
  // In development React runs effects twice: the open check and remembering the
  // opener only once both exist for that reason.
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

  /** Runs a save or delete; only a failure comes back here, since success closes the form. */
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
    // Stop the browser's default "send the form and reload the page".
    event.preventDefault();
    const result = parseAmount(amountText);
    if (result.kind === 'invalid') {
      setAmountError(result.reason);
      amountRef.current?.focus();
      return;
    }
    void run(() =>
      onSave({
        id: entryId,
        date,
        merchant: merchant.trim(),
        ...(note.trim() && { note: note.trim() }),
        ...(category && { category }),
        ...(needOrWant && { needOrWant }),
        cents: result.cents,
      }),
    );
  }

  return (
    // onClose fires for Escape too, so every way of closing goes through the parent.
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="purchase-title"
      onClose={onClose}
      // Escape must not hide a save that is still on its way.
      onCancel={(event) => {
        if (saving) event.preventDefault();
      }}
    >
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <div className={styles.titleRow}>
          <h2 id="purchase-title" className={styles.title}>
            {isEditing ? 'Edit purchase' : 'Add spending'}
          </h2>
          <button type="button" className={styles.close} onClick={onClose} disabled={saving}>
            Close
          </button>
        </div>

        {restored && (
          <p className={styles.restored} role="status">
            Brought back after you signed in. This is not saved yet, so check it and save.
          </p>
        )}

        <label className={styles.field}>
          <span className={styles.label}>Amount</span>
          <span className={`${styles.amountBox} ${amountError ? styles.invalid : ''}`}>
            <span className={styles.prefix} aria-hidden="true">
              {currency} $
            </span>
            <input
              ref={amountRef}
              className={styles.amountInput}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={amountText}
              onChange={(event) => {
                setAmountText(event.target.value);
                setAmountError(null);
              }}
              aria-label={`Amount in ${currency}`}
              aria-invalid={amountError !== null}
              aria-describedby={amountError ? 'amount-error' : undefined}
            />
          </span>
          {amountError && (
            <span id="amount-error" className={styles.error}>
              {AMOUNT_MESSAGES[amountError]}
            </span>
          )}
        </label>

        <fieldset className={styles.group}>
          <legend className={styles.label}>
            Category <span className={styles.optional}>optional</span>
          </legend>
          <div className={styles.chips}>
            {CATEGORIES.map((option) => (
              <button
                key={option.id}
                type="button"
                className={styles.chip}
                aria-pressed={category === option.id}
                // Tapping the selected chip again clears it.
                onClick={() => setCategory(category === option.id ? null : option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.label}>
            Need or want <span className={styles.optional}>optional</span>
          </legend>
          <div className={styles.segmented}>
            {(['need', 'want'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={styles.segment}
                aria-pressed={needOrWant === option}
                onClick={() => setNeedOrWant(needOrWant === option ? null : option)}
              >
                {option === 'need' ? 'Need' : 'Want'}
              </button>
            ))}
          </div>
        </fieldset>

        <label className={styles.field}>
          <span className={styles.label}>
            Where <span className={styles.optional}>optional</span>
          </span>
          <input
            className={styles.textInput}
            value={merchant}
            onChange={(event) => setMerchant(event.target.value)}
            maxLength={60}
            placeholder="Campus café"
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>
            Note <span className={styles.optional}>optional</span>
          </span>
          <input
            className={styles.textInput}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={120}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Date</span>
          <select className={styles.textInput} value={date} onChange={(event) => setDate(event.target.value)}>
            {dates.map((option, index) => (
              <option key={option.date} value={option.date}>
                {index === 0 ? `${option.label} (today)` : option.label}
              </option>
            ))}
          </select>
        </label>

        {isEditing && onDelete && (
          <div className={styles.deleteArea}>
            {confirmingDelete ? (
              <div className={styles.confirm} role="group" aria-labelledby="confirm-text">
                <p id="confirm-text" className={styles.confirmText}>
                  Delete {purchaseTitle(existing)}, <Money cents={existing.cents} currency={currency} />?
                </p>
                <div className={styles.confirmButtons}>
                  <button type="button" className={styles.secondary} onClick={() => setConfirmingDelete(false)}>
                    Cancel
                  </button>
                  <button type="button" className={styles.danger} onClick={() => void run(() => onDelete(existing.id))}>
                    {saving ? 'Deleting' : 'Delete'}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className={styles.deleteLink} onClick={() => setConfirmingDelete(true)}>
                Delete purchase
              </button>
            )}
          </div>
        )}

        {/* role="alert" reads the problem out as soon as it appears. */}
        {saveError && (
          <p className={styles.error} role="alert">
            {saveError}
          </p>
        )}

        <button type="submit" className={styles.save}>
          {saving ? 'Saving' : saveError ? 'Try again' : isEditing ? 'Save changes' : 'Save purchase'}
        </button>
      </form>
    </dialog>
  );
}
