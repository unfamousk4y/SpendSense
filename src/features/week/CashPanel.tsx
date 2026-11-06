import type { CashAllocation } from '../../domain/allocation';
import type { Currency } from '../../domain/money';
import { TiltPanel } from '../../ui/TiltPanel';
import { CashAllocationChart } from './CashAllocationChart';
import styles from './CashPanel.module.css';

type CashPanelProps = {
  /** Shared with the expanded view so it grows out of, and returns to, this panel. */
  layoutId: string;
  /** Whether any panel is expanded. The panel only animates its layout when this changes. */
  expanded: boolean;
  className: string;
  /** Its place in the page's arrival order. */
  enterOrder: number;
  headingId: string;
  currency: Currency;
  allocation: CashAllocation;
  onOpen: () => void;
};

/**
 * "Where your cash is": it leans toward the mouse like every panel, and its layers
 * also separate in depth while hovered. A tap or click opens the focused view.
 * data-depth marks how far each layer rises (see the CSS).
 */
export function CashPanel({ layoutId, expanded, className, enterOrder, headingId, currency, allocation, onOpen }: CashPanelProps) {
  return (
    <TiltPanel
      layoutId={layoutId}
      // Without this it also glides whenever content above it changes height, and
      // passes over the chart above on the way.
      layoutDependency={expanded}
      className={`${className} ${styles.panel}`}
      enterOrder={enterOrder}
      aria-labelledby={headingId}
      // Tap or click anywhere opens it; the button below gives keyboard users
      // a clear control, and its click bubbles up to here.
      onClick={onOpen}
    >
      <h2 id={headingId} className={styles.title} data-depth="1">
        Where your {currency} cash is
      </h2>
      <CashAllocationChart currency={currency} allocation={allocation} reveal />
      <button type="button" className={styles.expandButton} data-expands={layoutId} data-depth="1">
        See spending by category
      </button>
    </TiltPanel>
  );
}
