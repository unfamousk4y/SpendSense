import { useReducer, useState, type ReactNode } from 'react';
import { AccountControls } from './auth/AccountControls';
import { SignInScreen } from './auth/SignInScreen';
import { useAuth } from './auth/useAuth';
import { ledgerReducer, weekAccount } from './domain/ledger';
import type { Currency } from './domain/money';
import { WeekView } from './features/week/WeekView';
import { demoLedger } from './fixtures/demoWeek';
import { MotionProvider } from './ui/MotionProvider';

// Signed out: the sign-in screen. Signed in: the week screen, still on
// fictional demo data until purchases are saved to the database (stage 3).
export default function App() {
  const auth = useAuth();
  // Development only, so the screens can be checked without a Google account.
  const [demoWithoutAccount, setDemoWithoutAccount] = useState(false);

  if (auth.status === 'checking') {
    return <p style={{ padding: 16 }}>Checking sign-in</p>;
  }
  if (auth.status === 'signedIn') {
    return <DemoWeek accountControls={<AccountControls email={auth.session.user.email ?? 'your Google account'} />} />;
  }
  if (demoWithoutAccount) {
    return <DemoWeek />;
  }
  return (
    <SignInScreen
      notConfigured={auth.status === 'notConfigured'}
      onTryDemo={import.meta.env.DEV ? () => setDemoWithoutAccount(true) : undefined}
    />
  );
}

// Everything the week screen remembers lives in one ledger, changed only by
// ledgerReducer (a pure function in the domain folder). Each button sends an
// action describing what happened; React hands it to the reducer with the
// latest state, so related changes (closing a week and starting the next)
// arrive together. Kept in memory only (fictional demo data); a reload starts
// again from the fixtures.
function DemoWeek({ accountControls }: { accountControls?: ReactNode }) {
  const [ledger, dispatch] = useReducer(ledgerReducer, demoLedger);
  // Which account is on screen is a viewing choice, not part of the ledger.
  const [currency, setCurrency] = useState<Currency>('USD');

  const account = weekAccount(ledger, currency);

  return (
    <MotionProvider>
      <WeekView
        account={account}
        today={ledger.today}
        onCurrencyChange={setCurrency}
        onAddPurchase={(purchase) => dispatch({ type: 'addPurchase', currency, purchase })}
        onUpdatePurchase={(purchase) => dispatch({ type: 'updatePurchase', currency, purchase })}
        onDeletePurchase={(id) => dispatch({ type: 'deletePurchase', currency, id })}
        onChangeAllowance={(change) => dispatch({ type: 'changeAllowance', currency, change })}
        onReleaseSavings={(release) => dispatch({ type: 'releaseSavings', currency, release })}
        onNextDay={() => dispatch({ type: 'nextDay' })}
        accountControls={accountControls}
      />
    </MotionProvider>
  );
}
