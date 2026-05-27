// Generates z18 square grid cells over New Orleans and samples each cell's
// center point against the flood zone and population density polygons.
// Outputs: data/flood-grid.geojson, data/density-grid.geojson

const fs   = require('fs');
const path = require('path');

const ZOOM = 18;
const BBOX = [-90.14, 29.87, -89.87, 30.05]; // [west, south, east, north]

// ── Tile math ──────────────────────────────────────────────────────────────
function lonToTileX(lon, z) {
  return Math.floor((lon + 180) / 360 * (1 << z));
}
function latToTileY(lat, z) {
  const r = lat * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * (1 << z));
}
function tileXToLon(x, z) { return x / (1 << z) * 360 - 180; }
function tileYToLat(y, z) {
  const n = Math.PI - 2 * Math.PI * y / (1 << z);
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

// ── Point-in-polygon (ray casting) ────────────────────────────────────────
function pip(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

function pointInGeom(px, py, geom) {
  if (geom.type === 'Polygon') {
    return pip(px, py, geom.coordinates[0]);
  }
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.some(poly => pip(px, py, poly[0]));
  }
  return false;
}

// ── Bounding box helper ────────────────────────────────────────────────────
function featureBbox(geom) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const walk = c => {
    if (typeof c[0] === 'number') {
      if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0];
      if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1];
    } else c.forEach(walk);
  };
  walk(geom.coordinates);
  return [w, s, e, n];
}

// ── Load source data ───────────────────────────────────────────────────────
console.log('Loading source data...');
const floodSrc   = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/flood-zones.geojson')));
const densitySrc = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/population-density.geojson')));

const floodFeats   = floodSrc.features.map(f => ({ props: f.properties, geom: f.geometry, bb: featureBbox(f.geometry) }));
const densityFeats = densitySrc.features.map(f => ({ props: f.properties, geom: f.geometry, bb: featureBbox(f.geometry) }));

// ── Tile range ─────────────────────────────────────────────────────────────
const txMin = lonToTileX(BBOX[0], ZOOM);
const txMax = lonToTileX(BBOX[2], ZOOM);
const tyMin = latToTileY(BBOX[3], ZOOM); // N → lower Y index
const tyMax = latToTileY(BBOX[1], ZOOM); // S → higher Y index
const total = (txMax - txMin + 1) * (tyMax - tyMin + 1);
console.log(`z${ZOOM} grid: ${txMax - txMin + 1} cols × ${tyMax - tyMin + 1} rows = ${total.toLocaleString()} cells`);

// ── Build grid ─────────────────────────────────────────────────────────────
const floodGrid   = [];
const densityGrid = [];
let done = 0;

for (let tx = txMin; tx <= txMax; tx++) {
  for (let ty = tyMin; ty <= tyMax; ty++) {
    const west  = tileXToLon(tx,     ZOOM);
    const east  = tileXToLon(tx + 1, ZOOM);
    const north = tileYToLat(ty,     ZOOM);
    const south = tileYToLat(ty + 1, ZOOM);
    const cx = (west + east)   / 2;
    const cy = (north + south) / 2;

    const ring = [[west,north],[east,north],[east,south],[west,south],[west,north]];
    const geom = { type: 'Polygon', coordinates: [ring] };

    // Sample flood zone at cell centre
    let fldZone = null;
    for (const f of floodFeats) {
      const [bw, bs, be, bn] = f.bb;
      if (cx < bw || cx > be || cy < bs || cy > bn) continue;
      if (pointInGeom(cx, cy, f.geom)) { fldZone = f.props.FLD_ZONE; break; }
    }
    if (fldZone) floodGrid.push({ type: 'Feature', geometry: geom, properties: { FLD_ZONE: fldZone } });

    // Sample population density at cell centre
    let density = null;
    for (const f of densityFeats) {
      const [bw, bs, be, bn] = f.bb;
      if (cx < bw || cx > be || cy < bs || cy > bn) continue;
      if (pointInGeom(cx, cy, f.geom)) { density = f.props.density; break; }
    }
    if (density != null && density > 0) densityGrid.push({ type: 'Feature', geometry: geom, properties: { density } });

    done++;
    if (done % 10000 === 0) process.stdout.write(`\r  ${done.toLocaleString()} / ${total.toLocaleString()} cells...`);
  }
}

console.log(`\n  Flood grid:   ${floodGrid.length.toLocaleString()} cells`);
console.log(`  Density grid: ${densityGrid.length.toLocaleString()} cells`);

fs.writeFileSync(path.join(__dirname, '../data/flood-grid.geojson'),
  JSON.stringify({ type: 'FeatureCollection', features: floodGrid }));

fs.writeFileSync(path.join(__dirname, '../data/density-grid.geojson'),
  JSON.stringify({ type: 'FeatureCollection', features: densityGrid }));

console.log('Done.');
