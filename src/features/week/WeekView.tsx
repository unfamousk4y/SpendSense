import { AnimatePresence } from 'motion/react';
import { useState, type ReactNode } from 'react';
import type { FormDraft } from '../../data/formDraft';
import { allocateCash } from '../../domain/allocation';
import { freeCashCents } from '../../domain/allowance';
import { midweekSuggestion, remainingOverFreeCash, type AllowanceChange } from '../../domain/allowanceChange';
import { categoryLabel, purchaseTitle } from '../../domain/categories';
import { SETUP_BILL_NAME, type Bill, type BillPayment } from '../../domain/bills';
import { sumCorrections, type BalanceCorrection } from '../../domain/correction';
import { sumIncome, type IncomeReceipt } from '../../domain/income';
import { addDays, daysBetween, planDays, type IsoDate } from '../../domain/dates';
import type { Currency } from '../../domain/money';
import { summarizeWeek, type Purchase } from '../../domain/week';
import type { SaveResult } from '../../data/ledgerStore';
import type { WeekAccount } from '../../domain/ledger';
import { Money } from '../../ui/Money';
import { AppearanceMenu } from '../../ui/AppearanceMenu';
import { usePauseEffectsWhenHidden } from '../../ui/useAppearance';
import { TiltPanel } from '../../ui/TiltPanel';
import { SummaryCard } from './SummaryCard';
import { AdjustAllowanceDialog } from './AdjustAllowanceDialog';
import type { SavingsRelease } from '../../domain/release';
import { BillDialog } from './BillDialog';
import { CalculationBreakdown } from './CalculationBreakdown';
import { IncomeDialog } from './IncomeDialog';
import { ClosureSummary } from './ClosureSummary';
import { CorrectBalanceDialog } from './CorrectBalanceDialog';
import { UndoCorrectionDialog } from './UndoCorrectionDialog';
import { NewPlanDialog } from './NewPlanDialog';
import { PayBillDialog } from './PayBillDialog';
import { moneyFlow } from '../../domain/moneyFlow';
import { SUGGESTED_SPLIT } from '../../domain/split';
import { canStartNewPlan } from '../../domain/newPlan';
import { CashPanel } from './CashPanel';
import { MoneyFlow } from './MoneyFlow';
import { ExpandedCashView } from './ExpandedCashView';
import { PurchaseDialog } from './PurchaseDialog';
import { ReleaseSavingsDialog } from './ReleaseSavingsDialog';
import { SpendingTrace } from './SpendingTrace';
import styles from './WeekView.module.css';

type WeekViewProps = {
  account: WeekAccount;
  today: IsoDate;
  onCurrencyChange: (currency: Currency) => void;
  /** Each resolves once the change is confirmed or has failed. */
  onAddPurchase: (purchase: Purchase) => Promise<SaveResult>;
  onUpdatePurchase: (purchase: Purchase) => Promise<SaveResult>;
  onDeletePurchase: (id: string) => Promise<SaveResult>;
  onAddIncome: (income: IncomeReceipt) => Promise<SaveResult>;
  onUpdateIncome: (income: IncomeReceipt) => Promise<SaveResult>;
  onDeleteIncome: (id: string) => Promise<SaveResult>;
  onAddCorrection: (correction: BalanceCorrection) => Promise<SaveResult>;
  onDeleteCorrection: (id: string) => Promise<SaveResult>;
  onAddBill: (bill: Bill) => Promise<SaveResult>;
  onUpdateBill: (bill: Bill) => Promise<SaveResult>;
  onDeleteBill: (id: string) => Promise<SaveResult>;
  onPayBill: (id: string, payment: BillPayment) => Promise<SaveResult>;
  onPayBillKeepRest: (id: string, payment: BillPayment, restId: string) => Promise<SaveResult>;
  onUndoBillPayment: (id: string) => Promise<SaveResult>;
  onStartNewPlan: (endDate: IsoDate) => Promise<SaveResult>;
  onChangeAllowance: (change: AllowanceChange) => Promise<SaveResult>;
  onReleaseSavings: (release: SavingsRelease) => Promise<SaveResult>;
  /** Present only on the fictional demo: move the date forward one day. */
  onNextDay?: () => void;
  /** A form to reopen, filled in, because the session ended while saving it. */
  restoredDraft?: FormDraft;
  /** Who is signed in and a way out, shown in the footer. */
  accountControls?: ReactNode;
};

/** Which form is open, if any. Editing carries the purchase being edited. */
type DialogState =
  | { mode: 'add'; restored?: Purchase }
  | { mode: 'edit'; purchase: Purchase; restored?: Purchase }
  | { mode: 'addIncome'; restored?: IncomeReceipt }
  | { mode: 'editIncome'; income: IncomeReceipt; restored?: IncomeReceipt }
  | { mode: 'correct' }
  | { mode: 'undoCorrection'; correction: BalanceCorrection }
  | { mode: 'addBill'; restored?: Bill }
  | { mode: 'editBill'; bill: Bill; restored?: Bill }
  | { mode: 'payBill'; bill: Bill }
  | { mode: 'newPlan' }
  | { mode: 'allowance' }
  | { mode: 'release' }
  | null;

const CASH_PANEL_ID = 'cash-panel';

/** What the confirmation line under the remaining amount reports. */
type LastAction =
  | { kind: 'purchase'; verb: 'Saved' | 'Updated' | 'Deleted'; purchase: Purchase }
  | { kind: 'income'; verb: 'Recorded' | 'Updated' | 'Deleted'; income: IncomeReceipt }
  | { kind: 'correction'; verb: 'Saved' | 'Undid'; correction: BalanceCorrection; cashAfterCents: number }
  | { kind: 'bill'; verb: 'Added' | 'Updated' | 'Deleted'; bill: Bill }
  | { kind: 'billPaid'; verb: 'Paid' | 'Updated'; name: string; cents: number; restCents?: number }
  | { kind: 'billUnpaid'; name: string; cents: number }
  | { kind: 'newPlan'; endLabel: string }
  | { kind: 'allowance'; change: AllowanceChange }
  | { kind: 'release'; release: SavingsRelease }
  | null;

const CURRENCIES: Currency[] = ['USD', 'BSD'];

// Calendar dates are shown in UTC on purpose: the date string already is the
// student's local date, so no further time zone shift may be applied.
const label = (date: IsoDate, options: Intl.DateTimeFormatOptions) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });

/** An entry being edited must still exist: another device may have deleted it. */
function dialogForDraft(draft: FormDraft | undefined, account: WeekAccount): DialogState {
  if (!draft) return null;
  switch (draft.kind) {
    case 'purchase': {
      if (!draft.editing) return { mode: 'add', restored: draft.entry };
      const purchase = account.purchases.find((saved) => saved.id === draft.entry.id);
      return purchase ? { mode: 'edit', purchase, restored: draft.entry } : null;
    }
    case 'income': {
      if (!draft.editing) return { mode: 'addIncome', restored: draft.entry };
      const income = account.income.find((saved) => saved.id === draft.entry.id);
      return income ? { mode: 'editIncome', income, restored: draft.entry } : null;
    }
    case 'bill': {
      if (!draft.editing) return { mode: 'addBill', restored: draft.entry };
      const bill = account.bills.find((saved) => saved.id === draft.entry.id);
      return bill ? { mode: 'editBill', bill, restored: draft.entry } : null;
    }
  }
}

export function WeekView({
  account,
  today,
  onCurrencyChange,
  onAddPurchase,
  onUpdatePurchase,
  onDeletePurchase,
  onAddIncome,
  onUpdateIncome,
  onDeleteIncome,
  onAddCorrection,
  onDeleteCorrection,
  onAddBill,
  onUpdateBill,
  onDeleteBill,
  onPayBill,
  onPayBillKeepRest,
  onUndoBillPayment,
  onStartNewPlan,
  onChangeAllowance,
  onReleaseSavings,
  onNextDay,
  restoredDraft,
  accountControls,
}: WeekViewProps) {
  const [dialog, setDialog] = useState<DialogState>(() => dialogForDraft(restoredDraft, account));
  // Whether the cash panel is expanded into the focused view.
  const [cashExpanded, setCashExpanded] = useState(false);
  usePauseEffectsWhenHidden();
  // The last change, for the confirmation line. Cleared when switching account.
  const [lastAction, setLastAction] = useState<LastAction>(null);

  const { currency, weekStart } = account;
  const summary = summarizeWeek(weekStart, account.chosenAllowanceCents, account.purchases);
  // Derived, never stored: cash on Monday, plus income and corrections since, minus spending and bill payments since.
  const currentCashCents =
    account.weekStartCashCents +
    sumIncome(account.income) +
    sumCorrections(account.corrections) -
    summary.spentCents -
    account.billPaymentsThisWeekCents;
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
  // Nor before the account's opening date: its opening cash already reflects
  // earlier spending.
  const entryDates = Array.from({ length: todayIndex + 1 }, (_, day) => ({
    date: addDays(weekStart, day),
    label: dayTitles[day],
  }))
    .filter(({ date }) => date >= account.openingDate || date === today)
    .reverse();
  const overspent = summary.remainingCents < 0;
  // Reverse first so that, within one day, the most recently added comes first
  // (sort keeps the existing order of equal dates).
  const newestFirst = [...account.purchases].reverse().sort((a, b) => b.date.localeCompare(a.date));
  const incomeNewestFirst = [...account.income].reverse().sort((a, b) => b.date.localeCompare(a.date));

  // Soonest first; bills due on one day stay in the order they were added.
  const unpaidBills = account.bills.filter((bill) => bill.paidOn === undefined).sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  // A payment can be corrected only while its week is open, so only these are listed.
  const paidThisWeek = account.bills
    .filter((bill) => bill.paidOn !== undefined && bill.paidOn >= weekStart)
    .sort((a, b) => (b.paidOn ?? '').localeCompare(a.paidOn ?? ''));
  const hasSetupBill = unpaidBills.some((bill) => bill.name === SETUP_BILL_NAME);
  const planEndLabel = label(account.planEndDate, { month: 'short', day: 'numeric' });

  const freeCents = freeCashCents(cashParts);
  // A fresh suggestion for the days left this week, as a total for the week.
  const { daysThisWeek, daysLeft } = planDays(today, account.planEndDate);
  const suggestion = midweekSuggestion({ spentCents: summary.spentCents, freeCents, daysThisWeek, daysLeft });
  const lastChange = account.allowanceChanges.at(-1);
  const overFreeCash = remainingOverFreeCash({ remainingCents: summary.remainingCents, freeCents });
  const canStartPlan = canStartNewPlan(account.planEndDate, today);

  // The form closes and the confirmation shows only after a confirmed save. A
  // failure goes back to the form, which keeps what was typed.
  async function handleSave(purchase: Purchase): Promise<SaveResult> {
    const isEdit = dialog?.mode === 'edit';
    const result = await (isEdit ? onUpdatePurchase(purchase) : onAddPurchase(purchase));
    if (result.ok) {
      setLastAction({ kind: 'purchase', verb: isEdit ? 'Updated' : 'Saved', purchase });
      setDialog(null);
    }
    return result;
  }

  async function handleDelete(id: string): Promise<SaveResult> {
    const deleted = account.purchases.find((purchase) => purchase.id === id);
    const result = await onDeletePurchase(id);
    if (result.ok) {
      if (deleted) setLastAction({ kind: 'purchase', verb: 'Deleted', purchase: deleted });
      setDialog(null);
    }
    return result;
  }

  async function handleIncomeSave(income: IncomeReceipt): Promise<SaveResult> {
    const isEdit = dialog?.mode === 'editIncome';
    const result = await (isEdit ? onUpdateIncome(income) : onAddIncome(income));
    if (result.ok) {
      setLastAction({ kind: 'income', verb: isEdit ? 'Updated' : 'Recorded', income });
      setDialog(null);
    }
    return result;
  }

  async function handleIncomeDelete(income: IncomeReceipt): Promise<SaveResult> {
    const result = await onDeleteIncome(income.id);
    if (result.ok) {
      setLastAction({ kind: 'income', verb: 'Deleted', income });
      setDialog(null);
    }
    return result;
  }

  async function handleCorrectionSave(correction: BalanceCorrection): Promise<SaveResult> {
    const result = await onAddCorrection(correction);
    if (result.ok) {
      setLastAction({ kind: 'correction', verb: 'Saved', correction, cashAfterCents: currentCashCents + correction.differenceCents });
      setDialog(null);
    }
    return result;
  }

  async function handleCorrectionUndo(correction: BalanceCorrection): Promise<SaveResult> {
    const result = await onDeleteCorrection(correction.id);
    if (result.ok) {
      setLastAction({ kind: 'correction', verb: 'Undid', correction, cashAfterCents: currentCashCents - correction.differenceCents });
      setDialog(null);
    }
    return result;
  }

  async function handleBillSave(bill: Bill): Promise<SaveResult> {
    const isEdit = dialog?.mode === 'editBill';
    const result = await (isEdit ? onUpdateBill(bill) : onAddBill(bill));
    if (result.ok) {
      setLastAction({ kind: 'bill', verb: isEdit ? 'Updated' : 'Added', bill });
      setDialog(null);
    }
    return result;
  }

  async function handleBillDelete(bill: Bill): Promise<SaveResult> {
    const result = await onDeleteBill(bill.id);
    if (result.ok) {
      setLastAction({ kind: 'bill', verb: 'Deleted', bill });
      setDialog(null);
    }
    return result;
  }

  async function handleBillPay(bill: Bill, payment: BillPayment, restId?: string): Promise<SaveResult> {
    const result = await (restId ? onPayBillKeepRest(bill.id, payment, restId) : onPayBill(bill.id, payment));
    if (result.ok) {
      setLastAction({
        kind: 'billPaid',
        verb: bill.paidOn ? 'Updated' : 'Paid',
        name: bill.name,
        cents: payment.paidCents,
        ...(restId && { restCents: bill.cents - payment.paidCents }),
      });
      setDialog(null);
    }
    return result;
  }

  async function handleBillUndo(bill: Bill): Promise<SaveResult> {
    const result = await onUndoBillPayment(bill.id);
    if (result.ok) {
      setLastAction({ kind: 'billUnpaid', name: bill.name, cents: bill.paidCents ?? 0 });
      setDialog(null);
    }
    return result;
  }

  async function handleNewPlan(endDate: IsoDate): Promise<SaveResult> {
    const result = await onStartNewPlan(endDate);
    if (result.ok) {
      setLastAction({ kind: 'newPlan', endLabel: label(endDate, { month: 'short', day: 'numeric' }) });
      setDialog(null);
    }
    return result;
  }

  async function handleAllowanceSave(change: AllowanceChange): Promise<SaveResult> {
    const result = await onChangeAllowance(change);
    if (result.ok) {
      setLastAction({ kind: 'allowance', change });
      setDialog(null);
    }
    return result;
  }

  async function handleRelease(release: SavingsRelease): Promise<SaveResult> {
    const result = await onReleaseSavings(release);
    if (result.ok) {
      setLastAction({ kind: 'release', release });
      setDialog(null);
    }
    return result;
  }

  function handleCurrencyChange(next: Currency) {
    setLastAction(null);
    onCurrencyChange(next);
  }

  function handleNextDay() {
    // The confirmation line is about the day just left behind.
    setLastAction(null);
    onNextDay?.();
  }

  const cashAllocation = allocateCash({ ...cashParts, weekRemainingCents: summary.remainingCents });

  const breakdown = (
    <CalculationBreakdown
      currency={currency}
      {...cashParts}
      weekStartCashCents={account.weekStartCashCents}
      incomeThisWeekCents={sumIncome(account.income)}
      billPaymentsThisWeekCents={account.billPaymentsThisWeekCents}
      correctionsThisWeekCents={sumCorrections(account.corrections)}
      freeCashCents={freeCents}
      planEndLabel={planEndLabel}
      recommendedAllowanceCents={account.recommendedAllowanceCents}
      chosenAllowanceCents={account.chosenAllowanceCents}
      spentCents={summary.spentCents}
      remainingCents={summary.remainingCents}
      lastChange={
        lastChange && {
          fromCents: lastChange.fromCents,
          madeOnLabel: label(lastChange.madeOn, { weekday: 'short', month: 'short', day: 'numeric' }),
        }
      }
      onAdjust={() => setDialog({ mode: 'allowance' })}
      onRelease={() => setDialog({ mode: 'release' })}
      onCorrect={() => setDialog({ mode: 'correct' })}
    />
  );

  return (
    <div className={`${styles.page} ${cashExpanded ? styles.receded : ''}`}>
      {onNextDay && (
        <div className={styles.demoBanner}>
          <p className={styles.demoText}>
            <strong>Demo data.</strong> These numbers are fictional. Purchases you add are kept only
            until you close or reload this tab.
          </p>
          {/* Lets the demo reach the end of a week, where closure happens. */}
          <div className={styles.demoDate}>
            <span>
              Demo date: <time dateTime={today}>{label(today, { weekday: 'short', month: 'short', day: 'numeric' })}</time>
            </span>
            <button type="button" className={styles.nextDay} onClick={handleNextDay}>
              Next day
            </button>
          </div>
        </div>
      )}

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
        <div className={styles.dates}>
          <p className={styles.weekDates}>
            <time dateTime={weekStart}>{label(weekStart, { weekday: 'short', month: 'short', day: 'numeric' })}</time>
            {' to '}
            <time dateTime={weekEnd}>{label(weekEnd, { weekday: 'short', month: 'short', day: 'numeric' })}</time>
          </p>
          {/* The week above always runs Monday to Sunday; the plan can end on any day. */}
          <p className={styles.weekDates}>
            {today > account.planEndDate ? 'Plan ended ' : 'Plan runs until '}
            <time dateTime={account.planEndDate}>{planEndLabel}</time>
          </p>
        </div>
        <AppearanceMenu />
      </header>

      <main className={styles.layout}>
        {/* Keeps the reading order on every width: status and action, summaries, charts, details. */}
        <TiltPanel className={`${styles.panel} ${styles.hero} ${styles.edgeLit}`} aria-labelledby="remaining-heading">
          <div className={styles.amountWrap}>
            <h1 id="remaining-heading" className={styles.eyebrow}>
              {overspent ? 'Overspent this week' : 'Weekly remaining'}
            </h1>
            <p className={`${styles.remaining} ${overspent ? styles.overspent : ''}`}>
              <Money cents={Math.abs(summary.remainingCents)} currency={currency} />
            </p>
          </div>
          <div className={styles.heroRow}>
            <p className={styles.subline}>
              of <Money cents={account.chosenAllowanceCents} currency={currency} /> allowance ·{' '}
              <Money cents={summary.spentCents} currency={currency} /> spent
            </p>
            <div className={styles.actionBar}>
              <button type="button" className={styles.addButton} onClick={() => setDialog({ mode: 'add' })}>
                + Add spending
              </button>
            </div>
          </div>
          {/* Stays until it is no longer true, unlike the confirmation line below. */}
          {overFreeCash && (
            <div className={styles.overFreeCash} role="status">
              <p className={styles.overFreeCashText}>
                {overFreeCash.availableCents > 0 ? (
                  <>
                    Only <Money cents={overFreeCash.availableCents} currency={currency} /> of this is available.
                  </>
                ) : (
                  'None of this is available.'
                )}{' '}
                Your weekly remaining is <Money cents={overFreeCash.overCents} currency={currency} /> more than your free
                cash.
              </p>
              <button type="button" className={styles.addIncome} onClick={() => setDialog({ mode: 'allowance' })}>
                Adjust allowance
              </button>
            </div>
          )}
          {account.chosenAllowanceCents !== account.recommendedAllowanceCents && (
            <p className={styles.note}>
              You chose <Money cents={account.chosenAllowanceCents} currency={currency} />; the
              suggestion was <Money cents={account.recommendedAllowanceCents} currency={currency} />.
            </p>
          )}
          {/* role="status" makes screen readers announce the change without moving focus. */}
          <p className={styles.savedStatus} role="status">
            {lastAction?.kind === 'purchase' && (
              <>
                {lastAction.verb} <Money cents={lastAction.purchase.cents} currency={currency} /> ·{' '}
                {purchaseTitle(lastAction.purchase)}
              </>
            )}
            {lastAction?.kind === 'income' && (
              <>
                {lastAction.verb} <Money cents={lastAction.income.cents} currency={currency} /> of income. Your
                allowance has not changed; adjust it if you want to.
              </>
            )}
            {lastAction?.kind === 'correction' && (
              <>
                {lastAction.verb === 'Saved' ? 'Saved the balance correction' : 'Undid the balance correction'}. Cash is now{' '}
                <Money cents={lastAction.cashAfterCents} currency={currency} />. Your allowance has not changed; adjust it if you
                want to.
              </>
            )}
            {lastAction?.kind === 'bill' && (
              <>
                {lastAction.verb} bill: {lastAction.bill.name}, <Money cents={lastAction.bill.cents} currency={currency} />.
                Your allowance has not changed; adjust it if you want to.
              </>
            )}
            {lastAction?.kind === 'billPaid' && (
              <>
                {lastAction.verb === 'Paid' ? 'Paid' : 'Updated the payment for'} {lastAction.name},{' '}
                <Money cents={lastAction.cents} currency={currency} />.{' '}
                {lastAction.restCents !== undefined && (
                  <>
                    <Money cents={lastAction.restCents} currency={currency} /> is still in your unpaid bills.{' '}
                  </>
                )}
                Bill payments are not spending, so your weekly remaining has not changed.
              </>
            )}
            {lastAction?.kind === 'billUnpaid' && (
              <>
                Undid the payment for {lastAction.name}. <Money cents={lastAction.cents} currency={currency} /> is back
                in cash and the bill is unpaid again.
              </>
            )}
            {lastAction?.kind === 'newPlan' && (
              <>New plan saved, running until {lastAction.endLabel}. Your allowance has not changed; adjust it if you want to.</>
            )}
            {lastAction?.kind === 'allowance' && (
              <>
                Allowance changed from <Money cents={lastAction.change.fromCents} currency={currency} /> to{' '}
                <Money cents={lastAction.change.toCents} currency={currency} />
              </>
            )}
            {lastAction?.kind === 'release' && (
              <>
                Released <Money cents={lastAction.release.cents} currency={currency} /> from protected savings. Adjust
                the allowance to spend it.
              </>
            )}
          </p>
        </TiltPanel>

        <div className={styles.summaries}>
          <SummaryCard
            className={styles.panel}
            enterOrder={1}
            label="Current cash"
            cents={currentCashCents}
            currency={currency}
            hint={
              <>
                <Money cents={freeCents} currency={currency} /> free after savings and bills
              </>
            }
          />
          <SummaryCard
            className={styles.panel}
            enterOrder={2}
            label="Protected savings"
            cents={account.protectedCents}
            currency={currency}
            tone="protected"
            hint="Set aside, still in your account"
          />
          <SummaryCard
            className={styles.panel}
            enterOrder={3}
            label="Unpaid bills"
            cents={account.commitmentsCents}
            currency={currency}
            hint={`Due by ${planEndLabel}`}
          />
        </div>

        {(account.previousClosure || canStartPlan) && (
          <div className={styles.notices}>
        {account.previousClosure && (
          <TiltPanel as="div">
            <ClosureSummary
              currency={currency}
              closure={account.previousClosure}
              weekLabel={label(account.previousClosure.weekStart, { month: 'short', day: 'numeric' })}
              protectedNowCents={account.protectedCents}
              onAdjust={() => setDialog({ mode: 'allowance' })}
            />
          </TiltPanel>
        )}
        {canStartPlan && (
          <div className={styles.planEnding} role="group" aria-labelledby="plan-ending-text">
            <p id="plan-ending-text" className={styles.planEndingText}>
              {today === account.planEndDate ? 'Your plan ends today.' : `Your plan ended on ${planEndLabel}.`}
            </p>
            {today > account.planEndDate && (
              <p className={styles.planEndingHint}>If you were expecting money, record it once it arrives. If it is late, choose the next date you expect it.</p>
            )}
            <button type="button" className={styles.addIncome} onClick={() => setDialog({ mode: 'newPlan' })}>
              Start a new plan
            </button>
          </div>
        )}
          </div>
        )}

        <TiltPanel
          className={`${styles.panel} ${styles.chartPanel} ${styles.edgeLit}`}
          enterOrder={4}
          aria-labelledby="trace-heading"
        >
            <h2 id="trace-heading" className={styles.sectionTitle}>
              Spending this week
            </h2>
            <SpendingTrace
              // A new week starts with no day selected.
              key={weekStart}
              currency={currency}
              weekStart={weekStart}
              purchases={account.purchases}
              dayTitles={dayTitles}
              cumulativeCents={summary.cumulativeCents}
              evenPaceCents={summary.evenPaceCents}
              todayIndex={todayIndex}
              dayLabels={dayLabels}
            />
        </TiltPanel>

        <CashPanel
          layoutId={CASH_PANEL_ID}
          expanded={cashExpanded}
          className={`${styles.panel} ${styles.cashPanel}`}
          enterOrder={5}
          headingId="cash-heading"
          currency={currency}
          allocation={cashAllocation}
          onOpen={() => setCashExpanded(true)}
        />

        <div className={styles.column}>
          <TiltPanel className={styles.panel} enterOrder={6} aria-labelledby="flow-heading">
            <h2 id="flow-heading" className={styles.sectionTitle}>
              Where this week’s allowance went
            </h2>
            <MoneyFlow
              currency={currency}
              flow={moneyFlow(account.chosenAllowanceCents, account.purchases)}
              pulse={
                lastAction?.kind === 'purchase' && lastAction.verb === 'Saved'
                  ? { key: lastAction.purchase.category ?? 'none', id: lastAction.purchase.id }
                  : undefined
              }
            />
          </TiltPanel>

          <TiltPanel className={styles.panel} enterOrder={8} aria-labelledby="income-heading">
            <h2 id="income-heading" className={styles.sectionTitle}>
              Income this week
            </h2>
            {incomeNewestFirst.length === 0 ? (
              <p className={styles.empty}>No income recorded this week.</p>
            ) : (
              <ul className={styles.activity}>
                {incomeNewestFirst.map((income) => (
                  <li key={income.id}>
                    <button
                      type="button"
                      className={styles.activityRow}
                      onClick={() => setDialog({ mode: 'editIncome', income })}
                    >
                      <time className={styles.activityDay} dateTime={income.date}>
                        {label(income.date, { weekday: 'short' })}
                      </time>
                      <span className={styles.merchant}>{income.source || 'Income'}</span>
                      <span className={styles.amount}>
                        <Money cents={income.cents} currency={currency} />
                      </span>
                      <span className={styles.editHint} aria-hidden="true">
                        Edit
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className={styles.addIncome} onClick={() => setDialog({ mode: 'addIncome' })}>
              + Add income
            </button>
          </TiltPanel>
        </div>

        <div className={styles.column}>
          <TiltPanel className={styles.panel} enterOrder={7} aria-labelledby="activity-heading">
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
          </TiltPanel>

          {account.corrections.length > 0 && (
            <TiltPanel className={styles.panel} aria-labelledby="corrections-heading">
              <h2 id="corrections-heading" className={styles.sectionTitle}>
                Balance corrections this week
              </h2>
              <ul className={styles.activity}>
                {account.corrections.map((correction) => (
                  <li key={correction.id}>
                    <button
                      type="button"
                      className={styles.activityRow}
                      onClick={() => setDialog({ mode: 'undoCorrection', correction })}
                    >
                      <time className={styles.activityDay} dateTime={correction.date}>
                        {label(correction.date, { weekday: 'short' })}
                      </time>
                      <span className={styles.merchant}>
                        {correction.differenceCents < 0 ? 'Cash lowered' : 'Cash raised'}
                        {correction.note && <span className={styles.purchaseNote}>{correction.note}</span>}
                      </span>
                      <span className={styles.amount}>
                        <Money cents={Math.abs(correction.differenceCents)} currency={currency} />
                      </span>
                      <span className={styles.editHint} aria-hidden="true">
                        Undo
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </TiltPanel>
          )}

        </div>

        <div className={styles.column}>
          <TiltPanel
            className={`${styles.panel} ${styles.billsPanel}`}
            enterOrder={9}
            aria-labelledby="bills-heading"
          >
            <h2 id="bills-heading" className={styles.sectionTitle}>
              Bills
            </h2>
            {hasSetupBill && (
              <p className={styles.billPrompt}>
                “{SETUP_BILL_NAME}” is the total you entered at setup, with your plan’s end as a placeholder date. Split
                it into your real bills: lower it, or delete it, and add each one with its own due date.
              </p>
            )}
            {unpaidBills.length === 0 ? (
              <p className={styles.empty}>No unpaid bills.</p>
            ) : (
              <>
                <ul className={styles.activity}>
                  {unpaidBills.map((bill) => (
                    <li key={bill.id} className={styles.billItem}>
                      <button
                        type="button"
                        className={`${styles.activityRow} ${styles.billRow}`}
                        onClick={() => setDialog({ mode: 'editBill', bill })}
                      >
                        <time className={styles.activityDay} dateTime={bill.dueOn}>
                          {label(bill.dueOn, { month: 'short', day: 'numeric' })}
                        </time>
                        <span className={styles.merchant}>
                          {bill.name}
                          {bill.dueOn < today && <span className={styles.overdue}>Overdue</span>}
                          {bill.dueOn > account.planEndDate && (
                            <span className={styles.purchaseTags}>Due after your plan ends, so not counted yet</span>
                          )}
                        </span>
                        <span className={styles.amount}>
                          <Money cents={bill.cents} currency={currency} />
                        </span>
                        <span className={styles.editHint} aria-hidden="true">
                          Edit
                        </span>
                      </button>
                      <button
                        type="button"
                        className={styles.payButton}
                        aria-label={`Pay ${bill.name}`}
                        onClick={() => setDialog({ mode: 'payBill', bill })}
                      >
                        Pay
                      </button>
                    </li>
                  ))}
                </ul>
                <p className={styles.billTotal}>
                  <span>Unpaid bills due by {planEndLabel}</span>
                  <span className={styles.amount}>
                    <Money cents={account.commitmentsCents} currency={currency} />
                  </span>
                </p>
              </>
            )}
            <button type="button" className={styles.addIncome} onClick={() => setDialog({ mode: 'addBill' })}>
              + Add bill
            </button>
            {paidThisWeek.length > 0 && (
              <>
                <h3 className={styles.subTitle}>Paid this week</h3>
                <ul className={styles.activity}>
                  {paidThisWeek.map((bill) => (
                    <li key={bill.id}>
                      <button
                        type="button"
                        className={`${styles.activityRow} ${styles.billRow}`}
                        onClick={() => setDialog({ mode: 'payBill', bill })}
                      >
                        <time className={styles.activityDay} dateTime={bill.paidOn}>
                          {label(bill.paidOn ?? weekStart, { month: 'short', day: 'numeric' })}
                        </time>
                        <span className={styles.merchant}>{bill.name}</span>
                        <span className={styles.amount}>
                          <Money cents={bill.paidCents ?? 0} currency={currency} />
                        </span>
                        <span className={styles.editHint} aria-hidden="true">
                          Edit
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </TiltPanel>
        </div>

        <TiltPanel
          className={`${styles.panel} ${styles.calcPanel}`}
          enterOrder={10}
          aria-labelledby="calc-heading"
        >
          <h2 id="calc-heading" className={styles.sectionTitle}>
            How this is calculated <span className={styles.currencyTag}>{currency}</span>
          </h2>
          {breakdown}
        </TiltPanel>
      </main>

      <footer className={styles.footer}>{accountControls}</footer>

      {/* AnimatePresence keeps the view on screen while it shrinks back to its panel. */}
      <AnimatePresence>
        {cashExpanded && (
          <ExpandedCashView
            key={CASH_PANEL_ID}
            layoutId={CASH_PANEL_ID}
            currency={currency}
            allocation={cashAllocation}
            purchases={account.purchases}
            onClose={() => setCashExpanded(false)}
          />
        )}
      </AnimatePresence>

      {/* Mounted only while open, so every opening starts fresh: an empty form
          and a new id when adding, the purchase's own values and id when editing. */}
      {dialog?.mode === 'allowance' && (
        <AdjustAllowanceDialog
          currency={currency}
          today={today}
          currentAllowanceCents={account.chosenAllowanceCents}
          spentCents={summary.spentCents}
          freeCents={freeCents}
          suggestion={suggestion}
          laterDays={daysLeft - daysThisWeek}
          onSave={handleAllowanceSave}
          onClose={() => setDialog(null)}
          onReleaseSavings={account.protectedCents > 0 ? () => setDialog({ mode: 'release' }) : undefined}
        />
      )}
      {dialog?.mode === 'release' && (
        <ReleaseSavingsDialog
          currency={currency}
          today={today}
          protectedCents={account.protectedCents}
          freeCents={freeCents}
          currentCashCents={currentCashCents}
          onSave={handleRelease}
          onClose={() => setDialog(null)}
        />
      )}
      {(dialog?.mode === 'addIncome' || dialog?.mode === 'editIncome') && (
        <IncomeDialog
          key={dialog.mode === 'editIncome' ? dialog.income.id : 'add'}
          currency={currency}
          dates={entryDates}
          existing={dialog.mode === 'editIncome' ? dialog.income : undefined}
          restored={dialog.restored}
          defaultSplit={account.split ?? SUGGESTED_SPLIT}
          currentCashCents={currentCashCents}
          protectedCents={account.protectedCents}
          freeCents={freeCents}
          spentCents={summary.spentCents}
          allowanceCents={account.chosenAllowanceCents}
          daysThisWeek={daysThisWeek}
          daysLeft={daysLeft}
          onSave={handleIncomeSave}
          onDelete={handleIncomeDelete}
          onClose={() => setDialog(null)}
        />
      )}
      {(dialog?.mode === 'addBill' || dialog?.mode === 'editBill') && (
        <BillDialog
          key={dialog.mode === 'editBill' ? dialog.bill.id : 'add'}
          currency={currency}
          existing={dialog.mode === 'editBill' ? dialog.bill : undefined}
          restored={dialog.restored}
          planEndDate={account.planEndDate}
          planEndLabel={planEndLabel}
          commitmentsCents={account.commitmentsCents}
          freeCents={freeCents}
          spentCents={summary.spentCents}
          allowanceCents={account.chosenAllowanceCents}
          daysThisWeek={daysThisWeek}
          daysLeft={daysLeft}
          onSave={handleBillSave}
          onDelete={handleBillDelete}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.mode === 'payBill' && (
        <PayBillDialog
          key={dialog.bill.id}
          currency={currency}
          bill={dialog.bill}
          dates={entryDates}
          planEndDate={account.planEndDate}
          planEndLabel={planEndLabel}
          currentCashCents={currentCashCents}
          commitmentsCents={account.commitmentsCents}
          freeCents={freeCents}
          remainingCents={summary.remainingCents}
          onPay={handleBillPay}
          onUndo={handleBillUndo}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.mode === 'correct' && (
        <CorrectBalanceDialog
          currency={currency}
          today={today}
          currentCashCents={currentCashCents}
          freeCents={freeCents}
          spentCents={summary.spentCents}
          remainingCents={summary.remainingCents}
          allowanceCents={account.chosenAllowanceCents}
          daysThisWeek={daysThisWeek}
          daysLeft={daysLeft}
          onSave={handleCorrectionSave}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.mode === 'undoCorrection' && (
        <UndoCorrectionDialog
          key={dialog.correction.id}
          currency={currency}
          correction={dialog.correction}
          dateLabel={label(dialog.correction.date, { weekday: 'short', month: 'short', day: 'numeric' })}
          currentCashCents={currentCashCents}
          onUndo={handleCorrectionUndo}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.mode === 'newPlan' && (
        <NewPlanDialog
          currency={currency}
          today={today}
          currentCashCents={currentCashCents}
          protectedCents={account.protectedCents}
          bills={account.bills}
          spentCents={summary.spentCents}
          currentAllowanceCents={account.chosenAllowanceCents}
          onStart={(endDate) => handleNewPlan(endDate)}
          onClose={() => setDialog(null)}
        />
      )}
      {(dialog?.mode === 'add' || dialog?.mode === 'edit') && (
        <PurchaseDialog
          // A different key per purchase makes React start a fresh form when
          // switching straight from one purchase to another.
          key={dialog.mode === 'edit' ? dialog.purchase.id : 'add'}
          currency={currency}
          dates={entryDates}
          existing={dialog.mode === 'edit' ? dialog.purchase : undefined}
          restored={dialog.restored}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
