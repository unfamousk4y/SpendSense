import { useEffect, useId, useRef, useState } from 'react';
import { applyPreset, EFFECT_CONTROLS, presetOf, withControl, type EffectControl, type EffectsPreset } from './appearance';
import { ThemeSwitch } from './ThemeSwitch';
import { setEffects, useEffectSettings, useReducedMotionRequested } from './useAppearance';
import styles from './AppearanceMenu.module.css';

const PRESETS: { value: Exclude<EffectsPreset, 'custom'>; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'subtle', label: 'Subtle' },
  { value: 'full', label: 'Full' },
];

const CONTROL_LABELS: Record<EffectControl, { label: string; hint?: string }> = {
  background: { label: 'Background effects' },
  tilt: { label: 'Spatial tilt', hint: 'Mouse only' },
  edgeMotion: { label: 'Ambient edge motion' },
  chartAnimation: { label: 'Chart animation' },
};

/** A button in the header that opens a small panel of theme and effects settings. */
export function AppearanceMenu() {
  const [open, setOpen] = useState(false);
  const settings = useEffectSettings();
  const reduced = useReducedMotionRequested();
  const preset = presetOf(settings);
  const panelId = useId();
  const presetLabelId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector('button')?.focus();
    // A press anywhere else closes it, without pulling focus back from what was pressed.
    function onPointerDown(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <div
      ref={wrapRef}
      onKeyDown={(event) => {
        if (open && event.key === 'Escape') {
          event.stopPropagation();
          close(true);
        }
      }}
      // Tabbing past the last control closes it, so it never sits over the page unattended.
      onBlur={(event) => {
        if (open && event.relatedTarget instanceof Node && !wrapRef.current?.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={styles.button}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? close(true) : setOpen(true))}
      >
        Appearance
      </button>

      <div ref={panelRef} id={panelId} className={styles.panel} role="group" aria-label="Appearance settings" hidden={!open}>
        <ThemeSwitch label="Theme" />

        <div className={styles.group} role="group" aria-labelledby={presetLabelId}>
          <div className={styles.groupHeading}>
            <span id={presetLabelId} className={styles.label}>
              Effects
            </span>
            {preset === 'custom' && <span className={styles.custom}>Custom</span>}
          </div>
          <div className={styles.options}>
            {PRESETS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={styles.option}
                aria-pressed={preset === option.value}
                onClick={() => setEffects(applyPreset(option.value))}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <ul className={styles.controls}>
          {EFFECT_CONTROLS.map((control) => (
            <li key={control}>
              <label className={styles.control}>
                <span>
                  {CONTROL_LABELS[control].label}
                  {CONTROL_LABELS[control].hint && <span className={styles.hint}>{CONTROL_LABELS[control].hint}</span>}
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  className={styles.switch}
                  checked={settings[control]}
                  onChange={(event) => setEffects(withControl(settings, control, event.target.checked))}
                />
              </label>
            </li>
          ))}
        </ul>

        {reduced && (
          <p className={styles.note}>
            Your device asks for reduced motion, so tilt, edge motion, entrances and chart drawing stay off whatever is set here.
          </p>
        )}
      </div>
    </div>
  );
}
