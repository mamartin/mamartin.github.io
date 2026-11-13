// Stáhne volně dostupné podklady pro zkušební realistický vzhled (js/real.js) do assets/real/.
// Všechno je z Poly Haven (polyhaven.com), licence CC0: textury 1k JPG (barva, normála OpenGL, hrubost)
// a nebe 2k HDR. Použití: node tools/fetch-real.mjs
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'real');
const TEXTURES = ['asphalt_track', 'concrete_pavers_02', 'leafy_grass', 'clay_roof_tiles_02', 'white_stucco'];
const MAPS = { Diffuse: 'diff', nor_gl: 'nor', Rough: 'rough' };
const SKY = 'kloofendal_48d_partly_cloudy_puresky';

const UA = { 'User-Agent': 'zavody-fetch-real' };
const json = async (url) => (await fetch(url, { headers: UA })).json();
async function save(url, file) {
  if (existsSync(file)) return 0;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(file, buf);
  return buf.length;
}

mkdirSync(OUT, { recursive: true });
let total = 0;
for (const id of TEXTURES) {
  const files = await json(`https://api.polyhaven.com/files/${id}`);
  for (const [key, short] of Object.entries(MAPS)) total += await save(files[key]['1k'].jpg.url, join(OUT, `${id}_${short}.jpg`));
}
const sky = await json(`https://api.polyhaven.com/files/${SKY}`);
total += await save(sky.hdri['2k'].hdr.url, join(OUT, 'sky.hdr'));
console.log(`staženo ${(total / 1e6).toFixed(1)} MB do ${OUT}`);
