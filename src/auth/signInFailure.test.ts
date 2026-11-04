import { describe, expect, test } from 'vitest';
import { signInFailureFromAddress } from './signInFailure';

const SCAM = 'Your account is locked. Call 555-0100 to unlock it.';

describe('signInFailureFromAddress', () => {
  test('an ordinary address reports no failure', () => {
    expect(signInFailureFromAddress('http://localhost:5173/')).toBeNull();
    expect(signInFailureFromAddress('http://localhost:5173/?code=abc')).toBeNull();
  });

  // Anyone can write a link, so words in the address must never reach the screen.
  test.each([
    ['query', `http://localhost:5173/?error_description=${encodeURIComponent(SCAM)}`],
    ['hash', `http://localhost:5173/#error_description=${encodeURIComponent(SCAM)}`],
  ])('a failure in the %s shows our message, not the text from the link', (_where, address) => {
    const message = signInFailureFromAddress(address);
    expect(message).not.toBeNull();
    expect(message).not.toContain('555-0100');
  });
});
