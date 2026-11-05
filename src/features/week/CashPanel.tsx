import * as m from 'motion/react-m';
import type { CashAllocation } from '../../domain/allocation';
import type { Currency } from '../../domain/money';
import { HOVER_LIFT, PANEL_TRANSITION } from '../../ui/motionTokens';
import { usePointerTilt } from '../../ui/usePointerTilt';
import { CashAllocationChart } from './CashAllocationChart';
import styles from './CashPanel.module.css';

type CashPanelProps = {
  /** Shared with the expanded view so it grows out of, and returns to, this panel. */
  layoutId: string;
  /** Whether any panel is expanded. The panel only animates its layout when this changes. */
  expanded: boolean;
  className: string;
  headingId: string;
  currency: Currency;
  allocation: CashAllocation;
  onOpen: () => void;
};

/**
 * "Where your cash is" as a physical panel: it tilts toward the mouse, its
 * layers separate in depth while hovered, and a tap or click opens the
 * focused view. data-depth marks how far each layer rises (see the CSS).
 */
export function CashPanel({ layoutId, expanded, className, headingId, currency, allocation, onOpen }: CashPanelProps) {
  const tilt = usePointerTilt();

  return (
    <m.section
      layoutId={layoutId}
      // Without this it also glides whenever content above it changes height, and
      // passes over the chart above on the way.
      layoutDependency={expanded}
      className={`${className} ${styles.panel}`}
      aria-labelledby={headingId}
      style={tilt.style}
      onPointerMove={tilt.onPointerMove}
      onPointerLeave={tilt.onPointerLeave}
      whileHover={HOVER_LIFT}
      transition={PANEL_TRANSITION}
      // Tap or click anywhere opens it; the button below gives keyboard users
      // a clear control, and its click bubbles up to here.
      onClick={onOpen}
    >
      <span className={styles.glare} aria-hidden="true" />
      <h2 id={headingId} className={styles.title} data-depth="1">
        Where your {currency} cash is
      </h2>
      <CashAllocationChart currency={currency} allocation={allocation} />
      <button type="button" className={styles.expandButton} data-expands={layoutId} data-depth="1">
        See spending by category
      </button>
    </m.section>
  );
}
