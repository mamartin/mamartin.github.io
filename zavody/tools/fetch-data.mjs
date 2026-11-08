// Stáhne surová data pro trať města do tools/data/<město>/ (necommituje se).
// Použití: node fetch-data.mjs [město] [osm] [dmr] [dmp] [ruian] [osm_shops …]   (bez města Dobříš, bez dalších argumentů vše)
//          node fetch-data.mjs [město] listy   vypíše listy DMR 5G / DMP 1G, které zasahují do výřezu města
//
// OSM přes Overpass API (ODbL), výškopis DMR 5G z ATOM služby ČÚZK po listech LAZ,
// počty podlaží z RÚIAN (výměnný formát VFR obce, otevřená data ČÚZK). Výřez, listy a obec jsou v cities/<město>.mjs.
// Bodové getSamples na ImageServeru ČÚZK vrací 403, proto listy.

import { writeFileSync, mkdirSync, existsSync, createWriteStream, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { loadCity, TOOLS } from './lib/city.mjs';

const { city, args, data: DATA } = await loadCity();
const UA = 'mamartin-zavody-track-tool/0.2';
const BBOX = city.bbox;
const SHEETS = city.sheets ?? [];
const OBEC = city.obec;

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
nwr["name"~"${city.townHallNames ?? 'radnice|Radnice|[Mm]ěstský úřad'}"];way["highway"~"^(footway|path|steps|cycleway)$"];);
out body geom;`,
  osm_shops: `[out:json][timeout:120][bbox:${BBOX}];
(nwr["shop"];nwr["amenity"~"^(restaurant|cafe|pub|bar|fast_food|bank|pharmacy|post_office|ice_cream)$"];node["highway"="crossing"];);
out tags center;`,
  osm_signs: `[out:json][timeout:120][bbox:${BBOX}];
(node["traffic_sign"];node["highway"~"^(stop|give_way|bus_stop|traffic_signals|speed_camera)$"];
node["public_transport"="platform"];way["traffic_sign"];);
out body geom;`,
  osm_extra: `[out:json][timeout:120][bbox:${BBOX}];
(nwr["place"="square"];nwr["amenity"="parking"];way["area:highway"];way["highway"]["area"="yes"];way["man_made"="bridge"];way["barrier"="guard_rail"];);
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

// listy SM5, které zasahují do výřezu: z přehledu ATOM služby (celá republika, stáhne se jednou)
async function listSheets() {
  const feed = join(TOOLS, 'data', 'dmr_atom_feed.xml');
  if (!existsSync(feed)) {
    mkdirSync(join(TOOLS, 'data'), { recursive: true });
    const res = await fetch('https://atom.cuzk.gov.cz/DMR5G-SJTSK/DMR5G-SJTSK.xml', { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`přehled listů: ${res.status}`);
    writeFileSync(feed, await res.text());
  }
  const [la0, lo0, la1, lo1] = BBOX.split(',').map(Number);
  const xml = readFileSync(feed, 'utf8');
  const out = [];
  for (const m of xml.matchAll(/SJTSK_([A-Z]{4}\d\d)\.xml<\/id>[\s\S]*?mapový list: ([^<]+)<\/title>[\s\S]*?<georss:polygon>([^<]+)<\/georss:polygon>/g)) {
    const v = m[3].trim().split(/\s+/).map(Number);
    const lats = v.filter((_, i) => i % 2 === 0), lons = v.filter((_, i) => i % 2 === 1);
    if (Math.min(...lats) < la1 && Math.max(...lats) > la0 && Math.min(...lons) < lo1 && Math.max(...lons) > lo0) out.push(`${m[1]} (${m[2]})`);
  }
  console.log(`listy pro ${city.name} (${BBOX}): ${out.sort().join(', ')}`);
  const missing = out.map((s) => s.slice(0, 6)).filter((id) => !SHEETS.includes(id));
  if (missing.length) console.log(`v cities/${city.id}.mjs chybí: ${missing.join(', ')} (stačí ty pod tratí a 560 m kolem ní, chybějící osm2track ohlásí)`);
}

const want = args;
if (want.includes('listy')) {
  await listSheets();
  process.exit(0);
}
const all = !want.length;
mkdirSync(DATA, { recursive: true });
for (const name of Object.keys(QUERIES)) if (all || want.includes('osm') || want.includes(name)) await overpass(name);
if (all || want.includes('dmr')) {
  const files = [];
  for (const id of SHEETS) files.push(await sheet(id));
  execFileSync('node', [join(TOOLS, 'laz2grid.mjs'), join(DATA, 'dmr/grid.bin'), ...files], { stdio: 'inherit' });
}
if (all || want.includes('dmp')) for (const id of SHEETS) await sheet(id, 'DMP1G');
if (all || want.includes('ruian')) await ruian();
