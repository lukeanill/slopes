// Persists computed slope grids in IndexedDB so revisiting an area after a page reload skips
// both the DEM fetch and the slope computation. Grids are gzipped (smooth slope data compresses
// well) and the store is capped, evicting the oldest-saved tiles first. Every operation fails
// soft — if IndexedDB is unavailable (private mode, blocked storage) the map just recomputes.

const DB_NAME = 'slope-cache';
const STORE = 'grids';
// Bump whenever computeSlopeGrid's output changes, so stale grids from an older algorithm are
// never served — old-version keys simply stop matching and age out through eviction.
const GRID_VERSION = 2;
const MAX_ENTRIES = 2000; // ~75KB each gzipped → ~150MB ceiling
const PRUNE_EVERY = 100; // writes between eviction passes

let dbPromise = null;
function openDb() {
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE).createIndex('savedAt', 'savedAt');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

const keyFor = (key) => `v${GRID_VERSION}:${key}`;

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadGrid(key) {
  try {
    const db = await openDb();
    if (!db) return null;
    const entry = await request(db.transaction(STORE).objectStore(STORE).get(keyFor(key)));
    if (!entry) return null;
    const stream = entry.data.stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint16Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

let writesSincePrune = 0;
export async function saveGrid(key, grid) {
  try {
    const db = await openDb();
    if (!db) return;
    const stream = new Blob([grid]).stream().pipeThrough(new CompressionStream('gzip'));
    const data = await new Response(stream).blob();
    await request(db.transaction(STORE, 'readwrite').objectStore(STORE).put({ data, savedAt: Date.now() }, keyFor(key)));
    if (++writesSincePrune >= PRUNE_EVERY) {
      writesSincePrune = 0;
      await prune(db);
    }
  } catch {
    // best-effort cache — ignore quota/transaction failures
  }
}

async function prune(db) {
  const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
  const excess = (await request(store.count())) - MAX_ENTRIES;
  if (excess <= 0) return;
  let removed = 0;
  await new Promise((resolve, reject) => {
    const cursorReq = store.index('savedAt').openCursor(); // oldest first
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor || removed >= excess) return resolve();
      cursor.delete();
      removed++;
      cursor.continue();
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
}
