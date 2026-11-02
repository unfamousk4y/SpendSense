import { useState } from 'react';
import type { Currency } from './domain/money';
import { addPurchaseOnce, type Purchase } from './domain/week';
import { WeekView } from './features/week/WeekView';
import { DEMO_TODAY, DEMO_WEEK_START, demoAccounts } from './fixtures/demoWeek';

// State lives here, above everything that reads it: the selected account and
// each account's purchases. Kept in memory only (fictional demo data); a reload
// starts again from the fixtures.
export default function App() {
  const [currency, setCurrency] = useState<Currency>('USD');
  const [purchasesByCurrency, setPurchasesByCurrency] = useState<Record<Currency, Purchase[]>>({
    USD: demoAccounts.USD.purchases,
    BSD: demoAccounts.BSD.purchases,
  });

  function addPurchase(purchase: Purchase) {
    // The "previous value" form: React hands us the latest lists, so two saves
    // in quick succession cannot overwrite each other.
    setPurchasesByCurrency((previous) => ({
      ...previous,
      [currency]: addPurchaseOnce(previous[currency], purchase),
    }));
  }

  const account = { ...demoAccounts[currency], purchases: purchasesByCurrency[currency] };

  return (
    <WeekView
      account={account}
      weekStart={DEMO_WEEK_START}
      today={DEMO_TODAY}
      onCurrencyChange={setCurrency}
      onAddPurchase={addPurchase}
    />
  );
}
