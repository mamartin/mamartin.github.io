// Ortofoto ČÚZK (WMS, CC BY 4.0) pro zkušební realistický vzhled (js/real.js): pás kolem celé trati
// po dlaždicích 260 × 260 m (asi 17 cm na pixel) do assets/real/orto/<město>/<i>_<j>.jpg a seznam
// dlaždic do assets/real/orto/<město>.json.
// Dlaždice leží v mřížce hry: dlaždice (i, j) pokrývá x od i·260 do (i+1)·260 a z od j·260 do (j+1)·260 m.
// Stahují se v EPSG:3857 (sever nahoře jako ve hře, takže se nic neotáčí); hra měří metry na sever jinak
// než na východ (110 574 a 111 320 m na stupeň), proto má obrázek o 0,7 % víc řádků než sloupců.
// Bere se každá dlaždice, která je do 100 m od trati.
// Použití: node tools/fetch-ortho.mjs pribram
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCenterline } from '../js/trackmath.js';
import { localProjection } from './lib/geo.mjs';
import { loadCity, loadTrack, loadScene } from './lib/city.mjs';

const TILE = 260, PAD = 100, PX = 1536;
const R = 6378137, RAD = Math.PI / 180;
const [city] = process.argv.slice(2);
const ctx = await loadCity([city]);
const cl = buildCenterline(await loadTrack(ctx));
const scene = loadScene(ctx);
const proj = localProjection(scene.origin.lat, scene.origin.lon);
// hra: x na východ, z na jih -> souřadnice EPSG:3857
const mercator = (x, z) => {
  const [lat, lon] = proj.inverse(x, -z);
  return [R * lon * RAD, R * Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2))];
};
const want = new Set();
for (let k = 0; k < cl.N; k++) {
  for (const dx of [-PAD, 0, PAD]) for (const dz of [-PAD, 0, PAD]) want.add(`${Math.floor((cl.px[k] + dx) / TILE)}_${Math.floor((cl.pz[k] + dz) / TILE)}`);
}
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'real', 'orto');
mkdirSync(join(OUT, city), { recursive: true });
let total = 0, got = 0;
for (const key of want) {
  const file = join(OUT, city, `${key}.jpg`);
  if (existsSync(file)) continue;
  const [i, j] = key.split('_').map(Number);
  const [x0, y0] = mercator(i * TILE, (j + 1) * TILE), [x1, y1] = mercator((i + 1) * TILE, j * TILE);
  const height = Math.round((PX * (y1 - y0)) / (x1 - x0));
  const url = `https://ags.cuzk.gov.cz/arcgis1/services/ORTOFOTO/MapServer/WMSServer?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=0&STYLES=&CRS=EPSG:3857&BBOX=${[x0, y0, x1, y1].join(',')}&WIDTH=${PX}&HEIGHT=${height}&FORMAT=image/jpeg`;
  const res = await fetch(url, { headers: { 'User-Agent': 'zavody-fetch-ortho' } });
  if (!res.ok || !res.headers.get('content-type')?.includes('jpeg')) throw new Error(`ortofoto ${key}: ${res.status} ${res.headers.get('content-type')}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(file, buf);
  total += buf.length;
  got++;
  await new Promise((r) => setTimeout(r, 300));
}
writeFileSync(join(OUT, `${city}.json`), JSON.stringify({ credit: 'Ortofoto © ČÚZK, CC BY 4.0', tile: TILE, tiles: [...want].sort() }));
console.log(`${city}: ${want.size} dlaždic, staženo ${got} (${(total / 1e6).toFixed(1)} MB)`);
