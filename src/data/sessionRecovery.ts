// What to do when a save is refused because the session is stale. A student who
// reopens a phone after hours may only need a fresh token, which keeps their form.
import type { SaveResult } from './ledgerStore';
import { SESSION_ENDED } from './ledgerStore';

export const SIGN_IN_RENEWED = 'Your sign-in was renewed. Press Try again to save this.';

type RefreshingClient = { auth: { refreshSession: () => Promise<{ error: unknown }> } };

/** expired means the session could not be renewed, so the student must sign in again. */
export async function recoverFromSave(client: RefreshingClient, result: SaveResult): Promise<{ result: SaveResult; expired: boolean }> {
  if (result.ok || result.message !== SESSION_ENDED) return { result, expired: false };

  const { error } = await client.auth.refreshSession();
  if (error) return { result, expired: true };
  return { result: { ok: false, message: SIGN_IN_RENEWED }, expired: false };
}
