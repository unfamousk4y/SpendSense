import { useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import type { PointerEvent } from 'react';

/** Largest tilt in degrees; enough to read as depth, small enough to keep text easy to read. */
const MAX_TILT = 6;
// A soft spring so the panel follows the pointer smoothly instead of snapping.
const FOLLOW = { stiffness: 220, damping: 22, mass: 0.6 };

/**
 * Tilts a panel toward a mouse pointer, like a card held under a light.
 *
 * Motion values, not React state: the pointer moves many times a second, and
 * Motion writes these numbers straight onto the element's style without
 * asking React to redraw the screen.
 *
 * Only a real mouse tilts the panel (touchscreens have no hover position), and
 * nothing moves when the device asks for reduced motion.
 */
export function usePointerTilt() {
  const reduceMotion = useReducedMotion();
  // Pointer position across the panel: -0.5 at the left/top edge, 0.5 at the right/bottom.
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);

  // Pointer near the top edge tips the top away; near the right edge turns the right away.
  const rotateX = useSpring(useTransform(pointerY, [-0.5, 0.5], [MAX_TILT, -MAX_TILT]), FOLLOW);
  const rotateY = useSpring(useTransform(pointerX, [-0.5, 0.5], [-MAX_TILT, MAX_TILT]), FOLLOW);
  // Where the soft highlight sits, as CSS percentages for a radial gradient.
  const glareX = useTransform(pointerX, (x) => `${(x + 0.5) * 100}%`);
  const glareY = useTransform(pointerY, (y) => `${(y + 0.5) * 100}%`);

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    if (reduceMotion || event.pointerType !== 'mouse') return;
    const box = event.currentTarget.getBoundingClientRect();
    pointerX.set((event.clientX - box.left) / box.width - 0.5);
    pointerY.set((event.clientY - box.top) / box.height - 0.5);
  }

  function onPointerLeave() {
    pointerX.set(0);
    pointerY.set(0);
  }

  return {
    style: {
      rotateX,
      rotateY,
      transformPerspective: 900,
      '--glare-x': glareX,
      '--glare-y': glareY,
    },
    onPointerMove,
    onPointerLeave,
  };
}
