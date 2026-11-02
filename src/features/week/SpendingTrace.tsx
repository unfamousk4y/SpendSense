import { useState } from 'react';
import { purchaseTitle } from '../../domain/categories';
import { addDays, type IsoDate } from '../../domain/dates';
import type { Currency } from '../../domain/money';
import type { Purchase } from '../../domain/week';
import { Money } from '../../ui/Money';
import styles from './SpendingTrace.module.css';

type SpendingTraceProps = {
  currency: Currency;
  weekStart: IsoDate;
  purchases: Purchase[];
  cumulativeCents: number[];
  evenPaceCents: number[];
  /** 0 = Monday. Days after today have no actual spending yet. */
  todayIndex: number;
  dayLabels: string[];
  /** Long form for the details heading, e.g. "Wed, Nov 4". */
  dayTitles: string[];
};

const WIDTH = 700;
const HEIGHT = 160;
const TOP = 12;
const COLUMN = WIDTH / 7;

/**
 * Cumulative spending so far against an even-paced reference. The drawing is
 * hidden from screen readers; the day buttons, the details list and the
 * sentence below carry the same information as text.
 */
export function SpendingTrace({
  currency,
  weekStart,
  purchases,
  cumulativeCents,
  evenPaceCents,
  todayIndex,
  dayLabels,
  dayTitles,
}: SpendingTraceProps) {
  // The day chosen by tap, click or keyboard. Starts on today.
  const [selectedDay, setSelectedDay] = useState(todayIndex);
  // The day under the mouse pointer, if any; previews without changing the selection.
  const [hoveredDay, setHoveredDay] = useState<number | null>(null);
  const shownDay = hoveredDay ?? selectedDay;

  const max = Math.max(evenPaceCents[6], ...cumulativeCents, 1);
  const x = (day: number) => ((day + 1) * WIDTH) / 7;
  const y = (cents: number) => HEIGHT - (cents / max) * (HEIGHT - TOP);
  const line = (values: number[]) =>
    [`0,${HEIGHT}`, ...values.map((cents, day) => `${x(day)},${y(cents)}`)].join(' ');

  const shownDate = addDays(weekStart, shownDay);
  const shownPurchases = purchases.filter((purchase) => purchase.date === shownDate);
  const shownTotal = shownPurchases.reduce((sum, purchase) => sum + purchase.cents, 0);

  return (
    <figure className={styles.trace}>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <rect className={styles.highlight} x={shownDay * COLUMN} y={0} width={COLUMN} height={HEIGHT} />
        {dayLabels.map((_, day) => (
          <line key={day} className={styles.gridline} x1={x(day)} x2={x(day)} y1={0} y2={HEIGHT} />
        ))}
        <polyline className={styles.pace} points={line(evenPaceCents)} />
        <polyline className={styles.actual} points={line(cumulativeCents.slice(0, todayIndex + 1))} />
      </svg>

      <div className={styles.days} role="group" aria-label="Show purchases for a day">
        {dayLabels.map((label, day) => (
          <button
            key={label}
            type="button"
            className={`${styles.day} ${day === todayIndex ? styles.today : ''}`}
            aria-pressed={day === selectedDay}
            aria-controls="day-details"
            onClick={() => setSelectedDay(day)}
            onMouseEnter={() => setHoveredDay(day)}
            onMouseLeave={() => setHoveredDay(null)}
          >
            {label}
          </button>
        ))}
      </div>

      <div id="day-details" className={styles.details}>
        <p className={styles.detailsHeading}>
          <span>
            {dayTitles[shownDay]}
            {shownDay === todayIndex && <span className={styles.todayTag}>Today</span>}
          </span>
          {shownPurchases.length > 0 && <Money cents={shownTotal} currency={currency} />}
        </p>
        {shownPurchases.length > 0 ? (
          <ul className={styles.detailsList}>
            {shownPurchases.map((purchase) => (
              <li key={purchase.id} className={styles.detailsRow}>
                <span>
                  {purchaseTitle(purchase)}
                  {purchase.note && <span className={styles.detailsNote}>{purchase.note}</span>}
                </span>
                <Money cents={purchase.cents} currency={currency} />
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.detailsEmpty}>
            {shownDay > todayIndex ? 'This day has not happened yet.' : 'No spending recorded.'}
          </p>
        )}
      </div>

      <figcaption className={styles.caption}>
        <span className={styles.legendActual}>Spent</span> by {dayLabels[todayIndex]}:{' '}
        <Money cents={cumulativeCents[todayIndex]} currency={currency} />.{' '}
        <span className={styles.legendPace}>Even pace</span> by {dayLabels[todayIndex]}:{' '}
        <Money cents={evenPaceCents[todayIndex]} currency={currency} />.
      </figcaption>
    </figure>
  );
}
