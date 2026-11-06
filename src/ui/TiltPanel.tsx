import type { HTMLMotionProps, MotionStyle } from 'motion/react';
import * as m from 'motion/react-m';
import type { ReactNode } from 'react';
import { HOVER_LIFT, PANEL_TRANSITION } from './motionTokens';
import { usePointerTilt } from './usePointerTilt';
import styles from './TiltPanel.module.css';

type TiltPanelProps = Omit<HTMLMotionProps<'section'>, 'children'> & {
  children: ReactNode;
  as?: 'section' | 'div';
  /** Its place in the page's arrival order. */
  enterOrder?: number;
};

/**
 * With nothing moving, Motion would still write a bare perspective, which makes
 * browsers draw the panel's text less crisply. At rest there is no transform at all.
 */
function transformUnlessResting(_latest: unknown, generated: string): string {
  return generated.includes('rotate') || generated.includes('translate') || generated.includes('scale') ? generated : 'none';
}

/** Any dashboard panel: the whole panel leans gently toward the mouse where effects allow it. */
export function TiltPanel({ as = 'section', enterOrder, className = '', children, ...rest }: TiltPanelProps) {
  const tilt = usePointerTilt();
  const Element = (as === 'div' ? m.div : m.section) as typeof m.section;

  return (
    <Element
      {...rest}
      className={`${styles.tilt} ${className}`}
      // Motion accepts extra CSS variables in style; only the tilt's values move.
      style={{ ...tilt.style, ...(enterOrder !== undefined && { '--enter': enterOrder }) } as MotionStyle}
      onPointerMove={tilt.onPointerMove}
      onPointerLeave={tilt.onPointerLeave}
      whileHover={tilt.enabled ? HOVER_LIFT : undefined}
      transition={PANEL_TRANSITION}
      transformTemplate={transformUnlessResting}
    >
      <span className={styles.glare} aria-hidden="true" />
      {children}
    </Element>
  );
}
