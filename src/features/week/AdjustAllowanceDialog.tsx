import { useEffect, useRef, useState, type FormEvent } from 'react';
import { parseAmount, type AmountInvalidReason } from '../../domain/amount';
import {
  previewAllowanceChange,
  type AllowanceChange,
  type AllowanceSide,
  type MidweekSuggestion,
} from '../../domain/allowanceChange';
import type { IsoDate } from '../../domain/dates';
import { formatCents, type Currency } from '../../domain/money';
import { Money } from '../../ui/Money';
// Same sheet, title row, amount box and Save button as the purchase form.
import formStyles from './PurchaseDialog.module.css';
import styles from './AdjustAllowanceDialog.module.css';

// "0" is a valid allowance here, so notPositive never reaches the screen.
const FORMAT_MESSAGES: Partial<Record<AmountInvalidReason, string>> = {
  empty: 'Enter the new total, or 0.',
  format: 'Use numbers only, like 120.00 or 1,250.00.',
  commaDecimal: 'Use a period for cents, like 12.50.',
  tooManyDecimals: 'Please only use 2 decimals.',
  tooLarge: 'Amounts above 100,000.00 are not supported.',
};

type AdjustAllowanceDialogProps = {
  currency: Currency;
  today: IsoDate;
  currentAllowanceCents: number;
  spentCents: number;
  freeCents: number;
  suggestion: MidweekSuggestion;
  /** Days in the plan after this week ends (D - d). */
  laterDays: number;
  onSave: (change: AllowanceChange) => void;
  onClose: () => void;
};

export function AdjustAllowanceDialog({
  currency,
  today,
  currentAllowanceCents,
  spentCents,
  freeCents,
  suggestion,
  laterDays,
  onSave,
  onClose,
}: AdjustAllowanceDialogProps) {
  // One id per opening of the form, reused by every Save attempt, so a double
  // tap records the change once (same idea as adding a purchase).
  const [changeId] = useState(() => crypto.randomUUID());
  const [amountText, setAmountText] = useState(formatCents(currentAllowanceCents));
  // Set only when Save is pressed, so half-typed text is not flagged early.
  const [showProblem, setShowProblem] = useState(false);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  // On mount: open as a modal and select the amount so typing replaces it.
  // On unmount: put focus back on the button that opened the form. The dialog
  // is removed rather than closed, so the browser would otherwise drop focus
  // onto the page body. The focus call waits a moment because while the modal
  // is still in the page, everything outside it ignores focus().
  // The opener is remembered only once: in development React runs this effect
  // twice, and by the second run focus is already in the amount box.
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!openerRef.current && document.activeElement instanceof HTMLElement) {
      openerRef.current = document.activeElement;
    }
    const opener = openerRef.current;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    amountRef.current?.select();
    return () => queueMicrotask(() => opener?.focus());
  }, []);

  // The preview is worked out fresh from the typed text on every render, so it
  // can never disagree with the box. Nothing about it is kept in state.
  const parsed = parseAmount(amountText);
  // An allowance of 0 is allowed. parseAmount reports "0" as notPositive (the
  // text cannot contain a minus sign), so that reason means exactly zero here.
  const proposedCents = parsed.kind === 'ok' ? parsed.cents : parsed.kind === 'invalid' && parsed.reason === 'notPositive' ? 0 : null;
  const preview =
    proposedCents === null
      ? null
      : previewAllowanceChange({ currentAllowanceCents, proposedAllowanceCents: proposedCents, spentCents, freeCents });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview?.kind !== 'ok' || proposedCents === null) {
      setShowProblem(true);
      amountRef.current?.focus();
      return;
    }
    onSave({
      id: changeId,
      madeOn: today,
      fromCents: currentAllowanceCents,
      toCents: proposedCents,
      suggestedCents: suggestion.kind === 'ok' ? suggestion.totalCents : null,
    });
  }

  const refused = preview?.kind === 'exceedsFreeCash';
  const formatProblem = proposedCents === null && showProblem;

  return (
    <dialog ref={dialogRef} className={formStyles.dialog} aria-labelledby="adjust-title" onClose={onClose}>
      <form className={formStyles.form} onSubmit={handleSubmit} noValidate>
        <div className={formStyles.titleRow}>
          <h2 id="adjust-title" className={formStyles.title}>
            Adjust this week’s allowance
          </h2>
          <button type="button" className={formStyles.close} onClick={onClose}>
            Close
          </button>
        </div>

        <dl className={styles.facts}>
          <dt>Allowance now</dt>
          <dd>
            <Money cents={currentAllowanceCents} currency={currency} />
          </dd>
          <dt>Already spent this week</dt>
          <dd>
            <Money cents={spentCents} currency={currency} />
          </dd>
          <dt>Suggested now</dt>
          <dd>
            {suggestion.kind === 'ok' ? <Money cents={suggestion.totalCents} currency={currency} /> : 'None'}
          </dd>
        </dl>

        {suggestion.kind === 'planExpired' ? (
          <p className={styles.hint}>Your plan end date has passed. Set a new plan before changing the allowance.</p>
        ) : (
          <div className={styles.suggestionRow}>
            <p className={styles.hint}>
              {suggestion.shortfallCents > 0 ? (
                <>
                  No more spending suggested: your plan is <Money cents={suggestion.shortfallCents} currency={currency} />{' '}
                  short.
                </>
              ) : (
                <>
                  <Money cents={spentCents} currency={currency} /> spent, plus{' '}
                  <Money cents={suggestion.remainingCents} currency={currency} /> for the rest of this week.
                </>
              )}
            </p>
            <button
              type="button"
              className={styles.useSuggestion}
              onClick={() => {
                setAmountText(formatCents(suggestion.totalCents));
                setShowProblem(false);
              }}
            >
              Use suggestion
            </button>
          </div>
        )}

        <label className={formStyles.field}>
          <span className={formStyles.label}>New total allowance for this week</span>
          <span className={`${formStyles.amountBox} ${refused || formatProblem ? formStyles.invalid : ''}`}>
            <span className={formStyles.prefix} aria-hidden="true">
              {currency} $
            </span>
            <input
              ref={amountRef}
              className={formStyles.amountInput}
              inputMode="decimal"
              autoComplete="off"
              value={amountText}
              onChange={(event) => {
                setAmountText(event.target.value);
                setShowProblem(false);
              }}
              aria-label={`New total allowance in ${currency}`}
              aria-invalid={refused || formatProblem}
              aria-describedby="adjust-message"
            />
          </span>
        </label>

        {/* Announced as it changes, so screen reader users hear the effect of what they type. */}
        <div id="adjust-message" role="status" className={styles.message}>
          {formatProblem && parsed.kind === 'invalid' && (
            <p className={formStyles.error}>{FORMAT_MESSAGES[parsed.reason] ?? FORMAT_MESSAGES.format}</p>
          )}
          {preview?.kind === 'unchanged' && <p className={styles.hint}>That is the allowance already.</p>}
          {preview?.kind === 'exceedsFreeCash' && (
            <p className={formStyles.error}>
              That leaves <Money cents={preview.proposedRemainingCents} currency={currency} /> to spend this week, but only{' '}
              <Money cents={preview.availableCents} currency={currency} /> is free in your plan. To go higher, release
              savings or change upcoming bills first.
            </p>
          )}
          {preview?.kind === 'ok' && preview.overspentCents > 0 && (
            <p className={styles.warning}>
              You have already spent <Money cents={preview.overspentCents} currency={currency} /> more than this.
            </p>
          )}
        </div>

        {preview?.kind === 'ok' && (
          <ChangePreview
            currency={currency}
            before={preview.before}
            after={preview.after}
            laterDays={laterDays}
          />
        )}

        <p className={styles.footnote}>
          This changes how your cash is planned, not the cash itself. Your purchases stay as they are.
        </p>

        <button type="submit" className={formStyles.save}>
          Save new allowance
        </button>
      </form>
    </dialog>
  );
}

function ChangePreview({
  currency,
  before,
  after,
  laterDays,
}: {
  currency: Currency;
  before: AllowanceSide;
  after: AllowanceSide;
  laterDays: number;
}) {
  const later =
    laterDays > 0 ? `Available for the ${laterDays} days after this week` : 'Left over when the plan ends';
  return (
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
          <th scope="row">Total allowance</th>
          <td>
            <Money cents={before.allowanceCents} currency={currency} />
          </td>
          <td>
            <Money cents={after.allowanceCents} currency={currency} />
          </td>
        </tr>
        <tr>
          <th scope="row">Weekly remaining</th>
          <td className={before.remainingCents < 0 ? styles.negative : ''}>
            <Money cents={before.remainingCents} currency={currency} />
          </td>
          <td className={after.remainingCents < 0 ? styles.negative : styles.changed}>
            <Money cents={after.remainingCents} currency={currency} />
          </td>
        </tr>
        <tr>
          <th scope="row">{later}</th>
          <td className={before.laterWeeksCents < 0 ? styles.negative : ''}>
            <Money cents={before.laterWeeksCents} currency={currency} />
          </td>
          <td className={after.laterWeeksCents < 0 ? styles.negative : styles.changed}>
            <Money cents={after.laterWeeksCents} currency={currency} />
          </td>
        </tr>
      </tbody>
    </table>
  );
}
