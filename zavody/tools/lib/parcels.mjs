// Silniční pozemky z RÚIAN (VFR obce, parcely se způsobem využití 16 silnice a 17 ostatní komunikace).
// Z nich se měří šířka uličního prostoru, OSM šířky vozovek skoro nemá.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pointInRing } from './poly.mjs';

const ROAD_USE = new Set(['16', '17']);
const CELL = 25;

// rings v S-JTSK (e, n) a mřížka pro hledání; bez dat null
export function loadRoadParcels(dir) {
  if (!existsSync(dir)) return null;
  const file = readdirSync(dir).find((f) => f.endsWith('.xml'));
  if (!file) return null;
  const xml = readFileSync(join(dir, file), 'utf8');
  const rings = [];
  for (const m of xml.matchAll(/<vf:Parcela [\s\S]*?<\/vf:Parcela>/g)) {
    const use = /<pai:ZpusobyVyuzitiPozemku>(\d+)</.exec(m[0]);
    if (!use || !ROAD_USE.has(use[1])) continue;
    const outer = /<pai:OriginalniHranice>[\s\S]*?<gml:exterior>[\s\S]*?<gml:posList[^>]*>([^<]+)</.exec(m[0]);
    if (!outer) continue;
    const v = outer[1].trim().split(/\s+/).map(Number);
    const r = [];
    for (let i = 0; i + 1 < v.length; i += 2) r.push([v[i], v[i + 1]]);
    rings.push(r);
  }
  const grid = new Map();
  rings.forEach((r, i) => {
    const es = r.map((p) => p[0]), ns = r.map((p) => p[1]);
    for (let gx = Math.floor(Math.min(...es) / CELL); gx <= Math.floor(Math.max(...es) / CELL); gx++) {
      for (let gy = Math.floor(Math.min(...ns) / CELL); gy <= Math.floor(Math.max(...ns) / CELL); gy++) {
        const key = `${gx},${gy}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(i);
      }
    }
  });
  return { rings, grid };
}

const onRoad = (P, e, n) => (P.grid.get(`${Math.floor(e / CELL)},${Math.floor(n / CELL)}`) ?? []).some((i) => pointInRing(e, n, P.rings[i]));

// šířka silničního pozemku napříč směrem (ue, un) v bodě (e, n); null, když bod na silničním pozemku neleží
export function corridorWidth(P, e, n, ue, un, max = 30) {
  if (!onRoad(P, e, n)) return null;
  const side = (s) => {
    let d = 0;
    while (d < max && onRoad(P, e - un * s * (d + 0.25), n + ue * s * (d + 0.25))) d += 0.25;
    return d;
  };
  const a = side(1), b = side(-1);
  return a >= max || b >= max ? null : a + b;
}

// Všechny parcely s druhem pozemku a způsobem využití (kódy číselníků ČÚZK), obrys v S-JTSK.
// druh: 2 orná, 5 zahrada, 6 sad, 7 trvalý travní porost, 10 les, 11 voda, 13 zastavěná plocha a nádvoří, 14 ostatní plocha;
// use (u ostatních ploch): 12 společný dvůr, 16 silnice, 17 ostatní komunikace, 18 ostatní dopravní plocha, 19 zeleň, 23 manipulační plocha …
export function loadParcels(dir) {
  if (!existsSync(dir)) return null;
  const file = readdirSync(dir).find((f) => f.endsWith('.xml'));
  if (!file) return null;
  const xml = readFileSync(join(dir, file), 'utf8');
  const out = [];
  for (const m of xml.matchAll(/<vf:Parcela [\s\S]*?<\/vf:Parcela>/g)) {
    const druh = /<pai:DruhPozemkuKod>(\d+)</.exec(m[0]);
    const use = /<pai:ZpusobyVyuzitiPozemku>(\d+)</.exec(m[0]);
    const outer = /<pai:OriginalniHranice>[\s\S]*?<gml:exterior>[\s\S]*?<gml:posList[^>]*>([^<]+)</.exec(m[0]);
    if (!druh || !outer) continue;
    const v = outer[1].trim().split(/\s+/).map(Number);
    const ring = [];
    for (let i = 0; i + 1 < v.length; i += 2) ring.push([v[i], v[i + 1]]);
    out.push({ druh: +druh[1], use: use ? +use[1] : 0, ring });
  }
  return out;
}
