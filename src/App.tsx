import { useReducer, useState } from 'react';
import { AccountControls } from './auth/AccountControls';
import { supabase } from './data/supabaseClient';
import { SavedAccount } from './features/account/SavedAccount';
import { SignInScreen } from './auth/SignInScreen';
import { useAuth } from './auth/useAuth';
import { hasPlanThisWeek, ledgerReducer, weekAccount, type LedgerAction } from './domain/ledger';
import { mondayOf } from './domain/dates';
import type { Currency } from './domain/money';
import { PlanEndedScreen } from './features/week/PlanEndedScreen';
import { WeekView } from './features/week/WeekView';
import { demoLedger } from './fixtures/demoWeek';
import { MotionProvider } from './ui/MotionProvider';

// Signed out: the sign-in screen. Signed in: that student's saved account.
export default function App() {
  const auth = useAuth();
  // Development only, so the screens can be checked without a Google account.
  const [demoWithoutAccount, setDemoWithoutAccount] = useState(false);

  if (auth.status === 'checking') {
    return <p style={{ padding: 16 }}>Checking sign-in</p>;
  }
  if (auth.status === 'signedIn' && supabase) {
    return (
      <SavedAccount
        // A different student must never see the previous student's state.
        key={auth.session.user.id}
        client={supabase}
        userId={auth.session.user.id}
        accountControls={<AccountControls client={supabase} email={auth.session.user.email ?? 'your Google account'} />}
      />
    );
  }
  if (demoWithoutAccount) {
    return <DemoWeek />;
  }
  return (
    <SignInScreen
      notConfigured={auth.status === 'notConfigured'}
      sessionLost={auth.status === 'signedOut' && auth.sessionLost}
      onTryDemo={import.meta.env.DEV ? () => setDemoWithoutAccount(true) : undefined}
    />
  );
}

// The fictional demo, for development only. Everything it remembers lives in one ledger, changed only by
// ledgerReducer (a pure function in the domain folder). Each button sends an
// action describing what happened; React hands it to the reducer with the
// latest state, so related changes (closing a week and starting the next)
// arrive together. Kept in memory only (fictional demo data); a reload starts
// again from the fixtures.
function DemoWeek() {
  const [ledger, dispatch] = useReducer(ledgerReducer, demoLedger);
  // Which account is on screen is a viewing choice, not part of the ledger.
  const [currency, setCurrency] = useState<Currency>('USD');

  // Nothing to wait for: the demo is held in memory.
  function applied(action: LedgerAction) {
    dispatch(action);
    return Promise.resolve({ ok: true } as const);
  }

  const ledgerAccount = ledger.accounts[currency];
  if (ledgerAccount && !hasPlanThisWeek(ledgerAccount, ledger.today)) {
    return (
      <PlanEndedScreen
        account={ledgerAccount}
        today={ledger.today}
        onCurrencyChange={setCurrency}
        onStart={(endDate, week) =>
          applied({
            type: 'startNewPlan',
            currency,
            endDate,
            week: week && {
              weekStart: mondayOf(ledger.today),
              recommendedCents: week.recommendedCents,
              startingAllowanceCents: week.allowanceCents,
              wantsGuideCents: week.wantsGuideCents ?? 0,
              changes: [],
            },
          })
        }
      />
    );
  }

  const account = weekAccount(ledger, currency);

  return (
    <MotionProvider>
      <WeekView
        account={account}
        today={ledger.today}
        onCurrencyChange={setCurrency}
        onAddPurchase={(purchase) => applied({ type: 'addPurchase', currency, purchase })}
        onUpdatePurchase={(purchase) => applied({ type: 'updatePurchase', currency, purchase })}
        onDeletePurchase={(id) => applied({ type: 'deletePurchase', currency, id })}
        onAddIncome={(income) => applied({ type: 'addIncome', currency, income })}
        onUpdateIncome={(income) => applied({ type: 'updateIncome', currency, income })}
        onDeleteIncome={(id) => applied({ type: 'deleteIncome', currency, id })}
        onAddCorrection={(correction) => applied({ type: 'addCorrection', currency, correction })}
        onDeleteCorrection={(id) => applied({ type: 'deleteCorrection', currency, id })}
        onAddBill={(bill) => applied({ type: 'addBill', currency, bill })}
        onUpdateBill={(bill) => applied({ type: 'updateBill', currency, bill })}
        onDeleteBill={(id) => applied({ type: 'deleteBill', currency, id })}
        onPayBill={(id, payment) => applied({ type: 'payBill', currency, id, payment })}
        onPayBillKeepRest={(id, payment, restId) => applied({ type: 'payBillKeepRest', currency, id, payment, restId })}
        onUndoBillPayment={(id) => applied({ type: 'undoBillPayment', currency, id })}
        onStartNewPlan={(endDate) => applied({ type: 'startNewPlan', currency, endDate })}
        onChangeAllowance={(change) => applied({ type: 'changeAllowance', currency, change })}
        onReleaseSavings={(release) => applied({ type: 'releaseSavings', currency, release })}
        onNextDay={() => dispatch({ type: 'nextDay' })}
      />
    </MotionProvider>
  );
}
