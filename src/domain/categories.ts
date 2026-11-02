// The fixed beta category list and the optional Need/Want tag.

export const CATEGORIES = [
  { id: 'food', label: 'Food' },
  { id: 'transport', label: 'Transport' },
  { id: 'school', label: 'School' },
  { id: 'personalCare', label: 'Personal care' },
  { id: 'phoneBills', label: 'Phone & bills' },
  { id: 'fun', label: 'Fun' },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]['id'];
export type NeedOrWant = 'need' | 'want';

export function categoryLabel(id: CategoryId): string {
  return CATEGORIES.find((category) => category.id === id)?.label ?? id;
}

/**
 * The heading for a purchase in lists. Where is optional at entry, so fall back
 * to the category, then to a plain word, instead of storing invented text.
 */
export function purchaseTitle(purchase: { merchant: string; category?: CategoryId }): string {
  const merchant = purchase.merchant.trim();
  if (merchant !== '') return merchant;
  return purchase.category ? categoryLabel(purchase.category) : 'Purchase';
}
