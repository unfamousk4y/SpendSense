import type { WeekClosure } from '../../domain/closure';
import type { Currency } from '../../domain/money';
import { Money } from '../../ui/Money';
import styles from './ClosureSummary.module.css';

type ClosureSummaryProps = {
  currency: Currency;
  closure: WeekClosure;
  /** e.g. "Nov 2" */
  weekLabel: string;
  protectedNowCents: number;
  onAdjust: () => void;
};

/**
 * What happened when last week closed, shown through the following week. It
 * states the outcome in each case, including overspending, so nothing about
 * the rollover is hidden.
 */
export function ClosureSummary({ currency, closure, weekLabel, protectedNowCents, onAdjust }: ClosureSummaryProps) {
  const overspent = closure.leftoverCents < 0;
  const capped = closure.protectedCents < closure.leftoverCents;

  return (
    <section className={`${styles.card} ${overspent ? styles.overspent : ''}`} aria-labelledby="closure-heading">
      <h2 id="closure-heading" className={styles.heading}>
        Week of {weekLabel} closed
      </h2>

      {overspent ? (
        <>
          <p className={styles.line}>
            You spent <Money cents={-closure.leftoverCents} currency={currency} /> more than the{' '}
            <Money cents={closure.allowanceCents} currency={currency} /> allowance, so nothing was protected.
          </p>
          <p className={styles.line}>This week’s suggestion is based on the lower cash. You can change it.</p>
          <button type="button" className={styles.adjust} onClick={onAdjust}>
            Adjust allowance
          </button>
        </>
      ) : closure.protectedCents > 0 ? (
        <>
          <p className={styles.line}>
            <strong>
              <Money cents={closure.protectedCents} currency={currency} />
            </strong>{' '}
            of unused allowance moved to protected savings.
            {capped && (
              <>
                {' '}
                <Money cents={closure.leftoverCents} currency={currency} /> was unused; the rest is needed for
                upcoming bills.
              </>
            )}
          </p>
          <p className={styles.line}>
            Protected savings: <Money cents={protectedNowCents} currency={currency} />. It stays in your account;
            nothing was moved.
          </p>
        </>
      ) : (
        <p className={styles.line}>
          {closure.leftoverCents === 0
            ? 'The allowance was used exactly, so nothing was left to protect.'
            : 'Nothing was protected: your plan has no free cash after upcoming bills.'}
        </p>
      )}
    </section>
  );
}
