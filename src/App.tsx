import { useReducer, useState } from 'react';
import { ledgerReducer, weekAccount } from './domain/ledger';
import type { Currency } from './domain/money';
import { WeekView } from './features/week/WeekView';
import { demoLedger } from './fixtures/demoWeek';
import { MotionProvider } from './ui/MotionProvider';

// Everything the app remembers lives in one ledger, changed only by
// ledgerReducer (a pure function in the domain folder). Each button sends an
// action describing what happened; React hands it to the reducer with the
// latest state, so related changes (closing a week and starting the next)
// arrive together. Kept in memory only (fictional demo data); a reload starts
// again from the fixtures.
export default function App() {
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
      />
    </MotionProvider>
  );
}
