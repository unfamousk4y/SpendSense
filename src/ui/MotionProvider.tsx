import { LazyMotion, MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';

const loadFeatures = () => import('./motionFeatures').then((module) => module.default);

/**
 * Motion settings for the whole app.
 * - LazyMotion + `m` components: about 5 kB up front; features arrive separately.
 *   `strict` makes accidental use of the heavier `motion` component an error.
 * - reducedMotion="user": when the device asks for reduced motion, Motion turns
 *   off movement and layout animations and keeps only fades and color changes.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
