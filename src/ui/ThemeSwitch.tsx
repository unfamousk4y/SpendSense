import { useEffect, useState } from 'react';
import { applyTheme, readStoredTheme, type ThemeChoice } from './theme';
import styles from './ThemeSwitch.module.css';

const OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function ThemeSwitch() {
  // Passing a function means localStorage is read once, on the first draw only.
  const [choice, setChoice] = useState<ThemeChoice>(readStoredTheme);

  // Side job after each draw where `choice` changed: update <html> and storage.
  useEffect(() => {
    applyTheme(choice);
  }, [choice]);

  return (
    <div className={styles.switch} role="group" aria-labelledby="theme-label">
      <span id="theme-label" className={styles.label}>
        Appearance
      </span>
      <div className={styles.options}>
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={styles.option}
            aria-pressed={choice === option.value}
            onClick={() => setChoice(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
