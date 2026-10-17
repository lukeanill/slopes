import { useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipPanel } from '@lukeanill/ui/components/animate-ui/components/base/tooltip';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@lukeanill/ui/components/sheet';
import { Toaster, toast } from '@lukeanill/ui/components/toast';
import AddressSearchBar from './AddressSearchBar.jsx';
import AboutPanel from './AboutPanel.jsx';
import MessagePanel from './MessagePanel.jsx';
import StatusMessage from './StatusMessage.jsx';
import FlybyControl, { MAX_SCENES } from './FlybyControl.jsx';
import { textOnColor } from './colorContrast.js';
import SlopeDistributionChart from './SlopeDistributionChart.jsx';
import { initSlopeMap } from './slopeMap.js';
import ThemeMenu from './ThemeMenu.jsx';
import { THEME_KEY, ThemeContext, loadTheme } from './theme.js';

// Griffith Park / Hollywood Hills — biases address autosuggest toward this app's actual
// coverage area (LA parcels/zoning only resolve here anyway), independent of the map's
// default landing zoom/center in slopeMap.js.
const SEARCH_PROXIMITY = [-118.335827, 34.106652];

// Street-type suffixes that mark where the street name ends and the city name begins in the
// county's "<street> <city> <state> <zip>" format (city can be multiple words, e.g. "Los
// Angeles") — used to insert commas around the city, since nothing else in the raw string marks
// that boundary.
const STREET_TYPES = new Set([
  'ST', 'AVE', 'BLVD', 'DR', 'RD', 'LN', 'WAY', 'CT', 'PL', 'TER', 'CIR', 'PKWY', 'HWY', 'TRL', 'LOOP', 'WALK',
]);

// The county's SitusFullAddress comes back SHOUTING IN ALL CAPS with no punctuation — title-case
// it for display (keeping single-letter directionals like N/S/E/W and the state code uppercase),
// and add the commas a real address needs before/after the city.
function titleCaseAddress(address) {
  const words = address.split(' ');
  const cased = words.map((word, i) => {
    if (/^\d+$/.test(word)) return word;
    if (/^[A-Z]$/.test(word)) return word;
    if (i === words.length - 2 && /^[A-Z]{2}$/.test(word)) return word;
    return word.charAt(0) + word.slice(1).toLowerCase();
  });

  let streetEndIndex = -1;
  for (let i = 0; i < words.length; i++) {
    if (STREET_TYPES.has(words[i].toUpperCase())) streetEndIndex = i;
  }
  const stateIndex = words.length - 2;
  if (streetEndIndex !== -1 && streetEndIndex < stateIndex - 1) {
    cased[streetEndIndex] += ',';
    cased[stateIndex - 1] += ',';
  }
  return cased.join(' ');
}

// "<STREET> <CITY> <STATE> <ZIP>" → "Street, Zip" for the recent-parcels cards.
function streetAndZip(address) {
  const words = address.split(' ');
  let streetEndIndex = -1;
  for (let i = 0; i < words.length; i++) {
    if (STREET_TYPES.has(words[i].toUpperCase())) streetEndIndex = i;
  }
  const zip = /^\d{5}/.test(words[words.length - 1]) ? words[words.length - 1].slice(0, 5) : null;
  const street = streetEndIndex === -1 ? words.slice(0, Math.max(1, words.length - 3)) : words.slice(0, streetEndIndex + 1);
  const cased = street.map((w) => (/^\d+$/.test(w) || /^[A-Z]$/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()));
  return zip ? `${cased.join(' ')}, ${zip}` : cased.join(' ');
}

// The parcel sheet uses the same dark glass as the search, About and recent-parcel controls, and
// floats inset from the edge with rounded corners like the About panels. Text and inner surfaces
// come from overriding the design tokens on the sheet itself, so everything inside (and the
// sheet's own close button) follows. The Sheet merges className with tailwind-merge, so these
// replace its default edge-to-edge sizing and opaque background.
const PARCEL_SHEET_CLASS = [
  'overflow-y-auto',
  'data-[side=right]:inset-y-3 data-[side=right]:right-3 data-[side=right]:h-auto',
  'glass rounded-[28px] border-[var(--glass-border)] data-[side=right]:border',
  'bg-[var(--glass-bg-panel)] backdrop-blur-xl',
  'shadow-[inset_0_1px_0_var(--glass-highlight),0_8px_32px_var(--glass-shadow)]',
].join(' ');
const PARCEL_SHEET_THEME = {
  '--popover-foreground': 'var(--glass-fg)',
  '--foreground': 'var(--glass-fg)',
  '--muted': 'var(--glass-tint)',
  '--border': 'var(--glass-tint-border)',
  '--accent': 'var(--glass-tint)',
  '--accent-foreground': 'var(--glass-fg)',
};

// Parcels clicked this session, most recent first, capped at 10 (the oldest drops off).
// Kept in sessionStorage so a reload in the same tab doesn't lose them.
const HISTORY_KEY = 'slopes:parcel-history';
const HISTORY_LIMIT = 10;
function loadHistory() {
  try {
    return JSON.parse(sessionStorage.getItem(HISTORY_KEY)) ?? [];
  } catch {
    return [];
  }
}

// Panning keeps retrying the parcel query, so cap the toast at one per PARCEL_ERROR_COOLDOWN_MS
// rather than stacking a new one on every failed request.
const PARCEL_ERROR_COOLDOWN_MS = 30000;
let lastParcelErrorAt = 0;
function notifyParcelError() {
  const now = Date.now();
  if (now - lastParcelErrorAt < PARCEL_ERROR_COOLDOWN_MS) return;
  lastParcelErrorAt = now;
  toast.add({
    title: "We're having difficulty showing LA County parcel lines",
    description: 'Try again shortly.',
  });
}

// Flyby scenes are kept only in this browser's localStorage.
const FLYBY_KEY = 'slopes:flyby-scenes';
function loadScenes() {
  try {
    const scenes = JSON.parse(localStorage.getItem(FLYBY_KEY));
    return Array.isArray(scenes) ? scenes.slice(0, MAX_SCENES) : [];
  } catch {
    return [];
  }
}

// Applied before React renders so a saved light theme doesn't flash dark glass first.
document.documentElement.dataset.theme = loadTheme().map;

function MapApp() {
  const mapRef = useRef(null);
  const [slopeHover, setSlopeHover] = useState(null);
  const [selectedParcel, setSelectedParcel] = useState(null);
  const [bandHover, setBandHover] = useState(null);
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState(loadHistory);
  const [searchOpen, setSearchOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  const [scenes, setScenes] = useState(loadScenes);
  const [theme, setTheme] = useState(loadTheme);
  // The map theme the UI is showing right now — lags `theme.map` while the map cross-fades, since
  // the glass flips as the dissolve starts. JS-driven colors (shimmer, card text) key off this.
  const [uiMapTheme, setUiMapTheme] = useState(() => document.documentElement.dataset.theme);
  const [playingIndex, setPlayingIndex] = useState(null);
  const [reordering, setReordering] = useState(false);
  const flybyPlaying = playingIndex != null;
  // While a flyby plays the slot keeps its controls (Stop): the camera dips below zoom 11 between
  // distant scenes, and messages about the view mid-flight would only flicker over them.
  const slotStatus = flybyPlaying ? null : status;

  useEffect(() => {
    try {
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {
      // storage unavailable — history just won't survive a reload
    }
  }, [history]);

  // A click fires onParcelSelect again once zoning resolves; dedupe by AIN so that (and
  // re-clicking a parcel) moves it to the top instead of adding a duplicate.
  useEffect(() => {
    const p = selectedParcel;
    if (!p?.ain || !p.center || !p.stats?.sampleCount) return;
    const entry = {
      ain: p.ain,
      title: p.address ? streetAndZip(p.address) : `Parcel ${p.ain}`,
      label: p.stats.summaryLabel.charAt(0).toUpperCase() + p.stats.summaryLabel.slice(1),
      labelColor: p.stats.summaryColor,
      mode: Math.round(p.stats.modePercent),
      modeColor: p.stats.modeColor,
      min: Math.round(p.stats.minPercent),
      max: Math.round(p.stats.maxPercent),
      center: p.center,
    };
    setHistory((prev) => {
      if (prev[0]?.ain === entry.ain) return prev;
      return [entry, ...prev.filter((h) => h.ain !== entry.ain)].slice(0, HISTORY_LIMIT);
    });
  }, [selectedParcel]);

  useEffect(() => {
    try {
      localStorage.setItem(FLYBY_KEY, JSON.stringify(scenes.map(({ label, ...scene }) => scene)));
    } catch {
      // storage unavailable — scenes just won't survive a reload
    }
  }, [scenes]);

  // The light basemap flips every glass surface to dark-on-light (CSS tokens keyed off <html
  // data-theme>, so portaled menus and the sheet follow too). The flip waits for the map's
  // cross-fade to start, so the glass changes along with the map rather than over the old one.
  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, JSON.stringify(theme));
    } catch {
      // storage unavailable — the theme just won't survive a reload
    }
    let stale = false;
    Promise.resolve(mapRef.current?.setMapStyle(theme.map)).then(() => {
      if (stale) return;
      document.documentElement.dataset.theme = theme.map;
      setUiMapTheme(theme.map);
    });
    mapRef.current?.setSlopePalette(theme.slope);
    mapRef.current?.setSlopeOpacity(theme.opacity);
    return () => {
      stale = true;
    };
  }, [theme]);

  // Markers follow the scene list (and its order); clicking one flies to that scene.
  useEffect(() => {
    const map = mapRef.current;
    map?.setFlybyScenes(scenes, (i) => map.flyToScene(scenes[i]));
  }, [scenes]);

  function addScene() {
    const camera = mapRef.current?.getCamera();
    if (!camera) return;
    setScenes((prev) => (prev.length >= MAX_SCENES ? prev : [...prev, { id: crypto.randomUUID(), ...camera }]));
  }

  function playFlyby() {
    const map = mapRef.current;
    if (!map || scenes.length === 0) return;
    setPlayingIndex(0);
    // Loops until stopped; stopFlyby / onFlybyInterrupted clear playingIndex.
    map.playFlyby(scenes, setPlayingIndex);
  }

  function stopFlyby() {
    mapRef.current?.stopFlyby();
    setPlayingIndex(null);
  }

  useEffect(() => {
    if (!flybyPlaying && !reordering) return;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (flybyPlaying) stopFlyby();
      else setReordering(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flybyPlaying, reordering]);

  useEffect(() => {
    mapRef.current = initSlopeMap({
      onSlopeHover: setSlopeHover,
      onParcelSelect: setSelectedParcel,
      onStatusChange: setStatus,
      onParcelError: notifyParcelError,
      mapStyle: theme.map,
      slopePalette: theme.slope,
      slopeOpacity: theme.opacity,
    });
    mapRef.current.onFlybyInterrupted(() => setPlayingIndex(null));
    mapRef.current.setFlybyScenes(scenes, (i) => mapRef.current.flyToScene(scenes[i]));
    return () => mapRef.current?.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the map is created once
  }, []);

  return (
    <ThemeContext.Provider value={{ ...theme, map: uiMapTheme }}>
    <div id="app" data-search-open={searchOpen || undefined} data-sheet-open={selectedParcel ? true : undefined}
      data-about-open={aboutOpen || messageOpen || undefined} data-panel={aboutOpen ? 'about' : messageOpen ? 'message' : undefined} data-flyby-playing={flybyPlaying || undefined}
    >
      <div id="map"></div>
      {/* Marks the exact point being measured; the chip sits beside it rather than above, since in
          a tilted view "above" is a different patch of ground with a different color. */}
      {slopeHover && <div className="slope-hover-marker" style={{ left: slopeHover.x, top: slopeHover.y }} />}
      <Tooltip open={!!slopeHover}>
        <TooltipTrigger render={<span style={{ display: 'none' }} />} />
        <TooltipPanel
          className="slope-tooltip-panel"
          side="right"
          sideOffset={14}
          anchor={{
            getBoundingClientRect: () => {
              const x = slopeHover?.x ?? 0;
              const y = slopeHover?.y ?? 0;
              return { x, y, width: 0, height: 0, top: y, left: x, right: x, bottom: y };
            },
          }}
          style={slopeHover ? { backgroundColor: slopeHover.color, color: slopeHover.textColor } : undefined}
        >
          {slopeHover && `${Math.round(slopeHover.percent)}% (${slopeHover.degrees.toFixed(1)}°)`}
        </TooltipPanel>
      </Tooltip>
      <Sheet open={!!selectedParcel} onOpenChange={(open) => { if (!open) mapRef.current?.clearSelection(); }}>
        <SheetContent side="right" className={PARCEL_SHEET_CLASS} style={PARCEL_SHEET_THEME}>
          <SheetHeader className="items-center gap-3 px-8 pt-16 pb-8 text-center">
            {selectedParcel?.stats?.sampleCount > 0 && (
              <span
                className="rounded-full px-3 py-1 text-xs font-semibold capitalize"
                style={{ backgroundColor: selectedParcel.stats.summaryColor, color: textOnColor(selectedParcel.stats.summaryColor) }}
              >
                {selectedParcel.stats.summaryLabel}
              </span>
            )}
            <SheetTitle className="w-full text-lg leading-snug text-balance break-words">
              {selectedParcel?.address ? titleCaseAddress(selectedParcel.address) : `Parcel ${selectedParcel?.ain ?? ''}`}
            </SheetTitle>
          </SheetHeader>
          {selectedParcel?.stats?.sampleCount === 0 ? (
            <p className="px-8 text-foreground/75">No slope data available yet for this parcel. Zoom in or pan closer and try again.</p>
          ) : selectedParcel?.stats ? (
            <div className="flex flex-col gap-8 px-8 pb-10">
              <div className="text-foreground">
                <SlopeDistributionChart samples={selectedParcel.stats.samples} onHover={setBandHover} />
                <Tooltip open={!!bandHover}>
                  <TooltipTrigger render={<button type="button" style={{ display: 'none' }} />} />
                  <TooltipPanel
                    side="top"
                    sideOffset={14}
                    anchor={{
                      getBoundingClientRect: () => {
                        const x = bandHover?.x ?? 0;
                        const y = bandHover?.y ?? 0;
                        return { x, y, width: 0, height: 0, top: y, left: x, right: x, bottom: y };
                      },
                    }}
                  >
                    {bandHover && `${bandHover.pct}% slope`}
                  </TooltipPanel>
                </Tooltip>
              </div>
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="flex flex-col gap-1 rounded-xl bg-muted px-3 py-4">
                  <div className="text-lg font-bold text-foreground">
                    {Math.round(selectedParcel.stats.minPercent)}-{Math.round(selectedParcel.stats.maxPercent)}%
                  </div>
                  <div className="text-xs text-foreground/60">Slope range</div>
                </div>
                <div className="flex flex-col gap-1 rounded-xl bg-muted px-3 py-4">
                  <div className="text-lg font-bold text-foreground">
                    {Math.round(selectedParcel.stats.modePercent)}%
                  </div>
                  <div className="text-xs text-foreground/60">Most prevalent</div>
                </div>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 border-t border-border pt-6 text-sm">
                <dt className="text-foreground/60">APN</dt>
                <dd className="text-foreground">{selectedParcel.ain ?? '—'}</dd>
                <dt className="text-foreground/60">Zoning</dt>
                <dd className="text-foreground">
                  {selectedParcel.zoningLoading ? (
                    <span className="inline-block h-3 w-24 animate-pulse rounded bg-muted" />
                  ) : selectedParcel.zoning?.city === 'Los Angeles' ? (
                    // ZIMAS is the City of LA's own zoning lookup — only useful for parcels in the City.
                    <a className="inline-flex items-center gap-1 font-medium hover:underline" href="https://zimas.lacity.org/" target="_blank" rel="noopener noreferrer">
                      {selectedParcel.zoning.code}
                      <ExternalLink size={12} strokeWidth={2.25} />
                    </a>
                  ) : selectedParcel.zoning ? (
                    `${selectedParcel.zoning.code}${selectedParcel.zoning.city ? ` · ${selectedParcel.zoning.city}` : ''}`
                  ) : (
                    'Unavailable'
                  )}
                </dd>
              </dl>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
      <div className="search-control fixed top-4 left-4 z-10">
        <AddressSearchBar
          proximity={SEARCH_PROXIMITY}
          onSelectAddress={({ lng, lat }) => mapRef.current?.goToAddress(lng, lat)}
          history={history}
          onSelectHistory={({ center: [lng, lat] }) => mapRef.current?.goToAddress(lng, lat)}
          onOpenChange={setSearchOpen}
        />
      </div>
      {/* Top-right: Message and About, each opening its own overlay; the other steps aside. */}
      <div className="top-actions fixed top-4 right-4 z-[60] flex items-center gap-2">
        <MessagePanel onOpenChange={setMessageOpen} />
        <AboutPanel onOpenChange={setAboutOpen} />
      </div>
      <StatusMessage
        uiMapTheme={uiMapTheme}
        status={slotStatus}
        flyby={!slotStatus ? (
          <FlybyControl
            scenes={scenes}
            playingIndex={playingIndex}
            reordering={reordering}
            onAdd={addScene}
            onPlay={playFlyby}
            onStop={stopFlyby}
            onStartReorder={() => {
              setScenes((prev) => prev.map((scene, i) => ({ ...scene, label: i + 1 })));
              setReordering(true);
            }}
            onReorder={setScenes}
            onEndReorder={() => {
              setScenes((prev) => prev.map(({ label, ...scene }) => scene));
              setReordering(false);
            }}
            onStartOver={() => {
              setReordering(false);
              setScenes([]);
            }}
          />
        ) : null}
      />
      <div id="map-controls">
        <ThemeMenu theme={theme} onChange={(patch) => setTheme((t) => ({ ...t, ...patch }))} />
        <div id="zoom-level" aria-label="Current zoom level"></div>
        <button id="reset-bearing" className="map-control-btn" type="button" aria-label="Reset to north"></button>
        <div className="map-control-zoom-pill">
          <button id="zoom-in" className="map-control-btn map-control-btn-top" type="button" aria-label="Zoom in"></button>
          <button id="zoom-out" className="map-control-btn map-control-btn-bottom" type="button" aria-label="Zoom out"></button>
        </div>
      </div>
      <div id="bottom-bar">
        <div id="gradient-wrap">
          <div id="gradient-bar"></div>
          <div id="gradient-tooltip"></div>
        </div>
        <div id="controls">
          <button id="reset-view" className="icon-btn" type="button" aria-label="Reset view"></button>
        </div>
      </div>
    </div>
    </ThemeContext.Provider>
  );
}

export default function App() {
  return (
    <Toaster>
      <MapApp />
    </Toaster>
  );
}
