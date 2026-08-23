# US Slope Map

A live, color-coded slope map of the US built on Mapbox GL JS. Slope is computed
client-side from Mapbox's own terrain-RGB elevation tiles — green (flat) to red
(steep) — with no third-party GIS service in the loop.

## Why not USGS?

The original approach layered USGS's 3DEP WMS slope service directly on top of
Mapbox. That service turned out to be unreliable (intermittent 400/502/504
errors on identical requests) and Mapbox has no slope tileset of its own, so
this app derives slope itself: it fetches the visible terrain-RGB DEM tiles,
computes a per-pixel gradient, colors it, and renders the result as an image
overlay that refreshes as you pan/zoom.

## Setup

```bash
npm install
cp .env.example .env.local   # then add your Mapbox token
npm run dev
```

Get a free token at [account.mapbox.com/access-tokens](https://account.mapbox.com/access-tokens).

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — production build to `dist/`
- `npm run preview` — preview the production build locally
