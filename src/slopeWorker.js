// Fetches one terrain-RGB DEM tile plus its 8 neighbors, decodes them, and computes the tile's
// slope grid off the main thread. Replies with a Uint16Array of slope percent × 10 (transferred).
//
// The neighbors supply a 3px apron of real elevation around the tile, so the smoothing (2px) and
// Horn's slope kernel (1px) see true terrain across tile edges. Computing each tile in isolation
// meant clamping at its edges, which flattened slope along every tile boundary and showed up as
// straight seams across hillsides. Neighbor tiles are mostly already in the HTTP cache (they're
// neighbors' centers too), so this costs extra decoding rather than extra downloading.

const N = 256;
const PAD = 3; // 2px for the 5x5 smoothing + 1px for Horn's kernel
const W = N + PAD * 2;
const MAX_VALUE = 65534;
const NO_DATA = 65535; // "no slope here" — renders transparent
const SEA_LEVEL_M = 0;

const canvas = new OffscreenCanvas(N, N);
const ctx = canvas.getContext('2d', { willReadFrequently: true });

async function fetchElevation(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  // These pixels are data, not a picture: no color management or premultiplication, which could
  // nudge channel values (one step of red is 6.5 km of elevation).
  const bitmap = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  ctx.clearRect(0, 0, N, N);
  ctx.drawImage(bitmap, 0, 0, N, N);
  bitmap.close();
  const src = ctx.getImageData(0, 0, N, N).data;
  // Terrain-RGB encodes elevation in meters as: -10000 + (R*65536 + G*256 + B) * 0.1
  const elev = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    elev[i] = -10000 + (src[i * 4] * 65536 + src[i * 4 + 1] * 256 + src[i * 4 + 2]) * 0.1;
  }
  return fillVoids(elev);
}

// Mapbox's terrain-RGB has occasional gaps filled with 0 m — e.g. a one-pixel column at a
// survey-sheet boundary in New Mexico (14/3327/6533) — which read as a kilometer-high cliff and
// draw a bright line of maximum slope. A 0 m pixel is treated as a gap when there's land well
// above sea level on both sides of it within VOID_REACH pixels (interpolated across), or on the
// one side that exists when the gap runs into the tile edge (copied). Real coastlines are left
// alone: there, the sea is on one side.
const VOID_MAX_M = 0.5;
const VOID_LAND_M = 50;
const VOID_REACH = 4;
const isVoid = (v) => Math.abs(v) <= VOID_MAX_M;
function fillLine(elev, start, step, count) {
  for (let i = 0; i < count; i++) {
    if (!isVoid(elev[start + i * step])) continue;
    let a = -1, b = -1;
    for (let k = 1; k <= VOID_REACH; k++) {
      if (i - k < 0) break;
      if (!isVoid(elev[start + (i - k) * step])) { a = i - k; break; }
    }
    for (let k = 1; k <= VOID_REACH; k++) {
      if (i + k >= count) break;
      if (!isVoid(elev[start + (i + k) * step])) { b = i + k; break; }
    }
    const va = a >= 0 ? elev[start + a * step] : null;
    const vb = b >= 0 ? elev[start + b * step] : null;
    const runsToEdgeBefore = a < 0 && i < VOID_REACH;
    const runsToEdgeAfter = b < 0 && count - 1 - i < VOID_REACH;
    if (va > VOID_LAND_M && vb > VOID_LAND_M) elev[start + i * step] = va + ((vb - va) * (i - a)) / (b - a);
    else if (va > VOID_LAND_M && runsToEdgeAfter) elev[start + i * step] = va;
    else if (vb > VOID_LAND_M && runsToEdgeBefore) elev[start + i * step] = vb;
  }
}
function fillVoids(elev) {
  for (let y = 0; y < N; y++) fillLine(elev, y * N, 1, N); // across rows (vertical gaps)
  for (let x = 0; x < N; x++) fillLine(elev, x, N, N); // down columns (horizontal gaps)
  return elev;
}

// A neighbor whose shared edge doesn't line up with the center tile (mean jump along the edge, or
// at the touching corner) beyond this is treated as missing. Real terrain can't step tens of
// meters between adjacent pixels all along a tile edge; a mismatched neighbor (a bad or misdecoded
// tile) otherwise turns into a band of extreme "slope" along the seam, which got cached.
const SEAM_MAX_M = 25;
function edgeJump(center, tile, dx, dy) {
  if (dx !== 0 && dy !== 0) {
    const c = center[(dy > 0 ? N - 1 : 0) * N + (dx > 0 ? N - 1 : 0)];
    const t = tile[(dy > 0 ? 0 : N - 1) * N + (dx > 0 ? 0 : N - 1)];
    return Math.abs(c - t);
  }
  let sum = 0;
  for (let i = 0; i < N; i++) {
    sum += dx !== 0
      ? Math.abs(center[i * N + (dx > 0 ? N - 1 : 0)] - tile[i * N + (dx > 0 ? 0 : N - 1)])
      : Math.abs(center[(dy > 0 ? N - 1 : 0) * N + i] - tile[(dy > 0 ? 0 : N - 1) * N + i]);
  }
  return sum / N;
}
function dropMismatchedNeighbors(tiles) {
  const center = tiles[4];
  return tiles.map((tile, i) => {
    if (!tile || i === 4) return tile;
    const dx = (i % 3) - 1, dy = Math.floor(i / 3) - 1;
    return edgeJump(center, tile, dx, dy) > SEAM_MAX_M ? null : tile;
  });
}

// tiles: 3x3 row-major (dy -1..1, dx -1..1), center at index 4; missing neighbors are null and
// fall back to clamping the center tile's edge.
function buildPadded(tiles) {
  const center = tiles[4];
  const out = new Float32Array(W * W);
  for (let py = 0; py < W; py++) {
    const sy = py - PAD;
    const ty = sy < 0 ? -1 : sy >= N ? 1 : 0;
    for (let px = 0; px < W; px++) {
      const sx = px - PAD;
      const tx = sx < 0 ? -1 : sx >= N ? 1 : 0;
      const tile = tiles[(ty + 1) * 3 + (tx + 1)];
      out[py * W + px] = tile
        ? tile[(sy - ty * N) * N + (sx - tx * N)]
        : center[Math.min(N - 1, Math.max(0, sy)) * N + Math.min(N - 1, Math.max(0, sx))];
    }
  }
  return out;
}

function computeSlopeGrid(raw, mpp) {
  // Smooth elevation before differencing — taking a derivative of unsmoothed data amplifies the
  // DEM's per-pixel steps into ragged, sawtoothed band edges. A 5x5 binomial (separable 1-4-6-4-1,
  // a close approximation of a Gaussian) is rounder than a 3x3 box: it removes those steps without
  // the box filter's blocky artifacts, at a similar overall amount of smoothing.
  const K = [1, 4, 6, 4, 1];
  const tmp = new Float32Array(W * W);
  for (let y = 0; y < W; y++) {
    for (let x = 2; x < W - 2; x++) {
      const i = y * W + x;
      tmp[i] = (raw[i - 2] * K[0] + raw[i - 1] * K[1] + raw[i] * K[2] + raw[i + 1] * K[3] + raw[i + 2] * K[4]) / 16;
    }
  }
  const elev = new Float32Array(W * W);
  for (let y = 2; y < W - 2; y++) {
    for (let x = 2; x < W - 2; x++) {
      const i = y * W + x;
      elev[i] = (tmp[i - 2 * W] * K[0] + tmp[i - W] * K[1] + tmp[i] * K[2] + tmp[i + W] * K[3] + tmp[i + 2 * W] * K[4]) / 16;
    }
  }

  // Horn's method: the standard GDAL/QGIS/ArcGIS slope kernel — a weighted 3x3 average per axis,
  // inherently smoother than a 2-point central difference. Output is the unpadded tile.
  const grid = new Uint16Array(N * N);
  const k = 100 * 10 / (8 * mpp); // rise/run → percent, stored ×10
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = (y + PAD) * W + (x + PAD);
      const a = elev[i - W - 1], b = elev[i - W], c = elev[i - W + 1];
      const d = elev[i - 1], f = elev[i + 1];
      const g = elev[i + W - 1], h = elev[i + W], j = elev[i + W + 1];
      const dzdx = (c + 2 * f + j) - (a + 2 * d + g);
      const dzdy = (g + 2 * h + j) - (a + 2 * b + c);
      // Below sea level is sea (the DEM includes bathymetry): no slope there, ever. This also
      // blanks the rare dry basins below sea level (e.g. Death Valley's floor), which are flat.
      grid[y * N + x] = raw[i] < SEA_LEVEL_M
        ? NO_DATA
        : Math.min(MAX_VALUE, Math.round(Math.sqrt(dzdx * dzdx + dzdy * dzdy) * k));
    }
  }
  return grid;
}

// Decoded (and gap-filled) DEM tiles, most recently used last. Neighboring analyses share 4–6 of
// their 9 DEM tiles, and the main thread routes neighbors to the same worker, so each tile is
// downloaded and decoded about once instead of up to 9 times. In-flight fetches are shared too.
// ~256 KB per tile.
const DEM_CACHE_LIMIT = 80; // ~20 MB; covers the DEM tiles of the jobs in flight plus their neighbors
const demCache = new Map(); // url → Promise<Float32Array>
function getElevation(url) {
  let p = demCache.get(url);
  if (p) {
    demCache.delete(url);
    demCache.set(url, p);
    return p;
  }
  p = fetchElevation(url);
  demCache.set(url, p);
  p.catch(() => demCache.delete(url)); // don't remember failures — a later job retries
  if (demCache.size > DEM_CACHE_LIMIT) demCache.delete(demCache.keys().next().value);
  return p;
}

self.onmessage = async ({ data: { id, urls, mpp } }) => {
  try {
    const results = await Promise.allSettled(urls.map(getElevation));
    if (results[4].status !== 'fulfilled') throw results[4].reason;
    const tiles = dropMismatchedNeighbors(results.map((r) => (r.status === 'fulfilled' ? r.value : null)));
    const grid = computeSlopeGrid(buildPadded(tiles), mpp);
    self.postMessage({ id, grid }, [grid.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
