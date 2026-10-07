import mapboxgl from 'mapbox-gl';
import { loadGrid, saveGrid } from './slopeStore.js';
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
export function initSlopeMap({ onSlopeHover, onParcelSelect, onStatusChange, onParcelError } = {}) {
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

  const STYLE_DARK = 'mapbox://styles/bzyluke/cmtn58lr700ci01pmbvx4b8h8';

  const MAX_ZOOM = 20;

  // DOM listeners/timers here outlive the map unless torn down with it — React StrictMode mounts,
  // removes, and re-mounts in dev, and the first instance's leftovers kept driving the shared
  // controls (zoom buttons, zoom readout, status pill) and erroring against the removed map.
  const listeners = new AbortController();
  const listen = (el, type, fn) => el.addEventListener(type, fn, { signal: listeners.signal });

  const map = new mapboxgl.Map({
    container: 'map',
    style: STYLE_DARK,
    minZoom: 4.5,
    maxZoom: MAX_ZOOM,
    ...DEFAULT_CAMERA,
  });

  // This is a Standard-based style, so its basemap labels live in an import fragment —
  // there's no setPaintProperty/setLayoutProperty access to those layers, only the fixed set
  // of config toggles the style exposes. text-transform/letter-spacing aren't among them
  // (Studio-only); label color and hiding transit labels are. The dark style needs light labels
  // for contrast.
  function applyLabelStyling() {
    map.setConfigProperty('basemap', 'colorPlaceLabels', '#ffffff');
    map.setConfigProperty('basemap', 'colorRoadLabels', '#ffffff');
    map.setConfigProperty('basemap', 'showTransitLabels', false);
  }

  // Mapbox Standard auto-selects a lightPreset based on real-world time of day if left unset,
  // which made the map's look drift depending on when you opened it — pin it explicitly.
  map.on('style.load', () => {
    map.setConfigProperty('basemap', 'lightPreset', 'night');
    applyLabelStyling();
    addSlopeLayer(); // added first so parcels/selection/preview layers draw above it
    addParcelLayer();
    addSelectionLayer();
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

  // Exact spec stops, incl. the 0% anchor — a near-invisible rgba(0,0,0,0.04) wash rather than
  // true transparency. Colors interpolate smoothly across all of them; low single-digit percents
  // stay effectively invisible on their own since alpha only reaches .04 there.
  const RAMP_STOPS = [
    [0, 0, 0, 0, 0.04],       // rgba(0,0,0,0.04)
    [20, 128, 71, 143, 0.40], // rgba(128,71,143,0.40)
    [30, 104, 87, 180, 0.50], // rgba(104,87,180,0.50)
    [40, 72, 110, 164, 0.60], // rgba(72,110,164,0.60)
    [50, 71, 156, 130, 0.70], // rgba(71,156,130,0.70)
    [60, 128, 189, 100, 0.80],// rgba(128,189,100,0.80)
    [70, 193, 202, 71, 0.90], // rgba(193,202,71,0.90)
    [80, 196, 130, 89, 1.00], // rgba(196,130,89,1)
    [90, 161, 59, 59, 1.00],  // rgba(161,59,59,1)
  ];
  function percentToColor(pct) {
    const stops = RAMP_STOPS;
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
  const BAND_DESCRIPTORS = ['flat', 'minor', 'minor', 'minor', 'moderate', 'moderate', 'moderate', 'steep', 'steep'];
  function bandSolidColor(idx) {
    if (idx === 0) return '#424563';
    const [r, g, b] = percentToColor(RAMP_STOPS[idx][0]);
    return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
  }
  function summaryForPercent(pct) {
    const stops = RAMP_STOPS;
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

  const MIN_ZOOM = 11; // camera zoom below which slope isn't shown
  const TILE_SIZE = 256;
  const SLOPE_SRC_ID = 'slope-src';
  const SLOPE_LAYER_ID = 'slope';
  const NO_DATA = 65535; // grid sentinel for "no slope here" (a failed DEM tile) — renders transparent

  // Slope is only ever computed at one resolution: z14 DEM tiles (~6–8 m/px here, about the
  // true resolution of the underlying USGS elevation data — terrain-RGB's z15 is just upsampled
  // z14). Lower-zoom display tiles average those high-res slope values rather than computing
  // slope from coarser elevation, which smooths terrain and understated steepness: the same
  // hillside read green at zoom 11 and red at zoom 14, and the lower-zoom tiles Mapbox shows
  // while sharper ones load made everything look flatter than it is.
  const ANALYSIS_ZOOM = 14;
  const DISPLAY_MIN_ZOOM = 12; // camera zoom 11 draws 256px tiles at z12

  // z14 analysis grids, keyed `${z}:${x}:${y}` — the canonical slope data. Display tiles are
  // derived from these, and hover/parcel lookups read them directly (a color baked into a tile
  // can't be reversed back into a percent). Stored as percent × 10 in a Uint16Array (0.1%
  // precision) — half the memory of Float32 so more of the area you've explored stays cached.
  const gridCache = new Map();
  const GRID_CACHE_LIMIT = 800;
  // Display grids for z12/13, averaged down from analysis grids — cheap to rebuild, but cached
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
  const MAX_JOBS_PER_WORKER = 3; // a few in flight each, so fetch latency overlaps with compute
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
  function pumpJobs() {
    for (const entry of workers) {
      while (entry.busy < MAX_JOBS_PER_WORKER && jobQueue.length) {
        const job = jobQueue.pop(); // newest first — the current view beats earlier requests
        entry.busy++;
        workerJobs.set(job.id, job);
        entry.worker.postMessage({ id: job.id, url: job.url, mpp: job.mpp });
      }
    }
  }
  // Returns { promise, cancel }; cancel() only has an effect while the job is still queued.
  function queueWorkerJob(url, mpp) {
    let job;
    const promise = new Promise((resolve, reject) => {
      job = { id: nextJobId++, url, mpp, resolve, reject };
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
    return { promise, cancel };
  }

  // Analysis grid for one z14 tile: memory → IndexedDB (a previous session) → worker. In-flight
  // requests are shared, so the display tiles at every zoom that need this tile wait on one job.
  // Each caller passes its tile's abort signal; the job is dropped from the queue only once every
  // caller has given up. Resolves null if the DEM tile failed or the job was dropped.
  const analysisInFlight = new Map(); // key → { promise, refs, cancel }
  function getAnalysisGrid(x, y, signal) {
    const key = `${ANALYSIS_ZOOM}:${x}:${y}`;
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
        if (entry.refs === 0) throw new DOMException('cancelled', 'AbortError'); // everyone left during the IndexedDB lookup
        const centerLat = tileToLngLat(x + 0.5, y + 0.5, ANALYSIS_ZOOM).lat;
        const job = queueWorkerJob(DEM_URL(ANALYSIS_ZOOM, x, y), metersPerPixel(centerLat, ANALYSIS_ZOOM, TILE_SIZE));
        entry.cancel = job.cancel;
        startNetworkLoad();
        try {
          const grid = await job.promise;
          saveGrid(key, grid);
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
    signal?.addEventListener('abort', () => {
      // Forget a dropped job right away so a later request starts fresh instead of joining it.
      if (--entry.refs === 0 && entry.cancel?.()) analysisInFlight.delete(key);
    }, { once: true });
    return entry.promise;
  }

  // Display grid for a z12/13 tile: each output pixel is the mean slope of the s×s analysis
  // pixels under it (s = 2 or 4), ignoring no-data.
  async function getDisplayGrid(z, x, y, signal) {
    const key = `${z}:${x}:${y}`;
    const cached = displayCache.get(key);
    if (cached) {
      cacheLru(displayCache, DISPLAY_CACHE_LIMIT, key, cached);
      return cached;
    }
    const s = 2 ** (ANALYSIS_ZOOM - z);
    const children = await Promise.all(
      Array.from({ length: s * s }, (_, i) => getAnalysisGrid(x * s + (i % s), y * s + Math.floor(i / s), signal))
    );
    const out = new Uint16Array(TILE_SIZE * TILE_SIZE).fill(NO_DATA);
    const span = TILE_SIZE / s; // output pixels per child tile, per axis
    children.forEach((child, i) => {
      if (!child) return;
      const ox = (i % s) * span, oy = Math.floor(i / s) * span;
      for (let py = 0; py < span; py++) {
        for (let px = 0; px < span; px++) {
          let sum = 0, count = 0;
          for (let dy = 0; dy < s; dy++) {
            const row = (py * s + dy) * TILE_SIZE + px * s;
            for (let dx = 0; dx < s; dx++) {
              const v = child[row + dx];
              if (v !== NO_DATA) { sum += v; count++; }
            }
          }
          if (count) out[(oy + py) * TILE_SIZE + ox + px] = Math.round(sum / count);
        }
      }
    });
    // Don't cache a tile with holes from dropped children — the next request should fill them.
    if (children.every(Boolean)) cacheLru(displayCache, DISPLAY_CACHE_LIMIT, key, out);
    return out;
  }

  // RGBA lookup per stored grid value (percent × 10) — the ramp is flat past its last stop, so
  // anything steeper reuses the final entry instead of interpolating per pixel.
  const COLOR_LUT_MAX = RAMP_STOPS[RAMP_STOPS.length - 1][0] * 10;
  const COLOR_LUT = new Uint8ClampedArray((COLOR_LUT_MAX + 1) * 4);
  for (let v = 0; v <= COLOR_LUT_MAX; v++) {
    const [r, g, b, a] = percentToColor(v / 10);
    COLOR_LUT.set([r, g, b, Math.round(a * 255)], v * 4);
  }

  function colorizeGrid(grid) {
    const img = new ImageData(TILE_SIZE, TILE_SIZE);
    const out = new Uint32Array(img.data.buffer);
    const lut = new Uint32Array(COLOR_LUT.buffer);
    for (let p = 0; p < grid.length; p++) {
      const v = grid[p];
      out[p] = v === NO_DATA ? 0 : lut[Math.min(COLOR_LUT_MAX, v)];
    }
    return img;
  }

  // Slope at a point from the cached analysis grid covering it, or null if it isn't loaded —
  // the same full-resolution value whatever the camera zoom.
  function getSlopeAt(lng, lat) {
    const frac = lngLatToTileFrac(lng, lat, ANALYSIS_ZOOM);
    const tx = Math.floor(frac.x), ty = Math.floor(frac.y);
    const grid = gridCache.get(`${ANALYSIS_ZOOM}:${tx}:${ty}`);
    if (!grid) return null;
    const v = grid[Math.floor((frac.y - ty) * TILE_SIZE) * TILE_SIZE + Math.floor((frac.x - tx) * TILE_SIZE)];
    return v === NO_DATA ? null : v / 10;
  }

  // Loading/prompt pill state. The verb rotates per loading burst so it doesn't feel static.
  const LOADING_VERBS = ['Pulling', 'Fetching', 'Grabbing', 'Summoning', 'Wrangling', 'Excavating', 'Conjuring', 'Divining'];
  let loadingLabel = '';
  let pendingTiles = 0; // analysis tiles being fetched/computed (not cache/IndexedDB hits)
  let lastStatusKey = null;
  let isFlatView = false; // set by evaluateFlatness() once the map settles
  let removed = false;
  function updateStatus() {
    if (removed) return; // a removed instance (e.g. StrictMode's discarded mount) must not drive the UI
    let status = null;
    if (map.getZoom() < MIN_ZOOM) status = { kind: 'prompt', text: `Zoom in to ${MIN_ZOOM} for slope` };
    else if (pendingTiles > 0) status = { kind: 'loading', label: loadingLabel };
    else if (isFlatView) status = { kind: 'info', text: 'Very little slope in this area' };
    const key = status ? `${status.kind}:${status.text ?? status.label}` : null;
    if (key === lastStatusKey) return;
    lastStatusKey = key;
    onStatusChange?.(status);
  }
  function startNetworkLoad() {
    if (pendingTiles++ === 0) {
      loadingLabel = `${LOADING_VERBS[Math.floor(Math.random() * LOADING_VERBS.length)]} slope analysis`;
    }
    updateStatus();
  }
  function endNetworkLoad() {
    pendingTiles--;
    updateStatus();
  }

  // Loading placeholder: tiles Mapbox is waiting on get an animated stripe fill, so "not loaded
  // yet" never reads as "flat" (0% slope is near-transparent, so an empty tile looked identical
  // to level ground). Only tiles at the zoom Mapbox is actually drawing get one — it also
  // requests parent/prefetch tiles, which would otherwise stripe areas that are already shown.
  const PENDING_SRC_ID = 'slope-pending-src';
  const PENDING_LAYER_ID = 'slope-pending';
  const STRIPE_FRAMES = 8;
  const pendingDisplay = new Map(); // `${z}:${x}:${y}` → { z, x, y }

  function drawingZoom() {
    return Math.min(ANALYSIS_ZOOM, Math.max(DISPLAY_MIN_ZOOM, Math.floor(map.getZoom() + 1)));
  }

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
        if (t.z !== z) continue;
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
      maxzoom: ANALYSIS_ZOOM, // Mapbox overscales z14 for closer zooms
      async loadTile({ z, x, y }, { signal }) {
        const key = `${z}:${x}:${y}`;
        pendingDisplay.set(key, { z, x, y });
        syncPendingLayer();
        try {
          const grid = z >= ANALYSIS_ZOOM ? await getAnalysisGrid(x, y, signal) : await getDisplayGrid(z, x, y, signal);
          if (signal.aborted || !grid) return null;
          return colorizeGrid(grid);
        } finally {
          pendingDisplay.delete(key);
          syncPendingLayer();
        }
      },
    };
  }

  function addSlopeLayer() {
    if (!map.getSource(SLOPE_SRC_ID)) map.addSource(SLOPE_SRC_ID, createSlopeSource());
    if (!map.getLayer(SLOPE_LAYER_ID)) {
      map.addLayer({
        id: SLOPE_LAYER_ID,
        type: 'raster',
        source: SLOPE_SRC_ID,
        minzoom: MIN_ZOOM,
        // Standard style's 'night' lightPreset dims the whole scene's ambient light, which
        // flattened this layer's colors no matter how much alpha/brightness was baked into the
        // pixels. raster-emissive-strength makes the layer render as self-lit, bypassing that.
        // No fade: tiles fading up from transparent read as briefly flatter than they are.
        // Slightly translucent so the basemap's roads and labels read through the slope colors.
        paint: { 'raster-emissive-strength': 1, 'raster-fade-duration': 0, 'raster-opacity': 0.85 },
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
    if (map.getZoom() < MIN_ZOOM || pendingTiles > 0) return setFlatView(false);
    const b = map.getBounds();
    const nw = lngLatToTileFrac(b.getWest(), b.getNorth(), ANALYSIS_ZOOM);
    const se = lngLatToTileFrac(b.getEast(), b.getSouth(), ANALYSIS_ZOOM);
    let total = 0, found = 0, steep = 0;
    for (let i = 0; i < FLAT_SAMPLES_PER_SIDE; i++) {
      for (let j = 0; j < FLAT_SAMPLES_PER_SIDE; j++) {
        const fx = nw.x + (se.x - nw.x) * ((i + 0.5) / FLAT_SAMPLES_PER_SIDE);
        const fy = nw.y + (se.y - nw.y) * ((j + 0.5) / FLAT_SAMPLES_PER_SIDE);
        const tx = Math.floor(fx), ty = Math.floor(fy);
        total++;
        const grid = gridCache.get(`${ANALYSIS_ZOOM}:${tx}:${ty}`);
        if (!grid) continue;
        const v = grid[Math.floor((fy - ty) * TILE_SIZE) * TILE_SIZE + Math.floor((fx - tx) * TILE_SIZE)];
        if (v === NO_DATA) continue;
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
          'line-color': 'rgba(255, 255, 255, 0.7)',
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

  function clearSelection() {
    selectedAin = null;
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
    map.getSource(SELECTED_FILL_SRC_ID)?.setData({ type: 'FeatureCollection', features: [geom] });
    map.getSource(SELECTED_LINE_SRC_ID)?.setData({ type: 'FeatureCollection', features: [geom] });

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

  if (onSlopeHover) {
    map.on('mousemove', (e) => {
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
    workers.forEach(({ worker }) => worker.terminate());
    jobQueue.length = 0;
    workerJobs.forEach((job) => job.reject(new DOMException('map removed', 'AbortError')));
    parcelFetchToken++;
  });

  return Object.assign(map, { clearSelection, goToAddress });
}
