// The appearance choice: follow the device ("auto") or force light or dark.
// Stored only in this browser's localStorage; nothing is sent anywhere.

export type ThemeChoice = 'auto' | 'light' | 'dark';

// index.html reads the same key before React loads, to avoid a white flash.
export const THEME_STORAGE_KEY = 'spendsense-theme';

export function readStoredTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'auto';
  } catch {
    // Private browsing or blocked storage: fall back to following the device.
    return 'auto';
  }
}

/** Sets <html data-theme> for CSS and remembers the choice; "auto" removes both. */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'auto') {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = choice;
  }
  try {
    if (choice === 'auto') {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, choice);
    }
  } catch {
    // The page still switches; the choice just will not be remembered.
  }
}
