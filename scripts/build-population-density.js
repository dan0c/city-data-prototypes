// Fetches census tract population from Census Reporter and geometry from
// TIGERweb ACS2022 (layer 6), joins by GEOID, computes population density
// (people/km²), and writes data/population-density.geojson.

const https = require('https');
const fs = require('fs');
const path = require('path');

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return get(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
  });
}

async function main() {
  // 1. Population data from Census Reporter
  console.log('Fetching population from Census Reporter...');
  const popRaw = await get(
    'https://api.censusreporter.org/1.0/data/show/latest?table_ids=B01003&geo_ids=140|05000US22071'
  );
  const popData = JSON.parse(popRaw);

  // GEOIDs are like '14000US22071000100' — strip prefix to get 11-digit GEOID
  const popByGeoid = {};
  for (const [geoId, tables] of Object.entries(popData.data)) {
    const geoid = geoId.replace('14000US', '');
    const pop = tables.B01003?.estimate?.B01003001;
    if (pop != null) popByGeoid[geoid] = pop;
  }
  console.log(`  Population for ${Object.keys(popByGeoid).length} tracts`);

  // 2. Tract boundaries from TIGERweb ACS2022 layer 6 (Census Tracts)
  console.log('Fetching tract boundaries from TIGERweb...');
  const base = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2022/MapServer/6/query';
  const params = new URLSearchParams({
    where: "STATE='22' AND COUNTY='071'",
    outFields: 'GEOID,NAME,AREALAND',
    outSR: '4326',
    f: 'geojson'
  });
  const geoRaw = await get(`${base}?${params}`);
  const geoData = JSON.parse(geoRaw);
  console.log(`  ${geoData.features.length} tract features`);

  // 3. Join and compute density
  let matched = 0;
  const features = geoData.features.map(f => {
    const geoid = f.properties.GEOID;
    const pop = popByGeoid[geoid] ?? 0;
    const areaKm2 = (f.properties.AREALAND || 1) / 1_000_000;
    const density = pop / areaKm2;
    if (popByGeoid[geoid] != null) matched++;
    return {
      ...f,
      properties: {
        GEOID: geoid,
        NAME: f.properties.NAME,
        population: pop,
        area_km2: Math.round(areaKm2 * 100) / 100,
        density: Math.round(density)
      }
    };
  });

  console.log(`  Matched ${matched} / ${features.length} tracts`);

  // 4. Compute quintile breakpoints for the colour scale
  const densities = features.map(f => f.properties.density).filter(d => d > 0).sort((a, b) => a - b);
  const pct = p => densities[Math.floor(densities.length * p)] ?? 0;
  const bp = [0.2, 0.4, 0.6, 0.8].map(pct).map(Math.round);
  console.log(`  Density quintile breakpoints (p/km²): ${bp.join(', ')}`);

  const output = { type: 'FeatureCollection', features, metadata: { breakpoints: bp } };
  const outPath = path.join(__dirname, '../data/population-density.geojson');
  fs.writeFileSync(outPath, JSON.stringify(output));
  console.log(`  Saved → ${outPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });
