// Keeps a purchase, income or bill that could not be saved because the session
// ended, so it survives the page reload that Google sign-in causes.
//
// sessionStorage belongs to this one browser tab and is emptied when the tab
// closes. A draft is removed as soon as it is read, or as soon as the session
// turns out to be fine, and only the student who wrote it can get it back: a
// shared phone must not show one student's entry to the next.
import type { Bill } from '../domain/bills';
import type { LedgerAction } from '../domain/ledger';
import type { IncomeReceipt } from '../domain/income';
import type { Currency } from '../domain/money';
import type { Purchase } from '../domain/week';

export type FormDraft =
  | { kind: 'purchase'; editing: boolean; entry: Purchase }
  | { kind: 'income'; editing: boolean; entry: IncomeReceipt }
  | { kind: 'bill'; editing: boolean; entry: Bill };

export type RestoredDraft = { currency: Currency; draft: FormDraft };

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const KEY = 'spendsense.formDraft';

/** Reading sessionStorage can itself throw when a browser blocks site data. */
function browserStorage(): DraftStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Only these forms have enough typed in them to be worth keeping. */
function draftFromAction(action: LedgerAction): FormDraft | null {
  switch (action.type) {
    case 'addPurchase':
      return { kind: 'purchase', editing: false, entry: action.purchase };
    case 'updatePurchase':
      return { kind: 'purchase', editing: true, entry: action.purchase };
    case 'addIncome':
      return { kind: 'income', editing: false, entry: action.income };
    case 'updateIncome':
      return { kind: 'income', editing: true, entry: action.income };
    case 'addBill':
      return { kind: 'bill', editing: false, entry: action.bill };
    case 'updateBill':
      return { kind: 'bill', editing: true, entry: action.bill };
    default:
      return null;
  }
}

/** True if it was kept. A browser that refuses storage just means retyping. */
export function keepDraft(action: LedgerAction, userId: string, storage = browserStorage()): boolean {
  const draft = draftFromAction(action);
  if (!draft || !storage || action.type === 'nextDay') return false;
  try {
    storage.setItem(KEY, JSON.stringify({ userId, currency: action.currency, draft }));
    return true;
  } catch {
    return false;
  }
}

export function hasDraft(storage = browserStorage()): boolean {
  try {
    return storage?.getItem(KEY) != null;
  } catch {
    return false;
  }
}

export function clearDraft(storage = browserStorage()): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    // Nothing more can be done; the tab closing empties it anyway.
  }
}

function isDraft(value: unknown): value is FormDraft {
  const draft = value as Partial<FormDraft> | null;
  return (
    !!draft &&
    (draft.kind === 'purchase' || draft.kind === 'income' || draft.kind === 'bill') &&
    typeof draft.editing === 'boolean' &&
    typeof draft.entry?.id === 'string' &&
    Number.isInteger(draft.entry?.cents)
  );
}

/** Reads and removes it, so it comes back once. Another student's draft is thrown away. */
export function takeDraft(userId: string, storage = browserStorage()): RestoredDraft | null {
  if (!storage) return null;
  try {
    const text = storage.getItem(KEY);
    storage.removeItem(KEY);
    if (text === null) return null;
    const stored = JSON.parse(text) as { userId?: unknown; currency?: unknown; draft?: unknown };
    if (stored.userId !== userId) return null;
    if (stored.currency !== 'USD' && stored.currency !== 'BSD') return null;
    if (!isDraft(stored.draft)) return null;
    return { currency: stored.currency, draft: stored.draft };
  } catch {
    return null;
  }
}
