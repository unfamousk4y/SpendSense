import type { Currency } from '../../domain/money';
import { Money } from '../../ui/Money';
import styles from './CalculationBreakdown.module.css';

type CalculationBreakdownProps = {
  currency: Currency;
  currentCashCents: number;
  protectedCents: number;
  commitmentsCents: number;
  freeCashCents: number;
  planEndLabel: string;
  recommendedAllowanceCents: number;
  chosenAllowanceCents: number;
  spentCents: number;
  remainingCents: number;
  /** The most recent saved change to this week's allowance, if any. */
  lastChange?: { fromCents: number; madeOnLabel: string };
  onAdjust: () => void;
  /** Left out when releases cannot be saved yet: the screen says so instead. */
  onRelease?: () => void;
};

/** The arithmetic behind the big number, written out line by line. */
export function CalculationBreakdown(props: CalculationBreakdownProps) {
  const { currency } = props;
  return (
    <div className={styles.breakdown}>
      <dl className={styles.sum}>
        <dt>Current cash</dt>
        <dd>
          <Money cents={props.currentCashCents} currency={currency} />
        </dd>
        <dt>
          <span className={styles.op}>−</span> Protected savings
        </dt>
        <dd className={styles.protected}>
          <Money cents={props.protectedCents} currency={currency} />
        </dd>
        <dt>
          <span className={styles.op}>−</span> Unpaid bills due by {props.planEndLabel}
        </dt>
        <dd>
          <Money cents={props.commitmentsCents} currency={currency} />
        </dd>
        <dt className={styles.total}>
          <span className={styles.op}>=</span> Free cash for the rest of the plan
        </dt>
        <dd className={styles.total}>
          <Money cents={props.freeCashCents} currency={currency} />
        </dd>
      </dl>

      <dl className={styles.sum}>
        <dt>This week’s allowance</dt>
        <dd>
          <Money cents={props.chosenAllowanceCents} currency={currency} />
        </dd>
        {props.lastChange && (
          <>
            <dt className={styles.detail}>Before your change on {props.lastChange.madeOnLabel}</dt>
            <dd className={styles.detail}>
              <Money cents={props.lastChange.fromCents} currency={currency} />
            </dd>
          </>
        )}
        <dt className={styles.detail}>Suggested at the start of the week</dt>
        <dd className={styles.detail}>
          <Money cents={props.recommendedAllowanceCents} currency={currency} />
        </dd>
        <dt>
          <span className={styles.op}>−</span> Spent this week
        </dt>
        <dd>
          <Money cents={props.spentCents} currency={currency} />
        </dd>
        <dt className={styles.total}>
          <span className={styles.op}>=</span> {props.remainingCents < 0 ? 'Overspent' : 'Weekly remaining'}
        </dt>
        <dd className={`${styles.total} ${props.remainingCents < 0 ? styles.overspent : styles.available}`}>
          <Money cents={props.remainingCents} currency={currency} />
        </dd>
      </dl>

      <div className={styles.actions}>
        <button type="button" className={styles.adjust} onClick={props.onAdjust}>
          Adjust allowance
        </button>
        {props.protectedCents > 0 && props.onRelease && (
          <button type="button" className={styles.adjust} onClick={props.onRelease}>
            Release savings
          </button>
        )}
      </div>

      {!props.onRelease && (
        <p className={styles.footnote}>Releasing savings and closing a week are not available for saved accounts yet.</p>
      )}

      <p className={styles.footnote}>
        Based only on what you have entered. Expected income is not counted until you record it as
        received. Protected savings stay in your account; nothing is moved.
      </p>
    </div>
  );
}
