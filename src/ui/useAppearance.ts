import { useEffect, useSyncExternalStore } from 'react';
import { applyEffects, readStoredEffects, type EffectsSettings } from './appearance';

// One shared copy, so the settings panel and every effect see a change at once.
let current = readStoredEffects();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setEffects(next: EffectsSettings): void {
  current = next;
  applyEffects(next);
  listeners.forEach((listener) => listener());
}

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', listener);
      return () => list.removeEventListener('change', listener);
    },
    () => window.matchMedia(query).matches,
  );
}

/** The switches as the student set them, for the settings panel. */
export function useEffectSettings(): EffectsSettings {
  return useSyncExternalStore(subscribe, () => current);
}

export function useReducedMotionRequested(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

/** What may actually run: the switches, limited by the device. */
export function useEffects() {
  const settings = useEffectSettings();
  const reduced = useReducedMotionRequested();
  const finePointer = useMediaQuery('(hover: hover) and (pointer: fine)');
  // Narrower, Add spending is fixed to the window from inside a panel, and a
  // transform on that panel would carry it away.
  const wideEnough = useMediaQuery('(min-width: 760px)');
  return {
    tilt: settings.tilt && !reduced && finePointer && wideEnough,
    chartAnimation: settings.chartAnimation && !reduced,
  };
}

/** Lets the CSS stop the slow edge light while the tab cannot be seen. */
export function usePauseEffectsWhenHidden(): void {
  useEffect(() => {
    const root = document.documentElement;
    const update = () => {
      root.dataset.pageHidden = document.hidden ? 'true' : 'false';
    };
    update();
    document.addEventListener('visibilitychange', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      delete root.dataset.pageHidden;
    };
  }, []);
}
