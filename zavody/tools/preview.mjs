// Náhledy kandidátních okruhů a jejich okolí. Čte data/loops/loops.json z loops.mjs,
// píše data/loops/okruh-*.svg a metrics.json.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localProjection } from './lib/geo.mjs';
import { douglasPeucker } from './lib/roads.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA = join(ROOT, 'data');
const proj = localProjection(49.7815, 14.1745);
const area = JSON.parse(readFileSync(join(DATA, 'osm_area.json'), 'utf8')).elements;
const roads = JSON.parse(readFileSync(join(DATA, 'osm_roads.json'), 'utf8')).elements.filter((e) => e.type === 'way');
const loops = JSON.parse(readFileSync(join(DATA, 'loops/loops.json'), 'utf8'));

const ring = (e) => (e.geometry || []).filter(Boolean).map((p) => proj.forward(p.lat, p.lon));
const rings = (e) => (e.type === 'relation'
  ? e.members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => m.geometry.map((p) => proj.forward(p.lat, p.lon)))
  : [ring(e)]);
const center = (r) => [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length];

const buildings = area.filter((e) => e.tags?.building && e.type === 'way').map((e) => ({ e, r: ring(e) }));
const parks = area.filter((e) => e.tags?.leisure === 'park' || e.tags?.leisure === 'garden' || e.tags?.landuse === 'forest' || e.tags?.natural === 'wood' || e.tags?.landuse === 'cemetery');
const water = area.filter((e) => e.tags?.natural === 'water');

const townhall = buildings.find((b) => b.e.tags.amenity === 'townhall' && b.e.tags['addr:street'] === 'Mírové náměstí');

const LANDMARKS = [
  { name: 'Zámek', at: proj.forward(49.7815667, 14.1789113), dy: 22, dx: 10 },
  { name: 'Radnice', at: center(townhall.r), dy: -12, dx: -30 },
  { name: 'Nejsv. Trojice', at: proj.forward(49.7821357, 14.1778341), dy: -14, dx: -60 },
  { name: 'Sv. Kříž', at: proj.forward(49.7832485, 14.1810164), dy: -8, dx: 10 },
  { name: 'Bývalá synagoga', at: proj.forward(49.781337, 14.167355), dy: -14, dx: -96 },
  { name: 'Francouzský park', at: proj.forward(49.7802809, 14.179386), dy: 4, dx: 12 },
  { name: 'Anglický park', at: proj.forward(49.7770822, 14.1799325), dy: 4, dx: 10 },
  { name: 'Zimní stadion', at: proj.forward(49.777002, 14.1743546), dy: 4, dx: 10 },
  { name: 'Koryto', at: proj.forward(49.7846616, 14.1775276), dy: 4, dx: 10 },
  { name: 'Huťský rybník', at: proj.forward(49.7811944, 14.1882824), dy: 4, dx: -40 },
  { name: 'Papež', at: proj.forward(49.7890954, 14.170825), dy: 4, dx: 10 },
];

const nearest = (axis, p) => axis.reduce((m, a) => Math.min(m, Math.hypot(a[0] - p[0], a[1] - p[1])), Infinity);

// nejdelší skoro rovný úsek, hledá se jako délka tětivy s malým vybočením
function longestStraight(axis) {
  const n = axis.length, step = 6;
  let best = { len: 0, i: 0, j: 0 };
  for (let i = 0; i < n; i++) {
    for (let span = 8; span < n / 2; span++) {
      const j = (i + span) % n;
      const a = axis[i], b = axis[j];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let dev = 0;
      for (let k = 1; k < span; k++) {
        const p = axis[(i + k) % n];
        dev = Math.max(dev, Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / l);
      }
      if (dev > 2.5) break;
      if (span * step > best.len) best = { len: span * step, i, j };
    }
  }
  return { ...best, mid: axis[(best.i + Math.floor(((best.j - best.i + n) % n) / 2)) % n] };
}

// velikost budoucího souboru: zjednodušený půdorys v dm + výška, střecha, barva
function jsonSize(list) {
  let size = 0;
  for (const b of list) {
    const r = douglasPeucker(b.r, 0.6);
    size += r.length * 11 + 22;
  }
  return size;
}

const W = 1400, MAP_TOP = 96, MAP_H = 1040, S = 0.6, CX = -325, CY = 40;
const X = (x) => +(W / 2 + (x - CX) * S).toFixed(1);
const Y = (y) => +(MAP_TOP + MAP_H / 2 - (y - CY) * S).toFixed(1);
const pts = (r) => r.map((p) => `${X(p[0])},${Y(p[1])}`).join(' ');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const base = [];
for (const e of parks) for (const r of rings(e)) if (r.length > 2) base.push(`<polygon points="${pts(r)}" fill="#d6e8c4"/>`);
for (const e of water) for (const r of rings(e)) if (r.length > 2) base.push(`<polygon points="${pts(r)}" fill="#a3cfea"/>`);
for (const w of roads) {
  if (['track', 'motorway', 'motorway_link'].includes(w.tags.highway)) continue;
  const main = ['secondary', 'tertiary'].includes(w.tags.highway);
  base.push(`<polyline fill="none" stroke="${main ? '#b3ada3' : '#d3cec6'}" stroke-width="${main ? 3 : 1.4}" points="${pts(w.geometry.map((p) => proj.forward(p.lat, p.lon)))}"/>`);
}
for (const b of buildings) base.push(`<polygon points="${pts(b.r)}" fill="#c4bcb0"/>`);
const baseMap = base.join('');

const metrics = [];
for (const L of loops) {
  const axis = L.axis;
  const near = buildings.filter((b) => b.r.some((p) => nearest(axis, p) < 400));
  const edge = 11 / 2 + 3;
  const clash = near.filter((b) => b.r.some((p) => nearest(axis, p) < edge)).length;
  const marks = LANDMARKS.map((m) => ({ name: m.name, dist: Math.round(nearest(axis, m.at)) }));
  const straight = longestStraight(axis);
  const hmax = L.hmin + Math.max(...L.profile), hlow = L.hmin + Math.min(...L.profile);
  metrics.push({
    id: L.id, name: L.name, km: +(L.length / 1000).toFixed(2), range: +L.range.toFixed(1), climb: Math.round(L.climb),
    hlow: Math.round(hlow), hmax: Math.round(hmax), grade: +(L.grade50 * 100).toFixed(1), corners: L.corners, tight: L.tight,
    minR: Math.round(L.minRadius), minSep: Math.round(L.minSeparation), ok: L.ok, straight: straight.len,
    buildings: near.length, clash, jsonKb: Math.round(jsonSize(near) / 1024), marks, streets: L.streets.filter((s) => s.len >= 15).map((s) => `${s.name} ${s.len} m`),
  });

  const svg = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${W}" width="${W}" height="${W}" font-family="Helvetica,Arial,sans-serif"><rect width="${W}" height="${W}" fill="#faf8f4"/>`];
  svg.push(baseMap);
  svg.push(`<polygon points="${pts(axis)}" fill="none" stroke="#fff" stroke-width="11" stroke-linejoin="round"/>`);
  svg.push(`<polygon points="${pts(axis)}" fill="none" stroke="#d3124f" stroke-width="6" stroke-linejoin="round"/>`);
  for (let i = 40; i < axis.length; i += 70) {
    const a = axis[i], b = axis[(i + 2) % axis.length];
    const ang = (Math.atan2(-(b[1] - a[1]), b[0] - a[0]) * 180) / Math.PI;
    svg.push(`<polygon points="-12,-11 14,0 -12,11" fill="#fff" stroke="#d3124f" stroke-width="3" stroke-linejoin="round" transform="translate(${X(a[0])} ${Y(a[1])}) rotate(${ang.toFixed(0)})"/>`);
  }
  for (const m of LANDMARKS) {
    const x = X(m.at[0]), y = Y(m.at[1]);
    svg.push(`<circle cx="${x}" cy="${y}" r="6" fill="#1b3a6b" stroke="#fff" stroke-width="2"/>`);
    svg.push(`<text x="${x + m.dx}" y="${y + m.dy}" font-size="17" font-weight="600" fill="#1b3a6b" stroke="#faf8f4" stroke-width="4" paint-order="stroke">${esc(m.name)}</text>`);
  }
  const sx = X(straight.mid[0]), sy = Y(straight.mid[1]);
  svg.push(`<circle cx="${sx}" cy="${sy}" r="11" fill="#111" stroke="#fff" stroke-width="3"/><text x="${sx - 28}" y="${sy + 34}" font-size="18" font-weight="700" fill="#111" stroke="#fff" stroke-width="4" paint-order="stroke">START</text>`);

  svg.push(`<rect width="${W}" height="${MAP_TOP}" fill="#fff"/>`);
  svg.push(`<text x="28" y="44" font-size="32" font-weight="700" fill="#16202e">Okruh ${L.id}: ${esc(L.name)}</text>`);
  const sum = `${metrics.at(-1).km.toFixed(2).replace('.', ',')} km  ·  převýšení ${Math.round(L.range)} m  ·  stoupání do ${metrics.at(-1).grade.toString().replace('.', ',')} %  ·  zatáček ${L.corners}  ·  rovinka ${straight.len} m`;
  svg.push(`<text x="28" y="78" font-size="21" fill="#46515f">${sum}</text>`);

  const PT = MAP_TOP + MAP_H, PH = W - PT;
  svg.push(`<rect y="${PT}" width="${W}" height="${PH}" fill="#fff"/>`);
  const px0 = 84, px1 = W - 30, py0 = PT + 32, py1 = W - 44;
  const lo = Math.floor(hlow / 10) * 10 - 10, hi = lo + 80;
  const py = (h) => py1 - ((h - lo) / (hi - lo)) * (py1 - py0);
  const prof = L.profile.map((h, i) => [px0 + (i / (L.profile.length - 1)) * (px1 - px0), py(L.hmin + h)]);
  for (let h = lo; h <= hi; h += 20) {
    svg.push(`<line x1="${px0}" x2="${px1}" y1="${py(h)}" y2="${py(h)}" stroke="#e6e2da"/><text x="${px0 - 10}" y="${py(h) + 5}" font-size="15" text-anchor="end" fill="#6a7482">${h} m</text>`);
  }
  svg.push(`<polygon points="${px0},${py1} ${prof.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')} ${px1},${py1}" fill="#f4c6d4"/>`);
  svg.push(`<polyline points="${prof.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}" fill="none" stroke="#d3124f" stroke-width="3"/>`);
  for (let km = 0; km * 1000 <= L.length; km += 1) {
    const x = px0 + ((km * 1000) / L.length) * (px1 - px0);
    svg.push(`<text x="${x}" y="${py1 + 24}" font-size="15" text-anchor="middle" fill="#6a7482">${km} km</text>`);
  }
  svg.push(`<text x="${px0}" y="${PT + 22}" font-size="16" font-weight="600" fill="#46515f">Výškový profil (DMR 5G, nad mořem) od západního konce Mírového náměstí</text>`);
  svg.push(`<text x="${W - 28}" y="${MAP_TOP - 14}" font-size="13" text-anchor="end" fill="#6a7482">Mapová data © přispěvatelé OpenStreetMap (ODbL), výšky © ČÚZK (CC BY 4.0)</text>`);
  svg.push('</svg>');
  writeFileSync(join(DATA, `loops/okruh-${L.id}.svg`), svg.join(''));
}
writeFileSync(join(DATA, 'loops/metrics.json'), JSON.stringify(metrics, null, 1));
for (const m of metrics) {
  console.log(`\n${m.id} ${m.name}: ${m.km} km, ${m.hlow}–${m.hmax} m n. m., nastoupáno ${m.climb} m, stoupání ${m.grade} %, zatáčky ${m.corners} (ostré ${m.tight}), min. R ${m.minR}, rovinka ${m.straight} m`);
  console.log(`  budov do 400 m: ${m.buildings}, zasahuje do rozšířené trati: ${m.clash}, odhad JSON budov: ${m.jsonKb} kB`);
  console.log('  dominanty [m od osy]:', m.marks.map((d) => `${d.name} ${d.dist}`).join(', '));
}
