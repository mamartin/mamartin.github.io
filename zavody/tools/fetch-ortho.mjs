// Ortofoto ČÚZK (WMS, CC BY 4.0) v plném rozlišení pro zkušební realistický vzhled (js/real.js):
// čtverec 512 × 512 m po 12,5 cm kolem zadaných míst trati (metry od startu), uložený jako JPEG
// do assets/real/<město>-orto-<n>.jpg. Vedle něj <město>-orto.json s převodem ze souřadnic hry
// (x, z) na souřadnice v obrázku: u = a·x + b·z + c, v = d·x + e·z + f (obrázek je v S-JTSK, vůči
// hře pootočený; na 500 m je převod s přesností na centimetry lineární).
// Použití: node tools/fetch-ortho.mjs pribram 60 1550
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCenterline } from '../js/trackmath.js';
import { localProjection, wgsToKrovak } from './lib/geo.mjs';
import { loadCity, loadTrack, loadScene } from './lib/city.mjs';

const SIZE = 512, PX = 4096;
const [city, ...at] = process.argv.slice(2);
const ctx = await loadCity([city]);
const TRACK = await loadTrack(ctx);
const scene = loadScene(ctx);
const cl = buildCenterline(TRACK);
const proj = localProjection(scene.origin.lat, scene.origin.lon);
// hra: x na východ, z na jih
const krovak = (x, z) => wgsToKrovak(...proj.inverse(x, -z));
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'real');
mkdirSync(OUT, { recursive: true });
const patches = [];
for (const [n, s] of at.map(Number).entries()) {
  const k = Math.min(cl.N - 1, Math.round(s / cl.step));
  const cx = cl.px[k], cz = cl.pz[k];
  const [e, nn] = krovak(cx, cz);
  const e0 = Math.round(e) - SIZE / 2, n0 = Math.round(nn) - SIZE / 2;
  const url = `https://ags.cuzk.gov.cz/arcgis1/services/ORTOFOTO/MapServer/WMSServer?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=0&STYLES=&CRS=EPSG:5514&BBOX=${[e0, n0, e0 + SIZE, n0 + SIZE].join(',')}&WIDTH=${PX}&HEIGHT=${PX}&FORMAT=image/jpeg`;
  const res = await fetch(url, { headers: { 'User-Agent': 'zavody-fetch-ortho' } });
  if (!res.ok || !res.headers.get('content-type')?.includes('jpeg')) throw new Error(`ortofoto ${s}: ${res.status} ${res.headers.get('content-type')}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const file = `${city}-orto-${n}.jpg`;
  writeFileSync(join(OUT, file), buf);
  // lineární převod ze tří bodů (střed a 100 m po osách hry)
  const uv = (x, z) => { const [pe, pn] = krovak(x, z); return [(pe - e0) / SIZE, (pn - n0) / SIZE]; };
  const [u0, v0] = uv(cx, cz), [u1, v1] = uv(cx + 100, cz), [u2, v2] = uv(cx, cz + 100);
  const a = (u1 - u0) / 100, b = (u2 - u0) / 100, d = (v1 - v0) / 100, ee = (v2 - v0) / 100;
  patches.push({ file, s, m: [a, b, u0 - a * cx - b * cz, d, ee, v0 - d * cx - ee * cz] });
  console.log(`${file}: ${(buf.length / 1e6).toFixed(1)} MB, střed [${cx.toFixed(0)}, ${cz.toFixed(0)}]`);
}
writeFileSync(join(OUT, `${city}-orto.json`), JSON.stringify({ credit: 'Ortofoto © ČÚZK, CC BY 4.0', patches }));
