import { useId, useState } from 'react';
import { purchaseTitle } from '../../domain/categories';
import { addDays, type IsoDate } from '../../domain/dates';
import type { Currency } from '../../domain/money';
import type { Purchase } from '../../domain/week';
import { Money } from '../../ui/Money';
import { areaPoints, dayX, lineYs, polylinePoints, TRACE_HEIGHT, TRACE_WIDTH } from './traceGeometry';
import { useSpendingLine } from './useSpendingLine';
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

const COLUMN = TRACE_WIDTH / 7;

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
  const svgIds = useId();

  const maxCents = Math.max(evenPaceCents[6], ...cumulativeCents, 1);
  const actualYs = lineYs(cumulativeCents.slice(0, todayIndex + 1), maxCents);
  const paceYs = lineYs(evenPaceCents, maxCents);
  const { clipRef, lineRef, areaRef, startClipWidth } = useSpendingLine(actualYs, todayIndex);

  const shownDate = addDays(weekStart, shownDay);
  const shownPurchases = purchases.filter((purchase) => purchase.date === shownDate);
  const shownTotal = shownPurchases.reduce((sum, purchase) => sum + purchase.cents, 0);

  return (
    <figure className={styles.trace}>
      <div className={styles.plot}>
        <svg
          className={styles.chart}
          viewBox={`0 0 ${TRACE_WIDTH} ${TRACE_HEIGHT}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          onMouseLeave={() => setHoveredDay(null)}
        >
          <defs>
            <clipPath id={`${svgIds}-reveal`}>
              <rect ref={clipRef} x={0} y={-4} width={startClipWidth} height={TRACE_HEIGHT + 8} />
            </clipPath>
            <linearGradient id={`${svgIds}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className={styles.fillTop} />
              <stop offset="1" className={styles.fillBottom} />
            </linearGradient>
          </defs>

          <rect className={styles.highlight} x={shownDay * COLUMN} y={0} width={COLUMN} height={TRACE_HEIGHT} />
          {dayLabels.map((_, day) => (
            <line key={day} className={styles.gridline} x1={dayX(day)} x2={dayX(day)} y1={0} y2={TRACE_HEIGHT} />
          ))}
          <line className={styles.gridline} x1={0} x2={TRACE_WIDTH} y1={TRACE_HEIGHT / 2} y2={TRACE_HEIGHT / 2} />

          <polyline className={styles.pace} points={polylinePoints(paceYs)} />
          <g clipPath={`url(#${svgIds}-reveal)`}>
            <polygon ref={areaRef} fill={`url(#${svgIds}-fill)`} points={areaPoints(actualYs)} />
            <polyline ref={lineRef} className={styles.actual} points={polylinePoints(actualYs)} />
          </g>

          {/* Mouse only: the day buttons below are the way in for everyone else. */}
          {dayLabels.map((_, day) => (
            <rect
              key={day}
              className={styles.hit}
              x={day * COLUMN}
              y={0}
              width={COLUMN}
              height={TRACE_HEIGHT}
              onMouseEnter={() => setHoveredDay(day)}
              onClick={() => setSelectedDay(day)}
            />
          ))}
        </svg>

        {/* The scale, shown from the first frame whatever the line is doing. */}
        {maxCents > 1 && (
          <div className={styles.axis} aria-hidden="true">
            <Money cents={maxCents} currency={currency} />
            <Money cents={0} currency={currency} />
          </div>
        )}
      </div>

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

      <div className={styles.below}>
        <figcaption className={styles.caption}>
          <span className={styles.legendRow}>
            <span className={styles.legendActual}>Spent</span> by {dayLabels[todayIndex]}:{' '}
            <Money cents={cumulativeCents[todayIndex]} currency={currency} />
          </span>
          <span className={styles.legendRow}>
            <span className={styles.legendPace}>Even pace</span> by {dayLabels[todayIndex]}:{' '}
            <Money cents={evenPaceCents[todayIndex]} currency={currency} />
          </span>
        </figcaption>

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
      </div>
    </figure>
  );
}
