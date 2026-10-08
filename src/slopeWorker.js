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
const MAX_VALUE = 65534; // 65535 is reserved as the "no data" sentinel

const canvas = new OffscreenCanvas(N, N);
const ctx = canvas.getContext('2d', { willReadFrequently: true });

async function fetchElevation(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const bitmap = await createImageBitmap(await res.blob());
  ctx.clearRect(0, 0, N, N);
  ctx.drawImage(bitmap, 0, 0, N, N);
  bitmap.close();
  const src = ctx.getImageData(0, 0, N, N).data;
  // Terrain-RGB encodes elevation in meters as: -10000 + (R*65536 + G*256 + B) * 0.1
  const elev = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    elev[i] = -10000 + (src[i * 4] * 65536 + src[i * 4 + 1] * 256 + src[i * 4 + 2]) * 0.1;
  }
  return elev;
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
      grid[y * N + x] = Math.min(MAX_VALUE, Math.round(Math.sqrt(dzdx * dzdx + dzdy * dzdy) * k));
    }
  }
  return grid;
}

self.onmessage = async ({ data: { id, urls, mpp } }) => {
  try {
    const results = await Promise.allSettled(urls.map(fetchElevation));
    if (results[4].status !== 'fulfilled') throw results[4].reason;
    const tiles = results.map((r) => (r.status === 'fulfilled' ? r.value : null));
    const grid = computeSlopeGrid(buildPadded(tiles), mpp);
    self.postMessage({ id, grid }, [grid.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
