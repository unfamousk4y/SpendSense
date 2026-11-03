import { useState } from 'react';
import type { Currency } from './domain/money';
import { addPurchaseOnce, removePurchase, updatePurchase, type Purchase } from './domain/week';
import { WeekView } from './features/week/WeekView';
import { DEMO_TODAY, DEMO_WEEK_START, demoAccounts } from './fixtures/demoWeek';
import { MotionProvider } from './ui/MotionProvider';

// State lives here, above everything that reads it: the selected account and
// each account's purchases. Kept in memory only (fictional demo data); a reload
// starts again from the fixtures.
export default function App() {
  const [currency, setCurrency] = useState<Currency>('USD');
  const [purchasesByCurrency, setPurchasesByCurrency] = useState<Record<Currency, Purchase[]>>({
    USD: demoAccounts.USD.purchases,
    BSD: demoAccounts.BSD.purchases,
  });

  // Every change goes through one pure list function from the domain. The
  // "previous value" form hands us the latest lists, so two changes in quick
  // succession cannot overwrite each other.
  function changePurchases(change: (purchases: Purchase[]) => Purchase[]) {
    setPurchasesByCurrency((previous) => ({ ...previous, [currency]: change(previous[currency]) }));
  }

  const account = { ...demoAccounts[currency], purchases: purchasesByCurrency[currency] };

  return (
    <MotionProvider>
      <WeekView
        account={account}
        weekStart={DEMO_WEEK_START}
        today={DEMO_TODAY}
        onCurrencyChange={setCurrency}
        onAddPurchase={(purchase) => changePurchases((list) => addPurchaseOnce(list, purchase))}
        onUpdatePurchase={(purchase) => changePurchases((list) => updatePurchase(list, purchase))}
        onDeletePurchase={(id) => changePurchases((list) => removePurchase(list, id))}
      />
    </MotionProvider>
  );
}
