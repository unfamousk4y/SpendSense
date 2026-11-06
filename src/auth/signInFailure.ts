/**
 * If Google or Supabase sends the student back with an error, it arrives in
 * the address (?error_description=... or #error_description=...). Anyone can
 * write a link like that, so its words are never shown: only the fact of a
 * failure is used. Reading has no side effects, because React may call a state
 * initializer twice in development.
 */
export function signInFailureFromAddress(address: string): string | null {
  const url = new URL(address);
  const fromHash = new URLSearchParams(url.hash.slice(1));
  return url.searchParams.has('error_description') || fromHash.has('error_description') ? 'Please try again. During the beta, only invited Google accounts can sign in.' : null;
}
