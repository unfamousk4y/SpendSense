import { useState } from 'react';
import { currentAllowanceCents, recordAllowanceChange, type AllowanceChange } from './domain/allowanceChange';
import type { Currency } from './domain/money';
import { addPurchaseOnce, removePurchase, updatePurchase, type Purchase } from './domain/week';
import { WeekView } from './features/week/WeekView';
import { DEMO_TODAY, DEMO_WEEK_START, demoAccounts } from './fixtures/demoWeek';
import { MotionProvider } from './ui/MotionProvider';

// State lives here, above everything that reads it: the selected account, each
// account's purchases and its allowance changes. Kept in memory only (fictional
// demo data); a reload starts again from the fixtures.
export default function App() {
  const [currency, setCurrency] = useState<Currency>('USD');
  const [purchasesByCurrency, setPurchasesByCurrency] = useState<Record<Currency, Purchase[]>>({
    USD: demoAccounts.USD.purchases,
    BSD: demoAccounts.BSD.purchases,
  });
  // Every saved allowance change, oldest first. The allowance in force is
  // derived from this list and the start-of-week snapshot, never stored twice.
  const [allowanceChangesByCurrency, setAllowanceChangesByCurrency] = useState<Record<Currency, AllowanceChange[]>>({
    USD: [],
    BSD: [],
  });

  // Every change goes through one pure list function from the domain. The
  // "previous value" form hands us the latest lists, so two changes in quick
  // succession cannot overwrite each other.
  function changePurchases(change: (purchases: Purchase[]) => Purchase[]) {
    setPurchasesByCurrency((previous) => ({ ...previous, [currency]: change(previous[currency]) }));
  }

  function changeAllowance(change: AllowanceChange) {
    setAllowanceChangesByCurrency((previous) => ({
      ...previous,
      [currency]: recordAllowanceChange(previous[currency], change),
    }));
  }

  const allowanceChanges = allowanceChangesByCurrency[currency];
  const account = {
    ...demoAccounts[currency],
    purchases: purchasesByCurrency[currency],
    chosenAllowanceCents: currentAllowanceCents(demoAccounts[currency].chosenAllowanceCents, allowanceChanges),
  };

  return (
    <MotionProvider>
      <WeekView
        account={account}
        allowanceChanges={allowanceChanges}
        weekStart={DEMO_WEEK_START}
        today={DEMO_TODAY}
        onCurrencyChange={setCurrency}
        onAddPurchase={(purchase) => changePurchases((list) => addPurchaseOnce(list, purchase))}
        onUpdatePurchase={(purchase) => changePurchases((list) => updatePurchase(list, purchase))}
        onDeletePurchase={(id) => changePurchases((list) => removePurchase(list, id))}
        onChangeAllowance={changeAllowance}
      />
    </MotionProvider>
  );
}
