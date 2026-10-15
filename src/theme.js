import { createContext } from 'react';

// The user's look: basemap ('dark' | 'light', which also flips the UI glass) and slope palette
// ('rainbow' | 'muted' | 'beam') and slope layer opacity (0.1–1). Kept in this browser's localStorage.
export const THEME_KEY = 'slopes:theme';
export const DEFAULT_THEME = { map: 'dark', slope: 'rainbow', opacity: 1 };

export function loadTheme() {
  try {
    const saved = JSON.parse(localStorage.getItem(THEME_KEY));
    return {
      map: saved?.map === 'light' ? 'light' : 'dark',
      slope: ['rainbow', 'muted', 'beam'].includes(saved?.slope) ? saved.slope : 'rainbow',
      opacity: Number.isFinite(saved?.opacity) ? Math.min(1, Math.max(0.1, saved.opacity)) : 1,
    };
  } catch {
    return DEFAULT_THEME;
  }
}

export const ThemeContext = createContext(DEFAULT_THEME);
