// Stáhne postavy pro zkušební realistický vzhled (js/realpeople.js) do assets/real/people/.
// Modely jsou od Quaternia (quaternius.com) z poly.pizza, licence CC0; skript u každého ověří, že stránka
// modelu licenci CC0 uvádí. Použití: node tools/fetch-people.mjs
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'real', 'people');
const MODELS = { casual: 'kZ3DmIoGip', woman_casual: 'jpKRgGDxhk', man: 'HMnuH5geEG', worker: 'Yg2bQZO6Hj', woman: 'AQsd9ngvKU', woman_top: 'XqzeZGB7iU' };
const UA = { 'User-Agent': 'Mozilla/5.0 (zavody-fetch-people)' };

mkdirSync(OUT, { recursive: true });
let total = 0;
for (const [name, slug] of Object.entries(MODELS)) {
  const file = join(OUT, `${name}.glb`);
  if (existsSync(file)) continue;
  const page = await (await fetch(`https://poly.pizza/m/${slug}`, { headers: UA })).text();
  if (!page.includes('Public Domain (CC0)') || !/href="\/u\/Quaternius"/.test(page)) throw new Error(`${name}: stránka neuvádí CC0 od Quaternia`);
  const url = page.match(/https:\/\/static\.poly\.pizza\/[0-9a-f-]+\.glb/)?.[0];
  if (!url) throw new Error(`${name}: odkaz na model nenalezen`);
  const buf = Buffer.from(await (await fetch(url, { headers: UA })).arrayBuffer());
  writeFileSync(file, buf);
  total += buf.length;
  console.log(`${name}.glb ${(buf.length / 1e6).toFixed(2)} MB`);
}
console.log(`staženo ${(total / 1e6).toFixed(1)} MB do ${OUT}`);
