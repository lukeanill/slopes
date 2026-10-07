// Band colors run from deep purple to pale yellow-green, so no single text color works on all of
// them. These use WCAG relative luminance / contrast to keep band-colored UI readable.

function parseColor(color) {
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16));
  return (color.match(/\d+(\.\d+)?/g) ?? [0, 0, 0]).slice(0, 3).map(Number);
}

function luminance([r, g, b]) {
  const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const toCss = (rgb) => `rgb(${rgb.map(Math.round).join(', ')})`;

// Dark or white text, whichever reads better on a band-colored background (the sheet's badge).
export function textOnColor(color) {
  const rgb = parseColor(color);
  return contrast(rgb, [255, 255, 255]) >= contrast(rgb, [26, 26, 26]) ? '#ffffff' : '#1a1a1a';
}

// A band color used as text on the dark glass surfaces, lightened toward white just enough to
// reach 4.5:1. The reference is a little lighter than the glass itself (it's translucent over
// the map), so the result holds up over brighter parts of the map too.
const GLASS_REFERENCE = [44, 43, 43];
export function readableOnDark(color) {
  let rgb = parseColor(color);
  for (let i = 0; i < 30 && contrast(rgb, GLASS_REFERENCE) < 4.5; i++) {
    rgb = rgb.map((c) => c + (255 - c) * 0.1);
  }
  return toCss(rgb);
}
