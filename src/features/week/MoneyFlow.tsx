import { useState } from 'react';
import type { Currency } from '../../domain/money';
import type { MoneyFlow as Flow } from '../../domain/moneyFlow';
import { Money } from '../../ui/Money';
import styles from './MoneyFlow.module.css';

type MoneyFlowProps = {
  currency: Currency;
  flow: Flow;
  /** The purchase just saved: a streak runs along its category's band. */
  pulse?: { key: string; id: string };
};

// Each destination gets one row of this height; bands start at their exact
// share of the source bar and narrow into the middle of their row.
const ROW = 48;

/**
 * Where this week's allowance went, drawn as bands flowing from one source bar
 * into each category and "Left to spend". The drawing is hidden from screen
 * readers; the list of names and amounts beside it is the text version.
 */
export function MoneyFlow({ currency, flow, pulse }: MoneyFlowProps) {
  // The destination under the mouse: its band brightens, the others dim.
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  if (flow.totalCents === 0) {
    return <p className={styles.empty}>No allowance or spending this week yet.</p>;
  }

  const height = Math.max(flow.streams.length, 1) * ROW;
  // SVG units: x runs 0 to 100 (stretched to the column width), y is real pixels.
  const bands: { stream: Flow['streams'][number]; area: string; centerline: string }[] = [];
  let start = 0;
  for (const [index, stream] of flow.streams.entries()) {
    const share = stream.cents / flow.totalCents;
    const y0 = start * height;
    const y1 = (start + share) * height;
    start += share;
    const target = (index + 0.5) * ROW;
    const half = Math.min(Math.max(share * height, 3), ROW - 10) / 2;
    const middle = (y0 + y1) / 2;
    bands.push({
      stream,
      area: `M0,${y0} C50,${y0} 50,${target - half} 100,${target - half} L100,${target + half} C50,${target + half} 50,${y1} 0,${y1} Z`,
      centerline: `M0,${middle} C50,${middle} 50,${target} 100,${target}`,
    });
  }

  // Where the allowance ends on the source bar, as a percentage of its height.
  const allowanceEnd = (flow.allowanceCents / flow.totalCents) * 100;

  return (
    <div className={styles.flow}>
      <p className={styles.headline}>
        {flow.overspentCents > 0 ? (
          <>
            Spent more than the <Money cents={flow.allowanceCents} currency={currency} /> allowance by{' '}
            <strong className={styles.over}>
              <Money cents={flow.overspentCents} currency={currency} />
            </strong>
          </>
        ) : (
          <>
            <Money cents={flow.allowanceCents} currency={currency} /> allowance this week
          </>
        )}
      </p>

      <div className={styles.diagram} style={{ height }}>
        <div
          className={styles.source}
          aria-hidden="true"
          // Above the line is the allowance; any red below it is overspending.
          style={{
            background: `linear-gradient(to bottom, var(--accent) 0 ${allowanceEnd}%, var(--red) ${allowanceEnd}% 100%)`,
          }}
        />

        <svg
          className={styles.bands}
          viewBox={`0 0 100 ${height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          onMouseLeave={() => setFocusedKey(null)}
        >
          {bands.map(({ stream, area, centerline }) => {
            const dimmed = focusedKey !== null && focusedKey !== stream.key;
            const isPulsing = pulse?.key === stream.key;
            return (
              <g key={stream.key} onMouseEnter={() => setFocusedKey(stream.key)}>
                <path
                  // Re-keying on each new purchase restarts the flash animation.
                  key={isPulsing ? pulse.id : 'band'}
                  d={area}
                  className={[
                    styles.band,
                    stream.kind === 'remaining' ? styles.remaining : styles.spent,
                    dimmed ? styles.dimmed : '',
                    focusedKey === stream.key ? styles.focused : '',
                    isPulsing ? styles.flash : '',
                  ].join(' ')}
                />
                {isPulsing && (
                  <path key={pulse.id} d={centerline} pathLength={100} className={styles.streak} />
                )}
              </g>
            );
          })}
        </svg>

        <ul className={styles.labels}>
          {flow.streams.map((stream) => (
            <li
              key={stream.key}
              className={`${styles.label} ${focusedKey !== null && focusedKey !== stream.key ? styles.labelDimmed : ''}`}
              style={{ height: ROW }}
              onMouseEnter={() => setFocusedKey(stream.key)}
              onMouseLeave={() => setFocusedKey(null)}
            >
              <span className={stream.kind === 'remaining' ? styles.remainingName : styles.name}>{stream.label}</span>
              <Money cents={stream.cents} currency={currency} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
