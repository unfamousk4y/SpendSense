import { useMotionValue, useSpring, useTransform } from 'motion/react';
import type { PointerEvent } from 'react';
import { tiltDegrees } from './tilt';
import { useEffects } from './useAppearance';

// A soft, unhurried spring: the panel drifts after the pointer instead of chasing
// it, and settles back at rest.
const FOLLOW = { stiffness: 110, damping: 20, mass: 0.8 };

/**
 * Tilts a panel toward a mouse pointer, like a card held under a light.
 *
 * Motion values, not React state: the pointer moves many times a second, and
 * Motion writes these numbers straight onto the element's style without
 * asking React to redraw the screen.
 *
 * Runs only when the student's effects allow it, on a device with a real mouse,
 * and not when the device asks for reduced motion. Then the panel gets no
 * transform at all, so it cannot move or blur.
 */
export function usePointerTilt() {
  const { tilt: enabled } = useEffects();
  const targetX = useMotionValue(0);
  const targetY = useMotionValue(0);
  // Pointer position across the panel: -0.5 at the left/top edge, 0.5 at the right/bottom.
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);

  const rotateX = useSpring(targetX, FOLLOW);
  const rotateY = useSpring(targetY, FOLLOW);
  // Where the soft highlight sits, as CSS percentages for a radial gradient.
  const glareX = useTransform(pointerX, (x) => `${(x + 0.5) * 100}%`);
  const glareY = useTransform(pointerY, (y) => `${(y + 0.5) * 100}%`);

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    if (!enabled || event.pointerType !== 'mouse') return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width - 0.5;
    const y = (event.clientY - box.top) / box.height - 0.5;
    pointerX.set(x);
    pointerY.set(y);
    // Pointer near the top edge tips the top away; near the right edge turns the right away.
    targetX.set(-y * 2 * tiltDegrees(box.height));
    targetY.set(x * 2 * tiltDegrees(box.width));
  }

  function onPointerLeave() {
    pointerX.set(0);
    pointerY.set(0);
    targetX.set(0);
    targetY.set(0);
  }

  return {
    enabled,
    style: enabled
      ? {
          rotateX,
          rotateY,
          transformPerspective: 900,
          '--glare-x': glareX,
          '--glare-y': glareY,
        }
      : undefined,
    onPointerMove,
    onPointerLeave,
  };
}
