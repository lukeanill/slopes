import mapboxgl from 'mapbox-gl';
import { listGridKeys, loadGrid, saveGrid } from './slopeStore.js';
import iconPlusSimple from './icons/PlusSimple.svg?raw';
import iconMinusSimple from './icons/MinusSimple.svg?raw';
import iconNorth from './icons/North.svg?raw';
import iconCrosshairSimple from './icons/CrosshairSimple.svg?raw';

// Initializes the slope map into the DOM elements already rendered by <MapApp/>.
// Returns the mapboxgl.Map instance (plus a clearSelection() method) so the caller can clean
// it up on unmount and clear a parcel selection from React.
// onSlopeHover(info | null) fires as the cursor moves over the slope layer, with
// info = { x, y, percent, degrees } in map-container pixel coordinates.
// onParcelSelect(info | null) fires when a parcel is clicked (info = { ain, address, stats, center,
// zoning, zoningLoading }, called again once zoning resolves) or deselected (null).
// onParcelError() fires when LA County's parcel lines fail to load or time out.
// onStatusChange(info | null) fires with { kind: 'prompt', text } when zoomed out too far to
// render slope, { kind: 'loading', label } while fetching/rendering/finishing a new tile grid,
// or null once idle (nothing to show).
// Map-wide zoom bounds: below SLOPE_MIN_ZOOM slope isn't shown.
export const MAP_MIN_ZOOM = 4.5;
export const SLOPE_MIN_ZOOM = 11;

// Slope palettes from the SLOPES Figma ("New Slope Gradients"): Rainbow, Muted and Beam, each with
// a version tuned for the dark map and one for the light map — they share the steep end and differ
// in the faint low-slope colors, which have to read against that basemap. Design stops are at
// 0/20/30/…/90/100%; the top color is held out to 150% so every palette has one stop per
// BAND_DESCRIPTORS entry. All fade to fully transparent at 0%.
const PCTS = [0, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const palette = (colors) => {
  const stops = colors.map((c, i) => [PCTS[i], ...c]);
  return [...stops, [150, ...colors[colors.length - 1]]];
};
const STEEP = {
  rainbow: [[15, 158, 130, 1], [109, 192, 87, 1], [191, 202, 29, 1], [208, 126, 80, 1], [175, 49, 55, 1], [175, 49, 55, 1]],
  muted: [[251, 245, 183, 1], [250, 223, 153, 1], [250, 200, 122, 1], [245, 165, 86, 1], [237, 129, 52, 1], [237, 128, 51, 1]],
  beam: [[190, 47, 101, 1], [215, 77, 80, 1], [236, 111, 59, 1], [249, 148, 43, 1], [250, 197, 30, 1], [250, 197, 30, 1]],
};
export const SLOPE_PALETTES = {
  dark: {
    rainbow: palette([[67, 42, 125, 0], [67, 42, 125, 0.4], [107, 86, 187, 0.6], [61, 111, 168, 0.8], ...STEEP.rainbow]),
    muted: palette([[72, 131, 128, 0], [72, 131, 128, 0.4], [177, 234, 202, 0.6], [228, 241, 188, 0.8], ...STEEP.muted]),
    beam: palette([[41, 24, 84, 0], [41, 24, 84, 0.4], [65, 1, 145, 0.6], [138, 7, 138, 0.8], ...STEEP.beam]),
  },
  light: {
    rainbow: palette([[162, 131, 166, 0], [162, 131, 166, 0.4], [107, 86, 187, 0.6], [61, 111, 168, 0.8], ...STEEP.rainbow]),
    muted: palette([[184, 226, 223, 0], [184, 226, 223, 0.4], [177, 234, 202, 0.6], [228, 241, 188, 0.8], ...STEEP.muted]),
    beam: palette([[97, 78, 146, 0], [97, 78, 146, 0.4], [65, 1, 145, 0.6], [138, 7, 138, 0.8], ...STEEP.beam]),
  },
};
const paletteFor = (mapStyle, name) => SLOPE_PALETTES[mapStyle]?.[name] ?? SLOPE_PALETTES.dark.rainbow;

// The palette currently on the map. Module-level so UI that colors by slope (the parcel chart,
// hover chip, badges) always matches the layer.
let activeStops = SLOPE_PALETTES.dark.rainbow;
export function getRampStops() {
  return activeStops;
}

// A palette as a Mapbox `raster-color` expression over the layer's decoded slope percent.
function rasterColorFor(stops) {
  return ['interpolate', ['linear'], ['raster-value'], ...stops.flatMap(([pct, r, g, b, a]) => [pct, `rgba(${r}, ${g}, ${b}, ${a})`])];
}

export const MAP_STYLES = {
  dark: 'mapbox://styles/bzyluke/cmv97y6cz002m01qu25z7awxg', // Slopes Dark (flat land)
  light: 'mapbox://styles/bzyluke/cmv8hknck010t01s0digaae2t',
};

export function initSlopeMap({ onSlopeHover, onParcelSelect, onStatusChange, onParcelError, mapStyle = 'dark', slopePalette = 'rainbow' } = {}) {
  let currentMapStyle = MAP_STYLES[mapStyle] ? mapStyle : 'dark';
  let currentPalette = slopePalette;
  activeStops = paletteFor(currentMapStyle, currentPalette);
  const token = import.meta.env.VITE_MAPBOX_TOKEN;
  const els = {
    zoomLevel: document.getElementById('zoom-level'),
    zoomIn: document.getElementById('zoom-in'),
    zoomOut: document.getElementById('zoom-out'),
    resetBearing: document.getElementById('reset-bearing'),
    resetView: document.getElementById('reset-view'),
    gradientBar: document.getElementById('gradient-bar'),
    gradientTooltip: document.getElementById('gradient-tooltip'),
  };

  if (!token) {
    console.error('Missing VITE_MAPBOX_TOKEN — copy .env.example to .env.local and add your Mapbox token.');
    throw new Error('VITE_MAPBOX_TOKEN is not set');
  }
  mapboxgl.accessToken = token;

  const DEFAULT_CAMERA = {
    center: [-117.0, 34.6], // wide Southern California overview — Bakersfield/Vegas down to San Diego
    zoom: 6.4,
    bearing: 0,
    pitch: 0,
  };

  const MAX_ZOOM = 20;

  // DOM listeners/timers here outlive the map unless torn down with it — React StrictMode mounts,
  // removes, and re-mounts in dev, and the first instance's leftovers kept driving the shared
  // controls (zoom buttons, zoom readout, status pill) and erroring against the removed map.
  const listeners = new AbortController();
  const listen = (el, type, fn, opts) => el.addEventListener(type, fn, { ...opts, signal: listeners.signal });

  const map = new mapboxgl.Map({
    container: 'map',
    style: MAP_STYLES[currentMapStyle],
    minZoom: MAP_MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    ...DEFAULT_CAMERA,
  });

  // Both styles are Standard-based, so their basemap labels live in an import fragment —
  // there's no setPaintProperty/setLayoutProperty access to those layers, only the fixed set
  // of config toggles the style exposes. text-transform/letter-spacing aren't among them
  // (Studio-only); label color and hiding transit labels are. The dark style needs light labels
  // for contrast; the light style keeps its own.
  function applyLabelStyling() {
    if (currentMapStyle === 'dark') {
      map.setConfigProperty('basemap', 'colorPlaceLabels', '#ffffff');
      map.setConfigProperty('basemap', 'colorRoadLabels', '#ffffff');
    }
    map.setConfigProperty('basemap', 'showTransitLabels', false);
  }

  // One land color everywhere, at every zoom. Mapbox Standard varies the ground by itself — it
  // lightens built-up areas zoomed out, draws countryside from its own land-cover data (which
  // ignores the style's land color), and adds land-use areas (parks, airports, farmland…) — and
  // all of that showed through the semi-transparent low slopes as shapes and tone shifts. So a
  // flat layer in the style's own land color covers Standard's ground (the 'bottom' slot sits above
  // its land, land-use and water polygons but below roads, buildings and labels), and water is
  // redrawn on top of it from Mapbox Streets in the style's water color. Both read their colors
  // from the active style's config, so Studio stays the source of truth for dark and light.
  const FLAT_LAND_ID = 'flat-land';
  const FLAT_WATER_ID = 'flat-water';
  // A background layer (no source needed) in the 'bottom' slot — the same layers the uploadable
  // styles in mapbox-styles/ carry, so this only adds them to styles that don't have them yet.
  // Colors are read live from the basemap's config, so they always follow Studio's land/water.
  const LAND_COLOR = ['config', 'colorLand', 'basemap'];
  const WATER_COLOR = ['config', 'colorWater', 'basemap'];
  // App-side ground colors per map, applied over whatever the style's flat layers carry (keep these
  // in step with the style in Studio, or remove an entry to use the style's own colors).
  const GROUND_COLORS = {
    // Buildings: Standard's building color (its lighting shades it, so it renders a little
    // differently from the value itself).
    // Sky: dark haze at the horizon that blends into the land, near-black above, faint stars.
    dark: {
      land: 'hsl(206, 8%, 18%)',
      water: 'hsl(204, 13%, 27%)',
      buildings: '#FFE0A8', // warm on purpose: night lighting tints buildings blue, so this renders neutral grey
      sky: {
        color: 'hsl(206, 10%, 14%)',
        'high-color': 'hsl(214, 30%, 9%)',
        'space-color': 'hsl(220, 30%, 4%)',
        'horizon-blend': 0.08,
        'star-intensity': 0.35,
      },
    },
  };
  function applyGroundColors() {
    const colors = GROUND_COLORS[currentMapStyle];
    if (!colors) return;
    if (map.getLayer(FLAT_LAND_ID)) map.setPaintProperty(FLAT_LAND_ID, 'background-color', colors.land);
    if (map.getLayer(FLAT_WATER_ID)) map.setPaintProperty(FLAT_WATER_ID, 'fill-color', colors.water);
    if (colors.buildings) map.setConfigProperty('basemap', 'colorBuildings', colors.buildings);
    if (colors.sky) map.setFog({ ...map.getFog(), ...colors.sky });
  }
  function addFlatGround() {
    if (map.getLayer(FLAT_LAND_ID)) return applyGroundColors();
    map.addLayer({
      id: FLAT_LAND_ID,
      type: 'background',
      slot: 'bottom',
      paint: { 'background-color': LAND_COLOR, 'background-emissive-strength': 1 }, // emissive: unaffected by lighting
    });
    if (map.getSource('composite') && !map.getLayer(FLAT_WATER_ID)) {
      map.addLayer({
        id: FLAT_WATER_ID,
        type: 'fill',
        source: 'composite',
        'source-layer': 'water',
        slot: 'bottom',
        paint: { 'fill-color': WATER_COLOR, 'fill-emissive-strength': 1 },
      });
    }
    applyGroundColors();
  }

  // Mapbox Standard auto-selects a lightPreset based on real-world time of day if left unset,
  // which made the map's look drift depending on when you opened it — pin it explicitly. The dark
  // map uses night lighting so buildings and photo-textured landmarks (Dodger Stadium, the Aon
  // Center…) render dark; the land and water are the app's own emissive layers (addFlatGround),
  // so night lighting no longer dims them away from the picked colors. This also re-runs after
  // setMapStyle swaps the style.
  map.on('style.load', () => {
    map.setConfigProperty('basemap', 'lightPreset', currentMapStyle === 'dark' ? 'night' : 'day');
    applyLabelStyling();
    addFlatGround();
    addSlopeLayer(); // added first so parcels/selection/preview layers draw above it
    addParcelLayer();
    addSelectionLayer();
    map.getSource(SELECTED_FILL_SRC_ID)?.setData(selectedFC);
    map.getSource(SELECTED_LINE_SRC_ID)?.setData(selectedFC);
    addPreviewLayer();
    scheduleParcelRefresh(0);
  });

  // The gradient bar's stops are positioned by percent-of-width (0-100), so cursor position
  // maps directly to slope percent — no separate scale to keep in sync with the color ramp.
  listen(els.gradientBar, 'mousemove', (e) => {
    const rect = els.gradientBar.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const pct = Math.round(t * 100);
    els.gradientTooltip.textContent = `${pct}%`;
    els.gradientTooltip.style.left = `${t * rect.width}px`;
    els.gradientTooltip.classList.add('visible');
  });
  listen(els.gradientBar, 'mouseleave', () => {
    els.gradientTooltip.classList.remove('visible');
  });

  els.zoomIn.innerHTML = iconPlusSimple;
  els.zoomOut.innerHTML = iconMinusSimple;
  els.resetBearing.innerHTML = iconNorth;
  els.resetView.innerHTML = iconCrosshairSimple;

  // Rounded down, not to nearest — toFixed showed 10.96 as "11.0" while slope (which needs a
  // real zoom of 11) still said "Zoom in to 11".
  const updateZoomLevel = () => { els.zoomLevel.textContent = (Math.floor(map.getZoom() * 10 + 1e-9) / 10).toFixed(1); };
  updateZoomLevel();
  map.on('zoom', updateZoomLevel);

  listen(els.zoomIn, 'click', () => map.zoomIn());
  listen(els.zoomOut, 'click', () => map.zoomOut());
  listen(els.resetBearing, 'click', () => map.easeTo({ bearing: 0, pitch: map.getPitch() }));
  listen(els.resetView, 'click', () => map.easeTo(DEFAULT_CAMERA));

  // USGS's live slope WMS turned out to be unreliable server-side (intermittent 400/502/504 on
  // identical requests) and Mapbox has no slope tileset of its own — so slope is computed here,
  // client-side, from Mapbox's own terrain-RGB elevation tiles (reliable CDN, real CORS support).
  // Terrain-RGB encodes elevation in meters as: -10000 + (R*65536 + G*256 + B) * 0.1
  const DEM_URL = (z, x, y) =>
    `https://api.mapbox.com/v4/mapbox.terrain-rgb/${z}/${x}/${y}.pngraw?access_token=${mapboxgl.accessToken}`;

  // Interpolates the active palette for a slope percent.
  function percentToColor(pct) {
    const stops = activeStops;
    if (pct <= stops[0][0]) return stops[0].slice(1);
    for (let i = 1; i < stops.length; i++) {
      if (pct <= stops[i][0]) {
        const [p0, r0, g0, b0, a0] = stops[i - 1];
        const [p1, r1, g1, b1, a1] = stops[i];
        const t = (pct - p0) / (p1 - p0);
        return [r0 + (r1 - r0) * t, g0 + (g1 - g0) * t, b0 + (b1 - b0) * t, a0 + (a1 - a0) * t];
      }
    }
    return stops[stops.length - 1].slice(1);
  }
  // 4 tiers matching the ramp's color families — used for the popover's summary badge.
  // One descriptor per palette stop (every palette has the same number of stops).
  const BAND_DESCRIPTORS = ['flat', 'minor', 'minor', 'minor', 'moderate', 'moderate', 'moderate', 'steep', 'steep', 'very steep', 'very steep'];
  function bandSolidColor(idx) {
    if (idx === 0) return '#424563';
    const [r, g, b] = percentToColor(activeStops[idx][0]);
    return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
  }
  function summaryForPercent(pct) {
    const stops = activeStops;
    let idx = 0;
    for (let i = 0; i < stops.length; i++) if (pct >= stops[i][0]) idx = i;
    return { label: BAND_DESCRIPTORS[idx], color: bandSolidColor(idx) };
  }

  function lngLatToTileFrac(lng, lat, z) { // fractional tile coords — integer part is the tile, remainder is position within it
    const n = 2 ** z;
    const x = ((lng + 180) / 360) * n;
    const latRad = (lat * Math.PI) / 180;
    const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
    return { x, y };
  }
  function lngLatToTile(lng, lat, z) {
    const { x, y } = lngLatToTileFrac(lng, lat, z);
    return { x: Math.floor(x), y: Math.floor(y) };
  }
  function tileToLngLat(x, y, z) { // top-left corner of the tile
    const n = 2 ** z;
    const lng = (x / n) * 360 - 180;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
    return { lng, lat };
  }
  function metersPerPixel(lat, z, tileSize) {
    return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z * (256 / tileSize);
  }

  const MIN_ZOOM = SLOPE_MIN_ZOOM; // camera zoom below which slope isn't shown
  const TILE_SIZE = 256;
  const SLOPE_SRC_ID = 'slope-src';
  const SLOPE_LAYER_ID = 'slope';
  const NO_DATA = 65535; // grid sentinel for "no slope here" (a failed DEM tile) — renders transparent

  // Slope is computed from DEM tiles in a worker ("analysis" grids), at a detail level that suits
  // the zoom you're looking at, and coarser display tiles average those slope values:
  //   display ≤12 → averaged from z13 analysis (~16 m/px): a fresh zoom-11 view is ~¼ the DEM
  //                 download of z14 (~10 MB rather than ~38 MB), so new areas appear in seconds
  //   display z13 → z13 analysis itself (camera 11.5–12.5)
  //   display z14 → z14 analysis (~8 m/px, camera 12.5–13.5)
  //   display z15 → z15 analysis (~4 m/px, terrain-RGB's max, camera 13.5+). z15 carries real
  //                 detail beyond z14 (measured: ~0.6 m mean / ~3 m max difference from an
  //                 upsampled z14 over these hills) — capping at z14 made close zooms soft.
  // Finer data reads a little steeper; it arrives silently as you zoom in, over the coarser slope
  // already on screen. Zooming out, tiles are assembled from whatever finer slope is saved (see
  // gridAt), so an area you've explored stays visible at every zoom without re-downloading.
  // Mapbox overscales z15 for closer zooms; those tiles' values are upsampled 3x (see encodeGridUpsampled).
  const BASE_ZOOM = 14;
  const DETAIL_ZOOM = 15;
  const OVERVIEW_ZOOM = 13;
  const DISPLAY_MIN_ZOOM = 12; // camera zoom 11 draws 256px tiles at z12
  const SOURCE_MIN_ZOOM = 5; // lowest zoom the coverage bookkeeping (saved-slope index) tracks
  // Around the slope zoom the layer cross-fades with the camera zoom: fully visible from MIN_ZOOM,
  // fading out to nothing by FADE_OUT_ZOOM. Between the two, only slope that's already saved is
  // shown (nothing new is analysed below MIN_ZOOM), so zooming out of an area eases it away and
  // zooming back in eases it back.
  const FADE_OUT_ZOOM = 10.5;
  const analysisZoomFor = (displayZoom) => (displayZoom >= DETAIL_ZOOM ? DETAIL_ZOOM : displayZoom >= BASE_ZOOM ? BASE_ZOOM : OVERVIEW_ZOOM);

  // z13–z15 analysis grids, keyed `${z}:${x}:${y}` — the canonical slope data. Display tiles are
  // derived from these, and hover/parcel lookups read them directly (a color baked into a tile
  // can't be reversed back into a percent). Stored as percent × 10 in a Uint16Array (0.1%
  // precision) — half the memory of Float32 so more of the area you've explored stays cached.
  const gridCache = new Map();
  const GRID_CACHE_LIMIT = 800;
  // Display grids for z12 and below, averaged down from analysis grids — cheap to rebuild, but cached
  // so Mapbox re-requesting an evicted tile doesn't redo the averaging.
  const displayCache = new Map();
  const DISPLAY_CACHE_LIMIT = 200;
  function cacheLru(cache, limit, key, grid) {
    cache.delete(key); // re-insert so recently used tiles are evicted last
    cache.set(key, grid);
    if (cache.size > limit) cache.delete(cache.keys().next().value);
  }

  // Small worker pool for fetch + decode + slope math. Jobs wait in a main-thread queue until a
  // worker has room, newest first, and are dropped there once nobody wants them: a fly-to or a
  // fast zoom requests tiles at every zoom along the way, and running those after Mapbox had
  // cancelled them left the view you actually landed on waiting behind them for seconds.
  const MAX_JOBS_PER_WORKER = 8; // jobs are network-bound (~1 ms of math vs ~0.4 s of DEM fetches), so keep plenty in flight
  const workerJobs = new Map(); // id → job, while running on a worker
  const jobQueue = [];
  let nextJobId = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1)) }, () => {
    const worker = new Worker(new URL('./slopeWorker.js', import.meta.url), { type: 'module' });
    const entry = { worker, busy: 0 };
    worker.onmessage = ({ data: { id, grid, error } }) => {
      entry.busy--;
      const job = workerJobs.get(id);
      workerJobs.delete(id);
      if (error) job?.reject(new Error(error));
      else job?.resolve(grid);
      pumpJobs();
    };
    return entry;
  });
  // Jobs prefer a "home" worker picked by neighborhood (4×4-tile blocks), so the analyses that
  // share DEM tiles land on the same worker and reuse its decoded-tile cache instead of each
  // downloading and decoding them again. Any idle worker takes a job whose home is full, so
  // nothing waits while a worker sits empty.
  // Background-fill jobs (see backgroundFill) are the lowest priority: they only run when no job
  // for the view is waiting, and at most BG_MAX_RUNNING at a time, so they never slow down slope
  // you're actually looking at.
  const BG_MAX_RUNNING = 2;
  function pumpJobs() {
    const foregroundWaiting = jobQueue.some((j) => !j.background);
    let bgRunning = 0;
    for (const j of workerJobs.values()) if (j.background) bgRunning++;
    for (let i = jobQueue.length - 1; i >= 0; i--) { // newest first — the current view beats earlier requests
      const job = jobQueue[i];
      if (job.background && (foregroundWaiting || bgRunning >= BG_MAX_RUNNING)) continue;
      const home = workers[job.home];
      const target = home.busy < MAX_JOBS_PER_WORKER ? home : workers.find((w) => w.busy === 0);
      if (!target) continue;
      jobQueue.splice(i, 1);
      target.busy++;
      if (job.background) bgRunning++;
      workerJobs.set(job.id, job);
      target.worker.postMessage({ id: job.id, urls: job.urls, mpp: job.mpp });
    }
  }
  // Returns { promise, cancel }; cancel() only has an effect while the job is still queued.
  function queueWorkerJob(urls, mpp, x, y, background = false) {
    let job;
    const promise = new Promise((resolve, reject) => {
      const home = Math.abs(((x >> 2) * 73856093) ^ ((y >> 2) * 19349663)) % workers.length;
      job = { id: nextJobId++, urls, mpp, home, background, resolve, reject };
    });
    jobQueue.push(job);
    pumpJobs();
    const cancel = () => {
      const i = jobQueue.indexOf(job);
      if (i === -1) return false; // already running — let it finish; its result is cached
      jobQueue.splice(i, 1);
      job.reject(new DOMException('cancelled', 'AbortError'));
      return true;
    };
    return { promise, cancel, job };
  }

  // Analysis grid for one z14/z15 tile: memory → IndexedDB (a previous session) → worker. In-flight
  // requests are shared, so the display tiles at every zoom that need this tile wait on one job.
  // Each caller passes its tile's abort signal; the job is dropped from the queue only once every
  // caller has given up. Resolves null if the DEM tile failed or the job was dropped.
  const analysisInFlight = new Map(); // key → { promise, refs, cancel }

  // Index of what's saved in IndexedDB (loaded once at start, kept up to date as we save), so
  // coverage questions — "is any slope saved here, at any detail?" — are answered without reading
  // grids. savedAncestors holds every tile that has saved slope somewhere beneath it.
  // Store keys: analysis `${z}:${x}:${y}`, display `${DISPLAY_PREFIX}${z}:${x}:${y}`. The display
  // prefix was bumped from 'd:' when tiles with holes were found saved as complete; old entries
  // are simply never read again and age out of the store.
  const DISPLAY_PREFIX = 'd2:';
  const isAnalysisKey = (storeKey) => /^\d/.test(storeKey);
  const savedKeys = new Set();
  const savedAncestors = new Set();
  function noteSaved(storeKey) {
    savedKeys.add(storeKey);
    const [z, x, y] = storeKey.split(':').slice(-3).map(Number);
    for (let pz = z - 1, px = x >> 1, py = y >> 1; pz >= SOURCE_MIN_ZOOM; pz--, px >>= 1, py >>= 1) {
      const k = `${pz}:${px}:${py}`;
      if (savedAncestors.has(k)) break; // its ancestors were added along with it
      savedAncestors.add(k);
    }
  }
  function persist(storeKey, grid) {
    noteSaved(storeKey);
    saveGrid(storeKey, grid);
  }
  const savedIndexReady = listGridKeys().then((keys) => {
    keys.forEach(noteSaved);
    syncPendingLayer(); // tiles may now count as covered
  });
  const hasSlopeHere = (z, x, y) => {
    const key = `${z}:${x}:${y}`;
    return gridCache.has(key) || displayCache.has(key) || savedKeys.has(key) || savedKeys.has(`${DISPLAY_PREFIX}${key}`);
  };

  // New analysis only starts once the camera has been still for SETTLE_MS, so tiles Mapbox asks for
  // while you're mid-gesture — zooming in and straight back out, flicking past an area — are never
  // downloaded or computed. Saved slope still shows immediately while moving. A playing flyby is
  // always moving, so it doesn't wait (it would otherwise never load anything new).
  const SETTLE_MS = 400; // also covers zooming in to 11 and straight back out with only a short pause
  let cameraSettled = true;
  let settleTimer = null;
  let settleWaiters = [];
  map.on('movestart', () => {
    cameraSettled = false;
    clearTimeout(settleTimer);
  });
  map.on('moveend', () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      cameraSettled = true;
      // During a flyby, waiting requests keep waiting (they'd only be dropped) until it stops.
      if (!flybyPlaying) settleWaiters.splice(0).forEach((resolve) => resolve());
      syncLock();
      scheduleBackgroundFill();
    }, SETTLE_MS);
  });
  // A playing flyby never loads new slope: it shows only what's already saved, so the video is
  // free of loading activity. Its camera is always moving, so requests simply wait here until it
  // stops and the camera settles — then whatever is on screen loads as usual.
  function whenSettled() {
    if (cameraSettled && !flybyPlaying) return Promise.resolve();
    return new Promise((resolve) => settleWaiters.push(resolve));
  }

  // `background`: a quiet fill request (see backgroundFill) — runs at any camera zoom, at the
  // lowest priority. If the view needs the same tile, its request joins and keeps it alive.
  function getAnalysisGrid(z, x, y, signal, { background = false } = {}) {
    const key = `${z}:${x}:${y}`;
    const cached = gridCache.get(key);
    if (cached) {
      cacheLru(gridCache, GRID_CACHE_LIMIT, key, cached);
      return Promise.resolve(cached);
    }
    let entry = analysisInFlight.get(key);
    if (!entry) {
      entry = { refs: 0, cancel: null };
      entry.promise = (async () => {
        const stored = await loadGrid(key);
        if (stored) return stored;
        await whenSettled();
        // Everyone left during the IndexedDB lookup or the settle wait; below the slope zoom,
        // only saved slope is shown and nothing new is analysed.
        if (entry.refs === 0 || flybyPlaying || (!background && map.getZoom() < MIN_ZOOM)) throw new DOMException('cancelled', 'AbortError');
        const centerLat = tileToLngLat(x + 0.5, y + 0.5, z).lat;
        // The tile plus its 8 neighbors (row-major, center at index 4) so the worker can compute
        // slope across tile edges instead of clamping there.
        const urls = [];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) urls.push(DEM_URL(z, x + dx, y + dy));
        }
        const job = queueWorkerJob(urls, metersPerPixel(centerLat, z, TILE_SIZE), x, y, background);
        entry.cancel = job.cancel;
        entry.job = job.job;
        startNetworkLoad();
        try {
          const grid = await job.promise;
          persist(key, grid);
          zoomedOutStale = true; // zoomed-out tiles assembled earlier don't include this yet
          return grid;
        } finally {
          endNetworkLoad();
        }
      })()
        .then((grid) => {
          cacheLru(gridCache, GRID_CACHE_LIMIT, key, grid);
          return grid;
        })
        .catch((err) => {
          if (err.name !== 'AbortError' && !removed) console.error('DEM tile failed', key, err);
          return null;
        })
        .finally(() => {
          if (analysisInFlight.get(key) === entry) analysisInFlight.delete(key);
        });
      analysisInFlight.set(key, entry);
    }
    entry.refs++;
    if (!background && entry.job?.background) {
      entry.job.background = false; // the view needs it now — no longer a low-priority fill job
      pumpJobs();
    }
    signal?.addEventListener('abort', () => {
      // Forget a dropped job right away so a later request starts fresh instead of joining it.
      if (--entry.refs === 0 && entry.cancel?.()) analysisInFlight.delete(key);
    }, { once: true });
    return entry.promise;
  }

  // Grid for a display tile `d`: the analysis grid at its detail level, or 2×2-averaged down from
  // finer grids (recursively, via gridAt).
  // Tiles coarser than DISPLAY_MIN_ZOOM are zoomed-out views: they're only ever assembled from saved
  // slope, never analysed. That's decided by the tile's own zoom, not the camera's: a zoomed-out
  // tile still loading when you zoom back in would otherwise analyse everything beneath it — a
  // z10 tile spans ~40 km.
  function getDisplayGrid(d, x, y, signal) {
    return gridAt(d, x, y, analysisZoomFor(d), signal, d < DISPLAY_MIN_ZOOM);
  }

  // Whether slope for this whole tile is saved at finer detail (so it can be assembled rather
  // than analysed or downloaded again).
  function savedBeneath(z, x, y) {
    if (hasSlopeHere(z, x, y)) return true;
    if (z >= DETAIL_ZOOM || !savedAncestors.has(`${z}:${x}:${y}`)) return false;
    return [0, 1, 2, 3].every((i) => savedBeneath(z + 1, x * 2 + (i & 1), y * 2 + (i >> 1)));
  }

  async function gridAt(z, x, y, n, signal, savedOnly) {
    const key = `${z}:${x}:${y}`;
    const belowSlopeZoom = savedOnly || map.getZoom() < MIN_ZOOM;
    if (z >= n) {
      // Analysis level. Prefer finer slope that's already saved over analysing this tile afresh
      // (e.g. you arrived at zoom 17 by search, then zoomed out).
      if (!hasSlopeHere(z, x, y) && z < DETAIL_ZOOM && savedBeneath(z, x, y)) return assemble(z, x, y, z + 1, signal, savedOnly);
      if (belowSlopeZoom && !hasSlopeHere(z, x, y)) return null; // zoomed out: saved slope only
      return getAnalysisGrid(z, x, y, signal);
    }
    const cached = displayCache.get(key);
    if (cached) {
      cacheLru(displayCache, DISPLAY_CACHE_LIMIT, key, cached);
      return cached;
    }
    // Averaged display tiles are saved too, so revisiting an area zoomed out reads one tile
    // instead of the tiles under it.
    if (savedKeys.has(`${DISPLAY_PREFIX}${key}`)) {
      const stored = await loadGrid(`${DISPLAY_PREFIX}${key}`);
      if (stored) {
        cacheLru(displayCache, DISPLAY_CACHE_LIMIT, key, stored);
        return stored;
      }
    }
    if (belowSlopeZoom && !savedAncestors.has(key)) return null; // nothing saved under it
    return assemble(z, x, y, n, signal, savedOnly);
  }

  // Averages the four z+1 children into one 256px grid (each output pixel is the mean of the 2×2
  // child pixels under it, ignoring no-data). Complete tiles are cached and saved; tiles with
  // holes (children not loaded) aren't, so a later request can fill them in.
  const partialGrids = new WeakSet(); // assembled grids with holes (children not loaded yet)
  async function assemble(z, x, y, n, signal, savedOnly) {
    const children = await Promise.all(
      [0, 1, 2, 3].map((i) => gridAt(z + 1, x * 2 + (i & 1), y * 2 + (i >> 1), n, signal, savedOnly))
    );
    if (!children.some(Boolean)) return null;
    const out = new Uint16Array(TILE_SIZE * TILE_SIZE).fill(NO_DATA);
    const half = TILE_SIZE / 2;
    children.forEach((child, i) => {
      if (!child) return;
      const ox = (i & 1) * half, oy = (i >> 1) * half;
      for (let py = 0; py < half; py++) {
        for (let px = 0; px < half; px++) {
          const r0 = py * 2 * TILE_SIZE + px * 2, r1 = r0 + TILE_SIZE;
          let sum = 0, count = 0;
          for (const v of [child[r0], child[r0 + 1], child[r1], child[r1 + 1]]) {
            if (v !== NO_DATA) { sum += v; count++; }
          }
          if (count) out[(oy + py) * TILE_SIZE + ox + px] = Math.round(sum / count);
        }
      }
    });
    const key = `${z}:${x}:${y}`;
    // Complete only if every child is present and itself complete — a child with holes passed up
    // as if whole made its parent save (and keep serving) the holes after they'd been filled in.
    if (children.every((c) => c && !partialGrids.has(c))) {
      cacheLru(displayCache, DISPLAY_CACHE_LIMIT, key, out);
      persist(`${DISPLAY_PREFIX}${key}`, out);
      return out;
    }
    partialGrids.add(out);
    if (savedOnly || map.getZoom() < MIN_ZOOM) {
      zoomedOutStale = true; // holes from "saved slope only" — refresh once more slope is saved
    }
    return out;
  }


  // Tiles carry slope *values*, not colors: the GPU blends neighboring values, then maps each
  // screen pixel to a color via the layer's `raster-color` (see addSlopeLayer). Baking colors on
  // the CPU instead meant the GPU stretched a colored image — at zoom 19–20 each image pixel
  // covered ~10–20 screen px and every sharp color change showed the pixel grid as a sawtooth.
  // Encoding: slope % in the red channel, byte = pct × 255/ENCODE_MAX_PCT (~0.6% steps). One
  // channel keeps the GPU's blending correct (splitting 16 bits across two channels wraps).
  // Alpha 0 marks no data.
  const ENCODE_MAX_PCT = 160;
  const ENCODE_SCALE = 255 / (ENCODE_MAX_PCT * 10); // grid stores percent × 10
  const encodeValue = (v) => Math.round(Math.min(ENCODE_MAX_PCT * 10, Math.max(0, v)) * ENCODE_SCALE);

  // A fully transparent tile, used whenever a tile has no slope. Never resolve loadTile with null:
  // Mapbox then gives the tile a recycled texture from its pool without clearing it, so slope from
  // whichever tile last used that texture shows up in the wrong place.
  const EMPTY_TILE = new ImageData(TILE_SIZE, TILE_SIZE);

  function encodeGrid(grid) {
    const img = new ImageData(TILE_SIZE, TILE_SIZE);
    const d = img.data;
    for (let p = 0; p < grid.length; p++) {
      const v = grid[p];
      if (v === NO_DATA) continue; // stays transparent
      d[p * 4] = encodeValue(v);
      d[p * 4 + 3] = 255;
    }
    return img;
  }

  // Zoomed-in tiles are stretched far past their 256px (Mapbox overscales z15: 32x at zoom 20), so
  // their values are upsampled 3x with a separable Catmull-Rom (bicubic) kernel before encoding —
  // the GPU then blends a smooth value surface rather than a coarse one, keeping contours round.
  const UPSAMPLE = 3;
  const OUT_UP = TILE_SIZE * UPSAMPLE;
  // Catmull-Rom weights for the 4 taps at fractional offset t, precomputed per output phase.
  const CR_WEIGHTS = Array.from({ length: UPSAMPLE }, (_, phase) => {
    const t = ((phase + 0.5) / UPSAMPLE - 0.5 + 1) % 1; // fractional position between source px
    const t2 = t * t, t3 = t2 * t;
    return [
      (-t3 + 2 * t2 - t) / 2,
      (3 * t3 - 5 * t2 + 2) / 2,
      (-3 * t3 + 4 * t2 + t) / 2,
      (t3 - t2) / 2,
    ];
  });
  // Source index of the tap just before the sample point, per output coordinate.
  const CR_BASE = Int32Array.from({ length: OUT_UP }, (_, o) => Math.floor((o + 0.5) / UPSAMPLE - 0.5) - 1);
  const clampIdx = (i) => (i < 0 ? 0 : i > TILE_SIZE - 1 ? TILE_SIZE - 1 : i);

  function encodeGridUpsampled(grid) {
    // Horizontal pass: TILE_SIZE rows × OUT_UP cols. NaN marks no-data so it never blends in.
    const src = new Float32Array(grid.length);
    for (let p = 0; p < grid.length; p++) src[p] = grid[p] === NO_DATA ? NaN : grid[p];
    const rows = new Float32Array(TILE_SIZE * OUT_UP);
    for (let y = 0; y < TILE_SIZE; y++) {
      const r = y * TILE_SIZE;
      for (let o = 0; o < OUT_UP; o++) {
        const b = CR_BASE[o], w = CR_WEIGHTS[o % UPSAMPLE];
        const v0 = src[r + clampIdx(b)], v1 = src[r + clampIdx(b + 1)], v2 = src[r + clampIdx(b + 2)], v3 = src[r + clampIdx(b + 3)];
        let v = v0 * w[0] + v1 * w[1] + v2 * w[2] + v3 * w[3];
        if (Number.isNaN(v)) v = w[1] >= w[2] ? v1 : v2; // touching no-data: nearest instead of blending
        rows[y * OUT_UP + o] = v;
      }
    }
    // Vertical pass + encoding.
    const img = new ImageData(OUT_UP, OUT_UP);
    const d = img.data;
    for (let o = 0; o < OUT_UP; o++) {
      const b = CR_BASE[o], w = CR_WEIGHTS[o % UPSAMPLE];
      const r0 = clampIdx(b) * OUT_UP, r1 = clampIdx(b + 1) * OUT_UP, r2 = clampIdx(b + 2) * OUT_UP, r3 = clampIdx(b + 3) * OUT_UP;
      for (let x = 0; x < OUT_UP; x++) {
        let v = rows[r0 + x] * w[0] + rows[r1 + x] * w[1] + rows[r2 + x] * w[2] + rows[r3 + x] * w[3];
        if (Number.isNaN(v)) v = w[1] >= w[2] ? rows[r1 + x] : rows[r2 + x];
        if (Number.isNaN(v)) continue; // no data: transparent
        const i = (o * OUT_UP + x) * 4;
        d[i] = encodeValue(v);
        d[i + 3] = 255;
      }
    }
    return img;
  }

  // The tile zoom Mapbox is drawing right now: custom sources round (camera zoom + 1, since their
  // 256px tiles are half the 512px world tile size), clamped to the source's zoom range.
  function drawingZoom() {
    return Math.min(DETAIL_ZOOM, Math.max(DISPLAY_MIN_ZOOM, Math.round(map.getZoom() + 1)));
  }

  // Cached grid for tile z/x/y, whichever cache holds it (analysis grids for z14/15 analysis
  // tiles, display grids for averaged z12–14 tiles).
  function cachedGrid(z, x, y) {
    const key = `${z}:${x}:${y}`;
    return gridCache.get(key) ?? displayCache.get(key) ?? null;
  }

  // Bilinear sample (percent × 10) of a grid at fractional tile coords, matching how the GPU
  // blends the drawn tile. NO_DATA neighbors fall back to the nearest pixel.
  function sampleGrid(grid, frac) {
    const tx = Math.floor(frac.x), ty = Math.floor(frac.y);
    const last = TILE_SIZE - 1;
    const fx = Math.min(last, Math.max(0, (frac.x - tx) * TILE_SIZE - 0.5));
    const fy = Math.min(last, Math.max(0, (frac.y - ty) * TILE_SIZE - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(last, x0 + 1), y1 = Math.min(last, y0 + 1);
    const a = grid[y0 * TILE_SIZE + x0], b = grid[y0 * TILE_SIZE + x1], c = grid[y1 * TILE_SIZE + x0], d = grid[y1 * TILE_SIZE + x1];
    if (a === NO_DATA || b === NO_DATA || c === NO_DATA || d === NO_DATA) {
      return grid[Math.round(fy) * TILE_SIZE + Math.round(fx)];
    }
    const sx = fx - x0, sy = fy - y0;
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
  }

  // Slope value (percent × 10) at a point as currently drawn — from the grid of the tile zoom on
  // screen, so hover matches the colors you see (at zoom 12–13 that's the averaged display grid,
  // not the sharper analysis data underneath). Falls back to any other loaded grid; NO_DATA if the
  // point has none, undefined if nothing covering it is loaded.
  function slopeValueAt(lng, lat) {
    const drawn = drawingZoom();
    const order = [drawn, ...[DETAIL_ZOOM, BASE_ZOOM, OVERVIEW_ZOOM, 12].filter((z) => z !== drawn)];
    for (const z of order) {
      const frac = lngLatToTileFrac(lng, lat, z);
      const grid = cachedGrid(z, Math.floor(frac.x), Math.floor(frac.y));
      if (grid) return sampleGrid(grid, frac);
    }
    return undefined;
  }

  // Slope percent at a point as drawn, or null if it isn't loaded.
  function getSlopeAt(lng, lat) {
    const v = slopeValueAt(lng, lat);
    return v === undefined || v === NO_DATA ? null : v / 10;
  }

  // Status message state. The verb rotates per loading session so it doesn't feel static.
  const LOADING_VERBS = ['Pulling', 'Fetching', 'Grabbing', 'Summoning', 'Wrangling', 'Excavating', 'Conjuring', 'Divining'];
  let loadingLabel = '';
  let pendingTiles = 0; // analysis tiles being fetched/computed (not cache/IndexedDB hits)
  let lastStatusKey = null;
  let isFlatView = false; // set by evaluateFlatness() once the map settles
  // "Loading" starts only when real network work does (so panning over cached areas doesn't flash
  // it), then holds until nothing is downloading AND no display tile is still being assembled,
  // plus a short grace period — so it persists across gaps between batches instead of flickering
  // off and on, and only clears once the view's slope is fully loaded and cached.
  // It also waits LOADING_SHOW_DELAY_MS before appearing, so a few quick fetches mid-gesture
  // (e.g. zooming out through the threshold) don't flash it in and straight back out.
  let loadingActive = false;
  let loadingOnTimer = null;
  let loadingOffTimer = null;
  const LOADING_SHOW_DELAY_MS = 300;
  const LOADING_GRACE_MS = 400;
  let removed = false;
  function updateStatus() {
    if (removed) return; // a removed instance (e.g. StrictMode's discarded mount) must not drive the UI
    let status = null;
    if (map.getZoom() < MIN_ZOOM) status = { kind: 'prompt', text: 'Zoom in for slope analysis' };
    else if (loadingActive) status = { kind: 'loading', label: loadingLabel };
    else if (isFlatView) status = { kind: 'info', text: 'Little slope in this area' };
    const key = status ? `${status.kind}:${status.text ?? status.label}` : null;
    if (key === lastStatusKey) return;
    lastStatusKey = key;
    onStatusChange?.(status);
  }
  // The loading message (and the lock below) is only for areas with no slope on screen at all —
  // uncovered tiles. Adding detail where slope already shows (zooming in on a loaded area) is
  // silent.
  function refreshLoading() {
    clearTimeout(loadingOffTimer);
    const busy = !flybyPlaying && uncoveredPending() > 0; // a flyby shows no loading activity
    if (busy && !loadingActive) {
      if (!loadingOnTimer) {
        loadingOnTimer = setTimeout(() => {
          loadingOnTimer = null;
          if (flybyPlaying || uncoveredPending() === 0) return; // finished before it was worth showing
          loadingActive = true;
          loadingLabel = `${LOADING_VERBS[Math.floor(Math.random() * LOADING_VERBS.length)]} slope analysis`;
          updateStatus();
          syncLock();
        }, LOADING_SHOW_DELAY_MS);
      }
      return;
    }
    if (!loadingActive || busy) return;
    loadingOffTimer = setTimeout(() => {
      if (!flybyPlaying && uncoveredPending() > 0) return;
      loadingActive = false;
      updateStatus();
      syncLock();
      bgQueue = null; // a newly loaded area can create new gaps to fill between
      scheduleBackgroundFill();
      evaluateFlatness(); // the map may already have gone idle while we waited
    }, LOADING_GRACE_MS);
  }

  // While an area with no slope yet is loading, the map holds still: pan/zoom/rotate/tilt gestures
  // and the zoom/compass buttons are disabled until it's done. It only engages once the camera has
  // settled (never mid-gesture), never during a flyby, and lets go after LOCK_MAX_MS regardless so
  // a stalled load can't trap you. Search, recent parcels and flybys still move the camera.
  const LOCK_GESTURES = ['dragPan', 'scrollZoom', 'boxZoom', 'dragRotate', 'keyboard', 'doubleClickZoom', 'touchZoomRotate', 'touchPitch'];
  const LOCK_MAX_MS = 20000;
  let locked = false;
  let lockExpired = false;
  let lockTimer = null;
  function setLocked(on) {
    if (on === locked || removed) return;
    locked = on;
    for (const name of LOCK_GESTURES) map[name]?.[on ? 'disable' : 'enable']();
    for (const el of [els.zoomIn, els.zoomOut, els.resetBearing]) if (el) el.disabled = on;
    map.getContainer().classList.toggle('slope-locked', on);
    clearTimeout(lockTimer);
    if (on) {
      lockTimer = setTimeout(() => {
        lockExpired = true;
        setLocked(false);
      }, LOCK_MAX_MS);
    }
  }
  function syncLock() {
    if (!loadingActive) lockExpired = false;
    setLocked(loadingActive && cameraSettled && !flybyPlaying && !lockExpired);
  }

  function startNetworkLoad() {
    pendingTiles++;
    refreshLoading();
  }
  function endNetworkLoad() {
    pendingTiles--;
    refreshLoading();
  }

  // Loading placeholder: tiles Mapbox is waiting on get an animated stripe fill, so "not loaded
  // yet" never reads as "flat" (0% slope is near-transparent, so an empty tile looked identical
  // to level ground). Only tiles at the zoom Mapbox is actually drawing get one — it also
  // requests parent/prefetch tiles, which would otherwise stripe areas that are already shown.
  const PENDING_SRC_ID = 'slope-pending-src';
  const PENDING_LAYER_ID = 'slope-pending';
  const STRIPE_FRAMES = 8;
  const pendingDisplay = new Map(); // `${z}:${x}:${y}` → { z, x, y, covered }

  // Whether this tile's area already has slope to show — a coarser tile covering it, or finer
  // slope saved inside it (in memory or IndexedDB). Loading such a tile only adds detail, so it
  // happens silently — no stripes, no loading message, no lock. Only areas with no slope at all
  // get the loading treatment.
  function isCovered(z, x, y) {
    if (hasSlopeHere(z, x, y)) return true; // saved itself — it loads straight from the cache
    for (let pz = z - 1, px = x >> 1, py = y >> 1; pz >= SOURCE_MIN_ZOOM; pz--, px >>= 1, py >>= 1) {
      if (hasSlopeHere(pz, px, py)) return true;
    }
    if (savedAncestors.has(`${z}:${x}:${y}`)) return true;
    return z < DETAIL_ZOOM && [0, 1, 2, 3].some((i) => hasSlopeHere(z + 1, x * 2 + (i & 1), y * 2 + (i >> 1)));
  }
  const uncoveredPending = () => {
    let n = 0;
    for (const t of pendingDisplay.values()) if (!t.covered) n++;
    return n;
  };


  let pendingSyncQueued = false;
  function syncPendingLayer() {
    if (pendingSyncQueued || removed) return;
    pendingSyncQueued = true;
    requestAnimationFrame(() => {
      pendingSyncQueued = false;
      const src = map.getSource(PENDING_SRC_ID);
      if (!src) return;
      const z = drawingZoom();
      const features = [];
      for (const t of pendingDisplay.values()) {
        if (t.z !== z || t.covered || flybyPlaying) continue;
        const nw = tileToLngLat(t.x, t.y, t.z), se = tileToLngLat(t.x + 1, t.y + 1, t.z);
        features.push({
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [[[nw.lng, nw.lat], [se.lng, nw.lat], [se.lng, se.lat], [nw.lng, se.lat], [nw.lng, nw.lat]]] },
        });
      }
      src.setData({ type: 'FeatureCollection', features });
      setStripesAnimating(features.length > 0);
    });
  }
  map.on('zoom', syncPendingLayer); // the drawing zoom can change mid-gesture
  // Belt and braces: once the map settles, redraw the placeholders from the current set. An update
  // can be lost while a style swap replaces the source, which left stripes stuck over loaded tiles.
  map.on('idle', syncPendingLayer);

  // Phase-shifted copies of a diagonal stripe pattern; cycling through them makes the stripes
  // drift — a skeleton-style shimmer. Built at 2× for crisp edges on high-DPI screens.
  function addStripeImages() {
    const size = 32, period = 16;
    for (let f = 0; f < STRIPE_FRAMES; f++) {
      const id = `slope-loading-${f}`;
      if (map.hasImage(id)) continue;
      const data = new Uint8ClampedArray(size * size * 4);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const on = (x + y + f * (period / STRIPE_FRAMES)) % period < period / 2;
          data.set(on ? [255, 255, 255, 46] : [255, 255, 255, 14], (y * size + x) * 4);
        }
      }
      map.addImage(id, { width: size, height: size, data }, { pixelRatio: 2 });
    }
  }

  let stripeTimer = null;
  let stripeFrame = 0;
  function setStripesAnimating(on) {
    if (on && !stripeTimer && !removed) {
      stripeTimer = setInterval(() => {
        stripeFrame = (stripeFrame + 1) % STRIPE_FRAMES;
        if (map.getLayer(PENDING_LAYER_ID)) map.setPaintProperty(PENDING_LAYER_ID, 'fill-pattern', `slope-loading-${stripeFrame}`);
      }, 90);
    } else if (!on && stripeTimer) {
      clearInterval(stripeTimer);
      stripeTimer = null;
    }
  }

  // Slope is served as a Mapbox custom tile source rather than one big image of the viewport:
  // Mapbox decides which tiles the view needs, loads them as you pan/zoom (no waiting for the
  // gesture to end), keeps loaded tiles in its own cache, and shows a lower-zoom parent tile
  // while a sharper one loads — so explored areas stay visible instead of being swapped out.
  function createSlopeSource() {
    return {
      id: SLOPE_SRC_ID,
      type: 'custom',
      tileSize: TILE_SIZE,
      minzoom: DISPLAY_MIN_ZOOM,
      maxzoom: DETAIL_ZOOM, // Mapbox overscales z15 for closer zooms
      // Tilted toward the horizon, Mapbox asks for ever-coarser tiles out to the distance, and each
      // coarse tile here costs 4–16 detailed analyses. Only the near and mid ground get slope
      // (tiles no more than one zoom coarser than the view's own); the distance shows basemap.
      // Re-checked on every coverage update, so skipped tiles are never requested or cached.
      hasTile({ z }) {
        return z >= Math.min(DETAIL_ZOOM, Math.round(map.getZoom() + 1)) - 1;
      },
      async loadTile({ z, x, y }, { signal }) {
        const key = `${z}:${x}:${y}`;
        pendingDisplay.set(key, { z, x, y, covered: isCovered(z, x, y) });
        syncPendingLayer();
        refreshLoading();
        try {
          if (z >= DETAIL_ZOOM) {
            const grid = await getAnalysisGrid(DETAIL_ZOOM, x, y, signal);
            return signal.aborted || !grid ? EMPTY_TILE : encodeGridUpsampled(grid);
          }
          const grid = await getDisplayGrid(z, x, y, signal);
          return signal.aborted || !grid ? EMPTY_TILE : encodeGrid(grid);
        } finally {
          pendingDisplay.delete(key);
          syncPendingLayer();
          refreshLoading();
        }
      },
    };
  }

  // Zoomed out below the slope zoom, tiles are assembled from saved slope only, so they can have
  // holes, and Mapbox keeps tiles it has already drawn. When new slope has been saved (or tiles
  // were left with holes), reload the tiles as you cross the slope zoom — in either direction —
  // so zoomed-out views include everything you've explored and holes fill in once analysis is
  // allowed again. Mapbox attaches update() to the custom source implementation.
  let slopeSourceImpl = null;
  let zoomedOutStale = false;
  let wasBelowSlopeZoom = map.getZoom() < MIN_ZOOM;
  map.on('zoom', () => {
    const below = map.getZoom() < MIN_ZOOM;
    if (below === wasBelowSlopeZoom) return;
    wasBelowSlopeZoom = below;
    if (!zoomedOutStale) return;
    zoomedOutStale = false;
    slopeSourceImpl?.update?.();
  });

  function addSlopeLayer() {
    if (!map.getSource(SLOPE_SRC_ID)) {
      slopeSourceImpl = createSlopeSource();
      map.addSource(SLOPE_SRC_ID, slopeSourceImpl);
    }
    if (!map.getLayer(SLOPE_LAYER_ID)) {
      map.addLayer({
        id: SLOPE_LAYER_ID,
        type: 'raster',
        source: SLOPE_SRC_ID,
        minzoom: FADE_OUT_ZOOM,
        // Standard style's 'night' lightPreset dims the whole scene's ambient light, which
        // flattened this layer's colors no matter how much alpha/brightness was baked into the
        // pixels. raster-emissive-strength makes the layer render as self-lit, bypassing that.
        // No fade: tiles fading up from transparent read as briefly flatter than they are.
        // Full opacity: the ramp's own per-stop alpha already lets the basemap read through at low
        // slopes; an extra layer-wide reduction made 20–40% nearly invisible on the dark basemap.
        // Colors are applied on the GPU per screen pixel: tiles carry encoded slope (red channel,
        // 0–255 ↔ 0–ENCODE_MAX_PCT %), which is linearly blended and then mapped through the ramp.
        paint: {
          'raster-emissive-strength': 1,
          'raster-fade-duration': 0,
          'raster-opacity': ['interpolate', ['linear'], ['zoom'], FADE_OUT_ZOOM, 0, MIN_ZOOM, 1],
          'raster-resampling': 'linear',
          'raster-color-mix': [ENCODE_MAX_PCT, 0, 0, 0],
          'raster-color-range': [0, ENCODE_MAX_PCT],
          'raster-color': rasterColorFor(activeStops),
        },
      });
    }
    addStripeImages();
    if (!map.getSource(PENDING_SRC_ID)) map.addSource(PENDING_SRC_ID, { type: 'geojson', data: EMPTY_FC });
    if (!map.getLayer(PENDING_LAYER_ID)) {
      map.addLayer({
        id: PENDING_LAYER_ID,
        type: 'fill',
        source: PENDING_SRC_ID,
        minzoom: MIN_ZOOM,
        paint: { 'fill-pattern': `slope-loading-${stripeFrame}`, 'fill-emissive-strength': 1 },
      });
    }
    syncPendingLayer();
  }

  // The prompt/loading pill flips the instant the zoom crosses MIN_ZOOM, mid-gesture.
  map.on('zoom', updateStatus);

  // Flat areas render as almost nothing (the ramp barely tints anything under ~10%), which can
  // read as "slope didn't load". Once the map settles, sample the visible area from the cached
  // analysis grids; if hardly any of it is steeper than FLAT_SLOPE_PCT, say so in the pill.
  const FLAT_SLOPE_PCT = 10;
  const FLAT_MAX_SHARE = 0.05; // under 5% of the view steeper than that → "very little slope"
  const FLAT_SAMPLES_PER_SIDE = 40;

  function setFlatView(flat) {
    if (flat === isFlatView) return;
    isFlatView = flat;
    updateStatus();
  }

  function evaluateFlatness() {
    if (map.getZoom() < MIN_ZOOM || loadingActive) return setFlatView(false);
    const b = map.getBounds();
    let total = 0, found = 0, steep = 0;
    for (let i = 0; i < FLAT_SAMPLES_PER_SIDE; i++) {
      for (let j = 0; j < FLAT_SAMPLES_PER_SIDE; j++) {
        const lng = b.getWest() + (b.getEast() - b.getWest()) * ((i + 0.5) / FLAT_SAMPLES_PER_SIDE);
        const lat = b.getNorth() + (b.getSouth() - b.getNorth()) * ((j + 0.5) / FLAT_SAMPLES_PER_SIDE);
        total++;
        const v = slopeValueAt(lng, lat);
        if (v === undefined || v === NO_DATA) continue;
        found++;
        if (v >= FLAT_SLOPE_PCT * 10) steep++;
      }
    }
    // Only judge with most of the view's data in hand, so partial loads never read as flat.
    if (found < total * 0.8) return setFlatView(false);
    setFlatView(steep / found < FLAT_MAX_SHARE);
  }

  map.on('idle', evaluateFlatness);
  map.on('movestart', () => setFlatView(false));

  // LA County's own ArcGIS REST service — free, live, and returns real parcel polygons as
  // GeoJSON for a bbox query. There's no free nationwide parcel API; this only covers LA
  // County, which is fine since the default camera (and this app's focus) sits inside it.
  const PARCEL_URL =
    'https://public.gis.lacounty.gov/public/rest/services/LACounty_Cache/LACounty_Parcel/MapServer/0/query';
  // LA County retired its LACounty_Dynamic/Zoning service (it now answers "service not found"),
  // and the county's own replacement only covers unincorporated areas. SCAG's regional parcel
  // zoning layer covers every city in the county, keyed by the same APN/AIN, with each city's
  // own zone code (ZN24_CITY) — and it allows cross-origin requests from the browser.
  const ZONING_URL =
    'https://maps.scag.ca.gov/scaggis/rest/services/LDX/Zoning_poly_LA/MapServer/0/query';
  const PARCEL_SRC_ID = 'parcels-src';
  const PARCEL_LAYER_ID = 'parcels';
  const PARCEL_HIT_LAYER_ID = 'parcels-hit'; // invisible fill — the visible layer is just a line, which only hit-tests along the thin boundary stroke, not the parcel's interior
  const PARCEL_MIN_ZOOM = 16; // below this, parcels are too dense/tiny to read or worth fetching

  const EMPTY_FC = { type: 'FeatureCollection', features: [] };

  // White lot lines on the dark map, dark ones on the light map.
  const parcelLineColor = () => (currentMapStyle === 'dark' ? 'rgba(255, 255, 255, 0.7)' : 'rgba(20, 20, 24, 0.55)');

  function addParcelLayer() {
    if (!map.getSource(PARCEL_SRC_ID)) {
      map.addSource(PARCEL_SRC_ID, { type: 'geojson', data: EMPTY_FC });
    }
    if (!map.getLayer(PARCEL_HIT_LAYER_ID)) {
      map.addLayer({
        id: PARCEL_HIT_LAYER_ID,
        type: 'fill',
        source: PARCEL_SRC_ID,
        paint: { 'fill-color': '#000000', 'fill-opacity': 0 },
      });
    }
    if (!map.getLayer(PARCEL_LAYER_ID)) {
      map.addLayer({
        id: PARCEL_LAYER_ID,
        type: 'line',
        source: PARCEL_SRC_ID,
        // Tightly dashed and zoom-scaled so lot lines read clearly over the slope colors without
        // competing with them; emissive so the Standard style's 'night' lighting doesn't dim them
        // like it does the basemap. (Dash lengths are in multiples of the line width.)
        paint: {
          'line-color': parcelLineColor(),
          'line-width': ['interpolate', ['linear'], ['zoom'], 16, 1, 18, 1.75, 20, 2.5],
          'line-dasharray': [2, 1.5],
          'line-emissive-strength': 1,
        },
      });
    }
  }

  let parcelFetchToken = 0;
  const PARCEL_TIMEOUT_MS = 12000;
  let parcelRefreshTimer = null;
  function scheduleParcelRefresh(delay = 500) {
    clearTimeout(parcelRefreshTimer);
    parcelRefreshTimer = setTimeout(refreshParcels, delay);
  }

  async function refreshParcels() {
    if (map.getZoom() < PARCEL_MIN_ZOOM) {
      map.getSource(PARCEL_SRC_ID)?.setData(EMPTY_FC);
      return;
    }
    const myToken = ++parcelFetchToken;
    const b = map.getBounds();
    const params = new URLSearchParams({
      f: 'geojson',
      geometry: `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`,
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      outSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'AIN,SitusFullAddress',
      returnGeometry: 'true',
    });
    // The county's query endpoint can stall for a minute and then return an error page (seen in
    // practice), so give up after PARCEL_TIMEOUT_MS and tell the user rather than leaving them
    // waiting on parcel lines that never appear.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PARCEL_TIMEOUT_MS);
    try {
      const res = await fetch(`${PARCEL_URL}?${params}`, { signal: controller.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const fc = await res.json();
      if (myToken !== parcelFetchToken) return;
      if (fc.error) throw new Error(fc.error.message ?? 'Parcel query error');
      map.getSource(PARCEL_SRC_ID)?.setData(fc);
    } catch (err) {
      if (myToken !== parcelFetchToken || removed) return; // superseded by a newer request
      console.error('Parcel fetch failed', err);
      onParcelError?.();
    } finally {
      clearTimeout(timeout);
    }
  }

  const FALLBACK_COLOR = '#9fb3ac';
  const SELECTED_FILL_SRC_ID = 'selected-parcel-fill-src';
  const SELECTED_LINE_SRC_ID = 'selected-parcel-line-src';
  const SELECTED_FILL_ID = 'selected-parcel-fill';
  const SELECTED_LINE_ID = 'selected-parcel-line';

  function addSelectionLayer() {
    if (!map.getSource(SELECTED_FILL_SRC_ID)) {
      map.addSource(SELECTED_FILL_SRC_ID, { type: 'geojson', data: EMPTY_FC });
    }
    if (!map.getSource(SELECTED_LINE_SRC_ID)) {
      // lineMetrics is required for line-gradient to work — it's what lets the gradient
      // expression key off ['line-progress'] along the boundary.
      map.addSource(SELECTED_LINE_SRC_ID, { type: 'geojson', data: EMPTY_FC, lineMetrics: true });
    }
    if (!map.getLayer(SELECTED_FILL_ID)) {
      map.addLayer({
        id: SELECTED_FILL_ID,
        type: 'fill',
        source: SELECTED_FILL_SRC_ID,
        paint: { 'fill-color': FALLBACK_COLOR, 'fill-opacity': 0.25 },
      });
    }
    if (!map.getLayer(SELECTED_LINE_ID)) {
      map.addLayer({
        id: SELECTED_LINE_ID,
        type: 'line',
        source: SELECTED_LINE_SRC_ID,
        paint: {
          'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, FALLBACK_COLOR, 1, FALLBACK_COLOR],
          'line-width': 4,
          'line-emissive-strength': 1,
        },
      });
    }
    map.moveLayer(SELECTED_FILL_ID);
    map.moveLayer(SELECTED_LINE_ID); // outline stays topmost of all overlays
  }

  // A very light, non-interactive wash shown over a parcel found via address search — a
  // preview, distinct from an actual click-selection (no border, no analysis popover, no
  // animation). Cleared the moment a real selection or a new preview replaces it.
  const PREVIEW_SRC_ID = 'preview-parcel-src';
  const PREVIEW_LINE_ID = 'preview-parcel-line';

  function addPreviewLayer() {
    if (!map.getSource(PREVIEW_SRC_ID)) {
      map.addSource(PREVIEW_SRC_ID, { type: 'geojson', data: EMPTY_FC });
    }
    if (!map.getLayer(PREVIEW_LINE_ID)) {
      map.addLayer({
        id: PREVIEW_LINE_ID,
        type: 'line',
        source: PREVIEW_SRC_ID,
        paint: { 'line-color': '#ffd60a', 'line-width': 3, 'line-opacity': 0.9 },
      });
    }
    map.moveLayer(PREVIEW_LINE_ID); // stays above the parcels line layer/selection, above slope
  }

  // House-number labels are a normal style layer (not locked inside the Standard basemap's
  // config-schema import), so they can be filtered directly — isolating the searched address's
  // own number declutters the view right after a search, restored the moment the user takes the
  // map back over (drags/zooms it themselves) or otherwise dismisses the preview.
  const HOUSENUM_LAYER_ID = 'housenum-label';
  const originalHousenumFilter = map.getLayer(HOUSENUM_LAYER_ID) ? map.getFilter(HOUSENUM_LAYER_ID) ?? null : null;

  function restoreHouseNumbers() {
    if (map.getLayer(HOUSENUM_LAYER_ID)) map.setFilter(HOUSENUM_LAYER_ID, originalHousenumFilter);
  }

  function isolateHouseNumber(houseNum) {
    if (!houseNum || !map.getLayer(HOUSENUM_LAYER_ID)) return;
    map.setFilter(HOUSENUM_LAYER_ID, ['==', ['get', 'house_num'], houseNum]);
    map.once('movestart', restoreHouseNumbers);
  }

  function clearPreview() {
    map.getSource(PREVIEW_SRC_ID)?.setData(EMPTY_FC);
    restoreHouseNumbers();
  }

  // Rasterizes a parcel ring against the currently-cached slope percentGrids — walks a regular
  // grid of candidate points across the ring's bbox and keeps the ones that fall inside the
  // polygon (simple even-odd point-in-polygon test), reading each kept point's slope percent.
  function pointInRing(lng, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function computeParcelStats(ring) {
    let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
    for (const [lng, lat] of ring) {
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
    const SAMPLES_PER_SIDE = 24;
    const samples = [];
    for (let iy = 0; iy < SAMPLES_PER_SIDE; iy++) {
      const lat = south + ((north - south) * (iy + 0.5)) / SAMPLES_PER_SIDE;
      for (let ix = 0; ix < SAMPLES_PER_SIDE; ix++) {
        const lng = west + ((east - west) * (ix + 0.5)) / SAMPLES_PER_SIDE;
        if (!pointInRing(lng, lat, ring)) continue;
        const pct = getSlopeAt(lng, lat);
        if (pct !== null && Number.isFinite(pct)) samples.push(pct);
      }
    }
    if (samples.length === 0) {
      return { sampleCount: 0, samples: [], minPercent: 0, maxPercent: 0, modePercent: 0, summaryLabel: 'flat', summaryColor: bandSolidColor(0) };
    }
    const minPercent = Math.min(...samples);
    const maxPercent = Math.max(...samples);
    // Mode via coarse (5%) binning — "most prevalent" band rather than a fragile exact-value mode.
    const bins = new Map();
    for (const s of samples) {
      const bin = Math.round(s / 5) * 5;
      bins.set(bin, (bins.get(bin) || 0) + 1);
    }
    let modePercent = minPercent, modeCount = -1;
    for (const [bin, count] of bins) {
      if (count > modeCount) { modeCount = count; modePercent = bin; }
    }
    const { label: summaryLabel, color: summaryColor } = summaryForPercent(maxPercent);
    const modeColor = summaryForPercent(modePercent).color; // band color of the most common slope
    return { sampleCount: samples.length, samples, minPercent, maxPercent, modePercent, modeColor, summaryLabel, summaryColor };
  }

  function ringToAnchorRect(ring) {
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (const [lng, lat] of ring) {
      const p = map.project([lng, lat]);
      if (p.x < left) left = p.x;
      if (p.x > right) right = p.x;
      if (p.y < top) top = p.y;
      if (p.y > bottom) bottom = p.y;
    }
    return { left, right, top, bottom };
  }

  let selectedAin = null;
  let selectedFC = EMPTY_FC; // kept so a map-style swap (which drops all layers) can redraw it

  function clearSelection() {
    selectedAin = null;
    selectedFC = EMPTY_FC;
    map.getSource(SELECTED_FILL_SRC_ID)?.setData(EMPTY_FC);
    map.getSource(SELECTED_LINE_SRC_ID)?.setData(EMPTY_FC);
    onParcelSelect?.(null);
  }

  // `reveal` (optional) is awaited after the highlight is drawn but before the sheet is told to
  // open — so the camera can finish moving to the parcel first.
  async function selectParcel(feature, reveal) {
    const ain = feature.properties?.AIN ?? null;
    selectedAin = ain;
    const geom = { type: 'Feature', properties: {}, geometry: feature.geometry };
    selectedFC = { type: 'FeatureCollection', features: [geom] };
    map.getSource(SELECTED_FILL_SRC_ID)?.setData(selectedFC);
    map.getSource(SELECTED_LINE_SRC_ID)?.setData(selectedFC);

    const ring = feature.geometry.type === 'Polygon'
      ? feature.geometry.coordinates[0]
      : feature.geometry.coordinates[0][0];
    const stats = computeParcelStats(ring);
    const anchorRect = ringToAnchorRect(ring);
    // Bounding-box midpoint — where a "recent parcels" card flies back to.
    const lngs = ring.map((p) => p[0]), lats = ring.map((p) => p[1]);
    const center = [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
    const address = feature.properties?.SitusFullAddress ?? null;

    if (reveal) await reveal;
    if (selectedAin !== ain) return; // another parcel was clicked while the camera was moving
    onParcelSelect?.({ ain, address, stats, anchorRect, center, zoning: null, zoningLoading: true });

    if (ain == null) {
      onParcelSelect?.({ ain, address, stats, anchorRect, center, zoning: null, zoningLoading: false });
      return;
    }
    try {
      const params = new URLSearchParams({
        f: 'json', where: `APN24='${ain}'`, outFields: 'ZN24_CITY,CITY', returnGeometry: 'false',
      });
      const res = await fetch(`${ZONING_URL}?${params}`);
      const json = await res.json();
      const attrs = json?.features?.[0]?.attributes;
      const zoning = attrs?.ZN24_CITY ? { code: attrs.ZN24_CITY, city: attrs.CITY ?? null } : null;
      if (selectedAin === ain) onParcelSelect?.({ ain, address, stats, anchorRect, center, zoning, zoningLoading: false });
    } catch (err) {
      console.error('Zoning fetch failed', err);
      if (selectedAin === ain) onParcelSelect?.({ ain, address, stats, anchorRect, center, zoning: null, zoningLoading: false });
    }
  }

  // Clicking a parcel highlights it immediately, moves the camera so the parcel sits centered in
  // the part of the map the sheet leaves visible (zooming in if needed, never out), and only then
  // opens the sheet — rather than the sheet sliding in over a camera that's still moving.
  const PARCEL_FOCUS_MAX_ZOOM = 20;
  const SHEET_MAX_WIDTH = 384; // design system Sheet: w-3/4, capped at sm:max-w-sm
  const FOCUS_MS = 600;

  function easeAndWait(opts) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      map.easeTo(opts);
      map.once('moveend', finish);
      setTimeout(finish, (opts.duration ?? 500) + 100); // moveend never fires for a no-op ease
    });
  }

  map.on('click', PARCEL_HIT_LAYER_ID, (e) => {
    const feature = e.features?.[0];
    if (!feature) return;
    clearPreview();
    const ring = feature.geometry.type === 'Polygon'
      ? feature.geometry.coordinates[0]
      : feature.geometry.coordinates[0][0];
    const bounds = ring.reduce(
      (b, [lng, lat]) => b.extend([lng, lat]),
      new mapboxgl.LngLatBounds(ring[0], ring[0])
    );

    const { clientWidth: w } = map.getContainer();
    const sheetWidth = w >= 640 ? Math.min(w * 0.75, SHEET_MAX_WIDTH) : w * 0.75;
    // Only offset for the sheet when there's a usable strip of map left beside it (not on phones,
    // where the sheet covers three quarters of the screen).
    const offsetForSheet = w - sheetWidth >= 280 ? sheetWidth : 0;
    const camera = map.cameraForBounds(bounds, {
      padding: { top: 120, bottom: 120, left: 80, right: 80 + offsetForSheet },
      maxZoom: PARCEL_FOCUS_MAX_ZOOM,
    });
    let reveal = null;
    if (camera) {
      const zoom = Math.max(map.getZoom(), camera.zoom);
      // Map center sits east of the parcel by half the sheet width (in pixels at the target
      // zoom), which puts the parcel in the middle of the uncovered area.
      const c = bounds.getCenter();
      const degPerPx = 360 / (512 * 2 ** zoom);
      reveal = easeAndWait({ center: [c.lng + (offsetForSheet / 2) * degPerPx, c.lat], zoom, duration: FOCUS_MS });
    }
    selectParcel(feature, reveal);
  });

  // One continuous flyTo arc — levels the pitch, rises, travels and descends as a single curve.
  // This used to be three chained easeTo stages (flatten, overview, dive), which read as
  // stop-start: each stage decelerated to a halt before the next one kicked off.
  const ADDRESS_FLY_FINAL_ZOOM = 17;
  const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

  // map.once('moveend', ...) never fires if the flight turns out to be a no-op (already there),
  // so a timeout safety net guarantees the code after it always runs.
  function flyToAndWait(opts) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      map.flyTo(opts);
      map.once('moveend', finish);
      setTimeout(finish, (opts.duration ?? 3000) + 200);
    });
  }

  async function goToAddress(lng, lat) {
    clearSelection();
    clearPreview();
    // Explicit duration scaled by distance and zoom change, not flyTo's speed/maxDuration: when
    // the computed flight exceeds maxDuration Mapbox skips the animation and jumps instead.
    const from = map.getCenter();
    const km = from.distanceTo(new mapboxgl.LngLat(lng, lat)) / 1000;
    const dz = Math.abs(ADDRESS_FLY_FINAL_ZOOM - map.getZoom());
    const duration = Math.min(2600, Math.max(1000, 700 + dz * 90 + Math.log2(1 + km) * 160));
    await flyToAndWait({
      center: [lng, lat],
      zoom: ADDRESS_FLY_FINAL_ZOOM,
      pitch: 0,
      curve: 1.5,
      duration,
      easing: easeInOutCubic,
      essential: true,
    });

    await new Promise((r) => setTimeout(r, 300)); // let parcels for the new area load in
    const point = map.project([lng, lat]);
    const features = map.queryRenderedFeatures(point, { layers: [PARCEL_HIT_LAYER_ID] });
    const feature = features?.[0];
    if (feature) {
      const geom = { type: 'Feature', properties: {}, geometry: feature.geometry };
      map.getSource(PREVIEW_SRC_ID)?.setData({ type: 'FeatureCollection', features: [geom] });
      isolateHouseNumber(feature.properties?.HouseNumber ?? feature.properties?.house_num ?? null);
    }
  }

  // ---- Flyby ----
  // A scene is a saved camera ({ id, center, zoom, bearing, pitch }); the list itself lives in
  // React (and localStorage). The map shows a numbered marker at each scene's center and plays
  // them back like Mapbox's playback-locations example — a default-speed flyTo to each scene —
  // but instead of just holding on arrival, the camera orbits half way (180°) around the scene's
  // center (as in the free-camera-point example), then flies on to the next, looping until stopped.
  const FLYBY_ORBIT_DEGREES = 180;
  const FLYBY_ORBIT_MS = 5000;
  const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
  let flybyMarkers = [];
  let flybyToken = 0;
  let flybyPlaying = false;

  function getCamera() {
    const { lng, lat } = map.getCenter();
    return { center: [lng, lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
  }

  function setFlybyScenes(scenes, onMarkerClick) {
    if (removed) return; // StrictMode's discarded instance can still be in a ref for one effect pass
    flybyMarkers.forEach((m) => m.remove());
    flybyMarkers = scenes.map((scene, i) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'flyby-marker';
      el.textContent = String(i + 1);
      el.setAttribute('aria-label', `Go to scene ${i + 1}`);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onMarkerClick?.(i);
      });
      return new mapboxgl.Marker({ element: el }).setLngLat(scene.center).addTo(map);
    });
  }

  // Resolves once the camera has settled (or immediately if the move turned out to be a no-op).
  function waitForMoveEnd() {
    return new Promise((resolve) => {
      if (!map.isMoving()) return resolve();
      map.once('moveend', () => resolve());
    });
  }

  function flyToScene(scene) {
    const from = map.getCenter();
    const km = from.distanceTo(new mapboxgl.LngLat(scene.center[0], scene.center[1])) / 1000;
    const dz = Math.abs(scene.zoom - map.getZoom());
    const camera = { center: scene.center, zoom: scene.zoom, bearing: scene.bearing, pitch: scene.pitch, essential: true };
    if (km < 0.05 && dz < 0.1) {
      // Same spot, different angle: flyTo's duration comes from distance travelled, so a pure
      // rotate/tilt would snap. Give it a duration that scales with the turn instead.
      const dBearing = Math.abs(((scene.bearing - map.getBearing() + 540) % 360) - 180);
      const dPitch = Math.abs(scene.pitch - map.getPitch());
      map.easeTo({ ...camera, duration: Math.max(1200, dBearing * 10 + dPitch * 20) });
    } else {
      map.flyTo(camera);
    }
    return waitForMoveEnd();
  }

  // A half turn around the current center, keeping zoom and pitch — the bearing is the camera's
  // angle around the point it looks at, so sweeping it circles the camera around that point.
  // Eased in and out so the turn starts and settles smoothly. Resolves early if `token` goes stale.
  function orbitCenter(token) {
    return new Promise((resolve) => {
      const start = map.getBearing();
      const t0 = performance.now();
      const frame = (now) => {
        if (token !== flybyToken) return resolve();
        const t = Math.min(1, (now - t0) / FLYBY_ORBIT_MS);
        map.setBearing(start + FLYBY_ORBIT_DEGREES * easeInOutSine(t));
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  // Flies through the scenes in order, looping back to the first after the last, until stopped
  // (stopFlyby, or the user grabbing the map). onScene(i) fires as each flight starts.
  async function playFlyby(scenes, onScene) {
    const token = ++flybyToken;
    flybyPlaying = true;
    syncLock(); // a flyby is never locked out
    refreshLoading(); // and shows no loading message…
    syncPendingLayer(); // …or stripes
    clearSelection();
    clearPreview();
    map.getContainer().classList.add('flyby-playing');
    for (let i = 0; token === flybyToken; i = (i + 1) % scenes.length) {
      onScene?.(i);
      await flyToScene(scenes[i]);
      if (token !== flybyToken) break;
      await orbitCenter(token);
    }
  }

  function stopFlyby() {
    if (!flybyPlaying) return;
    flybyToken++;
    flybyPlaying = false;
    map.getContainer().classList.remove('flyby-playing');
    map.stop();
    // Back to normal: anything on screen without slope now loads (requests waiting in whenSettled
    // go ahead once the camera settles — now, if it already has), with the usual message and stripes.
    if (cameraSettled) settleWaiters.splice(0).forEach((resolve) => resolve());
    refreshLoading();
    syncPendingLayer();
  }

  let onFlybyInterrupted = null;
  // Scrolling, dragging or touching the map mid-flyby ends playback rather than fighting the user.
  // These are raw input events rather than 'movestart', which doesn't fire again while a flight is
  // already moving the camera — Mapbox just cuts the flight short, which would otherwise read as
  // "scene reached" and carry on to the next one.
  for (const type of ['wheel', 'pointerdown', 'touchstart']) {
    listen(map.getCanvasContainer(), type, () => {
      if (!flybyPlaying) return;
      stopFlyby();
      onFlybyInterrupted?.();
    }, { capture: true, passive: true });
  }

  if (onSlopeHover) {
    map.on('mousemove', (e) => {
      if (flybyPlaying) return onSlopeHover(null);
      const percent = map.getZoom() >= MIN_ZOOM ? getSlopeAt(e.lngLat.lng, e.lngLat.lat) : null;
      if (percent === null) {
        onSlopeHover(null);
        return;
      }
      const [r, g, b] = percentToColor(percent);
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      onSlopeHover({
        x: e.point.x,
        y: e.point.y,
        percent,
        degrees: Math.atan(percent / 100) * (180 / Math.PI),
        color: `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`,
        textColor: luminance > 0.55 ? '#1a1a1a' : '#ffffff',
      });
    });
    listen(map.getContainer(), 'mouseleave', () => onSlopeHover(null));
    // Dragging/zooming/rotating fires 'movestart' but not always a mousemove over the same
    // point, so without this the last hover value (and its cursor position) stays stuck
    // on screen through the pan instead of clearing.
    map.on('movestart', () => onSlopeHover(null));
  }

  map.on('load', updateStatus);
  map.on('moveend', () => scheduleParcelRefresh());

  map.on('remove', () => {
    listeners.abort();
    removed = true;
    clearTimeout(parcelRefreshTimer);
    setStripesAnimating(false);
    clearTimeout(loadingOffTimer);
    clearTimeout(loadingOnTimer);
    clearTimeout(revealTimer);
    clearTimeout(lockTimer);
    clearTimeout(settleTimer);
    clearTimeout(bgTimer);
    freezeEl?.remove();
    resolveReveal?.();
    workers.forEach(({ worker }) => worker.terminate());
    jobQueue.length = 0;
    workerJobs.forEach((job) => job.reject(new DOMException('map removed', 'AbortError')));
    parcelFetchToken++;
    flybyToken++;
  });

  // Swaps the basemap behind a frozen picture of the current one: the current frame is copied
  // onto a canvas laid over the map, the style is reloaded out of sight, and once the new map and
  // its slope layer have fully drawn ('idle'), the picture dissolves away. Without this the new
  // basemap visibly assembled itself tile by tile. The reload is a full (non-diff) one so
  // 'style.load' fires and re-adds the slope, parcel and selection layers on top of the new style;
  // slope grids are cached, so the slope layer comes straight back.
  // Returns a promise that resolves as the dissolve starts, so the UI can switch theme in step.
  const REVEAL_MAX_WAIT_MS = 2500; // dissolve by then even if the new map is still loading
  const DISSOLVE_MS = 500;
  let appliedMapStyle = currentMapStyle; // the style actually loaded on the map
  let freezeEl = null;
  let freezing = null; // in-flight freezeFrame(), shared by rapid toggles
  let swapToken = 0;
  let revealTimer = null;
  let pendingReveal = null;
  let resolveReveal = null;

  // Copies the map's current frame onto a canvas just above the WebGL canvas (flyby markers come
  // later in the container, so they stay on top). Copied inside 'render', while the WebGL buffer
  // still holds the frame — no preserveDrawingBuffer needed. It swallows input so the live map
  // can't be moved underneath it (the reveal would jump).
  function freezeFrame() {
    return new Promise((resolve) => {
      const source = map.getCanvas();
      const el = document.createElement('canvas');
      el.className = 'map-freeze';
      el.width = source.width;
      el.height = source.height;
      for (const type of ['pointerdown', 'mousedown', 'touchstart', 'click', 'dblclick', 'contextmenu']) {
        el.addEventListener(type, (e) => e.stopPropagation());
      }
      el.addEventListener('wheel', (e) => { e.stopPropagation(); e.preventDefault(); }, { passive: false });
      map.once('render', () => {
        try {
          el.getContext('2d').drawImage(source, 0, 0);
          source.after(el);
          resolve(el);
        } catch {
          resolve(null); // no snapshot: fall back to a plain swap
        }
      });
      map.triggerRepaint();
    });
  }

  function dissolveFrozenFrame() {
    clearTimeout(revealTimer);
    const el = freezeEl;
    freezeEl = null;
    freezing = null;
    pendingReveal = null;
    resolveReveal?.();
    resolveReveal = null;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.remove();
      return;
    }
    el.style.transition = `opacity ${DISSOLVE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    requestAnimationFrame(() => {
      el.style.opacity = '0';
    });
    setTimeout(() => el.remove(), DISSOLVE_MS + 50);
  }

  function setMapStyle(name) {
    if (removed || !MAP_STYLES[name]) return Promise.resolve();
    if (name === currentMapStyle) return pendingReveal ?? Promise.resolve(); // already there / on the way
    currentMapStyle = name;
    activeStops = paletteFor(currentMapStyle, currentPalette); // each map has its own palette set
    const token = ++swapToken;
    pendingReveal ??= new Promise((resolve) => { resolveReveal = resolve; });

    // Rapid toggles reuse the first snapshot rather than capturing a half-drawn map.
    freezing ??= freezeFrame().then((el) => { freezeEl = el; });
    freezing.then(() => {
      if (removed || token !== swapToken) return; // a later toggle has taken over
      if (currentMapStyle === appliedMapStyle) { // toggled back before anything reloaded
        dissolveFrozenFrame();
        return;
      }
      appliedMapStyle = currentMapStyle;
      const reveal = () => {
        if (token === swapToken && !removed) dissolveFrozenFrame();
      };
      map.once('style.load', () => map.once('idle', reveal));
      clearTimeout(revealTimer);
      revealTimer = setTimeout(reveal, REVEAL_MAX_WAIT_MS);
      map.setStyle(MAP_STYLES[currentMapStyle], { diff: false });
    });
    return pendingReveal;
  }

  function setSlopePalette(name) {
    if (removed || name === currentPalette) return; // StrictMode's discarded instance / no change
    currentPalette = name;
    activeStops = paletteFor(currentMapStyle, currentPalette);
    if (map.getLayer(SLOPE_LAYER_ID)) map.setPaintProperty(SLOPE_LAYER_ID, 'raster-color', rasterColorFor(activeStops));
  }

  // ---- Background fill ----
  // Quietly fills the gaps between areas you've already loaded (e.g. Santa Monica and Los Feliz →
  // everything in between), so panning or zooming into them later shows slope straight away. A gap tile
  // is filled when it's sandwiched between loaded areas along one of four axes (east–west,
  // north–south, both diagonals) within BG_REACH tiles — that covers gaps between nearby areas and
  // holes inside one, but never grows outward past an area's edge. Only slope you loaded yourself
  // counts as an anchor (filled tiles are remembered separately), so fills can't creep outward by
  // anchoring on each other.
  // It's invisible: lowest-priority worker jobs (see pumpJobs), no stripes/message/lock, only while
  // the map is idle, the tab is visible and nothing for the view is loading; nearest gaps first,
  // capped per visit, skipped when the browser asks to save data. Filled at OVERVIEW_ZOOM — the
  // same detail a zoomed-out view uses; zooming in still loads full detail as usual.
  const BG_ZOOM = OVERVIEW_ZOOM; // z13 tiles are ~4 km across here
  const BG_REACH = 10; // ~40 km: how far apart two areas can be for the gap between them to fill
  const BG_IDLE_MS = 1500; // map idle this long before filling (re)starts
  const BG_SESSION_LIMIT = 400; // tiles per visit (~0.1–0.2 MB of DEM downloads each)
  const BG_FILLED_KEY = 'slopes:bg-filled';
  const AXES = [[1, 0], [0, 1], [1, 1], [1, -1]];
  let bgFilled;
  try {
    bgFilled = new Set(JSON.parse(localStorage.getItem(BG_FILLED_KEY)) ?? []);
  } catch {
    bgFilled = new Set();
  }
  let bgTimer = null;
  let bgQueue = null; // gap tiles still to fill, nearest first; null = needs (re)computing
  let bgInFlight = 0;
  let bgDoneThisVisit = 0;

  function rememberBgFilled(key) {
    bgFilled.add(key);
    try {
      localStorage.setItem(BG_FILLED_KEY, JSON.stringify([...bgFilled]));
    } catch {
      // storage full/unavailable — worst case a filled tile later counts as an anchor
    }
  }

  // Tiles at BG_ZOOM that hold slope you loaded yourself (analysed at that zoom or finer).
  function bgAnchors() {
    const anchors = new Set();
    for (const key of savedKeys) {
      if (!isAnalysisKey(key) || bgFilled.has(key)) continue; // display tiles are derived data
      const [z, x, y] = key.split(':').map(Number);
      if (z < BG_ZOOM) continue;
      const shift = z - BG_ZOOM;
      anchors.add(`${x >> shift}:${y >> shift}`);
    }
    return anchors;
  }

  function findGapTiles() {
    const anchors = bgAnchors();
    const has = (x, y) => anchors.has(`${x}:${y}`);
    const filled = (x, y) => {
      const key = `${BG_ZOOM}:${x}:${y}`;
      return savedKeys.has(key) || savedAncestors.has(key) || has(x, y);
    };
    const reaches = (x, y, dx, dy) => {
      for (let k = 1; k <= BG_REACH; k++) if (has(x + dx * k, y + dy * k)) return true;
      return false;
    };
    // A gap tile is always within BG_REACH of an anchor along some axis, so walking out from every
    // anchor along the 8 directions finds every candidate.
    const candidates = new Set();
    for (const a of anchors) {
      const [ax, ay] = a.split(':').map(Number);
      for (const [dx, dy] of AXES) {
        for (const sgn of [1, -1]) {
          for (let k = 1; k <= BG_REACH; k++) {
            const x = ax + dx * k * sgn, y = ay + dy * k * sgn;
            if (has(x, y)) break;
            if (!filled(x, y)) candidates.add(`${x}:${y}`);
          }
        }
      }
    }
    const center = lngLatToTileFrac(map.getCenter().lng, map.getCenter().lat, BG_ZOOM);
    const gaps = [];
    for (const c of candidates) {
      const [x, y] = c.split(':').map(Number);
      if (AXES.some(([dx, dy]) => reaches(x, y, dx, dy) && reaches(x, y, -dx, -dy))) {
        gaps.push({ x, y, d: (x + 0.5 - center.x) ** 2 + (y + 0.5 - center.y) ** 2 });
      }
    }
    return gaps.sort((a, b) => a.d - b.d);
  }

  const bgAllowed = () =>
    !removed && !document.hidden && !navigator.connection?.saveData && bgDoneThisVisit < BG_SESSION_LIMIT;
  const viewBusy = () => !cameraSettled || flybyPlaying || loadingActive || uncoveredPending() > 0;

  // Already-scheduled starts aren't pushed back: 'idle' can fire on nearly every frame (e.g. while
  // something keeps repainting), which kept restarting the countdown so it never ran. Moving the
  // map is what cancels a pending start (see the movestart listener).
  function scheduleBackgroundFill(delay = BG_IDLE_MS) {
    if (!bgAllowed() || (bgTimer && delay > 0)) return;
    clearTimeout(bgTimer);
    bgTimer = setTimeout(() => {
      bgTimer = null;
      backgroundFill();
    }, delay);
  }

  function backgroundFill() {
    if (!bgAllowed()) return;
    if (viewBusy()) return scheduleBackgroundFill();
    bgQueue ??= findGapTiles();
    while (bgInFlight < BG_MAX_RUNNING && bgQueue.length && bgDoneThisVisit + bgInFlight < BG_SESSION_LIMIT) {
      const { x, y } = bgQueue.shift();
      const key = `${BG_ZOOM}:${x}:${y}`;
      if (savedKeys.has(key) || savedAncestors.has(key)) continue; // loaded meanwhile
      bgInFlight++;
      getAnalysisGrid(BG_ZOOM, x, y, null, { background: true })
        .then((grid) => {
          if (!grid) return;
          rememberBgFilled(key);
          bgDoneThisVisit++;
        })
        .finally(() => {
          bgInFlight--;
          scheduleBackgroundFill(0);
        });
    }
    if (!bgQueue.length && bgInFlight === 0) bgQueue = null; // done for now; recompute next time
  }



  // Start (or resume) when the map settles; new loads by you can create new gaps to fill, so the
  // gap list is recomputed whenever you've finished loading something.
  map.on('idle', () => {
    if (!loadingActive) scheduleBackgroundFill();
  });
  map.on('movestart', () => {
    clearTimeout(bgTimer);
    bgTimer = null;
  });
  listen(document, 'visibilitychange', () => {
    if (!document.hidden) return scheduleBackgroundFill();
    clearTimeout(bgTimer);
    bgTimer = null;
  });
  savedIndexReady.then(() => scheduleBackgroundFill());

  return Object.assign(map, {
    setMapStyle,
    setSlopePalette,
    clearSelection,
    goToAddress,
    getCamera,
    setFlybyScenes,
    flyToScene,
    playFlyby,
    stopFlyby,
    onFlybyInterrupted: (fn) => { onFlybyInterrupted = fn; },
  });
}
