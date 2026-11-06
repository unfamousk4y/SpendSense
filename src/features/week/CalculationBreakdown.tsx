import { useId, useState } from 'react';
import type { Currency } from '../../domain/money';
import { Money } from '../../ui/Money';
import styles from './CalculationBreakdown.module.css';

type CalculationBreakdownProps = {
  currency: Currency;
  weekStartCashCents: number;
  incomeThisWeekCents: number;
  billPaymentsThisWeekCents: number;
  /** Signed: below zero when corrections lowered cash. */
  correctionsThisWeekCents: number;
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
  onRelease: () => void;
  onCorrect: () => void;
};

/**
 * The arithmetic behind the big number. Two short sums always show, with the
 * actions beside them; the control opens the same sums written out line by line.
 */
export function CalculationBreakdown(props: CalculationBreakdownProps) {
  const { currency } = props;
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const overspent = props.remainingCents < 0;

  return (
    <div className={styles.breakdown}>
      <div className={styles.compact}>
        <dl className={styles.equation}>
          <div className={styles.term}>
            <dt>Current cash</dt>
            <dd>
              <Money cents={props.currentCashCents} currency={currency} />
            </dd>
          </div>
          <div className={styles.term}>
            <dt>
              <span className={styles.op}>−</span> Protected
            </dt>
            <dd>
              <Money cents={props.protectedCents} currency={currency} />
            </dd>
          </div>
          <div className={styles.term}>
            <dt>
              <span className={styles.op}>−</span> Bills
            </dt>
            <dd>
              <Money cents={props.commitmentsCents} currency={currency} />
            </dd>
          </div>
          <div className={`${styles.term} ${styles.result}`}>
            <dt>
              <span className={styles.op}>=</span> Free cash
            </dt>
            <dd>
              <Money cents={props.freeCashCents} currency={currency} />
            </dd>
          </div>
        </dl>
        <dl className={styles.equation}>
          <div className={styles.term}>
            <dt>Allowance</dt>
            <dd>
              <Money cents={props.chosenAllowanceCents} currency={currency} />
            </dd>
          </div>
          <div className={styles.term}>
            <dt>
              <span className={styles.op}>−</span> Spent
            </dt>
            <dd>
              <Money cents={props.spentCents} currency={currency} />
            </dd>
          </div>
          <div className={`${styles.term} ${styles.result}`}>
            <dt>
              <span className={styles.op}>=</span> {overspent ? 'Overspent' : 'Remaining'}
            </dt>
            <dd className={overspent ? styles.overspent : styles.available}>
              <Money cents={props.remainingCents} currency={currency} />
            </dd>
          </div>
        </dl>
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded(!expanded)}
        >
          <span className={styles.chevron} aria-hidden="true" />
          {expanded ? 'Hide the full arithmetic' : 'Show the full arithmetic'}
        </button>
        <div className={styles.buttons}>
          <button type="button" className={styles.adjust} onClick={props.onAdjust}>
            Adjust allowance
          </button>
          {props.protectedCents > 0 && (
            <button type="button" className={styles.adjust} onClick={props.onRelease}>
              Release savings
            </button>
          )}
          <button type="button" className={styles.adjust} onClick={props.onCorrect}>
            Correct balance
          </button>
        </div>
      </div>

      {/* Stays in the page so it can slide; inert keeps it out of reach while closed. */}
      <div id={detailsId} className={`${styles.expander} ${expanded ? styles.open : ''}`} inert={!expanded}>
        <div className={styles.expanderInner}>
          <div className={styles.sums}>
            <dl className={styles.sum}>
              <dt>Cash at the start of this week</dt>
              <dd>
                <Money cents={props.weekStartCashCents} currency={currency} />
              </dd>
              {props.incomeThisWeekCents !== 0 && (
                <>
                  <dt>
                    <span className={styles.op}>+</span> Income this week
                  </dt>
                  <dd>
                    <Money cents={props.incomeThisWeekCents} currency={currency} />
                  </dd>
                </>
              )}
              <dt>
                <span className={styles.op}>−</span> Spent this week
              </dt>
              <dd>
                <Money cents={props.spentCents} currency={currency} />
              </dd>
              {props.billPaymentsThisWeekCents !== 0 && (
                <>
                  <dt>
                    <span className={styles.op}>−</span> Bills paid this week
                  </dt>
                  <dd>
                    <Money cents={props.billPaymentsThisWeekCents} currency={currency} />
                  </dd>
                </>
              )}
              {props.correctionsThisWeekCents !== 0 && (
                <>
                  <dt>
                    <span className={styles.op}>{props.correctionsThisWeekCents < 0 ? '−' : '+'}</span> Balance corrections this week
                  </dt>
                  <dd>
                    <Money cents={Math.abs(props.correctionsThisWeekCents)} currency={currency} />
                  </dd>
                </>
              )}
              <dt className={styles.total}>
                <span className={styles.op}>=</span> Current cash
              </dt>
              <dd className={styles.total}>
                <Money cents={props.currentCashCents} currency={currency} />
              </dd>
            </dl>

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
                <span className={styles.op}>=</span> {overspent ? 'Overspent' : 'Weekly remaining'}
              </dt>
              <dd className={`${styles.total} ${overspent ? styles.overspent : styles.available}`}>
                <Money cents={props.remainingCents} currency={currency} />
              </dd>
            </dl>
          </div>
        </div>
      </div>

      <p className={styles.footnote}>
        Based only on what you have entered. Expected income is not counted until you record it as
        received. Protected savings stay in your account; nothing is moved.
      </p>
    </div>
  );
}
