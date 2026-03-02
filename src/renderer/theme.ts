export type ThemeMode = 'dark' | 'light';

const STORAGE_KEY = 'kiosk_theme';

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'dark' || value === 'light';
}

export function getTheme(): ThemeMode {
  const fromDataset = document.documentElement.dataset.theme;
  if (isThemeMode(fromDataset)) return fromDataset;

  try {
    const fromStorage = window.localStorage.getItem(STORAGE_KEY);
    if (isThemeMode(fromStorage)) return fromStorage;
  } catch {
    // ignore storage access failures
  }

  return 'dark';
}

export function setTheme(theme: ThemeMode): ThemeMode {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore storage access failures
  }
  return theme;
}

export function toggleTheme(): ThemeMode {
  return setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

export function initTheme(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isThemeMode(stored)) {
      return setTheme(stored);
    }
  } catch {
    // ignore storage access failures
  }
  return setTheme('dark');
}
