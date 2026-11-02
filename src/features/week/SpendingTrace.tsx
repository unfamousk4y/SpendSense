import type { Currency } from '../../domain/money';
import { Money } from '../../ui/Money';
import styles from './SpendingTrace.module.css';

type SpendingTraceProps = {
  currency: Currency;
  cumulativeCents: number[];
  evenPaceCents: number[];
  /** 0 = Monday. Days after today have no actual spending yet. */
  todayIndex: number;
  dayLabels: string[];
};

const WIDTH = 700;
const HEIGHT = 160;
const TOP = 12;

/**
 * Cumulative spending so far against an even-paced reference. The drawing is
 * hidden from screen readers because the sentence below it says the same thing.
 */
export function SpendingTrace({
  currency,
  cumulativeCents,
  evenPaceCents,
  todayIndex,
  dayLabels,
}: SpendingTraceProps) {
  const max = Math.max(evenPaceCents[6], ...cumulativeCents, 1);
  const x = (day: number) => ((day + 1) * WIDTH) / 7;
  const y = (cents: number) => HEIGHT - (cents / max) * (HEIGHT - TOP);
  const line = (values: number[]) =>
    [`0,${HEIGHT}`, ...values.map((cents, day) => `${x(day)},${y(cents)}`)].join(' ');

  const spentByToday = cumulativeCents[todayIndex];
  const paceByToday = evenPaceCents[todayIndex];

  return (
    <figure className={styles.trace}>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {dayLabels.map((_, day) => (
          <line key={day} className={styles.gridline} x1={x(day)} x2={x(day)} y1={0} y2={HEIGHT} />
        ))}
        <polyline className={styles.pace} points={line(evenPaceCents)} />
        <polyline className={styles.actual} points={line(cumulativeCents.slice(0, todayIndex + 1))} />
      </svg>
      <ol className={styles.days} aria-hidden="true">
        {dayLabels.map((label, day) => (
          <li key={label} className={day === todayIndex ? styles.today : undefined}>
            {label}
          </li>
        ))}
      </ol>
      <figcaption className={styles.caption}>
        <span className={styles.legendActual}>Spent</span> by {dayLabels[todayIndex]}:{' '}
        <Money cents={spentByToday} currency={currency} />.{' '}
        <span className={styles.legendPace}>Even pace</span> by {dayLabels[todayIndex]}:{' '}
        <Money cents={paceByToday} currency={currency} />.
      </figcaption>
    </figure>
  );
}
