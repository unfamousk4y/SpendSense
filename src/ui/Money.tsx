import { formatCents, type Currency } from '../domain/money';
import styles from './Money.module.css';

type MoneyProps = {
  cents: number;
  currency: Currency;
};

/** An exact amount with its currency code, e.g. "USD $110.00". Never a bare "$". */
export function Money({ cents, currency }: MoneyProps) {
  return (
    <span className={styles.money}>
      {cents < 0 && '−'}
      <span className={styles.code}>{currency} $</span>
      {formatCents(Math.abs(cents))}
    </span>
  );
}
