// Fetches one terrain-RGB DEM tile, decodes it, and computes its slope grid off the main
// thread — a zoom-11 viewport needs a few hundred of these, which stalled panning when they
// ran on the main thread. Replies with a Uint16Array of slope percent × 10 (transferred).

const N = 256;
// Neighbor index tables clamped at the tile edge, so the per-pixel loops are plain array reads.
const PREV = Int32Array.from({ length: N }, (_, i) => Math.max(0, i - 1));
const NEXT = Int32Array.from({ length: N }, (_, i) => Math.min(N - 1, i + 1));
const MAX_VALUE = 65534; // 65535 is reserved as the "no data" sentinel

const canvas = new OffscreenCanvas(N, N);
const ctx = canvas.getContext('2d', { willReadFrequently: true });

function computeSlopeGrid(src, mpp) {
  // Decode raw elevation, then smooth it before differencing — taking a derivative of
  // unsmoothed data amplifies per-pixel quantization noise into a "cauliflower" texture.
  // Terrain-RGB encodes elevation in meters as: -10000 + (R*65536 + G*256 + B) * 0.1
  const rawElev = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    rawElev[i] = -10000 + (src[i * 4] * 65536 + src[i * 4 + 1] * 256 + src[i * 4 + 2]) * 0.1;
  }
  const elev = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    const r0 = PREV[y] * N, r1 = y * N, r2 = NEXT[y] * N;
    for (let x = 0; x < N; x++) {
      const x0 = PREV[x], x2 = NEXT[x];
      elev[r1 + x] = (
        rawElev[r0 + x0] + rawElev[r0 + x] + rawElev[r0 + x2]
        + rawElev[r1 + x0] + rawElev[r1 + x] + rawElev[r1 + x2]
        + rawElev[r2 + x0] + rawElev[r2 + x] + rawElev[r2 + x2]
      ) / 9;
    }
  }

  // Horn's method: the standard GDAL/QGIS/ArcGIS slope kernel — a weighted 3x3 average
  // per axis, inherently smoother than a 2-point central difference.
  const grid = new Uint16Array(N * N);
  const k = 100 * 10 / (8 * mpp); // rise/run → percent, stored ×10
  for (let y = 0; y < N; y++) {
    const r0 = PREV[y] * N, r1 = y * N, r2 = NEXT[y] * N;
    for (let x = 0; x < N; x++) {
      const x0 = PREV[x], x2 = NEXT[x];
      const a = elev[r0 + x0], b = elev[r0 + x], c = elev[r0 + x2];
      const d = elev[r1 + x0], f = elev[r1 + x2];
      const g = elev[r2 + x0], h = elev[r2 + x], i = elev[r2 + x2];
      const dzdx = (c + 2 * f + i) - (a + 2 * d + g);
      const dzdy = (g + 2 * h + i) - (a + 2 * b + c);
      grid[r1 + x] = Math.min(MAX_VALUE, Math.round(Math.sqrt(dzdx * dzdx + dzdy * dzdy) * k));
    }
  }
  return grid;
}

self.onmessage = async ({ data: { id, url, mpp } }) => {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const bitmap = await createImageBitmap(await res.blob());
    ctx.clearRect(0, 0, N, N);
    ctx.drawImage(bitmap, 0, 0, N, N);
    bitmap.close();
    const grid = computeSlopeGrid(ctx.getImageData(0, 0, N, N).data, mpp);
    self.postMessage({ id, grid }, [grid.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
