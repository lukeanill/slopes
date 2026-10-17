import { createContext } from 'react';

// The user's look: basemap ('dark' | 'light', which also flips the UI glass), slope palette
// (one of SLOPE_PALETTE_IDS in slopeMap.js) and slope layer opacity (one of OPACITY_OPTIONS — the
// theme menu's three steps). Kept in this browser's localStorage.
export const THEME_KEY = 'slopes:theme';
export const OPACITY_OPTIONS = [0.3, 0.6, 1];
// New visitors: the dark map, the Rainbow palette, full opacity.
export const DEFAULT_THEME = { map: 'dark', slope: 'rainbow', opacity: 1 };

// Older saves (from the opacity slider) snap to the nearest step.
const nearestOpacity = (value) =>
  OPACITY_OPTIONS.reduce((best, o) => (Math.abs(o - value) < Math.abs(best - value) ? o : best), DEFAULT_THEME.opacity);

export function loadTheme() {
  try {
    const saved = JSON.parse(localStorage.getItem(THEME_KEY));
    return {
      map: saved?.map === 'light' ? 'light' : 'dark',
      slope: ['rainbow', 'muted', 'beam', 'aurora', 'indigo'].includes(saved?.slope) ? saved.slope : 'rainbow',
      opacity: Number.isFinite(saved?.opacity) ? nearestOpacity(saved.opacity) : DEFAULT_THEME.opacity,
    };
  } catch {
    return DEFAULT_THEME;
  }
}

export const ThemeContext = createContext(DEFAULT_THEME);
