// Pure calendar-date helpers. A calendar date is an ISO 8601 string such as
// "2026-11-02" with no time or time zone. Day arithmetic goes through UTC day
// numbers because UTC has no daylight saving shifts: every UTC day is exactly
// 24 hours, so subtracting two dates always gives a whole number of days.

/** A calendar date, "YYYY-MM-DD". */
export type IsoDate = string;

export type PlanDays = {
  /** d: days from today through Sunday, or through the end date if sooner. 0 once the plan has ended. */
  daysThisWeek: number;
  /** D: days from today through the end date, inclusive. 0 once the plan has ended. */
  daysLeft: number;
};

const MS_PER_DAY = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The calendar date at `instant` for someone in `timeZone` (an IANA name such
 * as "America/Nassau"). This is the only place a time zone matters; everything
 * after it is plain calendar arithmetic.
 */
export function localDateIn(instant: Date, timeZone: string): IsoDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Day counts for suggestAllowance. Weeks run Monday through Sunday. */
export function planDays(today: IsoDate, endDate: IsoDate): PlanDays {
  const todayNumber = dayNumber(today);
  // Inclusive: Friday through Sunday is 3 days, not Sunday - Friday = 2.
  const daysLeft = dayNumber(endDate) - todayNumber + 1;
  if (daysLeft <= 0) {
    return { daysThisWeek: 0, daysLeft: 0 };
  }

  // getUTCDay: 0 = Sunday, 1 = Monday ... 6 = Saturday.
  // Days through Sunday: Monday 7, Tuesday 6 ... Saturday 2, Sunday 1.
  const weekday = new Date(todayNumber * MS_PER_DAY).getUTCDay();
  const daysThroughSunday = 7 - ((weekday + 6) % 7);

  return { daysThisWeek: Math.min(daysThroughSunday, daysLeft), daysLeft };
}

/** Whole calendar days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return dayNumber(to) - dayNumber(from);
}

/** The calendar date `days` after `date` (or before, when negative). */
export function addDays(date: IsoDate, days: number): IsoDate {
  return new Date((dayNumber(date) + days) * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Whole days since 1970-01-01 for a valid ISO date; throws on anything else. */
function dayNumber(date: IsoDate): number {
  const match = ISO_DATE.exec(date);
  if (!match) {
    throw new RangeError(`Expected a date like 2026-11-02 (got "${date}")`);
  }
  const [year, month, day] = match.slice(1).map(Number);
  const ms = Date.UTC(year, month - 1, day);

  // Date.UTC quietly rolls 2026-02-30 over to March 2, so reject any date that
  // does not come back unchanged.
  const check = new Date(ms);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new RangeError(`"${date}" is not a real calendar date`);
  }
  return ms / MS_PER_DAY;
}
