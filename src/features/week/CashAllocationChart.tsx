import type { AllocationKey, CashAllocation } from '../../domain/allocation';
import type { Currency } from '../../domain/money';
import { Money } from '../../ui/Money';
import styles from './CashAllocationChart.module.css';

type CashAllocationChartProps = {
  currency: Currency;
  allocation: CashAllocation;
  /** Draw the ring in once when it first appears, where effects allow it. */
  reveal?: boolean;
};

const LABELS: Record<AllocationKey, string> = {
  protected: 'Protected savings',
  bills: 'Reserved for bills',
  thisWeek: 'Left to spend this week',
  laterWeeks: 'Free for later weeks',
};

// Gap between slices, in hundredths of the ring.
const GAP = 0.8;

/**
 * Donut of current cash with at most four slices. The ring is hidden from
 * screen readers; the list beside it carries every label, amount and percent.
 */
export function CashAllocationChart({ currency, allocation, reveal = false }: CashAllocationChartProps) {
  if (allocation.kind === 'shortfall') {
    return (
      <p className={styles.shortfall}>
        Protected savings and bills are more than your current cash by{' '}
        <strong>
          <Money cents={allocation.shortfallCents} currency={currency} />
        </strong>
        . There is nothing free to plan with until you record income or change the plan.
      </p>
    );
  }

  const { totalCents, segments } = allocation;
  // pathLength="100" lets each slice be drawn as "percent of the ring". Exact
  // shares are used for drawing; the rounded percents are only for reading.
  const slices: { key: AllocationKey; start: number; length: number }[] = [];
  let start = 0;
  for (const segment of segments) {
    const share = totalCents === 0 ? 0 : (segment.cents * 100) / totalCents;
    slices.push({ key: segment.key, start, length: Math.max(share - GAP, 0) });
    start += share;
  }

  return (
    <div className={styles.chart}>
      {/* data-depth: how far this layer rises when a tilting panel is hovered. */}
      <div className={styles.ringWrap} data-depth="2">
        <svg className={styles.ring} viewBox="0 0 120 120" aria-hidden="true">
          <circle className={styles.track} cx="60" cy="60" r="48" pathLength="100" />
          {slices
            .filter((slice) => slice.length > 0)
            .map((slice) => (
              <circle
                key={slice.key}
                className={`${styles.slice} ${styles[slice.key]} ${reveal ? styles.reveal : ''}`}
                cx="60"
                cy="60"
                r="48"
                pathLength="100"
                strokeDasharray={`${slice.length} ${100 - slice.length}`}
                strokeDashoffset={-slice.start}
                transform="rotate(-90 60 60)"
              />
            ))}
        </svg>
        <p className={styles.center}>
          <span className={styles.centerLabel}>Current cash</span>
          <Money cents={totalCents} currency={currency} />
        </p>
      </div>

      <ul className={styles.legend} data-depth="1">
        {segments.map((segment) => (
          <li key={segment.key} className={styles.legendRow}>
            <span className={`${styles.swatch} ${styles[segment.key]}`} aria-hidden="true" />
            <span className={styles.legendLabel}>{LABELS[segment.key]}</span>
            <span className={styles.legendValue}>
              <Money cents={segment.cents} currency={currency} />
              <span className={styles.percent}>{segment.percent}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
