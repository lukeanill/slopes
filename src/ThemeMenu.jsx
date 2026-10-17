import { useState } from 'react';
import { Layers } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverPanel } from '@lukeanill/ui/components/animate-ui/components/base/popover';
import Metal, { METAL_HOST } from './Metal.jsx';
import { SLOPE_PALETTES, SLOPE_PALETTE_IDS } from './slopeMap.js';
import { OPACITY_OPTIONS } from './theme.js';
import imgMapDark from './assets/theme/map-dark.jpg';
import imgMapLight from './assets/theme/map-light.jpg';

// Theme menu from the SLOPES Figma (node 10:94): the basemap (which also flips the UI between dark
// and light), the slope palette and the slope layer's opacity. The chosen option in each row is
// ringed in live metal (see Metal.jsx); the others sit quietly. Söhne → Inter, as elsewhere.
const SANS = { fontFamily: "'Inter', system-ui, sans-serif", fontWeight: 400 };
const LABEL = 'w-full text-[12px] leading-[1.4] tracking-[0.12px] opacity-80';

const MAPS = [
  // Crops copied from the design's image fills.
  { id: 'dark', label: 'Dark map', src: imgMapDark, crop: 'top-[-29.53%] left-[-68.58%] h-[163.26%] w-[251.04%]' },
  { id: 'light', label: 'Light map', src: imgMapLight, crop: 'top-[-34.37%] left-[-62.43%] h-[190.41%] w-[292.79%]' },
];
const SLOPE_LABELS = { rainbow: 'Rainbow', muted: 'Muted', beam: 'Beam', aurora: 'Aurora', indigo: 'Indigo' };

// A palette as a CSS gradient, low slope (faint) to steep, at `angle`. Built from the palette data
// so the menu always shows exactly what the map draws.
const paletteGradient = (stops, angle = 90) =>
  `linear-gradient(${angle}deg, ${stops
    .filter(([pct]) => pct <= 100)
    .map(([pct, r, g, b, a]) => `rgba(${r}, ${g}, ${b}, ${a}) ${pct}%`)
    .join(', ')})`;

// One choice: ringed in metal when it's the active one. The 2 px inset leaves room for the ring
// around the swatch inside.
function Choice({ active, label, onClick, radius, className = '', children }) {
  return (
    <Metal variant="button" active={active} className="theme-choice">
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        className={`block cursor-pointer bg-transparent p-0.5 ${className}`}
        style={{ borderRadius: radius }}
      >
        <span className="relative block size-full overflow-hidden" style={{ borderRadius: radius - 2 }}>
          {children}
        </span>
      </button>
    </Metal>
  );
}

// onChange receives a partial theme ({ map }, { slope } or { opacity }).
export default function ThemeMenu({ theme, onChange }) {
  // The button turns metal while its menu is open.
  const [open, setOpen] = useState(false);
  const stops = SLOPE_PALETTES[theme.map === 'light' ? 'light' : 'dark'];
  return (
    <Popover onOpenChange={setOpen}>
      <Metal active={open}>
        <PopoverTrigger className={`${METAL_HOST} size-10`} aria-label="Map and slope colors">
          <Layers size={18} strokeWidth={1.75} />
        </PopoverTrigger>
      </Metal>
      <PopoverPanel
        side="left"
        align="end"
        sideOffset={12}
        // .quiet-panel is unlayered, so it wins over the popover's own bg/border/shadow utilities.
        className="quiet-panel flex w-[176px] flex-col items-center gap-4 rounded-[24px] border-0 px-4 py-5"
        style={SANS}
      >
        <section className="flex w-full flex-col items-center gap-2">
          <h3 className={LABEL}>Map Style</h3>
          <div className="flex w-[138px] gap-3">
            {MAPS.map((m) => (
              <Choice
                key={m.id}
                active={theme.map === m.id}
                label={m.label}
                onClick={() => onChange({ map: m.id })}
                radius={16}
                className="h-14 w-[63px]"
              >
                <img alt="" src={m.src} className={`pointer-events-none absolute max-w-none opacity-80 ${m.crop}`} />
              </Choice>
            ))}
          </div>
        </section>
        <section className="flex w-full flex-col items-center gap-4">
          <h3 className={LABEL}>Slope Colors</h3>
          <div className="flex flex-col gap-4">
            {SLOPE_PALETTE_IDS.map((id) => (
              <Choice
                key={id}
                active={theme.slope === id}
                label={`${SLOPE_LABELS[id]} slope colors`}
                onClick={() => onChange({ slope: id })}
                radius={4}
                className="h-5 w-36"
              >
                <span className="absolute inset-0" style={{ backgroundImage: paletteGradient(stops[id]) }} />
              </Choice>
            ))}
          </div>
        </section>
        <section className="flex w-full flex-col items-center gap-2">
          <h3 className={LABEL}>Slope Opacity</h3>
          <div className="flex gap-3">
            {OPACITY_OPTIONS.map((value) => (
              <Choice
                key={value}
                active={theme.opacity === value}
                label={`Slope opacity ${Math.round(value * 100)}%`}
                onClick={() => onChange({ opacity: value })}
                radius={12}
                className="size-10"
              >
                {/* The current palette, shown at this opacity. */}
                <span
                  className="absolute inset-0"
                  style={{ backgroundImage: paletteGradient(stops[theme.slope] ?? stops.rainbow, 135), opacity: value }}
                />
              </Choice>
            ))}
          </div>
        </section>
      </PopoverPanel>
    </Popover>
  );
}
