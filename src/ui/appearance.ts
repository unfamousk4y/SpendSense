// Decorative effects: which are on, and how strong. Pure, apart from the two
// functions at the end. Stored only in this browser, like the theme. Nothing here
// affects a financial number, and every effect also obeys the device's
// reduced-motion setting (see useAppearance.ts and the CSS).

export type EffectControl = 'background' | 'tilt' | 'edgeMotion' | 'chartAnimation';
export type EffectLevel = 'subtle' | 'full';
export type EffectsPreset = 'off' | EffectLevel | 'custom';

export type EffectsSettings = Record<EffectControl, boolean> & {
  /** How strong the effects that are on should look. */
  level: EffectLevel;
};

// public/boot-appearance.js reads the same key before React loads, so effects never flash on.
export const EFFECTS_STORAGE_KEY = 'spendsense-effects';

export const EFFECT_CONTROLS: EffectControl[] = ['background', 'tilt', 'edgeMotion', 'chartAnimation'];

const allControls = (on: boolean): Record<EffectControl, boolean> => ({
  background: on,
  tilt: on,
  edgeMotion: on,
  chartAnimation: on,
});

export const DEFAULT_EFFECTS: EffectsSettings = { ...allControls(true), level: 'subtle' };

/** "custom" as soon as the switches stop matching a preset. */
export function presetOf(settings: EffectsSettings): EffectsPreset {
  const on = EFFECT_CONTROLS.filter((control) => settings[control]).length;
  if (on === 0) return 'off';
  if (on === EFFECT_CONTROLS.length) return settings.level;
  return 'custom';
}

export function applyPreset(preset: Exclude<EffectsPreset, 'custom'>): EffectsSettings {
  if (preset === 'off') return { ...allControls(false), level: 'subtle' };
  return { ...allControls(true), level: preset };
}

export function withControl(settings: EffectsSettings, control: EffectControl, on: boolean): EffectsSettings {
  return { ...settings, [control]: on };
}

/** Whatever storage holds, this returns usable settings: damaged values mean the default. */
export function parseEffects(text: string | null): EffectsSettings {
  if (text === null) return DEFAULT_EFFECTS;
  try {
    const stored: unknown = JSON.parse(text);
    if (typeof stored !== 'object' || stored === null) return DEFAULT_EFFECTS;
    const values = stored as Record<string, unknown>;
    if (!EFFECT_CONTROLS.every((control) => typeof values[control] === 'boolean')) return DEFAULT_EFFECTS;
    return {
      background: values.background as boolean,
      tilt: values.tilt as boolean,
      edgeMotion: values.edgeMotion as boolean,
      chartAnimation: values.chartAnimation as boolean,
      level: values.level === 'full' ? 'full' : 'subtle',
    };
  } catch {
    return DEFAULT_EFFECTS;
  }
}

export function readStoredEffects(): EffectsSettings {
  try {
    return parseEffects(localStorage.getItem(EFFECTS_STORAGE_KEY));
  } catch {
    // Private browsing or blocked storage: the default, not remembered.
    return DEFAULT_EFFECTS;
  }
}

/** Sets the attributes the CSS reads and remembers the choice. Same names as public/boot-appearance.js. */
export function applyEffects(settings: EffectsSettings): void {
  const { dataset } = document.documentElement;
  dataset.fxBackground = settings.background ? 'on' : 'off';
  dataset.fxTilt = settings.tilt ? 'on' : 'off';
  dataset.fxEdge = settings.edgeMotion ? 'on' : 'off';
  dataset.fxChart = settings.chartAnimation ? 'on' : 'off';
  dataset.fxLevel = presetOf(settings) === 'off' ? 'off' : settings.level;
  try {
    localStorage.setItem(EFFECTS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // The page still changes; the choice just will not be remembered.
  }
}
