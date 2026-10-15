import { createContext } from 'react';

// The user's look: basemap ('dark' | 'light', which also flips the UI glass) and slope palette
// ('rainbow' | 'muted' | 'beam'). Kept in this browser's localStorage.
export const THEME_KEY = 'slopes:theme';
export const DEFAULT_THEME = { map: 'dark', slope: 'rainbow' };

export function loadTheme() {
  try {
    const saved = JSON.parse(localStorage.getItem(THEME_KEY));
    return {
      map: saved?.map === 'light' ? 'light' : 'dark',
      slope: ['rainbow', 'muted', 'beam'].includes(saved?.slope) ? saved.slope : 'rainbow',
    };
  } catch {
    return DEFAULT_THEME;
  }
}

export const ThemeContext = createContext(DEFAULT_THEME);
