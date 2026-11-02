import type { Currency } from './domain/money';
import { WeekView } from './features/week/WeekView';
import { DEMO_TODAY, DEMO_WEEK_START, demoAccounts } from './fixtures/demoWeek';

// Temporary: the currency comes from the address (?currency=BSD) so the demo can
// switch accounts without React state. The next step replaces this with state.
function currencyFromAddress(): Currency {
  return new URLSearchParams(window.location.search).get('currency') === 'BSD' ? 'BSD' : 'USD';
}

export default function App() {
  return (
    <WeekView account={demoAccounts[currencyFromAddress()]} weekStart={DEMO_WEEK_START} today={DEMO_TODAY} />
  );
}
