import { AnimatePresence } from 'motion/react';
import { useState } from 'react';
import { allocateCash } from '../../domain/allocation';
import { freeCashCents } from '../../domain/allowance';
import { categoryLabel, purchaseTitle } from '../../domain/categories';
import { addDays, daysBetween, type IsoDate } from '../../domain/dates';
import type { Currency } from '../../domain/money';
import { summarizeWeek, type Purchase } from '../../domain/week';
import type { DemoAccount } from '../../fixtures/demoWeek';
import { Money } from '../../ui/Money';
import { ThemeSwitch } from '../../ui/ThemeSwitch';
import { CalculationBreakdown } from './CalculationBreakdown';
import { moneyFlow } from '../../domain/moneyFlow';
import { CashPanel } from './CashPanel';
import { MoneyFlow } from './MoneyFlow';
import { ExpandedCashView } from './ExpandedCashView';
import { PurchaseDialog } from './PurchaseDialog';
import { SpendingTrace } from './SpendingTrace';
import styles from './WeekView.module.css';

type WeekViewProps = {
  account: DemoAccount;
  weekStart: IsoDate;
  today: IsoDate;
  onCurrencyChange: (currency: Currency) => void;
  onAddPurchase: (purchase: Purchase) => void;
  onUpdatePurchase: (purchase: Purchase) => void;
  onDeletePurchase: (id: string) => void;
};

/** Which form is open, if any. Editing carries the purchase being edited. */
type DialogState = { mode: 'add' } | { mode: 'edit'; purchase: Purchase } | null;

/**
 * The cash panel is drawn twice (below the number on phones, in the side column
 * on desktop; CSS hides one). Each copy has its own layoutId so the expanded
 * view grows out of, and returns to, the copy that was actually tapped.
 */
type CashPanelId = 'cash-phone' | 'cash-desktop';

/** What the confirmation line under the remaining amount reports. */
type LastAction = { verb: 'Saved' | 'Updated' | 'Deleted'; purchase: Purchase } | null;

const CURRENCIES: Currency[] = ['USD', 'BSD'];

// Calendar dates are shown in UTC on purpose: the date string already is the
// student's local date, so no further time zone shift may be applied.
const label = (date: IsoDate, options: Intl.DateTimeFormatOptions) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });

export function WeekView({
  account,
  weekStart,
  today,
  onCurrencyChange,
  onAddPurchase,
  onUpdatePurchase,
  onDeletePurchase,
}: WeekViewProps) {
  const [dialog, setDialog] = useState<DialogState>(null);
  // Which cash panel is expanded into the focused view, if any.
  const [expandedFrom, setExpandedFrom] = useState<CashPanelId | null>(null);
  // The last change, for the confirmation line. Cleared when switching account.
  const [lastAction, setLastAction] = useState<LastAction>(null);

  const { currency } = account;
  const summary = summarizeWeek(weekStart, account.chosenAllowanceCents, account.purchases);
  // Derived, never stored: cash on Monday minus everything spent since.
  const currentCashCents = account.weekStartCashCents - summary.spentCents;
  const cashParts = {
    currentCashCents,
    protectedCents: account.protectedCents,
    commitmentsCents: account.commitmentsCents,
  };
  const todayIndex = daysBetween(weekStart, today);
  const weekEnd = addDays(weekStart, 6);
  const dayLabels = Array.from({ length: 7 }, (_, day) =>
    label(addDays(weekStart, day), { weekday: 'short' }),
  );
  const dayTitles = Array.from({ length: 7 }, (_, day) =>
    label(addDays(weekStart, day), { weekday: 'short', month: 'short', day: 'numeric' }),
  );
  // The entry form offers Monday through today, never a future or closed day.
  const entryDates = Array.from({ length: todayIndex + 1 }, (_, day) => ({
    date: addDays(weekStart, day),
    label: dayTitles[day],
  })).reverse();
  const overspent = summary.remainingCents < 0;
  // Reverse first so that, within one day, the most recently added comes first
  // (sort keeps the existing order of equal dates).
  const newestFirst = [...account.purchases].reverse().sort((a, b) => b.date.localeCompare(a.date));

  function handleSave(purchase: Purchase) {
    if (dialog?.mode === 'edit') {
      onUpdatePurchase(purchase);
      setLastAction({ verb: 'Updated', purchase });
    } else {
      onAddPurchase(purchase);
      setLastAction({ verb: 'Saved', purchase });
    }
    setDialog(null);
  }

  function handleDelete(id: string) {
    const deleted = account.purchases.find((purchase) => purchase.id === id);
    onDeletePurchase(id);
    if (deleted) setLastAction({ verb: 'Deleted', purchase: deleted });
    setDialog(null);
  }

  function handleCurrencyChange(next: Currency) {
    setLastAction(null);
    onCurrencyChange(next);
  }

  const cashAllocation = allocateCash({ ...cashParts, weekRemainingCents: summary.remainingCents });

  const cashPanel = (id: CashPanelId, className: string, headingId: string) => (
    <CashPanel
      layoutId={id}
      className={className}
      headingId={headingId}
      currency={currency}
      allocation={cashAllocation}
      onOpen={() => setExpandedFrom(id)}
    />
  );

  const breakdown = (
    <CalculationBreakdown
      currency={currency}
      {...cashParts}
      freeCashCents={freeCashCents(cashParts)}
      planEndLabel={label(account.planEndDate, { month: 'short', day: 'numeric' })}
      recommendedAllowanceCents={account.recommendedAllowanceCents}
      chosenAllowanceCents={account.chosenAllowanceCents}
      spentCents={summary.spentCents}
      remainingCents={summary.remainingCents}
    />
  );

  return (
    <div className={`${styles.page} ${expandedFrom ? styles.receded : ''}`}>
      <p className={styles.demoBanner}>
        <strong>Demo data.</strong> These numbers are fictional. Purchases you add are kept only
        until you close or reload this tab.
      </p>

      <header className={styles.header}>
        <div className={styles.currencySwitch} role="group" aria-label="Account currency">
          {CURRENCIES.map((option) => (
            <button
              key={option}
              type="button"
              className={styles.currencyOption}
              aria-pressed={option === currency}
              onClick={() => handleCurrencyChange(option)}
            >
              {option}
            </button>
          ))}
        </div>
        <p className={styles.weekDates}>
          <time dateTime={weekStart}>{label(weekStart, { weekday: 'short', month: 'short', day: 'numeric' })}</time>
          {' to '}
          <time dateTime={weekEnd}>{label(weekEnd, { weekday: 'short', month: 'short', day: 'numeric' })}</time>
        </p>
      </header>

      <main className={styles.layout}>
        <div className={styles.primary}>
          <section aria-labelledby="remaining-heading">
            <h1 id="remaining-heading" className={styles.eyebrow}>
              {overspent ? 'Overspent this week' : 'Weekly remaining'}
            </h1>
            <p className={`${styles.remaining} ${overspent ? styles.overspent : ''}`}>
              <Money cents={Math.abs(summary.remainingCents)} currency={currency} />
            </p>
            <p className={styles.subline}>
              of <Money cents={account.chosenAllowanceCents} currency={currency} /> allowance ·{' '}
              <Money cents={summary.spentCents} currency={currency} /> spent
            </p>
            {account.chosenAllowanceCents !== account.recommendedAllowanceCents && (
              <p className={styles.note}>
                You chose <Money cents={account.chosenAllowanceCents} currency={currency} />; the
                suggestion was <Money cents={account.recommendedAllowanceCents} currency={currency} />.
              </p>
            )}
            {/* role="status" makes screen readers announce the change without moving focus. */}
            <p className={styles.savedStatus} role="status">
              {lastAction && (
                <>
                  {lastAction.verb} <Money cents={lastAction.purchase.cents} currency={currency} /> ·{' '}
                  {purchaseTitle(lastAction.purchase)}
                </>
              )}
            </p>
            <div className={styles.actionBar}>
              <button type="button" className={styles.addButton} onClick={() => setDialog({ mode: 'add' })}>
                + Add spending
              </button>
            </div>
          </section>

          <section className={styles.section} aria-labelledby="flow-heading">
            <h2 id="flow-heading" className={styles.sectionTitle}>
              Where this week’s allowance went
            </h2>
            <MoneyFlow
              currency={currency}
              flow={moneyFlow(account.chosenAllowanceCents, account.purchases)}
              pulse={
                lastAction?.verb === 'Saved'
                  ? { key: lastAction.purchase.category ?? 'none', id: lastAction.purchase.id }
                  : undefined
              }
            />
          </section>

          {cashPanel('cash-phone', `${styles.section} ${styles.phoneOnly}`, 'cash-heading-phone')}

          <section className={styles.section} aria-labelledby="trace-heading">
            <h2 id="trace-heading" className={styles.sectionTitle}>
              Spending this week
            </h2>
            <SpendingTrace
              currency={currency}
              weekStart={weekStart}
              purchases={account.purchases}
              dayTitles={dayTitles}
              cumulativeCents={summary.cumulativeCents}
              evenPaceCents={summary.evenPaceCents}
              todayIndex={todayIndex}
              dayLabels={dayLabels}
            />
          </section>

          <section className={styles.section} aria-labelledby="activity-heading">
            <h2 id="activity-heading" className={styles.sectionTitle}>
              This week’s activity
            </h2>
            {newestFirst.length === 0 ? (
              <p className={styles.empty}>No spending recorded this week.</p>
            ) : (
              <ul className={styles.activity}>
                {newestFirst.map((purchase) => (
                  <li key={purchase.id}>
                    {/* The whole row is one button: tap to edit or delete this purchase. */}
                    <button
                      type="button"
                      className={styles.activityRow}
                      onClick={() => setDialog({ mode: 'edit', purchase })}
                    >
                    <time className={styles.activityDay} dateTime={purchase.date}>
                      {label(purchase.date, { weekday: 'short' })}
                    </time>
                    <span className={styles.merchant}>
                      {purchaseTitle(purchase)}
                      {purchase.note && <span className={styles.purchaseNote}>{purchase.note}</span>}
                      {(purchase.category || purchase.needOrWant) && (
                        <span className={styles.purchaseTags}>
                          {[
                            purchase.category && categoryLabel(purchase.category),
                            purchase.needOrWant && (purchase.needOrWant === 'need' ? 'Need' : 'Want'),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      )}
                    </span>
                    <span className={styles.amount}>
                      <Money cents={purchase.cents} currency={currency} />
                    </span>
                    <span className={styles.editHint} aria-hidden="true">
                      Edit
                    </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <details className={`${styles.section} ${styles.phoneOnly}`}>
            <summary className={styles.summary}>How this is calculated</summary>
            {breakdown}
          </details>
        </div>

        {/* Desktop shows these side by side instead of below; phones hide this column. */}
        <aside className={styles.sideColumn}>
          {cashPanel('cash-desktop', styles.card, 'cash-heading')}
          <section className={styles.card} aria-labelledby="calc-heading">
            <h2 id="calc-heading" className={styles.sectionTitle}>
              How this is calculated <span className={styles.currencyTag}>{currency}</span>
            </h2>
            {breakdown}
          </section>
        </aside>
      </main>

      <footer className={styles.footer}>
        <ThemeSwitch />
      </footer>

      {/* AnimatePresence keeps the view on screen while it shrinks back to its panel. */}
      <AnimatePresence>
        {expandedFrom && (
          <ExpandedCashView
            key={expandedFrom}
            layoutId={expandedFrom}
            currency={currency}
            allocation={cashAllocation}
            purchases={account.purchases}
            onClose={() => setExpandedFrom(null)}
          />
        )}
      </AnimatePresence>

      {/* Mounted only while open, so every opening starts fresh: an empty form
          and a new id when adding, the purchase's own values and id when editing. */}
      {dialog && (
        <PurchaseDialog
          // A different key per purchase makes React start a fresh form when
          // switching straight from one purchase to another.
          key={dialog.mode === 'edit' ? dialog.purchase.id : 'add'}
          currency={currency}
          dates={entryDates}
          existing={dialog.mode === 'edit' ? dialog.purchase : undefined}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
