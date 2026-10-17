import { useEffect, useState } from 'react';
import SlopeDistributionChart from './SlopeDistributionChart.jsx';
import { SLOPE_PALETTES, SLOPE_PALETTE_IDS } from './slopeMap.js';
import imgBase from './assets/onboarding/base.jpg';
import imgRainbow from './assets/onboarding/rainbow.jpg';
import imgMuted from './assets/onboarding/muted.jpg';
import imgBeam from './assets/onboarding/beam.jpg';
import imgAurora from './assets/onboarding/aurora.jpg';
import imgIndigo from './assets/onboarding/indigo.jpg';
import imgParcel from './assets/onboarding/parcel.jpg';
import imgFly1 from './assets/onboarding/fly1.jpg';
import imgFly2 from './assets/onboarding/fly2.jpg';
import imgFly3 from './assets/onboarding/fly3.jpg';
import parcel from './assets/onboarding/parcel.json';

// The onboarding walkthrough's clips (Onboarding.jsx). Every frame is a real capture of the app's
// map (dark map, Rainbow unless noted) at 2× the 635 × 185 slot — Griffith Park and the Hollywood
// Hills, a selected hillside parcel in Beverly Crest with its real slope samples, and three flyby
// scenes — animated here. Reduced motion shows each clip's finished state.

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Steps through `durations` (ms per step) on a loop; returns the current step index.
function useLoop(durations) {
  const [step, setStep] = useState(() => (reducedMotion() ? durations.length - 2 : 0));
  useEffect(() => {
    if (reducedMotion()) return undefined;
    const id = setTimeout(() => setStep((s) => (s + 1) % durations.length), durations[step]);
    return () => clearTimeout(id);
  }, [step, durations]);
  return step;
}

const Img = ({ src, className = '', style }) => (
  <img src={src} alt="" draggable={false} className={`pointer-events-none absolute inset-0 h-full w-full object-cover ${className}`} style={style} />
);

// The app's status pill, as it reads while slope loads.
const Pill = ({ children, className = '' }) => (
  <div
    className={`absolute top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-[#1d1d1d] px-3 py-1.5 text-[10px] font-medium whitespace-nowrap text-[#f8f8f8] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] transition-opacity duration-300 ${className}`}
  >
    {children}
  </div>
);

// 1 · Instant slope analysis: tiles load the way the map loads them — the plain map, striped
// "pending" tiles, then slope tile by tile from the middle out.
const COLS = 10;
const ROWS = 3;
const TILE_ORDER = Array.from({ length: COLS * ROWS }, (_, i) => i)
  .map((i) => {
    const c = i % COLS, r = Math.floor(i / COLS);
    // Middle out, with a little jitter so it reads like network order rather than a sweep.
    const d = Math.hypot((c - (COLS - 1) / 2) / 1.6, r - (ROWS - 1) / 2);
    return { i, d: d + ((i * 7919) % 13) / 13 };
  })
  .sort((a, b) => a.d - b.d)
  .map(({ i }) => i);
const REVEAL_AT = Object.fromEntries(TILE_ORDER.map((tile, k) => [tile, k]));
// plain map → stripes → tiles in (one per step) → hold → fade back
const LOAD_STEPS = [900, 700, ...TILE_ORDER.map(() => 70), 2600, 700];
function InstantClip() {
  const step = useLoop(LOAD_STEPS);
  const tilesIn = step - 2; // tiles revealed so far (negative before loading starts)
  const loading = step >= 1 && tilesIn < TILE_ORDER.length;
  const resetting = step === LOAD_STEPS.length - 1;
  return (
    <div className="relative h-full w-full overflow-hidden">
      <Img src={imgBase} />
      <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)`, gridTemplateRows: `repeat(${ROWS}, 1fr)` }}>
        {Array.from({ length: COLS * ROWS }, (_, i) => {
          const c = i % COLS, r = Math.floor(i / COLS);
          const shown = !resetting && REVEAL_AT[i] < tilesIn;
          return (
            <div key={i} className="relative">
              <div className={`onb-stripes absolute inset-0 transition-opacity duration-200 ${loading && !shown ? 'opacity-100' : 'opacity-0'}`} />
              <div
                className={`absolute inset-0 transition-opacity duration-300 ${shown ? 'opacity-100' : 'opacity-0'}`}
                style={{
                  backgroundImage: `url(${imgRainbow})`,
                  backgroundSize: `${COLS * 100}% ${ROWS * 100}%`,
                  backgroundPosition: `${(c / (COLS - 1)) * 100}% ${(r / (ROWS - 1)) * 100}%`,
                }}
              />
            </div>
          );
        })}
      </div>
      <Pill className={loading ? 'opacity-100' : 'opacity-0'}>Pulling slope analysis</Pill>
    </div>
  );
}

// 2 · Parcel level insights: a selected hillside parcel, and its sheet — the app's own chart with
// the parcel's real samples.
const PARCEL_STEPS = [800, 600, 3400, 500];
function ParcelClip() {
  const step = useLoop(PARCEL_STEPS);
  const open = step === 1 || step === 2;
  const { stats } = parcel;
  return (
    <div className="relative h-full w-full overflow-hidden">
      <Img src={imgParcel} />
      <div
        className={`absolute top-2 right-2 bottom-2 flex w-[42%] max-w-[230px] flex-col gap-2 rounded-[12px] bg-[rgba(29,29,29,0.92)] p-2.5 text-[#f8f8f8] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] transition-all duration-500 ease-out ${open ? 'translate-x-0 opacity-100' : 'translate-x-6 opacity-0'}`}
      >
        <div className="flex items-center gap-2">
          <span className="rounded-full px-2 py-0.5 text-[9px] font-semibold capitalize text-black" style={{ backgroundColor: stats.summaryColor }}>
            {stats.summaryLabel}
          </span>
          <span className="truncate text-[11px] font-medium">{parcel.address || `Parcel ${parcel.ain}`}</span>
        </div>
        <div className={`onb-chart min-h-0 flex-1 ${open ? 'is-open' : ''}`}>
          <SlopeDistributionChart samples={stats.samples} />
        </div>
        <div className="grid grid-cols-2 gap-1.5 text-center">
          <div className="rounded-[8px] bg-white/[0.06] py-1">
            <div className="text-[12px] font-bold">
              {Math.round(stats.minPercent)}-{Math.round(stats.maxPercent)}%
            </div>
            <div className="text-[8px] opacity-60">Slope range</div>
          </div>
          <div className="rounded-[8px] bg-white/[0.06] py-1">
            <div className="text-[12px] font-bold">{Math.round(stats.modePercent)}%</div>
            <div className="text-[8px] opacity-60">Most prevalent</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// 3 · Customize the look: the same view in each palette, with the theme menu's picker.
const PALETTE_IMAGES = { rainbow: imgRainbow, muted: imgMuted, beam: imgBeam, aurora: imgAurora, indigo: imgIndigo };
const PALETTE_STEPS = SLOPE_PALETTE_IDS.map(() => 1800);
const gradient = (stops) =>
  `linear-gradient(90deg, ${stops.filter(([p]) => p <= 100).map(([p, r, g, b, a]) => `rgba(${r},${g},${b},${a}) ${p}%`).join(', ')})`;
function CustomizeClip() {
  const active = useLoop(PALETTE_STEPS);
  return (
    <div className="relative h-full w-full overflow-hidden">
      {SLOPE_PALETTE_IDS.map((id, i) => (
        <Img key={id} src={PALETTE_IMAGES[id]} className="transition-opacity duration-700" style={{ opacity: i === active ? 1 : 0 }} />
      ))}
      <div className="absolute top-2 right-2 flex flex-col gap-1.5 rounded-[12px] bg-[rgba(29,29,29,0.92)] p-2.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
        <span className="text-[8px] text-[#f8f8f8] opacity-80">Slope Colors</span>
        {SLOPE_PALETTE_IDS.map((id, i) => (
          <span
            key={id}
            className={`block h-2 w-20 rounded-[3px] transition-[box-shadow] duration-300 ${i === active ? 'shadow-[0_0_0_1.5px_#f8f8f8]' : ''}`}
            style={{ backgroundImage: gradient(SLOPE_PALETTES.dark[id]) }}
          />
        ))}
      </div>
    </div>
  );
}

// 4 · Make a flyby video: three scenes, drifting like the camera, with the flyby control on top.
const FLY_IMAGES = [imgFly1, imgFly2, imgFly3];
const FLY_STEPS = [2600, 2600, 2600];
function FlybyClip() {
  const scene = useLoop(FLY_STEPS);
  return (
    <div className="relative h-full w-full overflow-hidden">
      {FLY_IMAGES.map((src, i) => (
        <Img key={src} src={src} className={`transition-opacity duration-700 ${i === scene ? 'onb-drift' : ''}`} style={{ opacity: i === scene ? 1 : 0 }} />
      ))}
      <div className="absolute top-2.5 left-1/2 flex -translate-x-1/2 items-center gap-1.5 text-[11px] text-[#f8f8f8]">
        <span className="flex size-6 items-center justify-center rounded-full bg-[#272727] shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.55)]">
          <span className="block size-2 rounded-[1.5px] bg-[#f8f8f8]" />
        </span>
        <span className="flex h-6 items-center gap-2.5 rounded-full bg-[#272727] px-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)]">
          {FLY_IMAGES.map((src, i) => (
            <span key={src} className="transition-opacity duration-300" style={{ opacity: i > scene ? 0.4 : 1 }}>
              {i + 1}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

export default function OnboardingClip({ step }) {
  if (step === 0) return <InstantClip />;
  if (step === 1) return <ParcelClip />;
  if (step === 2) return <CustomizeClip />;
  return <FlybyClip />;
}
