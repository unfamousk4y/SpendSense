// Where the spending chart's lines go, in SVG units. Pure, so the shape on screen
// can be tested against the numbers it stands for.

export const TRACE_WIDTH = 700;
export const TRACE_HEIGHT = 240;
const TOP = 14;

export const dayX = (day: number) => ((day + 1) * TRACE_WIDTH) / 7;

/** The y position of each cumulative amount. */
export function lineYs(values: number[], maxCents: number): number[] {
  return values.map((cents) => TRACE_HEIGHT - (cents / maxCents) * (TRACE_HEIGHT - TOP));
}

/** A polyline from zero at the start of the week through each day's end. */
export function polylinePoints(ys: number[]): string {
  return [`0,${TRACE_HEIGHT}`, ...ys.map((y, day) => `${dayX(day)},${y}`)].join(' ');
}

/** The same line closed down to the baseline, for the soft fill beneath it. */
export function areaPoints(ys: number[]): string {
  const lastX = ys.length === 0 ? 0 : dayX(ys.length - 1);
  return `${polylinePoints(ys)} ${lastX},${TRACE_HEIGHT}`;
}

/** Partway between two lines of the same length: used only for the brief move after an edit. */
export function blendYs(from: number[], to: number[], amount: number): number[] {
  return to.map((y, day) => from[day] + (y - from[day]) * amount);
}

/** How far right the line ends, so the draw takes its full time over real data. */
export const revealEnd = (todayIndex: number) => dayX(todayIndex);

/** Slow start and finish; 0 and 1 are exact so the draw ends on the whole line. */
export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
