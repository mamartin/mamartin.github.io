// Stáhne surová data pro trať Dobříš do tools/data/ (necommituje se).
// Použití: node fetch-data.mjs [osm] [dmr] [dmp] [ruian] [osm_shops …]     (bez argumentu stáhne vše)
//
// OSM přes Overpass API (ODbL), výškopis DMR 5G z ATOM služby ČÚZK po listech LAZ,
// počty podlaží z RÚIAN (výměnný formát VFR obce Dobříš, otevřená data ČÚZK).
// Bodové getSamples na ImageServeru ČÚZK vrací 403, proto listy.

import { writeFileSync, mkdirSync, existsSync, createWriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const DATA = join(dirname(fileURLToPath(import.meta.url)), 'data');
const UA = 'mamartin-zavody-track-tool/0.2';
const BBOX = '49.760,14.135,49.800,14.205';
const SHEETS = ['DOBR66', 'DOBR67', 'DOBR56', 'DOBR57'];
const OBEC = 540111; // Dobříš

const QUERIES = {
  osm_roads: `[out:json][timeout:120][bbox:${BBOX}];
(way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|pedestrian|track)$"];);
out body geom;`,
  osm_poi: `[out:json][timeout:120][bbox:${BBOX}];
(nwr["historic"];nwr["amenity"~"^(place_of_worship|townhall)$"];nwr["tourism"~"^(attraction|museum|viewpoint|artwork)$"];
nwr["building"~"^(church|chapel|castle|civic|public)$"];nwr["place"="square"];nwr["man_made"~"^(tower|water_tower|chimney|mast)$"];
nwr["leisure"~"^(park|garden|pitch|stadium)$"];nwr["natural"="water"];);
out tags center;`,
  osm_area: `[out:json][timeout:170][bbox:${BBOX}];
(way["building"];relation["building"];way["building:part"];nwr["landuse"];
nwr["natural"~"^(water|wood|tree_row|scrub|wetland)$"];node["natural"="tree"];nwr["leisure"];way["waterway"];
way["barrier"~"^(wall|fence|hedge|retaining_wall)$"];node["highway"="street_lamp"];nwr["office"="government"];
nwr["name"~"radnice|Radnice|[Mm]ěstský úřad|[Mm]ěsto Dobříš"];way["highway"~"^(footway|path|steps|cycleway)$"];);
out body geom;`,
  osm_shops: `[out:json][timeout:120][bbox:${BBOX}];
(nwr["shop"];nwr["amenity"~"^(restaurant|cafe|pub|bar|fast_food|bank|pharmacy|post_office|ice_cream)$"];node["highway"="crossing"];);
out tags center;`,
  osm_extra: `[out:json][timeout:120][bbox:${BBOX}];
(nwr["place"="square"];nwr["amenity"="parking"];way["area:highway"];way["highway"]["area"="yes"];way["man_made"="bridge"];);
out body geom;`,
};

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

async function overpass(name) {
  const file = join(DATA, `${name}.json`);
  for (const wait of [0, 15, 30, 60, 120]) {
    await sleep(wait);
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: QUERIES[name] }),
    });
    const text = await res.text();
    if (res.ok && text.includes('"version"')) {
      writeFileSync(file, text);
      console.log(`${name}: ${(text.length / 1024).toFixed(0)} kB`);
      return;
    }
    console.log(`${name}: server je zaneprázdněný (${res.status}), zkusím znovu`);
  }
  throw new Error(`Overpass nedal ${name}`);
}

// list LAZ z DMR 5G (terén) nebo DMP 1G (povrch včetně budov)
async function sheet(id, product = 'DMR5G') {
  const dir = join(DATA, product === 'DMR5G' ? 'dmr' : 'dmp');
  mkdirSync(join(dir, `raw_${id}`), { recursive: true });
  const laz = join(dir, `raw_${id}`, `${id}.laz`);
  if (existsSync(laz)) return laz;
  const zip = join(dir, `${id}.zip`);
  const res = await fetch(`https://openzu.cuzk.gov.cz/opendata/${product}/epsg-5514/${id}.zip`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${id}: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(zip));
  execFileSync('unzip', ['-oq', zip, '-d', join(dir, `raw_${id}`)]);
  console.log(`${product} ${id}: staženo`);
  return laz;
}

// VFR vychází k poslednímu dni měsíce, zkusí se poslední tři
async function ruian() {
  const dir = join(DATA, 'ruian');
  mkdirSync(dir, { recursive: true });
  for (let back = 0; back < 3; back++) {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - back);
    d.setUTCDate(0);
    const day = d.toISOString().slice(0, 10).replaceAll('-', '');
    const res = await fetch(`https://vdp.cuzk.gov.cz/vymenny_format/soucasna/${day}_OB_${OBEC}_UKSH.xml.zip`, { headers: { 'User-Agent': UA } });
    if (!res.ok) continue;
    const zip = join(dir, 'obec.zip');
    await pipeline(Readable.fromWeb(res.body), createWriteStream(zip));
    execFileSync('unzip', ['-oq', zip, '-d', dir]);
    console.log(`RÚIAN ${day}: staženo`);
    return;
  }
  throw new Error('RÚIAN: výměnný soubor obce není k dispozici');
}

const want = process.argv.slice(2);
const all = !want.length;
mkdirSync(DATA, { recursive: true });
for (const name of Object.keys(QUERIES)) if (all || want.includes('osm') || want.includes(name)) await overpass(name);
if (all || want.includes('dmr')) {
  const files = [];
  for (const id of SHEETS) files.push(await sheet(id));
  execFileSync('node', [join(DATA, '..', 'laz2grid.mjs'), join(DATA, 'dmr/grid.bin'), ...files], { stdio: 'inherit' });
}
if (all || want.includes('dmp')) for (const id of SHEETS) await sheet(id, 'DMP1G');
if (all || want.includes('ruian')) await ruian();
