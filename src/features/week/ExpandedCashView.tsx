import * as m from 'motion/react-m';
import { useEffect } from 'react';
import type { CashAllocation } from '../../domain/allocation';
import { purchaseTitle } from '../../domain/categories';
import { spendingByCategory } from '../../domain/categoryBreakdown';
import type { Currency } from '../../domain/money';
import type { Purchase } from '../../domain/week';
import { Money } from '../../ui/Money';
import { PANEL_TRANSITION } from '../../ui/motionTokens';
import { CashAllocationChart } from './CashAllocationChart';
import styles from './ExpandedCashView.module.css';

type ExpandedCashViewProps = {
  /** Same layoutId as the panel it grew out of, so closing returns it there. */
  layoutId: string;
  currency: Currency;
  allocation: CashAllocation;
  purchases: Purchase[];
  onClose: () => void;
};

/**
 * The focused view of "Where your cash is": the donut plus this week's
 * spending folders by category. Motion animates the panel; the native
 * <dialog> keeps keyboard focus inside, makes the page behind inert, and is
 * announced as a dialog, which Motion does not do.
 */
export function ExpandedCashView({ layoutId, currency, allocation, purchases, onClose }: ExpandedCashViewProps) {
  const breakdown = spendingByCategory(purchases);

  // Opening as a modal in the ref callback, before Motion measures, lets the
  // panel start its grow animation from the dashboard panel's position.
  function openAsModal(dialog: HTMLDialogElement | null) {
    if (dialog && !dialog.open) dialog.showModal();
  }

  // The dialog is removed instead of closed, so put focus back by hand: always
  // on the panel's own "See spending by category" button. (Remembering
  // "whatever was focused" fails on Safari, which does not focus buttons on click.)
  useEffect(() => {
    return () => {
      document.querySelector<HTMLElement>(`[data-expands="${layoutId}"]`)?.focus();
    };
  }, [layoutId]);

  return (
    <dialog
      ref={openAsModal}
      className={styles.dialog}
      aria-labelledby="expanded-cash-title"
      // Escape normally closes the dialog instantly, which hides the shrink-back
      // animation. Stopping the key press itself is reliable; cancelling the
      // dialog's own "cancel" event is not always allowed by Chrome, so onCancel
      // stays only as a fallback that still closes through React.
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // A click on the dimmed area outside the panel closes it.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <m.div layoutId={layoutId} className={styles.panel} transition={PANEL_TRANSITION}>
        <div className={styles.titleRow}>
          <h2 id="expanded-cash-title" className={styles.title}>
            Where your {currency} cash is
          </h2>
          <button type="button" className={styles.close} onClick={onClose}>
            Close
          </button>
        </div>

        <m.div
          className={styles.body}
          // The contents fade in after the panel has grown, so text never
          // appears stretched mid-animation.
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { delay: 0.12, duration: 0.18 } }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
        >
          <CashAllocationChart currency={currency} allocation={allocation} />

          <section className={styles.section} aria-labelledby="folders-title">
            <h3 id="folders-title" className={styles.sectionTitle}>
              Spent this week by category
            </h3>
            {breakdown.groups.length === 0 ? (
              <p className={styles.muted}>No spending recorded this week.</p>
            ) : (
              <ul className={styles.folders}>
                {breakdown.groups.map((group) => (
                  <li key={group.category ?? 'none'}>
                    {/* Native disclosure: each category is a folder that opens to its purchases. */}
                    <details className={styles.folder}>
                      <summary className={styles.folderSummary}>
                        <span className={styles.folderName}>
                          {group.label}
                          <span className={styles.count}>
                            {group.purchases.length} {group.purchases.length === 1 ? 'purchase' : 'purchases'}
                          </span>
                        </span>
                        <Money cents={group.cents} currency={currency} />
                        {/* Exact share drawn as a bar; the amount beside it is the readable value. */}
                        <span className={styles.shareTrack} aria-hidden="true">
                          <span
                            className={styles.shareFill}
                            style={{ width: `${(group.cents * 100) / breakdown.totalCents}%` }}
                          />
                        </span>
                      </summary>
                      <ul className={styles.folderItems}>
                        {group.purchases.map((purchase) => (
                          <li key={purchase.id} className={styles.folderItem}>
                            <span>
                              {purchaseTitle(purchase)}
                              {purchase.note && <span className={styles.itemNote}>{purchase.note}</span>}
                            </span>
                            <Money cents={purchase.cents} currency={currency} />
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.section} aria-labelledby="needs-title">
            <h3 id="needs-title" className={styles.sectionTitle}>
              Needs and wants this week
            </h3>
            <dl className={styles.needs}>
              <dt>Needs</dt>
              <dd>
                <Money cents={breakdown.needCents} currency={currency} />
              </dd>
              <dt>Wants</dt>
              <dd>
                <Money cents={breakdown.wantCents} currency={currency} />
              </dd>
              {breakdown.untaggedCents > 0 && (
                <>
                  <dt>Not marked</dt>
                  <dd>
                    <Money cents={breakdown.untaggedCents} currency={currency} />
                  </dd>
                </>
              )}
            </dl>
          </section>
        </m.div>
      </m.div>
    </dialog>
  );
}
