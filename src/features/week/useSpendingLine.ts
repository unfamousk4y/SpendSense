import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEffects } from '../../ui/useAppearance';
import { areaPoints, blendYs, easeInOut, polylinePoints, revealEnd, TRACE_WIDTH } from './traceGeometry';

const DRAW_MS = 4000;
const EDIT_MS = 320;
// After a tab has been hidden, carry on from where the draw stopped instead of jumping ahead.
const LONGEST_FRAME_MS = 100;

/**
 * The spending line's two animations. Both write straight to the SVG, so hovers
 * and other redraws of the chart cannot restart them, and neither touches the
 * numbers shown as text.
 *
 * - Draw: on arrival only, a clip uncovers the real line from left to right. The
 *   line itself is already in its final position, so its values are never altered.
 * - After an edit: a brief move from the old line to the new one.
 */
export function useSpendingLine(ys: number[], todayIndex: number) {
  const { chartAnimation } = useEffects();
  const clipRef = useRef<SVGRectElement>(null);
  const lineRef = useRef<SVGPolylineElement>(null);
  const areaRef = useRef<SVGPolygonElement>(null);
  // Fixed when the chart first appears: a later redraw or setting change never replays it.
  const [drawsOnArrival] = useState(chartAnimation);
  const drawn = useRef(!drawsOnArrival);
  const previousYs = useRef(ys);
  const key = ys.join(',');

  useEffect(() => {
    const clip = clipRef.current;
    if (!clip) return;
    if (!chartAnimation) drawn.current = true;
    if (drawn.current) {
      clip.setAttribute('width', String(TRACE_WIDTH));
      return;
    }

    const end = revealEnd(todayIndex);
    let frame = 0;
    let elapsed = 0;
    let last: number | null = null;
    function step(now: number) {
      elapsed += last === null ? 0 : Math.min(now - last, LONGEST_FRAME_MS);
      last = now;
      const progress = Math.min(elapsed / DRAW_MS, 1);
      clip?.setAttribute('width', String(easeInOut(progress) * end));
      if (progress < 1) {
        frame = requestAnimationFrame(step);
      } else {
        drawn.current = true;
        clip?.setAttribute('width', String(TRACE_WIDTH));
      }
    }
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // The end point is read once: a change of data during the draw does not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartAnimation]);

  // Layout effect: the first frame after an edit starts from the old line, with no flicker.
  useLayoutEffect(() => {
    const from = previousYs.current;
    const to = key === '' ? [] : key.split(',').map(Number);
    previousYs.current = to;
    const line = lineRef.current;
    const area = areaRef.current;
    if (!line || !area) return;
    if (!chartAnimation || from.length !== to.length || from.join(',') === key) return;

    function draw(values: number[]) {
      line?.setAttribute('points', polylinePoints(values));
      area?.setAttribute('points', areaPoints(values));
    }
    let frame = 0;
    let start: number | null = null;
    function step(now: number) {
      start ??= now;
      const progress = Math.min((now - start) / EDIT_MS, 1);
      draw(blendYs(from, to, easeInOut(progress)));
      if (progress < 1) frame = requestAnimationFrame(step);
    }
    draw(from);
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      // Interrupted or removed: the true line is always what stays.
      draw(to);
    };
  }, [key, chartAnimation]);

  return { clipRef, lineRef, areaRef, startClipWidth: drawsOnArrival ? 0 : TRACE_WIDTH };
}
