import { useEffect, useRef, useState, type FormEvent } from 'react';
import { parseAmount, type AmountInvalidReason } from '../../domain/amount';
import { CATEGORIES, type CategoryId, type NeedOrWant } from '../../domain/categories';
import type { IsoDate } from '../../domain/dates';
import type { Currency } from '../../domain/money';
import type { Purchase } from '../../domain/week';
import styles from './AddSpendingDialog.module.css';

type AddSpendingDialogProps = {
  currency: Currency;
  /** Days the purchase may be dated, newest first; the first is today. */
  dates: { date: IsoDate; label: string }[];
  onSave: (purchase: Purchase) => void;
  onClose: () => void;
};

// The screen's wording for each reason parseAmount can return.
const AMOUNT_MESSAGES: Record<AmountInvalidReason, string> = {
  empty: 'Enter an amount.',
  format: 'Use numbers only, like 12.50.',
  tooManyDecimals: 'Please only use 2 decimals.',
  notPositive: 'Enter an amount above 0.',
  tooLarge: 'Amounts above 100,000.00 are not supported.',
};

export function AddSpendingDialog({ currency, dates, onSave, onClose }: AddSpendingDialogProps) {
  // One id per opening of the form. Every save attempt from this form reuses it,
  // so addPurchaseOnce can ignore a double tap. useState keeps it stable across redraws.
  const [entryId] = useState(() => crypto.randomUUID());

  // Controlled inputs: each box shows exactly what is in state.
  const [amountText, setAmountText] = useState('');
  const [category, setCategory] = useState<CategoryId | null>(null);
  const [needOrWant, setNeedOrWant] = useState<NeedOrWant | null>(null);
  const [merchant, setMerchant] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(dates[0].date);
  const [amountError, setAmountError] = useState<AmountInvalidReason | null>(null);

  // A ref is a handle to the real browser element, for the few things React
  // does not do itself: opening a <dialog> as a modal and moving focus.
  const dialogRef = useRef<HTMLDialogElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  // On mount: open as a modal (dims the page, keeps keyboard focus inside,
  // Escape closes it) and put the cursor in the amount box.
  // The open check matters in development, where React runs effects twice.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    amountRef.current?.focus();
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // Stop the browser's default "send the form and reload the page".
    event.preventDefault();
    const result = parseAmount(amountText);
    if (result.kind === 'invalid') {
      setAmountError(result.reason);
      amountRef.current?.focus();
      return;
    }
    onSave({
      id: entryId,
      date,
      merchant: merchant.trim(),
      ...(note.trim() && { note: note.trim() }),
      ...(category && { category }),
      ...(needOrWant && { needOrWant }),
      cents: result.cents,
    });
  }

  return (
    // onClose fires for Escape too, so every way of closing goes through the parent.
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby="add-title" onClose={onClose}>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <div className={styles.titleRow}>
          <h2 id="add-title" className={styles.title}>
            Add spending
          </h2>
          <button type="button" className={styles.close} onClick={onClose}>
            Close
          </button>
        </div>

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

        <button type="submit" className={styles.save}>
          Save purchase
        </button>
      </form>
    </dialog>
  );
}
