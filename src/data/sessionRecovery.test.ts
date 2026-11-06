import { describe, expect, test, vi } from 'vitest';
import { SESSION_ENDED } from './ledgerStore';
import { recoverFromSave, SIGN_IN_RENEWED } from './sessionRecovery';

const clientWhoseRefresh = (error: unknown) => ({ auth: { refreshSession: vi.fn(async () => ({ error })) } });
const stale = { ok: false, message: SESSION_ENDED } as const;

describe('recoverFromSave', () => {
  test('a successful save needs nothing, and no refresh', async () => {
    const client = clientWhoseRefresh(null);
    expect(await recoverFromSave(client, { ok: true })).toEqual({ result: { ok: true }, expired: false });
    expect(client.auth.refreshSession).not.toHaveBeenCalled();
  });

  test('any other failure is passed on untouched', async () => {
    const client = clientWhoseRefresh(null);
    const closed = { ok: false, message: 'That week is closed' } as const;
    expect(await recoverFromSave(client, closed)).toEqual({ result: closed, expired: false });
    expect(client.auth.refreshSession).not.toHaveBeenCalled();
  });

  test('a renewed session keeps the form and asks to try again; it never claims the save worked', async () => {
    expect(await recoverFromSave(clientWhoseRefresh(null), stale)).toEqual({
      result: { ok: false, message: SIGN_IN_RENEWED },
      expired: false,
    });
  });

  test('a session that cannot be renewed asks the student to sign in', async () => {
    expect(await recoverFromSave(clientWhoseRefresh(new Error('gone')), stale)).toEqual({ result: stale, expired: true });
  });
});
