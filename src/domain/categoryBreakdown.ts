// This week's spending grouped by category (the "folders" of the expanded
// view), plus how much was tagged Need, Want, or neither. Pure and exact:
// every total is a sum of integer cents from the same purchase list.
import { CATEGORIES, type CategoryId } from './categories';
import type { Purchase } from './week';

export type CategoryGroup = {
  /** null collects purchases saved without a category. */
  category: CategoryId | null;
  label: string;
  cents: number;
  purchases: Purchase[];
};

export type CategoryBreakdown = {
  /** Largest first; equal totals keep the fixed category order; "No category" is always last. */
  groups: CategoryGroup[];
  totalCents: number;
  needCents: number;
  wantCents: number;
  /** Spending marked neither Need nor Want. */
  untaggedCents: number;
};

export function spendingByCategory(purchases: Purchase[]): CategoryBreakdown {
  const categorized: CategoryGroup[] = CATEGORIES.map((option) => {
    const inCategory = purchases.filter((purchase) => purchase.category === option.id);
    return { category: option.id, label: option.label, cents: sum(inCategory), purchases: inCategory };
  })
    .filter((group) => group.purchases.length > 0)
    // sort keeps the fixed CATEGORIES order for equal totals.
    .sort((a, b) => b.cents - a.cents);

  const uncategorized = purchases.filter((purchase) => purchase.category === undefined);
  const groups =
    uncategorized.length > 0
      ? [...categorized, { category: null, label: 'No category', cents: sum(uncategorized), purchases: uncategorized }]
      : categorized;

  return {
    groups,
    totalCents: sum(purchases),
    needCents: sum(purchases.filter((purchase) => purchase.needOrWant === 'need')),
    wantCents: sum(purchases.filter((purchase) => purchase.needOrWant === 'want')),
    untaggedCents: sum(purchases.filter((purchase) => purchase.needOrWant === undefined)),
  };
}

function sum(purchases: Purchase[]): number {
  return purchases.reduce((total, purchase) => total + purchase.cents, 0);
}
