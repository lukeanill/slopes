import { Popover, PopoverTrigger, PopoverPanel } from '@lukeanill/ui/components/animate-ui/components/base/popover';
import iconSwatchesLight from './assets/theme/swatches-light-icon.svg';
import iconSwatchesDark from './assets/theme/swatches-dark-icon.svg';
import imgMapDark from './assets/theme/map-dark.jpg';
import imgMapLightBase from './assets/theme/map-light-base.png';
import imgMapLightOverlay from './assets/theme/map-light-overlay.jpg';

// Theme menu from the SLOPES Figma (nodes 10:90 / 10:135 button, 10:94 / 10:123 menu): pick the
// basemap (which also flips the UI between dark and light glass) and the slope palette.
// The Figma's Söhne isn't loaded; Inter stands in, as elsewhere.
const SANS = { fontFamily: "'Inter', system-ui, sans-serif", fontWeight: 400 };

// Each palette's swatch, from the design's "Rainbow / Muted / Beam Radial" styles: the palette
// radiating out from the steepest color at the center to the faint 0% color at the rim.
const radial = (stops) => `radial-gradient(circle closest-side, ${stops.map(([c, o]) => `${c} ${o}%`).join(', ')})`;
const SLOPE_OPTIONS = [
  {
    id: 'rainbow',
    label: 'Rainbow',
    swatch: radial([
      ['rgba(175,49,55,1)', 0], ['rgba(175,49,55,1)', 10], ['rgba(192,88,68,1)', 15], ['rgba(208,126,80,1)', 20],
      ['rgba(200,164,55,1)', 25], ['rgba(191,202,29,1)', 30], ['rgba(150,197,58,1)', 35], ['rgba(109,192,87,1)', 40],
      ['rgba(62,175,109,1)', 45], ['rgba(39,167,119,1)', 47.5], ['rgba(15,158,130,1)', 50], ['rgba(38,135,149,0.95)', 55],
      ['rgba(61,111,168,0.9)', 60], ['rgba(107,86,187,0.8)', 70], ['rgba(137,67,147,0.7)', 80], ['rgba(137,67,147,0.1)', 100],
    ]),
  },
  {
    id: 'muted',
    label: 'Muted',
    swatch: radial([
      ['rgba(237,128,51,1)', 0], ['rgba(237,129,52,1)', 10], ['rgba(245,165,86,1)', 20], ['rgba(250,200,122,1)', 30],
      ['rgba(250,223,153,1)', 40], ['rgba(251,245,183,1)', 50], ['rgba(228,241,188,0.9)', 60], ['rgba(177,234,202,0.8)', 70],
      ['rgba(125,229,223,0.7)', 80], ['rgba(125,229,223,0.1)', 100],
    ]),
  },
  {
    id: 'beam',
    label: 'Beam',
    swatch: radial([
      ['rgba(250,197,30,1)', 0], ['rgba(250,197,30,1)', 10], ['rgba(249,148,43,1)', 20], ['rgba(236,111,59,1)', 30],
      ['rgba(215,77,80,1)', 40], ['rgba(190,47,101,1)', 50], ['rgba(164,27,120,0.95)', 55], ['rgba(138,7,138,0.9)', 60],
      ['rgba(102,4,142,0.85)', 65], ['rgba(65,1,145,0.8)', 70], ['rgba(38,1,132,0.7)', 80], ['rgba(38,1,132,0.1)', 100],
    ]),
  },
];

// 2px ring on the chosen option — white on the dark glass, black on the light glass.
const selectedRing = (selected) => (selected ? 'border-2 border-[var(--glass-selected)]' : 'border-2 border-transparent');
const LABEL = 'text-[13px] leading-[1.4] tracking-[0.13px] opacity-80';

function MapThumb({ theme }) {
  // Crops copied from the design's image fills.
  return theme === 'dark' ? (
    <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[10px] bg-[#d9d9d9]">
      <img alt="" src={imgMapDark} className="absolute top-[-29.53%] left-[-68.58%] h-[163.26%] w-[251.04%] max-w-none" />
    </span>
  ) : (
    <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[10px]">
      <img alt="" src={imgMapLightBase} className="absolute size-full max-w-none object-cover" />
      <img alt="" src={imgMapLightOverlay} className="absolute top-[-34.37%] left-[-62.43%] h-[190.41%] w-[292.79%] max-w-none" />
    </span>
  );
}

// onChange receives a partial theme ({ map } or { slope }).
export default function ThemeMenu({ theme, onChange }) {
  return (
    <Popover>
      <PopoverTrigger
        className="map-control-btn rounded-full"
        aria-label="Map and slope colors"
      >
        <img
          src={theme.map === 'light' ? iconSwatchesDark : iconSwatchesLight}
          alt=""
          width={24}
          height={24}
          className="block shrink-0"
          draggable={false}
        />
      </PopoverTrigger>
      <PopoverPanel
        side="left"
        align="end"
        sideOffset={12}
        // The popover's own bg/text/border/shadow utilities would beat .glass, so restate them.
        className="glass flex w-[186px] flex-col items-center gap-6 rounded-[24px] border-[var(--glass-border)] bg-[var(--glass-bg)] p-6 text-[var(--glass-fg)] shadow-[inset_0_1px_0_var(--glass-highlight),0_4px_16px_var(--glass-shadow)] backdrop-blur-xl"
        style={SANS}
      >
        <section className="flex flex-col items-center gap-4">
          <h3 className={LABEL}>MAP</h3>
          <div className="flex w-[138px] gap-3">
            {['dark', 'light'].map((id) => (
              <button
                key={id}
                type="button"
                aria-label={`${id === 'dark' ? 'Dark' : 'Light'} map`}
                aria-pressed={theme.map === id}
                onClick={() => onChange({ map: id })}
                className={`relative h-[52px] flex-1 cursor-pointer rounded-[12px] transition-[border-color] ${selectedRing(theme.map === id)}`}
              >
                <MapThumb theme={id} />
              </button>
            ))}
          </div>
        </section>
        <section className="flex flex-col items-center gap-4">
          <h3 className={LABEL}>SLOPE</h3>
          <div className="flex w-[138px] gap-2">
            {SLOPE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-label={`${option.label} slope colors`}
                aria-pressed={theme.slope === option.id}
                onClick={() => onChange({ slope: option.id })}
                className={`aspect-square flex-1 cursor-pointer rounded-full transition-[border-color] ${selectedRing(theme.slope === option.id)}`}
                style={{ backgroundImage: option.swatch }}
              />
            ))}
          </div>
        </section>
      </PopoverPanel>
    </Popover>
  );
}
