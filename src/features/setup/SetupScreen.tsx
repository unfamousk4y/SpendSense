import { useState, type FormEvent, type ReactNode } from 'react';
import { parseAmount, centsOrZero } from '../../domain/amount';
import type { IsoDate } from '../../domain/dates';
import { formatCents, type Currency } from '../../domain/money';
import { firstAllowanceFits, previewSetup } from '../../domain/setup';
import type { NewAccount, SaveResult } from '../../data/ledgerStore';
import { Money } from '../../ui/Money';
import { ThemeSwitch } from '../../ui/ThemeSwitch';
// Same labels and amount boxes as the purchase form.
import formStyles from '../week/PurchaseDialog.module.css';
import styles from './SetupScreen.module.css';

type SetupScreenProps = {
  currency: Currency;
  today: IsoDate;
  onCurrencyChange: (currency: Currency) => void;
  onCreate: (account: NewAccount) => Promise<SaveResult>;
  accountControls: ReactNode;
};

const CURRENCIES: Currency[] = ['USD', 'BSD'];

/** Blank means 0 for the optional amounts. */
const optionalCents = (text: string) => (text.trim() === '' ? 0 : centsOrZero(parseAmount(text)));

export function SetupScreen({ currency, today, onCurrencyChange, onCreate, accountControls }: SetupScreenProps) {
  const [cashText, setCashText] = useState('');
  const [protectedText, setProtectedText] = useState('');
  const [billsText, setBillsText] = useState('');
  const [planEndDate, setPlanEndDate] = useState('');
  const [allowanceText, setAllowanceText] = useState('');
  const [showProblems, setShowProblems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Everything below is worked out from the typed text on every render.
  const cashCents = cashText.trim() === '' ? null : centsOrZero(parseAmount(cashText));
  const protectedCents = optionalCents(protectedText);
  const commitmentsCents = optionalCents(billsText);
  // A date box reports each stage of typing a year (0002, 0020, 0202, 2026), so
  // a year starting with 0 means the student has not finished typing it.
  const endDateEntered = planEndDate !== '' && !planEndDate.startsWith('0');
  const preview =
    cashCents !== null && protectedCents !== null && commitmentsCents !== null && endDateEntered
      ? previewSetup({ today, cashCents, protectedCents, commitmentsCents, planEndDate })
      : null;
  const chosenCents = preview?.kind === 'ok' && allowanceText.trim() !== '' ? centsOrZero(parseAmount(allowanceText)) : undefined;
  const allowanceCents = preview?.kind === 'ok' ? (chosenCents === undefined ? preview.suggestedCents : chosenCents) : null;
  const allowanceFits =
    preview?.kind === 'ok' && allowanceCents !== null && firstAllowanceFits(allowanceCents, preview.suggestedCents, preview.freeCents);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (cashCents === null || protectedCents === null || commitmentsCents === null || preview?.kind !== 'ok' || allowanceCents === null || !allowanceFits) {
      setShowProblems(true);
      return;
    }
    setSaving(true);
    setSaveError(null);
    const saved = await onCreate({
      currency,
      openingDate: today,
      cashCents,
      protectedCents,
      commitmentsCents,
      planEndDate,
      recommendedCents: preview.suggestedCents,
      allowanceCents,
    });
    // On success the app reloads the account and this screen goes away.
    if (!saved.ok) {
      setSaving(false);
      setSaveError(saved.message);
    }
  }

  const amountField = (
    label: string,
    text: string,
    setText: (text: string) => void,
    options: { optional?: boolean; placeholder?: string; invalid: boolean; message?: string; hint?: ReactNode },
  ) => (
    <label className={formStyles.field}>
      <span className={formStyles.label}>
        {label} {options.optional && <span className={formStyles.optional}>optional</span>}
      </span>
      <span className={`${formStyles.amountBox} ${options.invalid ? formStyles.invalid : ''}`}>
        <span className={formStyles.prefix} aria-hidden="true">
          {currency} $
        </span>
        <input
          className={formStyles.amountInput}
          inputMode="decimal"
          autoComplete="off"
          placeholder={options.placeholder ?? '0.00'}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setShowProblems(false);
          }}
          aria-label={`${label} in ${currency}`}
          aria-invalid={options.invalid}
        />
      </span>
      {options.hint && <span className={styles.hint}>{options.hint}</span>}
      {options.invalid && options.message && <span className={formStyles.error}>{options.message}</span>}
    </label>
  );

  const AMOUNT_HELP = 'Use numbers only, like 120.00 or 1,250.00, with up to 2 decimals.';

  return (
    <main className={styles.page}>
      <form className={styles.card} onSubmit={handleSubmit} noValidate>
        <h1 className={styles.title}>Set up your {currency} account</h1>
        <p className={styles.lead}>Enter what is true today. Count only money you already have, not money you expect.</p>
        <p className={styles.testNote}>Test version: please use made-up numbers for now.</p>

        <div className={styles.currencySwitch} role="group" aria-label="Account currency">
          {CURRENCIES.map((option) => (
            <button
              key={option}
              type="button"
              className={styles.currencyOption}
              aria-pressed={option === currency}
              onClick={() => onCurrencyChange(option)}
            >
              {option}
            </button>
          ))}
        </div>

        {amountField('Current cash', cashText, setCashText, {
          invalid: showProblems && cashCents === null,
          message: cashText.trim() === '' ? 'Enter your current cash, or 0.' : AMOUNT_HELP,
        })}
        {amountField('Protected savings', protectedText, setProtectedText, {
          optional: true,
          invalid: (showProblems && protectedCents === null) || preview?.kind === 'protectedAboveCash',
          message: preview?.kind === 'protectedAboveCash' ? 'Protected savings are part of your cash, so they cannot be more than it.' : AMOUNT_HELP,
          hint: 'Part of your cash that you do not want to plan with. Nothing moves between bank accounts.',
        })}
        {amountField('Unpaid bills', billsText, setBillsText, {
          optional: true,
          invalid: showProblems && commitmentsCents === null,
          message: AMOUNT_HELP,
          hint: 'The total of bills due before your plan ends. You can split it into separate bills afterwards.',
        })}

        <label className={formStyles.field}>
          <span className={formStyles.label}>Plan end date</span>
          <input
            type="date"
            className={formStyles.textInput}
            min={today}
            value={planEndDate}
            onChange={(event) => {
              setPlanEndDate(event.target.value);
              setShowProblems(false);
            }}
            aria-invalid={preview?.kind === 'planEndPassed' || (showProblems && !endDateEntered)}
          />
          <span className={styles.hint}>How long this money has to last, such as your next expected payment date.</span>
          {preview?.kind === 'planEndPassed' && <span className={formStyles.error}>Choose today or a later date.</span>}
          {showProblems && !endDateEntered && <span className={formStyles.error}>Choose an end date.</span>}
        </label>

        {preview?.kind === 'ok' && (
          <>
            <dl className={styles.sum}>
              <dt>Free cash after savings and bills</dt>
              <dd className={preview.freeCents < 0 ? styles.negative : ''}>
                <Money cents={preview.freeCents} currency={currency} />
              </dd>
              <dt>
                Suggested for the {preview.daysThisWeek} {preview.daysThisWeek === 1 ? 'day' : 'days'} left this week, of{' '}
                {preview.daysLeft} in the plan
              </dt>
              <dd>
                <Money cents={preview.suggestedCents} currency={currency} />
              </dd>
            </dl>

            {preview.shortfallCents > 0 && (
              <p className={styles.warning}>
                Your bills and savings are <Money cents={preview.shortfallCents} currency={currency} /> more than your
                cash, so no spending is suggested.
              </p>
            )}

            {amountField('Allowance this week', allowanceText, setAllowanceText, {
              optional: true,
              placeholder: formatCents(preview.suggestedCents),
              invalid: (showProblems && allowanceCents === null) || (allowanceCents !== null && !allowanceFits),
              message:
                allowanceCents === null ? AMOUNT_HELP : `This is more than the free cash in your plan (${formatCents(Math.max(0, preview.freeCents))}).`,
              hint: 'Leave blank to use the suggestion.',
            })}
          </>
        )}

        {saveError && (
          <p className={formStyles.error} role="alert">
            {saveError}
          </p>
        )}

        <button type="submit" className={styles.save}>
          {saving ? 'Saving' : saveError ? 'Try again' : 'Create account'}
        </button>
      </form>

      <footer className={styles.footer}>
        <ThemeSwitch />
        {accountControls}
      </footer>
    </main>
  );
}
