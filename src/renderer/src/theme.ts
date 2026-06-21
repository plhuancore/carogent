export type ThemeId = 'midnight-purple' | 'one-dark' | 'tokyo-night' | 'catppuccin-mocha' | 'light';

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  className: string;
  isDark: boolean;
}

export const THEMES: ThemeDefinition[] = [
  {
    id: 'midnight-purple',
    name: 'Midnight Purple',
    className: 'theme-midnight-purple',
    isDark: true
  },
  {
    id: 'one-dark',
    name: 'One Dark',
    className: 'theme-one-dark',
    isDark: true
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    className: 'theme-tokyo-night',
    isDark: true
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    className: 'theme-catppuccin-mocha',
    isDark: true
  },
  {
    id: 'light',
    name: 'Light Mode (GitHub)',
    className: 'theme-light',
    isDark: false
  }
];

const THEME_STORAGE_KEY = 'carogent-active-theme';

export function getSavedTheme(): ThemeId {
  const saved = localStorage.getItem(THEME_STORAGE_KEY) as ThemeId | null;
  if (saved && THEMES.some((t) => t.id === saved)) {
    return saved;
  }
  return 'midnight-purple';
}

export function saveTheme(themeId: ThemeId): void {
  localStorage.setItem(THEME_STORAGE_KEY, themeId);
}

export function applyTheme(themeId: ThemeId): void {
  const root = document.documentElement;
  
  // Remove all existing theme classes
  THEMES.forEach((t) => {
    if (t.className) {
      root.classList.remove(t.className);
    }
  });

  // Add the class for the selected theme
  const theme = THEMES.find((t) => t.id === themeId);
  if (theme && theme.className) {
    root.classList.add(theme.className);
  }
}
