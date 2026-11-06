// How far a panel may tilt. The same angle swings a wide panel's edge much further
// than a small one's, so the limit is set by how far an edge travels, which makes
// every panel feel alike whatever its size.

/** How far a panel's edge may move toward or away from the viewer, in pixels. */
const MAX_EDGE_TRAVEL = 9;
/** Small panels would otherwise tip too steeply. */
const MAX_DEGREES = 2.5;

/** The largest tilt, in degrees, for a panel this many pixels across. */
export function tiltDegrees(sizePx: number): number {
  if (sizePx <= 2 * MAX_EDGE_TRAVEL) return MAX_DEGREES;
  const degrees = (Math.asin(MAX_EDGE_TRAVEL / (sizePx / 2)) * 180) / Math.PI;
  return Math.min(degrees, MAX_DEGREES);
}
