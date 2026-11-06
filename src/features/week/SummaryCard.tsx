import type { ReactNode } from 'react';
import type { Currency } from '../../domain/money';
import { Money } from '../../ui/Money';
import { TiltPanel } from '../../ui/TiltPanel';
import styles from './SummaryCard.module.css';

type SummaryCardProps = {
  label: string;
  cents: number;
  currency: Currency;
  /** One short line of context. */
  hint: ReactNode;
  /** Color for a financial meaning; the label always says the same in words. */
  tone?: 'protected';
  className: string;
  enterOrder: number;
};

/** One supporting number, as a panel of its own. */
export function SummaryCard({ label, cents, currency, hint, tone, className, enterOrder }: SummaryCardProps) {
  return (
    <TiltPanel as="div" className={`${styles.card} ${className}`} enterOrder={enterOrder}>
      <p className={styles.label}>{label}</p>
      <p className={`${styles.amount} ${tone === 'protected' ? styles.protected : ''}`}>
        <Money cents={cents} currency={currency} />
      </p>
      <p className={styles.hint}>{hint}</p>
    </TiltPanel>
  );
}
