import { describe, expect, test } from 'vitest';
import type { LedgerAction } from '../domain/ledger';
import { clearDraft, hasDraft, keepDraft, takeDraft } from './formDraft';

function fakeStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

const purchase = { id: 'p1', date: '2026-11-05', merchant: 'Fictional café', cents: 1250 };
const addPurchase: LedgerAction = { type: 'addPurchase', currency: 'BSD', purchase };

describe('keeping a draft across sign-in', () => {
  test('the same student gets it back, with its currency and the same id', () => {
    const storage = fakeStorage();
    expect(keepDraft(addPurchase, 'student-a', storage)).toBe(true);
    expect(takeDraft('student-a', storage)).toEqual({
      currency: 'BSD',
      draft: { kind: 'purchase', editing: false, entry: purchase },
    });
  });

  test('it comes back once, so a later reload does not reopen the form', () => {
    const storage = fakeStorage();
    keepDraft(addPurchase, 'student-a', storage);
    takeDraft('student-a', storage);
    expect(takeDraft('student-a', storage)).toBeNull();
    expect(hasDraft(storage)).toBe(false);
  });

  test('a different student on the same phone never sees it, and it is thrown away', () => {
    const storage = fakeStorage();
    keepDraft(addPurchase, 'student-a', storage);
    expect(takeDraft('student-b', storage)).toBeNull();
    expect(storage.items.size).toBe(0);
  });

  test('an edit is remembered as an edit', () => {
    const storage = fakeStorage();
    keepDraft({ type: 'updatePurchase', currency: 'USD', purchase }, 'student-a', storage);
    expect(takeDraft('student-a', storage)?.draft).toMatchObject({ kind: 'purchase', editing: true });
  });

  test('income and bills are kept too', () => {
    const storage = fakeStorage();
    keepDraft({ type: 'addIncome', currency: 'USD', income: { id: 'i1', date: '2026-11-05', cents: 300 } }, 'student-a', storage);
    expect(takeDraft('student-a', storage)?.draft.kind).toBe('income');
    keepDraft({ type: 'updateBill', currency: 'USD', bill: { id: 'b1', name: 'Rent', dueOn: '2026-11-09', cents: 300 } }, 'student-a', storage);
    expect(takeDraft('student-a', storage)?.draft).toMatchObject({ kind: 'bill', editing: true });
  });

  test('a form that is not kept stores nothing', () => {
    const storage = fakeStorage();
    expect(keepDraft({ type: 'deletePurchase', currency: 'USD', id: 'p1' }, 'student-a', storage)).toBe(false);
    expect(storage.items.size).toBe(0);
  });

  test('clearing removes it', () => {
    const storage = fakeStorage();
    keepDraft(addPurchase, 'student-a', storage);
    clearDraft(storage);
    expect(takeDraft('student-a', storage)).toBeNull();
  });

  test.each([
    ['not JSON', 'not json'],
    ['no entry', JSON.stringify({ userId: 'student-a', currency: 'USD', draft: { kind: 'purchase', editing: false } })],
    ['fractional cents', JSON.stringify({ userId: 'student-a', currency: 'USD', draft: { kind: 'purchase', editing: false, entry: { id: 'p1', cents: 12.5 } } })],
    ['an unknown form', JSON.stringify({ userId: 'student-a', currency: 'USD', draft: { kind: 'other', editing: false, entry: { id: 'p1', cents: 1 } } })],
    ['an unknown currency', JSON.stringify({ userId: 'student-a', currency: 'EUR', draft: { kind: 'purchase', editing: false, entry: { id: 'p1', cents: 1 } } })],
  ])('a damaged draft is ignored: %s', (_name, text) => {
    const storage = fakeStorage();
    storage.setItem('spendsense.formDraft', text);
    expect(takeDraft('student-a', storage)).toBeNull();
    expect(storage.items.size).toBe(0);
  });

  test('a browser that refuses storage just means retyping, not a crash', () => {
    const refusing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(keepDraft(addPurchase, 'student-a', refusing)).toBe(false);
    expect(takeDraft('student-a', refusing)).toBeNull();
    expect(hasDraft(refusing)).toBe(false);
    expect(() => clearDraft(refusing)).not.toThrow();
  });
});
