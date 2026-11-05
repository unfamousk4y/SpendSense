import { useState, type FormEvent } from 'react';
import type { SaveResult } from '../../data/ledgerStore';
import { centsOrZero, parseAmount } from '../../domain/amount';
import type { Bill } from '../../domain/bills';
import type { IsoDate } from '../../domain/dates';
import { previewNewPlan } from '../../domain/newPlan';
import { firstAllowanceFits } from '../../domain/setup';
import { formatCents, type Currency } from '../../domain/money';
import { Money } from '../../ui/Money';
// Same fields and Save button as the other forms.
import formStyles from './PurchaseDialog.module.css';
import styles from './AdjustAllowanceDialog.module.css';

export type NewPlanWeek = { recommendedCents: number; allowanceCents: number };

type NewPlanFormProps = {
  currency: Currency;
  today: IsoDate;
  currentCashCents: number;
  protectedCents: number;
  bills: Bill[];
  spentCents: number;
  /** This week's allowance, which stays. Absent when the week has no plan yet, so the form asks for one. */
  currentAllowanceCents?: number;
  /** Resolves when the save is confirmed or has failed. On success the parent moves on. */
  onStart: (endDate: IsoDate, week?: NewPlanWeek) => Promise<SaveResult>;
  /** Called with whether a save is on its way, so a surrounding dialog can stay open. */
  onSavingChange?: (saving: boolean) => void;
};

const dateLabel = (date: IsoDate) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** The new end date, what it would mean, and this week's allowance if it has none yet. */
export function NewPlanForm({
  currency,
  today,
  currentCashCents,
  protectedCents,
  bills,
  spentCents,
  currentAllowanceCents,
  onStart,
  onSavingChange,
}: NewPlanFormProps) {
  const [endDate, setEndDate] = useState('');
  const [allowanceText, setAllowanceText] = useState('');
  // Set only when Save is pressed, so half-typed text is not flagged early.
  const [showProblems, setShowProblems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const needsAllowance = currentAllowanceCents === undefined;
  // Worked out from what is typed on every render, never kept in state. A year
  // starting with 0 is a date still being typed.
  const preview =
    endDate && !endDate.startsWith('0')
      ? previewNewPlan({ today, endDate, currentCashCents, protectedCents, bills, spentCents })
      : null;
  const ok = preview?.kind === 'ok' ? preview : null;

  // Blank means use the suggestion. 0 is a real answer; null means it is not an amount.
  const typedAllowance = allowanceText.trim() === '' ? undefined : centsOrZero(parseAmount(allowanceText));
  const allowanceCents = ok && typedAllowance !== null ? (typedAllowance ?? ok.suggestedCents) : null;
  const allowanceFits = ok !== null && allowanceCents !== null && firstAllowanceFits(allowanceCents, ok.suggestedCents, ok.freeCents);

  const endProblem = showProblems && !endDate ? 'Choose the date this plan should last until.' : preview?.kind === 'endPassed' ? 'Choose today or a later date.' : null;
  const allowanceProblem =
    !needsAllowance || !ok
      ? null
      : typedAllowance === null
        ? 'Use numbers only, like 150.00, up to 100,000.00.'
        : allowanceFits
          ? null
          : `This is more than the free cash in your plan (${formatCents(Math.max(0, ok.freeCents))}).`;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (!ok || (needsAllowance && allowanceProblem)) {
      setShowProblems(true);
      return;
    }
    setSaving(true);
    onSavingChange?.(true);
    setSaveError(null);
    const week =
      needsAllowance && allowanceCents !== null ? { recommendedCents: ok.suggestedCents, allowanceCents } : undefined;
    const result = await onStart(endDate, week);
    if (!result.ok) {
      setSaving(false);
      onSavingChange?.(false);
      setSaveError(result.message);
    }
  }

  return (
    <form className={formStyles.form} onSubmit={handleSubmit} noValidate>
      <p className={styles.hint}>
        Your cash, savings, bills and history all carry over. Free cash only counts income you have recorded, so if money
        has arrived, you can add it after starting and then adjust your allowance.
      </p>

      <label className={formStyles.field}>
        <span className={formStyles.label}>How long should this money last?</span>
        <span id="new-plan-end-hint" className={styles.footnote}>
          A date you choose, or your next expected payment date. Expected money is not counted until you record it as received.
        </span>
        <input
          type="date"
          className={`${formStyles.textInput} ${endProblem ? formStyles.invalid : ''}`}
          value={endDate}
          min={today}
          onChange={(event) => {
            setEndDate(event.target.value);
            setShowProblems(false);
          }}
          aria-invalid={endProblem !== null}
          aria-describedby={endProblem ? 'new-plan-end-error' : 'new-plan-end-hint'}
        />
        {endProblem && (
          <span id="new-plan-end-error" className={formStyles.error}>
            {endProblem}
          </span>
        )}
      </label>

      {ok && (
        <>
          <table className={styles.preview}>
            <caption className={styles.caption}>This plan, {ok.daysLeft === 1 ? '1 day' : `${ok.daysLeft} days`}</caption>
            <tbody>
              <tr>
                <th scope="row">Cash</th>
                <td>
                  <Money cents={currentCashCents} currency={currency} />
                </td>
              </tr>
              <tr>
                <th scope="row">Protected savings</th>
                <td>
                  <Money cents={protectedCents} currency={currency} />
                </td>
              </tr>
              <tr>
                <th scope="row">Unpaid bills due by {dateLabel(endDate)}</th>
                <td>
                  <Money cents={ok.commitmentsCents} currency={currency} />
                </td>
              </tr>
              <tr>
                <th scope="row">Free cash for this plan</th>
                <td className={ok.freeCents < 0 ? styles.negative : styles.changed}>
                  <Money cents={ok.freeCents} currency={currency} />
                </td>
              </tr>
            </tbody>
          </table>

          {ok.billsAfterEnd.length > 0 && (
            <div className={styles.footnote}>
              <p className={styles.footnote}>Due after this plan ends, so not counted:</p>
              <ul className={styles.billList}>
                {ok.billsAfterEnd.map((bill) => (
                  <li key={bill.id}>
                    {bill.name}, <Money cents={bill.cents} currency={currency} />, due {dateLabel(bill.dueOn)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {ok.shortfallCents > 0 && (
            <p className={styles.footnote}>
              Your bills and savings are <Money cents={ok.shortfallCents} currency={currency} /> more than your cash, so no
              spending is suggested.
            </p>
          )}

          {needsAllowance ? (
            <label className={formStyles.field}>
              <span className={formStyles.label}>
                Allowance this week <span className={formStyles.optional}>optional</span>
              </span>
              <span className={`${formStyles.amountBox} ${allowanceProblem ? formStyles.invalid : ''}`}>
                <span className={formStyles.prefix} aria-hidden="true">
                  {currency} $
                </span>
                <input
                  className={formStyles.amountInput}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={formatCents(ok.suggestedCents)}
                  value={allowanceText}
                  onChange={(event) => setAllowanceText(event.target.value)}
                  aria-label={`Allowance this week in ${currency}`}
                  aria-invalid={allowanceProblem !== null}
                  aria-describedby={allowanceProblem ? 'new-plan-allowance-error' : 'new-plan-allowance-hint'}
                />
              </span>
              {allowanceProblem ? (
                <span id="new-plan-allowance-error" className={formStyles.error}>
                  {allowanceProblem}
                </span>
              ) : (
                <span id="new-plan-allowance-hint" className={styles.footnote}>
                  Leave blank to use the suggestion, <Money cents={ok.suggestedCents} currency={currency} />.
                </span>
              )}
            </label>
          ) : (
            <p className={styles.footnote}>
              This week’s allowance stays at <Money cents={currentAllowanceCents ?? 0} currency={currency} /> unless you
              change it. With this plan, the suggestion for this week would be{' '}
              <Money cents={ok.suggestedCents} currency={currency} />.
            </p>
          )}
        </>
      )}

      {saveError && (
        <p className={formStyles.error} role="alert">
          {saveError}
        </p>
      )}

      <button type="submit" className={formStyles.save}>
        {saving ? 'Saving' : saveError ? 'Try again' : 'Start new plan'}
      </button>
    </form>
  );
}
