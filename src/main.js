import mapboxgl from 'mapbox-gl';
import './style.css';
import iconPlusCircle from './icons/PlusCircle.svg?raw';
import iconMinusCircle from './icons/MinusCircle.svg?raw';
import iconCompass from './icons/Compass.svg?raw';
import iconCrosshairSimple from './icons/CrosshairSimple.svg?raw';
import { clerk, initAuth } from './auth.js';

// Everything below only runs once Clerk confirms the user is signed in — see the
// bootstrap block at the bottom of this file.
function startApp() {

const token = import.meta.env.VITE_MAPBOX_TOKEN;
if (!token) {
  document.getElementById('status').textContent =
    'Missing VITE_MAPBOX_TOKEN — copy .env.example to .env.local and add your Mapbox token.';
  throw new Error('VITE_MAPBOX_TOKEN is not set');
}
mapboxgl.accessToken = token;

const DEFAULT_CAMERA = {
  center: [-118.335827, 34.106652], // Griffith Park / Hollywood Hills — style's default map position
  zoom: 14.11,
  bearing: 25.51,
  pitch: 61.34,
};

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/bzyluke/cmt4n38e5007z01sgaw7lhf44',
  minZoom: 4.5,
  maxZoom: 17.5,
  ...DEFAULT_CAMERA,
});

// Mapbox Standard auto-selects a lightPreset based on real-world time of day if left unset,
// which made the map's look drift depending on when you opened it — pin it to 'day'.
map.on('style.load', () => map.setConfigProperty('basemap', 'lightPreset', 'day'));

const els = {
  status: document.getElementById('status'),
  zoomIn: document.getElementById('zoom-in'),
  zoomOut: document.getElementById('zoom-out'),
  resetBearing: document.getElementById('reset-bearing'),
  resetView: document.getElementById('reset-view'),
  gradientBar: document.getElementById('gradient-bar'),
  gradientTooltip: document.getElementById('gradient-tooltip'),
};

// The gradient bar's stops are positioned by percent-of-width (0-100), so cursor position
// maps directly to slope percent — no separate scale to keep in sync with the color ramp.
els.gradientBar.addEventListener('mousemove', (e) => {
  const rect = els.gradientBar.getBoundingClientRect();
  const t = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  const pct = Math.round(t * 100);
  els.gradientTooltip.textContent = `${pct}%`;
  els.gradientTooltip.style.left = `${t * rect.width}px`;
  els.gradientTooltip.classList.add('visible');
});
els.gradientBar.addEventListener('mouseleave', () => {
  els.gradientTooltip.classList.remove('visible');
});

els.zoomIn.innerHTML = iconPlusCircle;
els.zoomOut.innerHTML = iconMinusCircle;
els.resetBearing.innerHTML = iconCompass;
els.resetView.innerHTML = iconCrosshairSimple;

els.zoomIn.addEventListener('click', () => map.zoomIn());
els.zoomOut.addEventListener('click', () => map.zoomOut());
els.resetBearing.addEventListener('click', () => map.easeTo({ bearing: 0, pitch: map.getPitch() }));
els.resetView.addEventListener('click', () => map.easeTo(DEFAULT_CAMERA));

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
  if (pct <= RAMP_STOPS[0][0]) return RAMP_STOPS[0].slice(1);
  for (let i = 1; i < RAMP_STOPS.length; i++) {
    if (pct <= RAMP_STOPS[i][0]) {
      const [p0, r0, g0, b0, a0] = RAMP_STOPS[i - 1];
      const [p1, r1, g1, b1, a1] = RAMP_STOPS[i];
      const t = (pct - p0) / (p1 - p0);
      return [r0 + (r1 - r0) * t, g0 + (g1 - g0) * t, b0 + (b1 - b0) * t, a0 + (a1 - a0) * t];
    }
  }
  return RAMP_STOPS[RAMP_STOPS.length - 1].slice(1);
}

function lngLatToTile(lng, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y };
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

let refreshToken = 0;

// Double-buffered layers so a refresh crossfades into place instead of popping in/out —
// each new mosaic fades into the currently-hidden buffer while the old one fades out.
const LAYER_IDS = ['slope-a', 'slope-b'];
const FADE_MS = 450;
let activeIdx = -1; // -1 = nothing shown yet

const LAYER_OPACITY = 1;

function showMosaic(dataUrl, coordinates) {
  const nextIdx = (activeIdx + 1) % 2;
  const nextId = LAYER_IDS[nextIdx];
  const nextSrcId = `${nextId}-src`;
  const prevId = activeIdx === -1 ? null : LAYER_IDS[activeIdx];

  const existingSrc = map.getSource(nextSrcId);
  if (existingSrc) {
    existingSrc.updateImage({ url: dataUrl, coordinates });
  } else {
    map.addSource(nextSrcId, { type: 'image', url: dataUrl, coordinates });
  }
  if (!map.getLayer(nextId)) {
    map.addLayer({
      id: nextId,
      type: 'raster',
      source: nextSrcId,
      paint: { 'raster-opacity': 0, 'raster-opacity-transition': { duration: FADE_MS } },
    });
  }

  // Deferred a frame so the newly-added layer/source is committed before animating its opacity.
  requestAnimationFrame(() => {
    map.setPaintProperty(nextId, 'raster-opacity', LAYER_OPACITY);
    if (prevId) map.setPaintProperty(prevId, 'raster-opacity', 0);
  });

  activeIdx = nextIdx;
}

function hideActiveLayer() {
  if (activeIdx === -1) return;
  map.setPaintProperty(LAYER_IDS[activeIdx], 'raster-opacity', 0);
}

const GRID_RADIUS = 3; // tiles out from center in each direction (7x7 = 49 tiles)
const MIN_ZOOM = 13;

// Per-tile cache of the fully-colored slope canvas, keyed by `${zoom}:${tx}:${ty}` — revisiting
// an area (or a grid that shifts by a tile or two while panning) reuses this instead of
// re-fetching and recomputing tiles we've already processed. Simple FIFO cap on size.
const tileCache = new Map();
const TILE_CACHE_LIMIT = 500;
function cacheTile(key, canvas) {
  tileCache.set(key, canvas);
  if (tileCache.size > TILE_CACHE_LIMIT) tileCache.delete(tileCache.keys().next().value);
}

function renderSlopeTile(bitmap, mpp, tileSize) {
  const work = document.createElement('canvas');
  work.width = tileSize;
  work.height = tileSize;
  const wctx = work.getContext('2d', { willReadFrequently: true });
  wctx.drawImage(bitmap, 0, 0, tileSize, tileSize);
  const src = wctx.getImageData(0, 0, tileSize, tileSize);
  const out = wctx.createImageData(tileSize, tileSize);
  const at = (arr, px, py) => {
    const cx = Math.min(tileSize - 1, Math.max(0, px));
    const cy = Math.min(tileSize - 1, Math.max(0, py));
    return arr[cy * tileSize + cx];
  };

  // Decode raw elevation, then smooth it before differencing — taking a derivative of
  // unsmoothed data amplifies per-pixel quantization noise into a "cauliflower" texture.
  const rawElev = new Float32Array(tileSize * tileSize);
  for (let y = 0; y < tileSize; y++) {
    for (let x = 0; x < tileSize; x++) {
      const i = (y * tileSize + x) * 4;
      const r = src.data[i], g = src.data[i + 1], b = src.data[i + 2];
      rawElev[y * tileSize + x] = -10000 + (r * 65536 + g * 256 + b) * 0.1;
    }
  }
  const elev = new Float32Array(tileSize * tileSize);
  for (let y = 0; y < tileSize; y++) {
    for (let x = 0; x < tileSize; x++) {
      let sum = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) sum += at(rawElev, x + kx, y + ky);
      }
      elev[y * tileSize + x] = sum / 9;
    }
  }

  // Horn's method: the standard GDAL/QGIS/ArcGIS slope kernel — a weighted 3x3 average
  // per axis, inherently smoother than a 2-point central difference.
  for (let y = 0; y < tileSize; y++) {
    for (let x = 0; x < tileSize; x++) {
      const a = at(elev, x - 1, y - 1), b2 = at(elev, x, y - 1), c = at(elev, x + 1, y - 1);
      const d = at(elev, x - 1, y), f = at(elev, x + 1, y);
      const g = at(elev, x - 1, y + 1), h = at(elev, x, y + 1), i2 = at(elev, x + 1, y + 1);
      const dzdx = ((c + 2 * f + i2) - (a + 2 * d + g)) / (8 * mpp);
      const dzdy = ((g + 2 * h + i2) - (a + 2 * b2 + c)) / (8 * mpp);
      const percent = Math.sqrt(dzdx * dzdx + dzdy * dzdy) * 100; // rise/run, as a %
      const i = (y * tileSize + x) * 4;
      const [r, g2, b3, a2] = percentToColor(percent);
      out.data[i] = r; out.data[i + 1] = g2; out.data[i + 2] = b3; out.data[i + 3] = Math.round(a2 * 255);
    }
  }
  wctx.putImageData(out, 0, 0);
  return work;
}

// Small nudges, individual scroll-wheel ticks, and pitch/rotate gestures all fire `moveend`
// even when the underlying DEM tile selection hasn't actually changed. Re-fetching and
// recomputing on every one of those made the layer feel like it was constantly reloading —
// skip the whole cycle whenever we're still covering the same tile grid.
let lastGridKey = null;

async function refreshSlopeLayer() {
  const myToken = ++refreshToken;

  if (map.getZoom() < MIN_ZOOM) {
    lastGridKey = null;
    els.status.textContent = 'Zoom in to get Slopes';
    els.status.classList.remove('is-loading');
    hideActiveLayer();
    return;
  }

  const zoom = Math.min(15, Math.round(map.getZoom())); // 15 is terrain-RGB's native max

  // map.getBounds() is unusable under pitch — a tilted camera's view extends toward the
  // horizon, which blows the bbox up toward the whole map. A fixed grid around the center
  // point is pitch-independent and covers the near field the camera actually shows.
  const center = map.getCenter();
  const centerTile = lngLatToTile(center.lng, center.lat, zoom);
  const tileRange = 2 ** zoom - 1;
  const xMin = Math.max(0, centerTile.x - GRID_RADIUS), xMax = Math.min(tileRange, centerTile.x + GRID_RADIUS);
  const yMin = Math.max(0, centerTile.y - GRID_RADIUS), yMax = Math.min(tileRange, centerTile.y + GRID_RADIUS);
  const cols = xMax - xMin + 1, rows = yMax - yMin + 1;

  const gridKey = `${zoom}:${xMin}:${yMin}:${xMax}:${yMax}`;
  if (gridKey === lastGridKey) return; // same tiles as last render — nothing to do
  lastGridKey = gridKey; // claim it now so an identical grid can't queue a second run mid-flight

  const tileSize = 256;
  const mosaic = document.createElement('canvas');
  mosaic.width = cols * tileSize;
  mosaic.height = rows * tileSize;
  const mctx = mosaic.getContext('2d');

  const centerLat = map.getCenter().lat;
  const mpp = metersPerPixel(centerLat, zoom, tileSize);

  const tiles = [];
  for (let ty = yMin; ty <= yMax; ty++) {
    for (let tx = xMin; tx <= xMax; tx++) tiles.push({ tx, ty, key: `${zoom}:${tx}:${ty}` });
  }
  const needsFetch = tiles.filter((t) => !tileCache.has(t.key));

  // Phase 1: fetch — pull only the DEM tiles we haven't already cached, in parallel.
  let fetchedByKey = new Map();
  if (needsFetch.length > 0) {
    els.status.textContent = 'Fetching';
    els.status.classList.add('is-loading');
    await yieldFrame();

    const fetched = await Promise.all(
      needsFetch.map(async ({ tx, ty, key }) => {
        try {
          const res = await fetch(DEM_URL(zoom, tx, ty));
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const bitmap = await createImageBitmap(await res.blob());
          return { key, bitmap };
        } catch (err) {
          console.error('DEM tile failed', tx, ty, err);
          return { key, bitmap: null }; // leave this tile blank rather than aborting the mosaic
        }
      })
    );
    if (myToken !== refreshToken) return; // superseded while tiles were loading
    fetchedByKey = new Map(fetched.map((f) => [f.key, f]));

    // Phase 2: render — decode elevation, smooth it, and compute slope for the new tiles only.
    els.status.textContent = 'Rendering';
    await yieldFrame();
  }

  for (const { tx, ty, key } of tiles) {
    let tileCanvas = tileCache.get(key);
    if (!tileCanvas) {
      const f = fetchedByKey.get(key);
      if (f && f.bitmap) {
        tileCanvas = renderSlopeTile(f.bitmap, mpp, tileSize);
        cacheTile(key, tileCanvas);
      }
    }
    if (tileCanvas) mctx.drawImage(tileCanvas, (tx - xMin) * tileSize, (ty - yMin) * tileSize);
  }
  if (myToken !== refreshToken) return; // superseded while rendering

  const topLeft = tileToLngLat(xMin, yMin, zoom);
  const bottomRight = tileToLngLat(xMax + 1, yMax + 1, zoom);
  const coordinates = [
    [topLeft.lng, topLeft.lat],
    [bottomRight.lng, topLeft.lat],
    [bottomRight.lng, bottomRight.lat],
    [topLeft.lng, bottomRight.lat],
  ];

  // Phase 3: improving quality — a light finishing blur to smooth residual stair-stepping
  // from the coarse source grid. Skip the status flash entirely if every tile was cached.
  if (needsFetch.length > 0) {
    els.status.textContent = 'Improving Quality';
    els.status.classList.add('is-loading');
    await yieldFrame();
  }

  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = mosaic.width;
  finalCanvas.height = mosaic.height;
  const fctx = finalCanvas.getContext('2d');
  fctx.filter = 'blur(1px)';
  fctx.drawImage(mosaic, 0, 0);
  const dataUrl = finalCanvas.toDataURL('image/png');
  if (myToken !== refreshToken) return; // superseded during the finishing pass

  showMosaic(dataUrl, coordinates);

  els.status.classList.remove('is-loading');
  els.status.textContent = '';
}

function yieldFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

let refreshTimer = null;
function scheduleRefresh(delay = 700) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshSlopeLayer, delay);
}

map.on('load', () => scheduleRefresh(0));
map.on('moveend', () => scheduleRefresh());

} // end startApp

const authGate = document.getElementById('auth-gate');
const app = document.getElementById('app');
let appStarted = false;
let userButtonMounted = false;

function showApp() {
  authGate.hidden = true;
  app.hidden = false;
  if (!userButtonMounted) {
    userButtonMounted = true;
    clerk.mountUserButton(document.getElementById('user-button'));
  }
  if (!appStarted) {
    appStarted = true;
    startApp();
  }
}

function showSignIn() {
  authGate.hidden = false;
  app.hidden = true;
}

initAuth().then(() => {
  if (clerk.user) {
    showApp();
  } else {
    clerk.mountSignIn(document.getElementById('clerk-auth'));
    showSignIn();
  }

  // Reacts to sign-in/sign-out without a full page reload.
  clerk.addListener(({ user }) => {
    if (user) showApp();
    else showSignIn();
  });
});
