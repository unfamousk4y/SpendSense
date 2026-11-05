import type { ReactNode } from 'react';
import type { SaveResult } from '../../data/ledgerStore';
import type { IsoDate } from '../../domain/dates';
import { accountCash, type AccountLedger } from '../../domain/ledger';
import type { Currency } from '../../domain/money';
import { NewPlanForm, type NewPlanWeek } from './NewPlanForm';
import styles from './PlanEndedScreen.module.css';

type PlanEndedScreenProps = {
  account: AccountLedger;
  today: IsoDate;
  onCurrencyChange: (currency: Currency) => void;
  onStart: (endDate: IsoDate, week?: NewPlanWeek) => Promise<SaveResult>;
  accountControls?: ReactNode;
};

const dateLabel = (date: IsoDate) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** A week with no plan because the last plan has ended. Nothing is lost; this starts the next one. */
export function PlanEndedScreen({ account, today, onCurrencyChange, onStart, accountControls }: PlanEndedScreenProps) {
  const { currency } = account;
  return (
    <main className={styles.page}>
      <div className={styles.switch} role="group" aria-label="Account currency">
        {(['USD', 'BSD'] as const).map((option) => (
          <button
            key={option}
            type="button"
            className={styles.option}
            aria-pressed={option === currency}
            onClick={() => onCurrencyChange(option)}
          >
            {option}
          </button>
        ))}
      </div>
      <h1 className={styles.heading}>Your {currency} plan ended on {dateLabel(account.planEndDate)}</h1>
      <NewPlanForm
        // Typed dates and amounts belong to one currency: switching starts a clean form.
        key={currency}
        currency={currency}
        today={today}
        {...accountCash(account)}
        bills={account.bills}
        spentCents={0}
        onStart={onStart}
      />
      {accountControls}
    </main>
  );
}
