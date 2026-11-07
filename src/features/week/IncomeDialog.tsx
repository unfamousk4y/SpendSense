import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SaveResult } from '../../data/ledgerStore';
import { parseAmount, type AmountInvalidReason } from '../../domain/amount';
import type { IsoDate } from '../../domain/dates';
import { incomeShares, previewIncome, splitFromShares, type IncomeKind, type IncomeReceipt } from '../../domain/income';
import { formatCents, type Currency } from '../../domain/money';
import { readSplitTexts, splitToTexts, type Split, type SplitTexts } from '../../domain/split';
import { Money } from '../../ui/Money';
import { SplitFields } from '../../ui/SplitFields';
// Same sheet, title row, amount box and Save button as the other forms.
import formStyles from './PurchaseDialog.module.css';
import styles from './AdjustAllowanceDialog.module.css';
import localStyles from './IncomeDialog.module.css';

type IncomeDialogProps = {
  currency: Currency;
  /** Days it may be dated, newest first; the first is today. Never a day to come. */
  dates: { date: IsoDate; label: string }[];
  /** Present when editing: the form starts filled in and offers Delete. */
  existing?: IncomeReceipt;
  /** What the student was saving when their session ended. Not saved yet. */
  restored?: IncomeReceipt;
  /** The account's split, which a new payment starts from. Changing it here does not change the default. */
  defaultSplit: Split;
  currentCashCents: number;
  protectedCents: number;
  freeCents: number;
  spentCents: number;
  allowanceCents: number;
  daysThisWeek: number;
  daysLeft: number;
  /** Resolves when the save is confirmed or has failed. On success the parent closes the form. */
  onSave: (income: IncomeReceipt) => Promise<SaveResult>;
  onDelete: (income: IncomeReceipt) => Promise<SaveResult>;
  onClose: () => void;
};

const AMOUNT_MESSAGES: Record<AmountInvalidReason, string> = {
  empty: 'Enter how much you received.',
  format: 'Use numbers only, like 300.00 or 1,250.00.',
  commaDecimal: 'Use a period for cents, like 12.50.',
  tooManyDecimals: 'Please only use 2 decimals.',
  notPositive: 'Enter an amount above 0.',
  tooLarge: 'Amounts above 100,000.00 are not supported.',
};

export function IncomeDialog({
  currency,
  dates,
  existing,
  restored,
  defaultSplit,
  currentCashCents,
  protectedCents,
  freeCents,
  spentCents,
  allowanceCents,
  daysThisWeek,
  daysLeft,
  onSave,
  onDelete,
  onClose,
}: IncomeDialogProps) {
  // An edit keeps its id; a new entry gets one per opening of the form, which
  // every attempt to save reuses, so a retry cannot count the money twice.
  const start = restored ?? existing;
  const [entryId] = useState(() => start?.id ?? crypto.randomUUID());
  const [amountText, setAmountText] = useState(start ? formatCents(start.cents) : '');
  const [source, setSource] = useState(start?.source ?? '');
  const [date, setDate] = useState(start && dates.some((option) => option.date === start.date) ? start.date : dates[0].date);
  // A new payment asks which kind it is, so nothing is split without a choice.
  const [kind, setKind] = useState<IncomeKind | null>(start ? (start.kind ?? 'oneOff') : null);
  const startHasShares = start !== undefined && ((start.savingsCents ?? 0) > 0 || (start.wantsCents ?? 0) > 0);
  const startWasSplit = startHasShares || start?.kind === 'regular';
  const [splitOneOff, setSplitOneOff] = useState(startHasShares);
  const [splitTexts, setSplitTexts] = useState<SplitTexts>(() =>
    splitToTexts(startWasSplit ? splitFromShares(start!) : defaultSplit),
  );
  const [percentsEdited, setPercentsEdited] = useState(false);
  // Set only when Save is pressed, so half-typed text is not flagged early.
  const [showProblem, setShowProblem] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
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
  const wantsSplit = kind === 'regular' || (kind === 'oneOff' && splitOneOff);
  const { split } = readSplitTexts(splitTexts);
  // The form starts from percents rounded to whole numbers. Until the amount or
  // the percents change, the amounts the student confirmed stay exact.
  const keepsStartAmounts = startWasSplit && start !== undefined && parsed.kind === 'ok' && parsed.cents === start.cents && !percentsEdited;
  const shares =
    parsed.kind === 'ok' && wantsSplit && split
      ? incomeShares({ cents: parsed.cents, split, freeCents, previous: existing })
      : null;
  const savingsCents = !wantsSplit ? 0 : keepsStartAmounts ? (start.savingsCents ?? 0) : (shares?.savingsCents ?? 0);
  const wantsCents = !wantsSplit ? 0 : keepsStartAmounts ? (start.wantsCents ?? 0) : (shares?.wantsCents ?? 0);
  const savingsChangeCents = savingsCents - (existing?.savingsCents ?? 0);
  // Savings from this payment may already have been released.
  const savingsAlreadyUsed = protectedCents + savingsChangeCents < 0;
  const deleteIsBlocked = existing !== undefined && (existing.savingsCents ?? 0) > protectedCents;
  const preview =
    parsed.kind === 'ok'
      ? previewIncome({
          changeCents: parsed.cents - (existing?.cents ?? 0),
          savingsChangeCents,
          currentCashCents,
          freeCents,
          spentCents,
          daysThisWeek,
          daysLeft,
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
    if (kind === null || (wantsSplit && split === null) || savingsAlreadyUsed) {
      setShowProblem(true);
      return;
    }
    void run(() =>
      onSave({
        id: entryId,
        date,
        cents: parsed.cents,
        ...(source.trim() && { source: source.trim() }),
        // Left off when empty: an unsplit one-off is the plain entry it always was.
        ...(kind === 'regular' && { kind }),
        ...(savingsCents > 0 && { savingsCents }),
        ...(wantsCents > 0 && { wantsCents }),
      }),
    );
  }

  return (
    <dialog
      ref={dialogRef}
      className={formStyles.dialog}
      aria-labelledby="income-title"
      onClose={onClose}
      // Escape must not hide a save that is still on its way.
      onCancel={(event) => {
        if (saving) event.preventDefault();
      }}
    >
      <form className={formStyles.form} onSubmit={handleSubmit} noValidate>
        <div className={formStyles.titleRow}>
          <h2 id="income-title" className={formStyles.title}>
            {existing ? 'Edit income' : 'Add income'}
          </h2>
          <button type="button" className={formStyles.close} onClick={onClose} disabled={saving}>
            Close
          </button>
        </div>

        {restored && (
          <p className={formStyles.restored} role="status">
            Brought back after you signed in. This is not saved yet, so check it and save.
          </p>
        )}

        <p className={styles.hint}>Record money once you have received it, not money you are expecting.</p>

        <label className={formStyles.field}>
          <span className={formStyles.label}>Amount received</span>
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
              aria-label={`Amount received in ${currency}`}
              aria-invalid={amountProblem !== null}
              aria-describedby={amountProblem ? 'income-amount-error' : undefined}
            />
          </span>
          {amountProblem && (
            <span id="income-amount-error" className={formStyles.error}>
              {AMOUNT_MESSAGES[amountProblem]}
            </span>
          )}
        </label>

        <label className={formStyles.field}>
          <span className={formStyles.label}>Date received</span>
          <select className={formStyles.textInput} value={date} onChange={(event) => setDate(event.target.value)}>
            {dates.map((option, index) => (
              <option key={option.date} value={option.date}>
                {index === 0 ? `${option.label} (today)` : option.label}
              </option>
            ))}
          </select>
        </label>

        <label className={formStyles.field}>
          <span className={formStyles.label}>
            Source <span className={formStyles.optional}>optional</span>
          </span>
          <input
            className={formStyles.textInput}
            value={source}
            onChange={(event) => setSource(event.target.value)}
            maxLength={60}
            placeholder="Aid, family, work"
          />
        </label>

        <fieldset className={formStyles.group}>
          <legend className={formStyles.label}>What kind of money is this?</legend>
          <div className={formStyles.segmented}>
            {(
              [
                ['regular', 'Regular payment'],
                ['oneOff', 'One-off'],
              ] as const
            ).map(([option, label]) => (
              <button
                key={option}
                type="button"
                className={formStyles.segment}
                aria-pressed={kind === option}
                onClick={() => {
                  setKind(option);
                  setShowProblem(false);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {kind === null && showProblem && <span className={formStyles.error}>Choose regular payment or one-off.</span>}
          {kind === null && !showProblem && <span className={styles.hint}>One-off means something like a gig or a gift.</span>}
        </fieldset>

        {kind === 'oneOff' && (
          <fieldset className={formStyles.group}>
            <legend className={formStyles.label}>Split this?</legend>
            <div className={formStyles.segmented}>
              {(
                [
                  [false, 'No'],
                  [true, 'Yes'],
                ] as const
              ).map(([option, label]) => (
                <button
                  key={label}
                  type="button"
                  className={formStyles.segment}
                  aria-pressed={splitOneOff === option}
                  onClick={() => setSplitOneOff(option)}
                >
                  {label}
                </button>
              ))}
            </div>
            {!splitOneOff && <span className={styles.hint}>All of it stays as spending money. Nothing is set aside, and your wants stay the same.</span>}
          </fieldset>
        )}

        {wantsSplit && (
          <SplitFields
            texts={splitTexts}
            onChange={(texts) => {
              setSplitTexts(texts);
              setPercentsEdited(true);
              setShowProblem(false);
            }}
            hint="Changing these only affects this payment. Your usual split stays the same."
          />
        )}

        {wantsSplit && parsed.kind === 'ok' && split && (
          <>
            <h3 className={localStyles.sharesTitle}>What this payment comes to</h3>
            <dl className={localStyles.shares}>
              <dt>Savings</dt>
              <dd>
                <Money cents={savingsCents} currency={currency} />
              </dd>
              <dt>Wants</dt>
              <dd>
                <Money cents={wantsCents} currency={currency} />
              </dd>
              <dt>Needs</dt>
              <dd>
                <Money cents={parsed.cents - savingsCents - wantsCents} currency={currency} />
              </dd>
            </dl>
            {!keepsStartAmounts && shares && shares.savingsCappedCents > 0 && (
              <p className={localStyles.warning}>
                You are short for your bills and savings, so only <Money cents={shares.savingsCents} currency={currency} /> of the{' '}
                <Money cents={shares.savingsCents + shares.savingsCappedCents} currency={currency} /> can be set aside.
              </p>
            )}
          </>
        )}

        {savingsAlreadyUsed && (
          <p className={formStyles.error} role="alert">
            You have already released some of the savings from this payment, so it needs to keep at least{' '}
            <Money cents={(existing?.savingsCents ?? 0) - protectedCents} currency={currency} /> as savings.
          </p>
        )}

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
                {savingsChangeCents !== 0 && (
                  <tr>
                    <th scope="row">Protected savings</th>
                    <td>
                      <Money cents={protectedCents} currency={currency} />
                    </td>
                    <td className={styles.changed}>
                      <Money cents={protectedCents + savingsChangeCents} currency={currency} />
                    </td>
                  </tr>
                )}
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
            {deleteIsBlocked ? (
              <p className={styles.hint}>This cannot be deleted because you have already released some of its savings.</p>
            ) : confirmingDelete ? (
              <div className={formStyles.confirm} role="group" aria-labelledby="income-confirm-text">
                <p id="income-confirm-text" className={formStyles.confirmText}>
                  Delete this income, <Money cents={existing.cents} currency={currency} />?
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
                Delete income
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
          {saving ? 'Saving' : saveError ? 'Try again' : existing ? 'Save changes' : 'Save income'}
        </button>
      </form>
    </dialog>
  );
}
