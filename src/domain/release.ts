// Releasing protected savings, from PRODUCT_PLAN.md: "Protected savings has
// its own explicit release action" and "Transfers within the allocation
// (protect/release) change P, not C". Pure: all money is integer cents in ONE
// currency.
//
// A release only relabels money the student already has: P goes down, free
// cash F goes up by the same amount, cash C does not change. It never changes
// this week's allowance; the student adjusts that separately if they want to.
import type { IsoDate } from './dates';

/** One release, kept as a record. P = opening + closures - releases. */
export type SavingsRelease = {
  /** One per opening of the form, so a double tap records it once. */
  id: string;
  madeOn: IsoDate;
  cents: number;
};

export type ReleaseSide = { protectedCents: number; freeCents: number };

export type ReleasePreview =
  | { kind: 'ok'; before: ReleaseSide; after: ReleaseSide }
  // Expected student situations, explained on screen.
  | { kind: 'nothingProtected' }
  | { kind: 'moreThanProtected'; protectedCents: number };

export function previewRelease({
  releaseCents,
  protectedCents,
  freeCents,
}: {
  /** A parsed, positive amount (parseAmount already refuses 0). */
  releaseCents: number;
  protectedCents: number;
  /** F before the release. May be negative. */
  freeCents: number;
}): ReleasePreview {
  for (const [name, value] of Object.entries({ releaseCents, protectedCents, freeCents })) {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`${name} must be a whole number within the safe integer range (got ${value})`);
    }
  }
  // These come from our own code, never straight from typing.
  if (releaseCents <= 0 || protectedCents < 0) {
    throw new RangeError('A release must be positive and protected savings cannot be negative');
  }

  if (protectedCents === 0) return { kind: 'nothingProtected' };
  if (releaseCents > protectedCents) return { kind: 'moreThanProtected', protectedCents };

  return {
    kind: 'ok',
    before: { protectedCents, freeCents },
    after: { protectedCents: protectedCents - releaseCents, freeCents: freeCents + releaseCents },
  };
}

/** Appends a release unless one with the same id is already recorded. */
export function recordRelease(releases: SavingsRelease[], release: SavingsRelease): SavingsRelease[] {
  if (releases.some((existing) => existing.id === release.id)) return releases;
  return [...releases, release];
}
