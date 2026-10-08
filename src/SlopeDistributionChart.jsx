import { RAMP_STOPS } from './slopeMap.js';

// Reconstructed component — see chat for context. Hand-rolled SVG "rug plot": each raw sample
// is drawn as a thin bar positioned by its own slope % on a fixed domain (extended if any sample
// exceeds it), colored by the map layer's own ramp (shared RAMP_STOPS), with a smoothed density
// curve on top.
const VIEW_W = 280;
const VIEW_H = 90;
const BASE_DOMAIN_MAX = 100;


function colorForPercent(pct) {
  const stops = RAMP_STOPS;
  if (pct <= stops[0][0]) return stops[0].slice(1);
  for (let i = 1; i < stops.length; i++) {
    if (pct <= stops[i][0]) {
      const [p0, r0, g0, b0] = stops[i - 1];
      const [p1, r1, g1, b1] = stops[i];
      const t = (pct - p0) / (p1 - p0);
      return [r0 + (r1 - r0) * t, g0 + (g1 - g0) * t, b0 + (b1 - b0) * t];
    }
  }
  return stops[stops.length - 1].slice(1);
}

function rgb(c) {
  return `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`;
}

export default function SlopeDistributionChart({ samples = [], onHover }) {
  if (samples.length === 0) return null;

  const domainMax = Math.max(BASE_DOMAIN_MAX, ...samples);
  const sorted = [...samples].sort((a, b) => a - b);
  const barWidth = Math.max(1, VIEW_W / sorted.length);

  // Rough density estimate for the smoothed curve — bucket into ~40 bins across the domain.
  const BINS = 40;
  const counts = new Array(BINS).fill(0);
  for (const s of samples) {
    const bin = Math.min(BINS - 1, Math.floor((s / domainMax) * BINS));
    counts[bin]++;
  }
  const maxCount = Math.max(...counts, 1);
  const points = counts.map((c, i) => {
    const x = (i / (BINS - 1)) * VIEW_W;
    const y = VIEW_H - (c / maxCount) * VIEW_H * 0.7 - 4;
    return [x, y];
  });
  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

  return (
    <svg className="slope-distribution-svg" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none">
      <defs>
        {sorted.map((s, i) => {
          const base = colorForPercent(s);
          const dark = base.map((c) => c * 0.5);
          return (
            <linearGradient id={`bar-grad-${i}`} key={i} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={rgb(base)} />
              <stop offset="100%" stopColor={rgb(dark)} />
            </linearGradient>
          );
        })}
      </defs>
      {sorted.map((s, i) => {
        const x = (s / domainMax) * VIEW_W;
        return (
          <rect
            key={i}
            x={x - barWidth / 2}
            y={0}
            width={barWidth}
            height={VIEW_H}
            fill={`url(#bar-grad-${i})`}
            opacity={0.5}
            onMouseEnter={(e) => onHover?.({ pct: Math.round(s), x: e.clientX, y: e.clientY })}
            onMouseLeave={() => onHover?.(null)}
          />
        );
      })}
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.85" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
