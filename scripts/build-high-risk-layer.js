// Builds a "high risk" layer: cells that are BOTH in a VE or AE flood zone
// AND in the top 40% population density (> 3,090 / km²).
//
// Score = flood_weight × density_weight, normalised to 0–1:
//   flood:   VE → 1.0,  AE → 0.6
//   density: scaled linearly from 3,090 (→ 0) to max density (→ 1)
//
// Output: data/high-risk-grid.geojson  (property: score 0–1)

const fs   = require('fs');
const path = require('path');

const DENSITY_THRESHOLD = 3090;
const HIGH_RISK_ZONES   = new Set(['VE', 'AE']);
const FLOOD_WEIGHT      = { VE: 1.0, AE: 0.6 };

// ── Load grids ─────────────────────────────────────────────────────────────
const floodGrid   = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/flood-grid.geojson')));
const densityGrid = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/density-grid.geojson')));

// ── Index density cells by top-left corner (west_north) ───────────────────
// Each cell is a rectangle; first coord is [west, north]
const densityByKey = new Map();
for (const f of densityGrid.features) {
  const [west, north] = f.geometry.coordinates[0][0];
  const key = `${west.toFixed(7)},${north.toFixed(7)}`;
  densityByKey.set(key, f.properties.density);
}

// ── Find max density for normalisation ────────────────────────────────────
let maxDensity = 0;
for (const d of densityByKey.values()) {
  if (d > maxDensity) maxDensity = d;
}
console.log(`Density range: ${DENSITY_THRESHOLD} – ${maxDensity} / km²`);

// ── Join and score ─────────────────────────────────────────────────────────
const features = [];

for (const f of floodGrid.features) {
  const zone = f.properties.FLD_ZONE;
  if (!HIGH_RISK_ZONES.has(zone)) continue;

  const [west, north] = f.geometry.coordinates[0][0];
  const key = `${west.toFixed(7)},${north.toFixed(7)}`;
  const density = densityByKey.get(key);

  if (density == null || density < DENSITY_THRESHOLD) continue;

  const floodW   = FLOOD_WEIGHT[zone];
  const densityW = density / maxDensity; // 0–1 relative to city maximum
  const score    = Math.round(floodW * densityW * 100) / 100; // 0–1

  features.push({
    type: 'Feature',
    geometry: f.geometry,
    properties: { FLD_ZONE: zone, density, score }
  });
}

console.log(`High-risk cells: ${features.length}`);

// Score distribution
const buckets = [0, 0, 0, 0, 0];
for (const f of features) {
  const i = Math.min(4, Math.floor(f.properties.score * 5));
  buckets[i]++;
}
console.log(`Score distribution (0–0.2, 0.2–0.4, 0.4–0.6, 0.6–0.8, 0.8–1.0): ${buckets.join(', ')}`);

fs.writeFileSync(
  path.join(__dirname, '../data/high-risk-grid.geojson'),
  JSON.stringify({ type: 'FeatureCollection', features })
);
console.log('Done → data/high-risk-grid.geojson');
