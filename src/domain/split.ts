// Dividing money coming in between needs, wants and savings, from the money
// split amendment in PRODUCT_PLAN.md. Pure: all money is integer cents in ONE
// currency, and each account has its own split.
//
// The split applies to money coming in, never to the current balance. A share
// of the balance would shrink as the student spends: 20% of 1,000 is 200, but
// after spending 300 it would be 140, and savings would lose 60 for no reason.

export type Split = {
  needsPercent: number;
  wantsPercent: number;
  savingsPercent: number;
};

/** A common starting point that the student can change. Not advice. */
export const SUGGESTED_SPLIT: Split = { needsPercent: 50, wantsPercent: 30, savingsPercent: 20 };

export function isValidSplit({ needsPercent, wantsPercent, savingsPercent }: Split): boolean {
  const percents = [needsPercent, wantsPercent, savingsPercent];
  return (
    percents.every((percent) => Number.isInteger(percent) && percent >= 0 && percent <= 100) &&
    needsPercent + wantsPercent + savingsPercent === 100
  );
}

/** A typed percent: a whole number from 0 to 100, or null if it is anything else. */
export function parsePercent(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const percent = Number(trimmed);
  return percent <= 100 ? percent : null;
}

/** What is typed in the three percent boxes. */
export type SplitTexts = { needs: string; wants: string; savings: string };

export const SUGGESTED_SPLIT_TEXTS = splitToTexts(SUGGESTED_SPLIT);

export function splitToTexts(split: Split): SplitTexts {
  return { needs: String(split.needsPercent), wants: String(split.wantsPercent), savings: String(split.savingsPercent) };
}

/** A split only when all three are whole percents totalling 100. The total is null if any is not whole. */
export function readSplitTexts(texts: SplitTexts): { split: Split | null; totalPercent: number | null } {
  const needsPercent = parsePercent(texts.needs);
  const wantsPercent = parsePercent(texts.wants);
  const savingsPercent = parsePercent(texts.savings);
  if (needsPercent === null || wantsPercent === null || savingsPercent === null) {
    return { split: null, totalPercent: null };
  }
  const split = { needsPercent, wantsPercent, savingsPercent };
  return { split: isValidSplit(split) ? split : null, totalPercent: needsPercent + wantsPercent + savingsPercent };
}

export type SplitAmounts = {
  savingsCents: number;
  wantsCents: number;
  needsCents: number;
  /** What the percentage asked for beyond the free cash available. 0 when it all fit. */
  savingsCappedCents: number;
};

/**
 * One payment's shares. Savings and wants round down and the spare cents go to
 * needs, so the three always add up to exactly the amount.
 */
export function splitMoneyIn({
  cents,
  split,
  freeAfterCents,
}: {
  cents: number;
  split: Split;
  /** F once this money has arrived, before setting any of it aside. May be negative. */
  freeAfterCents: number;
}): SplitAmounts {
  requireSafeIntegers({ cents, freeAfterCents });
  if (cents < 0) throw new RangeError('An amount to split cannot be negative');
  if (!isValidSplit(split)) throw new RangeError('A split must be whole percents that total 100');

  const askedCents = percentOf(cents, split.savingsPercent);
  const wantsCents = percentOf(cents, split.wantsPercent);
  // Setting money aside must never deepen a shortfall.
  const savingsCents = Math.min(askedCents, Math.max(0, freeAfterCents));
  return {
    savingsCents,
    wantsCents,
    needsCents: cents - savingsCents - wantsCents,
    savingsCappedCents: askedCents - savingsCents,
  };
}

/** The first split, at setup. Savings the student already has are left out of it. */
export function splitOpening({
  cashCents,
  alreadySavedCents,
  billsCents,
  split,
}: {
  cashCents: number;
  alreadySavedCents: number;
  billsCents: number;
  split: Split;
}): SplitAmounts & { protectedCents: number } {
  requireSafeIntegers({ cashCents, alreadySavedCents, billsCents });
  // previewSetup explains this situation on screen before anything reaches here.
  if (alreadySavedCents > cashCents) throw new RangeError('Savings cannot be more than cash');

  const amounts = splitMoneyIn({
    cents: cashCents - alreadySavedCents,
    split,
    freeAfterCents: cashCents - alreadySavedCents - billsCents,
  });
  return { ...amounts, protectedCents: alreadySavedCents + amounts.savingsCents };
}

export type WantsLeft = {
  wantsLeftCents: number;
  /** Wants money the cash cannot back, because bills or spending took it. The screen says so. */
  coveredElsewhereCents: number;
};

/** What is left for wants across the whole plan. It is never more than free cash. */
export function wantsLeft({
  wantsPoolCents,
  wantsSpentCents,
  movedToSavingsCents,
  freeCents,
}: {
  /** The opening wants share plus each payment's confirmed wants share. */
  wantsPoolCents: number;
  wantsSpentCents: number;
  movedToSavingsCents: number;
  /** F now. May be negative. */
  freeCents: number;
}): WantsLeft {
  requireSafeIntegers({ wantsPoolCents, wantsSpentCents, movedToSavingsCents, freeCents });
  const unspentCents = Math.max(0, wantsPoolCents - wantsSpentCents - movedToSavingsCents);
  const wantsLeftCents = Math.min(unspentCents, Math.max(0, freeCents));
  return { wantsLeftCents, coveredElsewhereCents: unspentCents - wantsLeftCents };
}

/**
 * This week's share of what is left for wants, the same way the allowance
 * shares free cash. Saved with the week's plan, so it does not shift after every purchase.
 */
export function weeklyWantsGuide({
  wantsLeftCents,
  daysThisWeek,
  daysLeft,
}: {
  wantsLeftCents: number;
  daysThisWeek: number;
  daysLeft: number;
}): number {
  requireSafeIntegers({ wantsLeftCents, daysThisWeek, daysLeft });
  // A plan that has ended gets no guide. The screen asks for a new plan instead.
  if (daysLeft <= 0) return 0;
  const product = wantsLeftCents * daysThisWeek;
  requireSafeIntegers({ product });
  return Math.floor(product / daysLeft);
}

export type WantsStatus = {
  /** The guide as shown: never above the allowance in force. */
  guideCents: number;
  leftCents: number;
  /** How far past the guide. A guide, not a limit: nothing is blocked. */
  overCents: number;
};

export function wantsStatus({
  savedGuideCents,
  allowanceCents,
  wantsSpentCents,
}: {
  savedGuideCents: number;
  allowanceCents: number;
  wantsSpentCents: number;
}): WantsStatus {
  requireSafeIntegers({ savedGuideCents, allowanceCents, wantsSpentCents });
  const guideCents = Math.min(savedGuideCents, allowanceCents);
  return {
    guideCents,
    leftCents: Math.max(0, guideCents - wantsSpentCents),
    overCents: Math.max(0, wantsSpentCents - guideCents),
  };
}

/**
 * Unused wants money that a closing week moved to savings. It stops counting
 * toward future wants, or the wants share would grow while the cash behind it
 * had already become savings.
 */
export function wantsMovedToSavings({
  protectedByClosureCents,
  guideCents,
  wantsSpentCents,
}: {
  protectedByClosureCents: number;
  guideCents: number;
  wantsSpentCents: number;
}): number {
  requireSafeIntegers({ protectedByClosureCents, guideCents, wantsSpentCents });
  return Math.min(protectedByClosureCents, Math.max(0, guideCents - wantsSpentCents));
}

function percentOf(cents: number, percent: number): number {
  const product = cents * percent;
  requireSafeIntegers({ product });
  return Math.floor(product / 100);
}

function requireSafeIntegers(values: Record<string, number>): void {
  for (const [name, value] of Object.entries(values)) {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`${name} must be a whole number within the safe integer range (got ${value})`);
    }
  }
}
