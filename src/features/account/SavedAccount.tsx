import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useReducer, useState, type ReactNode } from 'react';
import {
  createAccount,
  deletePurchaseRow,
  insertPurchase,
  loadLedger,
  updatePurchaseRow,
  type LoadedLedger,
  type SaveResult,
} from '../../data/ledgerStore';
import { localDateIn, type IsoDate } from '../../domain/dates';
import { hasPlanThisWeek, ledgerReducer, weekAccount, type LedgerAction } from '../../domain/ledger';
import type { Currency } from '../../domain/money';
import type { Purchase } from '../../domain/week';
import { MotionProvider } from '../../ui/MotionProvider';
import { SetupScreen } from '../setup/SetupScreen';
import { WeekView } from '../week/WeekView';
import styles from './SavedAccount.module.css';

type SavedAccountProps = { client: SupabaseClient; accountControls: ReactNode };

type LoadState =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; loaded: LoadedLedger };

/** Loads the signed-in student's data, then shows setup or their week. */
export function SavedAccount({ client, accountControls }: SavedAccountProps) {
  // The student's own calendar date, from the time zone their browser reports.
  const [today] = useState(() => localDateIn(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone));
  const [currency, setCurrency] = useState<Currency>('USD');
  // Changing this runs the load again (Try again, or after creating an account).
  const [loadNumber, setLoadNumber] = useState(0);
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    // If the screen goes away first, a late reply must not be applied.
    let ignore = false;
    loadLedger(client, today).then((result) => {
      if (ignore) return;
      if (result.ok) {
        setLoad({ status: 'ready', loaded: result.loaded });
        // Open on an account that exists, unless the chosen one does.
        setCurrency((chosen) =>
          result.loaded.ledger.accounts[chosen] ? chosen : result.loaded.ledger.accounts.BSD ? 'BSD' : chosen,
        );
      } else {
        setLoad({ status: 'failed', message: result.message });
      }
    });
    return () => {
      ignore = true;
    };
  }, [client, today, loadNumber]);

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
      loaded={load.loaded}
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
  today: IsoDate;
  currency: Currency;
  onCurrencyChange: (currency: Currency) => void;
  onAccountCreated: () => void;
};

function SavedWeek({ client, loaded, today, currency, onCurrencyChange, onAccountCreated, accountControls }: SavedWeekProps) {
  const [ledger, dispatch] = useReducer(ledgerReducer, loaded.ledger);
  const account = ledger.accounts[currency];
  const accountId = loaded.accountIds[currency];

  if (!account || !accountId) {
    return (
      <SetupScreen
        // Typed numbers belong to one currency: switching starts a clean form.
        key={currency}
        currency={currency}
        today={today}
        onCurrencyChange={onCurrencyChange}
        onCreate={async (newAccount) => {
          const result = await createAccount(client, newAccount);
          if (result.ok) onAccountCreated();
          return result;
        }}
        accountControls={accountControls}
      />
    );
  }

  if (!hasPlanThisWeek(account, today)) {
    return (
      <div className={styles.message}>
        <h1 className={styles.heading}>Your {currency} plan has ended</h1>
        <p>It ran until {account.planEndDate}. Starting a new plan is not available yet.</p>
        <div className={styles.switch}>
          {(['USD', 'BSD'] as const).map((option) => (
            <button key={option} type="button" className={styles.button} aria-pressed={option === currency} onClick={() => onCurrencyChange(option)}>
              {option}
            </button>
          ))}
        </div>
        {accountControls}
      </div>
    );
  }

  /**
   * Every change: save to the database first, and only when that is confirmed
   * update the screen. A failed save can never look like a saved one.
   */
  async function saveThenApply(save: Promise<SaveResult>, action: LedgerAction): Promise<SaveResult> {
    const result = await save;
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
        accountControls={accountControls}
      />
    </MotionProvider>
  );
}
