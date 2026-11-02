import { allocateCash } from '../../domain/allocation';
import { freeCashCents } from '../../domain/allowance';
import { addDays, daysBetween, type IsoDate } from '../../domain/dates';
import type { Currency } from '../../domain/money';
import { summarizeWeek } from '../../domain/week';
import type { DemoAccount } from '../../fixtures/demoWeek';
import { Money } from '../../ui/Money';
import { CalculationBreakdown } from './CalculationBreakdown';
import { CashAllocationChart } from './CashAllocationChart';
import { SpendingTrace } from './SpendingTrace';
import styles from './WeekView.module.css';

type WeekViewProps = {
  account: DemoAccount;
  weekStart: IsoDate;
  today: IsoDate;
};

const CURRENCIES: Currency[] = ['USD', 'BSD'];

// Calendar dates are shown in UTC on purpose: the date string already is the
// student's local date, so no further time zone shift may be applied.
const label = (date: IsoDate, options: Intl.DateTimeFormatOptions) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });

export function WeekView({ account, weekStart, today }: WeekViewProps) {
  const { currency } = account;
  const summary = summarizeWeek(weekStart, account.chosenAllowanceCents, account.purchases);
  const freeCash = freeCashCents(account);
  const todayIndex = daysBetween(weekStart, today);
  const weekEnd = addDays(weekStart, 6);
  const dayLabels = Array.from({ length: 7 }, (_, day) =>
    label(addDays(weekStart, day), { weekday: 'short' }),
  );
  const overspent = summary.remainingCents < 0;
  const newestFirst = [...account.purchases].sort((a, b) => b.date.localeCompare(a.date));

  const allocation = (
    <CashAllocationChart
      currency={currency}
      allocation={allocateCash({ ...account, weekRemainingCents: summary.remainingCents })}
    />
  );

  const breakdown = (
    <CalculationBreakdown
      currency={currency}
      currentCashCents={account.currentCashCents}
      protectedCents={account.protectedCents}
      commitmentsCents={account.commitmentsCents}
      freeCashCents={freeCash}
      planEndLabel={label(account.planEndDate, { month: 'short', day: 'numeric' })}
      recommendedAllowanceCents={account.recommendedAllowanceCents}
      chosenAllowanceCents={account.chosenAllowanceCents}
      spentCents={summary.spentCents}
      remainingCents={summary.remainingCents}
    />
  );

  return (
    <div className={styles.page}>
      <p className={styles.demoBanner}>
        <strong>Demo data</strong> — fictional numbers. Nothing is saved, and Add spending is not
        connected yet.
      </p>

      <header className={styles.header}>
        {/* Links for now: switching reloads the page with ?currency=…; React state replaces this next. */}
        <nav className={styles.currencySwitch} aria-label="Account currency">
          {CURRENCIES.map((option) => (
            <a
              key={option}
              href={`?currency=${option}`}
              className={styles.currencyOption}
              aria-current={option === currency ? 'page' : undefined}
            >
              {option}
            </a>
          ))}
        </nav>
        <p className={styles.weekDates}>
          <time dateTime={weekStart}>{label(weekStart, { weekday: 'short', month: 'short', day: 'numeric' })}</time>
          {' – '}
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
            <div className={styles.actionBar}>
              <button type="button" className={styles.addButton}>
                + Add spending
              </button>
            </div>
          </section>

          <section className={`${styles.section} ${styles.phoneOnly}`} aria-labelledby="cash-heading-phone">
            <h2 id="cash-heading-phone" className={styles.sectionTitle}>
              Where your {currency} cash is
            </h2>
            {allocation}
          </section>

          <section className={styles.section} aria-labelledby="trace-heading">
            <h2 id="trace-heading" className={styles.sectionTitle}>
              Spending this week
            </h2>
            <SpendingTrace
              currency={currency}
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
                  <li key={purchase.id} className={styles.activityRow}>
                    <time className={styles.activityDay} dateTime={purchase.date}>
                      {label(purchase.date, { weekday: 'short' })}
                    </time>
                    <span className={styles.merchant}>{purchase.merchant}</span>
                    <span className={styles.amount}>
                      <Money cents={purchase.cents} currency={currency} />
                    </span>
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
          <section className={styles.card} aria-labelledby="cash-heading">
            <h2 id="cash-heading" className={styles.sectionTitle}>
              Where your {currency} cash is
            </h2>
            {allocation}
          </section>
          <section className={styles.card} aria-labelledby="calc-heading">
            <h2 id="calc-heading" className={styles.sectionTitle}>
              How this is calculated <span className={styles.currencyTag}>{currency}</span>
            </h2>
            {breakdown}
          </section>
        </aside>
      </main>
    </div>
  );
}
