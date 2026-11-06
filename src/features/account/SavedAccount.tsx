import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useReducer, useState, type ReactNode } from 'react';
import {
  createAccount,
  deleteBillRow,
  deleteCorrectionRow,
  deleteIncomeRow,
  deletePurchaseRow,
  insertBill,
  insertCorrection,
  insertIncome,
  insertPurchase,
  loadLedger,
  payBillKeepRest,
  payBillRow,
  saveAllowanceChange,
  saveRelease,
  SESSION_ENDED,
  startNewPlan,
  undoBillPaymentRow,
  updateBillRow,
  updateIncomeRow,
  updatePurchaseRow,
  type LoadedLedger,
  type SaveResult,
} from '../../data/ledgerStore';
import type { AllowanceChange } from '../../domain/allowanceChange';
import type { Bill, BillPayment } from '../../domain/bills';
import type { BalanceCorrection } from '../../domain/correction';
import { localDateIn, mondayOf, type IsoDate } from '../../domain/dates';
import { accountCash, hasPlanThisWeek, ledgerReducer, weekAccount, type LedgerAction } from '../../domain/ledger';
import { SessionExpiredDialog } from '../../auth/SessionExpiredDialog';
import { clearDraft, keepDraft, takeDraft, type RestoredDraft } from '../../data/formDraft';
import { recoverFromSave } from '../../data/sessionRecovery';
import type { IncomeReceipt } from '../../domain/income';
import type { Currency } from '../../domain/money';
import type { SavingsRelease } from '../../domain/release';
import type { Purchase } from '../../domain/week';
import { MotionProvider } from '../../ui/MotionProvider';
import { SetupScreen } from '../setup/SetupScreen';
import { PlanEndedScreen } from '../week/PlanEndedScreen';
import { WeekView } from '../week/WeekView';
import styles from './SavedAccount.module.css';

type SavedAccountProps = { client: SupabaseClient; userId: string; accountControls: ReactNode };

type LoadState =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; loaded: LoadedLedger };

/** Loads the signed-in student's data, then shows setup or their week. */
export function SavedAccount({ client, userId, accountControls }: SavedAccountProps) {
  // The student's own calendar date, from the time zone their browser reports.
  const [today] = useState(() => localDateIn(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone));
  const [currency, setCurrency] = useState<Currency>('USD');
  // Changing this runs the load again (Try again, or after creating an account).
  const [loadNumber, setLoadNumber] = useState(0);
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  // Whatever the student was saving when their session ended, once it has loaded.
  const [restored, setRestored] = useState<RestoredDraft | null>(null);

  useEffect(() => {
    // If the screen goes away first, a late reply must not be applied.
    let ignore = false;
    loadLedger(client, today).then((result) => {
      if (ignore) return;
      if (result.ok) {
        setLoad({ status: 'ready', loaded: result.loaded });
        // A kept draft is taken here so it opens once. Its account must still exist.
        const taken = takeDraft(userId);
        const draft = taken && result.loaded.ledger.accounts[taken.currency] ? taken : null;
        setRestored(draft);
        // Open on the draft's account, or one that exists, unless the chosen one does.
        setCurrency((chosen) =>
          draft ? draft.currency : result.loaded.ledger.accounts[chosen] ? chosen : result.loaded.ledger.accounts.BSD ? 'BSD' : chosen,
        );
      } else {
        setLoad({ status: 'failed', message: result.message });
      }
    });
    return () => {
      ignore = true;
    };
  }, [client, userId, today, loadNumber]);

  function reload() {
    setLoad({ status: 'loading' });
    setLoadNumber((number) => number + 1);
  }

  if (load.status === 'loading') {
    return <p className={styles.message}>Loading your account</p>;
  }
  if (load.status === 'failed') {
    return (
      <div className={styles.message}>
        <p role="alert">{load.message}</p>
        <button type="button" className={styles.button} onClick={reload}>
          Try again
        </button>
        {accountControls}
      </div>
    );
  }
  return (
    <SavedWeek
      // Fresh reducer state from each load.
      key={loadNumber}
      client={client}
      userId={userId}
      loaded={load.loaded}
      restored={restored}
      today={today}
      currency={currency}
      onCurrencyChange={setCurrency}
      onAccountCreated={reload}
      accountControls={accountControls}
    />
  );
}

type SavedWeekProps = SavedAccountProps & {
  loaded: LoadedLedger;
  restored: RestoredDraft | null;
  today: IsoDate;
  currency: Currency;
  onCurrencyChange: (currency: Currency) => void;
  /** Load everything again, for a change that creates rows the screen needs the ids of. */
  onAccountCreated: () => void;
};

function SavedWeek({ client, userId, loaded, restored, today, currency, onCurrencyChange, onAccountCreated, accountControls }: SavedWeekProps) {
  const [ledger, dispatch] = useReducer(ledgerReducer, loaded.ledger);
  const account = ledger.accounts[currency];
  const accountId = loaded.accountIds[currency];
  const weekPlanId = loaded.weekPlanIds[currency]?.[mondayOf(today)];
  // Hooks stay above the early returns below.
  const [sessionExpired, setSessionExpired] = useState<{ draftKept: boolean } | null>(null);

  /** A refused session is renewed if it can be, and the student is asked to sign in if not. */
  async function checked(save: Promise<SaveResult>, action?: LedgerAction): Promise<SaveResult> {
    const saved = await save;
    // Kept before trying to renew: a failed renewal can sign the student out,
    // which removes this whole screen before anything after it could run.
    const refused = !saved.ok && saved.message === SESSION_ENDED;
    const draftKept = refused && action !== undefined && keepDraft(action, userId);
    const { result, expired } = await recoverFromSave(client, saved);
    if (expired) setSessionExpired({ draftKept });
    else if (draftKept) clearDraft();
    return result;
  }

  const sessionPrompt = sessionExpired && (
    <SessionExpiredDialog
      draftKept={sessionExpired.draftKept}
      onClose={() => {
        // The form is still open behind this, so the next attempt keeps it again.
        clearDraft();
        setSessionExpired(null);
      }}
    />
  );

  if (!account || !accountId) {
    return (
      <>
        <SetupScreen
          // Typed numbers belong to one currency: switching starts a clean form.
          key={currency}
          currency={currency}
          today={today}
          onCurrencyChange={onCurrencyChange}
          onCreate={async (newAccount) => {
            const result = await checked(createAccount(client, newAccount));
            if (result.ok) onAccountCreated();
            return result;
          }}
          accountControls={accountControls}
        />
        {sessionPrompt}
      </>
    );
  }

  if (!hasPlanThisWeek(account, today) || !weekPlanId) {
    return (
      <>
        <PlanEndedScreen
          account={account}
          today={today}
          onCurrencyChange={onCurrencyChange}
          onStart={async (endDate, week) => {
            const result = await checked(startNewPlan(client, accountId, today, endDate, week));
            // Load again: the new week plan's id is needed to change its allowance later.
            if (result.ok) onAccountCreated();
            return result;
          }}
          accountControls={accountControls}
        />
        {sessionPrompt}
      </>
    );
  }

  /**
   * Every change: save to the database first, and only when that is confirmed
   * update the screen. A failed save can never look like a saved one.
   */
  async function saveThenApply(save: Promise<SaveResult>, action: LedgerAction): Promise<SaveResult> {
    const result = await checked(save, action);
    if (result.ok) dispatch(action);
    return result;
  }

  return (
    <MotionProvider>
      <WeekView
        account={weekAccount(ledger, currency)}
        today={today}
        onCurrencyChange={onCurrencyChange}
        onAddPurchase={(purchase: Purchase) =>
          saveThenApply(insertPurchase(client, accountId, purchase), { type: 'addPurchase', currency, purchase })
        }
        onUpdatePurchase={(purchase: Purchase) =>
          saveThenApply(updatePurchaseRow(client, purchase), { type: 'updatePurchase', currency, purchase })
        }
        onDeletePurchase={(id: string) => saveThenApply(deletePurchaseRow(client, id), { type: 'deletePurchase', currency, id })}
        onAddIncome={(income: IncomeReceipt) =>
          saveThenApply(insertIncome(client, accountId, income), { type: 'addIncome', currency, income })
        }
        onUpdateIncome={(income: IncomeReceipt) =>
          saveThenApply(updateIncomeRow(client, income), { type: 'updateIncome', currency, income })
        }
        onDeleteIncome={(id: string) => saveThenApply(deleteIncomeRow(client, id), { type: 'deleteIncome', currency, id })}
        onAddCorrection={(correction: BalanceCorrection) =>
          saveThenApply(insertCorrection(client, accountId, correction, accountCash(account).currentCashCents), { type: 'addCorrection', currency, correction })
        }
        onDeleteCorrection={(id: string) => saveThenApply(deleteCorrectionRow(client, id), { type: 'deleteCorrection', currency, id })}
        onAddBill={(bill: Bill) => saveThenApply(insertBill(client, accountId, bill), { type: 'addBill', currency, bill })}
        onUpdateBill={(bill: Bill) => saveThenApply(updateBillRow(client, bill), { type: 'updateBill', currency, bill })}
        onDeleteBill={(id: string) => saveThenApply(deleteBillRow(client, id), { type: 'deleteBill', currency, id })}
        onPayBill={(id: string, payment: BillPayment) =>
          saveThenApply(payBillRow(client, id, payment), { type: 'payBill', currency, id, payment })
        }
        onPayBillKeepRest={(id: string, payment: BillPayment, restId: string) =>
          saveThenApply(payBillKeepRest(client, id, payment, restId), { type: 'payBillKeepRest', currency, id, payment, restId })
        }
        onUndoBillPayment={(id: string) => saveThenApply(undoBillPaymentRow(client, id), { type: 'undoBillPayment', currency, id })}
        onStartNewPlan={(endDate: IsoDate) =>
          saveThenApply(startNewPlan(client, accountId, today, endDate), { type: 'startNewPlan', currency, endDate })
        }
        onChangeAllowance={(change: AllowanceChange) =>
          saveThenApply(saveAllowanceChange(client, weekPlanId, change), { type: 'changeAllowance', currency, change })
        }
        onReleaseSavings={(release: SavingsRelease) =>
          saveThenApply(saveRelease(client, accountId, release), { type: 'releaseSavings', currency, release })
        }
        restoredDraft={restored?.currency === currency ? restored.draft : undefined}
        accountControls={accountControls}
      />
      {sessionPrompt}
    </MotionProvider>
  );
}
