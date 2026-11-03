// Převod skutečné Dobříše na trať: definice trati (js/tracks-dobris.js) a kulisy (data/dobris.json).
// Použití: node osm2track.mjs   (data stáhne fetch-data.mjs)
//
// Souřadnice výstupu jsou herní: x na východ, z na jih, počátek na startu.
// Kulisy jsou v JSON zaokrouhlené na decimetry (celá čísla), výšky v dm nad nejnižším bodem trati.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localProjection, wgsToKrovak } from './lib/geo.mjs';
import { loadRuian, ruianAt } from './lib/ruian.mjs';
import { loadDmp, roofOf, treesOf } from './lib/dmp.mjs';
import { loadRoadParcels, corridorWidth } from './lib/parcels.mjs';
import { buildGraph, routeLoop, edgeKey, douglasPeucker } from './lib/roads.mjs';
import { sampleAxis, rotateAxis, fitTrack, countCorners } from './lib/axis.mjs';
import { loadDem } from './lib/dem.mjs';
import { cleanRing, signedArea, simplifyRing, subdivideRing, minRect, minRectFrame, clipRing, joinOuter, pointInRing } from './lib/poly.mjs';
import { buildCenterline, validateCenterline } from '../js/trackmath.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA = join(ROOT, 'data');
const GAME = join(ROOT, '..');

const LOOP = 'A';
const START = [-140, -8];     // v souřadnicích loops.json: rovný kus Pražské za radnicí, jede se na východ
const WIDTH_MIN = 10, WIDTH_MAX = 13, WIDTH_SCALE = 1.5;
const RUNOFF = 3;
const STAND_S = 1020;         // tribuna na louce u Pražské, kde nic nezakryje (na startu by schovala obchody)
const REACH = 400;            // budovy a další kulisy do této vzdálenosti od osy
const MARGIN = 560;           // výšková mřížka a plochy kolem obdélníku trati
const DEM_CELL = 12;
const FACADE_GAP = 1.2;       // kolik volného místa zůstane mezi výběhem a fasádou

// Šířka vozovky: OSM ji u těchto ulic nemá. Měří se šířka silničního pozemku v katastru (RÚIAN)
// a vozovka je její podíl ROAD_SHARE, nastavený tak, aby silnice II. třídy měly v průměru 8 m
// (medián jejich pozemků v Dobříši je 15,5 m). Bez měření zůstane odhad podle kategorie.
const ROAD_SHARE = 0.52;
const MEASURED = new Set(['secondary', 'tertiary', 'unclassified', 'residential', 'living_street']); // service vede často přes parkoviště
function realWidth(tags) {
  if (tags.surface === 'sett' && tags.highway === 'secondary') return 8.5; // Mírové náměstí
  if (tags.highway === 'secondary') return (+tags.lanes || 2) >= 3 ? 10 : 8;
  if (tags.highway === 'tertiary') return 7;
  if (tags.highway === 'unclassified') return 6;
  return 6;
}

const STREET_W = { secondary: 8, secondary_link: 6, tertiary: 7, tertiary_link: 6, unclassified: 6, residential: 5.5, living_street: 4.5, pedestrian: 5, service: 3.5 };

const read = (name) => JSON.parse(readFileSync(join(DATA, name), 'utf8')).elements;
const dem = loadDem(join(DATA, 'dmr/grid.bin'));
const parcels = loadRoadParcels(join(DATA, 'ruian'));
const dmp = await loadDmp(join(DATA, 'dmp')); // DMP 1G, bez něj se výšky budov odhadnou a stromy rozmístí hra
const roofPoints = dmp?.roofs;
const roads = read('osm_roads.json').filter((e) => e.type === 'way');
const area = read('osm_area.json');
const extra = read('osm_extra.json');
const candidate = JSON.parse(readFileSync(join(ROOT, 'loops.json'), 'utf8')).find((c) => c.id === LOOP);

// --- osa trati ---------------------------------------------------------------

// počátek je start, proto se trasa hledá dvakrát: poprvé kvůli poloze startu
const survey = localProjection(49.7815, 14.1745);
const first = routeLoop(buildGraph(roads, survey.forward), candidate.via);
const startAt = rotateAxis(sampleAxis(first.nodes, dem, survey), ...START)[0];
const [lat0, lon0] = survey.inverse(startAt.x, startAt.y);
const proj = localProjection(lat0, lon0);
const via = candidate.via.map(([x, y, street]) => [...proj.forward(...survey.inverse(x, y)), street]);
const graph = buildGraph(roads, proj.forward);
const loop = routeLoop(graph, via);
const axis = rotateAxis(sampleAxis(loop.nodes, dem, proj), 0, 0);
const base = Math.min(...axis.map((p) => p.hs));
const relAxis = axis.map((p) => ({ ...p, hs: p.hs - base }));

// medián šířky silničního pozemku podél čáry (body [x, y] s y na sever); null bez dost měření
function corridorOf(pts) {
  if (!parcels) return null;
  const ws = [];
  const kr = pts.map(([x, y]) => wgsToKrovak(...proj.inverse(x, y)));
  for (let k = 0; k + 1 < kr.length; k++) {
    const a = kr[k], b = kr[k + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 1) continue;
    for (let d = 0.5; d < l; d += 8) {
      const w = corridorWidth(parcels, a[0] + ((b[0] - a[0]) * d) / l, a[1] + ((b[1] - a[1]) * d) / l, (b[0] - a[0]) / l, (b[1] - a[1]) / l);
      if (w) ws.push(w);
    }
  }
  if (ws.length < 3) return null;
  ws.sort((a, b) => a - b);
  return ws[ws.length >> 1];
}
const roadWidth = (tags, corridor) => (corridor && MEASURED.has(tags.highway) ? Math.max(3, Math.min(10, corridor * ROAD_SHARE)) : null);

// trať: šířka po úsecích osy (hrana grafu = kus ulice mezi křižovatkami)
const segWidth = new Map();
for (const seg of new Set(axis.map((p) => p.seg))) {
  const pts = axis.filter((p) => p.seg === seg).map((p) => [p.x, p.y]);
  const w = roadWidth(loop.edges[seg].way.tags, corridorOf(pts));
  if (w) segWidth.set(seg, w);
}
const widths = axis.map((p) => {
  const w = (segWidth.get(p.seg) ?? realWidth(loop.edges[p.seg].way.tags)) * WIDTH_SCALE;
  return Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, w));
});
const widthAt = (i) => {
  // průměr přes ±30 m, ať se šířka nemění skokem
  let s = 0;
  const R = 15;
  for (let o = -R; o <= R; o++) s += widths[(i + o + widths.length) % widths.length];
  return s / (2 * R + 1);
};

const nominal = 12;
const widest = Math.max(...widths);
const points = fitTrack(relAxis, { width: widest, runoff: RUNOFF, startFlat: true, maxLen: 45 });
const def = {
  id: 'dobris',
  name: 'Dobříš',
  subtitle: 'Mírové náměstí, zámek a Pražská, skutečné ulice',
  biome: 'town',
  width: nominal,
  runoff: RUNOFF,
  maxBank: 0.015,
  seed: 2263,
  smooth: 2,
  scene: 'data/dobris.json',
  credit: 'Mapová data © přispěvatelé OpenStreetMap (ODbL), výškopis, DMP a RÚIAN © ČÚZK (CC BY 4.0)',
  points,
};
const cl = buildCenterline(def);
const check = validateCenterline(cl, widest / 2, RUNOFF);
if (!check.ok) throw new Error(`Trať neprošla validací hry: ${JSON.stringify({ r: check.minRadius, sep: check.minSeparation, grade: check.maxGrade })}`);

// profil šířky: pro každý vzorek osy hry nejbližší vzorek osy z OSM
const clWidth = new Float32Array(cl.N);
const clAxis = new Int32Array(cl.N);
{
  let j = 0;
  for (let k = 0; k < cl.N; k++) {
    let best = j, bd = Infinity;
    for (let o = -60; o <= 200; o++) {
      const i = (j + o + axis.length) % axis.length;
      const d = (axis[i].x - cl.px[k]) ** 2 + (axis[i].y + cl.pz[k]) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    j = best;
    clAxis[k] = best;
    clWidth[k] = widthAt(best);
  }
}
const widthProfile = [];
for (let k = 0; k < cl.N; k += 10) {
  const w = Math.round(clWidth[k] * 2) / 2;
  const s = Math.round(cl.s[k]);
  if (!widthProfile.length || widthProfile[widthProfile.length - 1][1] !== w) widthProfile.push([s, w]);
}
def.widths = widthProfile;

// místo tribuny a úseky s kostkami (surface=sett) jako body ve světě, ať sedí i v obráceném směru
const at = (k, lat = 0) => [+(cl.px[k] + cl.rx[k] * lat).toFixed(1), +(cl.pz[k] + cl.rz[k] * lat).toFixed(1)];
{
  const k = Math.round(STAND_S / cl.step);
  def.stand = at(k, widest / 2 + RUNOFF + 13);
}
// souvislé úseky osy, kde platí test, delší než minLen metrů
function spansWhere(test, minLen = 20) {
  const out = [];
  for (let k = 0, run = -1; k <= cl.N; k++) {
    const on = k < cl.N && test(k);
    if (on && run < 0) run = k;
    if (on || run < 0) continue;
    if (cl.s[k - 1] - cl.s[run] > minLen) out.push([at(run), at(k - 1)]);
    run = -1;
  }
  return out;
}
def.sett = spansWhere((k) => loop.edges[axis[clAxis[k]].seg].way.tags.surface === 'sett');

// --- pomocné dotazy na osu ----------------------------------------------------

const toGame = (lat, lon) => {
  const [x, y] = proj.forward(lat, lon);
  return [x, -y];
};
const CELL = 24;
const hash = new Map();
for (let k = 0; k < cl.N; k++) {
  const key = `${Math.floor(cl.px[k] / CELL)},${Math.floor(cl.pz[k] / CELL)}`;
  if (!hash.has(key)) hash.set(key, []);
  hash.get(key).push(k);
}
// nejbližší vzorek osy v okolí, null když je trať dál než pár buněk
function nearAxis(x, z) {
  const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
  let best = -1, bd = Infinity;
  for (let j = cj - 2; j <= cj + 2; j++) {
    for (let i = ci - 2; i <= ci + 2; i++) {
      for (const k of hash.get(`${i},${j}`) ?? []) {
        const d = (cl.px[k] - x) ** 2 + (cl.pz[k] - z) ** 2;
        if (d < bd) { bd = d; best = k; }
      }
    }
  }
  return best < 0 ? null : { k: best, d: Math.sqrt(bd) };
}
// hrubá vzdálenost od osy i daleko od trati
function axisDist(x, z) {
  let m = Infinity;
  for (let k = 0; k < cl.N; k += 8) m = Math.min(m, (cl.px[k] - x) ** 2 + (cl.pz[k] - z) ** 2);
  return Math.sqrt(m);
}

const stats = {};
const bump = (key, n = 1) => { stats[key] = (stats[key] ?? 0) + n; };
stats.trackWidthMeasured = `${segWidth.size}/${new Set(axis.map((p) => p.seg)).size} úseků`;
const dm = (v) => Math.round(v * 10);
const flat = (r) => r.flatMap((p) => [dm(p[0]), dm(p[1])]);
const clearance = (k) => clWidth[k] / 2 + RUNOFF + FACADE_GAP;

let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
for (let k = 0; k < cl.N; k++) {
  minX = Math.min(minX, cl.px[k]); maxX = Math.max(maxX, cl.px[k]);
  minZ = Math.min(minZ, cl.pz[k]); maxZ = Math.max(maxZ, cl.pz[k]);
}
const bounds = { minX: minX - MARGIN, maxX: maxX + MARGIN, minZ: minZ - MARGIN, maxZ: maxZ + MARGIN };

// --- budovy --------------------------------------------------------------------

// ručně modelované dominanty, ve fázi 4 nahradí generický dům
const LANDMARKS = {
  49589320: 'zamek', 49589317: 'trojice', 49589363: 'kriz', 30103766: 'radnice', 48876694: 'synagoga', 30103752: 'vargac', 49589359: 'oranzerie',
};
const ROOF = { gabled: 0, hipped: 1, flat: 2, pyramidal: 3, skillion: 4, mansard: 1, half_hipped: 1, 'half-hipped': 1, gambrel: 0, round: 0, dome: 3 };
// tvar podle bodů DMP 1G; 5 = sedlová s hřebenem napříč delší strany (SHAPE.CROSS ve hře)
const ROOF_CROSS = 5;
const MEASURED_SHAPE = { gable: ROOF.gabled, hip: ROOF.hipped, flat: ROOF.flat, cross: ROOF_CROSS };
const WALLS = {
  house: ['#efe7d6', '#f3efe6', '#e6d3a8', '#e8c9a6', '#d9d6cf', '#ddd3bd', '#cfd2c8'],
  centre: ['#e9c46a', '#e8b79a', '#f1e3c6', '#cfdcc0', '#f0d9a8', '#d9a98c', '#efece3', '#c7d3dc'],
  block: ['#d8d8d2', '#e6e2d6', '#c8d0d4', '#e3d3b5', '#cfd6c4'],
  plain: ['#b9b6ae', '#a9a79f', '#c4c0b6'],
  // podle panoramat: u startu bílé a krémové domy, východ náměstí světle modrý, krémový a žlutý
  start: ['#f3efe6', '#efe7d6', '#f1e3c6', '#ece6d8'],
  squareEast: ['#c7d3dc', '#bccfdd', '#f1e3c6', '#efe0b0', '#e9c46a', '#f0d9a8'],
};
const ROOFS = {
  tile: ['#9c4a32', '#8a3f2e', '#a85a3c', '#7d3a2c', '#6b5147'],
  grey: ['#565a60', '#6e7176', '#4d4a49'],
  flat: ['#77797c', '#6b6d70', '#85878a'],
};
const wallPalette = [...new Set(Object.values(WALLS).flat())];
const roofPalette = [...new Set(Object.values(ROOFS).flat())];
const named = { sand: '#d9c08e', burlywood: '#deb887', black: '#2a2a2c', white: '#f2f0ea', red: '#a33a2c', grey: '#808080', gray: '#808080', brown: '#6b4a3a' };
const colourIndex = (palette, value) => {
  const hex = value.startsWith('#') ? value : named[value.toLowerCase()];
  if (!hex) return null;
  if (!palette.includes(hex)) palette.push(hex);
  return palette.indexOf(hex);
};
// stavební objekt RÚIAN k budově: podle ref:ruian:building, jinak podle těžiště
const ruian = loadRuian(join(DATA, 'ruian'));
const ruianByCode = new Map(ruian.map((o) => [o.code, o]));
function ruianOf(t, latlon) {
  const byRef = ruianByCode.get(+t['ref:ruian:building']);
  if (byRef) return byRef;
  const la = latlon.reduce((s, p) => s + p[0], 0) / latlon.length, lo = latlon.reduce((s, p) => s + p[1], 0) / latlon.length;
  return ruianAt(ruian, ...wgsToKrovak(la, lo));
}
const pick = (list, id) => list[(Math.imul(id, 2654435761) >>> 16) % list.length];

const centreLine = [toGame(49.7811, 14.1672), toGame(49.7813, 14.1717)];
// poloha vůči ose Mírového náměstí: t od západu (0) na východ (1), d kolmo
function alongCentre(x, z) {
  const [a, b] = centreLine;
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
  return { t, d: Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) };
}
const nearCentre = (x, z) => alongCentre(x, z).d < 120;
const START_ZONE = 75;            // domy kolem startu (počátek souřadnic)
const onSquareEast = (x, z) => { const c = alongCentre(x, z); return c.t > 0.55 && c.d < 45; };

// levels: počet podlaží z RÚIAN, jinak z OSM (import z RÚIAN bývá starší);
// measured: okap, střecha a plochost změřené v DMP 1G mají přednost před vším ostatním
function massing(t, areaM2, short, levels = parseFloat(t['building:levels']), measured = null) {
  const kind = t.building;
  if (measured) {
    const shape = ROOF[t['roof:shape']] ?? MEASURED_SHAPE[measured.shape];
    const roof = shape === ROOF.flat ? 0 : Math.max(0.8, Math.min(9, shape === ROOF_CROSS ? 9 : short * 0.75, measured.roof));
    return { wall: Math.max(2.4, measured.wall), roof, shape };
  }
  let tagged = parseFloat(t.height);
  // věžák 49589262: 15 podlaží a height=60, přes 4 m na podlaží je výška v OSM chybná
  if (levels > 0 && tagged > levels * 3.6) tagged = NaN;
  let shape = ROOF[t['roof:shape']];
  if (shape === undefined) {
    const wide = areaM2 > 900;
    const low = ['garage', 'garages', 'shed', 'carport'].includes(kind);
    const hall = ['industrial', 'warehouse', 'retail', 'commercial', 'service'].includes(kind) && areaM2 > 250;
    shape = levels >= 4 || wide || low || hall ? ROOF.flat : ROOF.gabled;
  }
  const roof = shape === ROOF.flat ? 0 : Math.max(1.4, Math.min(5.5, short * 0.42));
  let wall;
  if (tagged > 0) wall = Math.max(2.4, tagged - roof);
  else if (levels > 0) wall = levels * 3;
  else if (['garage', 'garages', 'carport'].includes(kind)) wall = 2.6;
  else if (kind === 'shed' || areaM2 < 25) wall = 2.4;
  else if (kind === 'barn') wall = 4.5;
  else if (['industrial', 'warehouse', 'civic', 'commercial', 'retail', 'service'].includes(kind)) wall = 6.5;
  else if (kind === 'school') wall = 9;
  else if (areaM2 < 45) wall = 3;
  else wall = 4.5;
  return { wall, roof, shape };
}

function styleOf(e, t, x, z, shape, wall) {
  const id = e.id;
  const blocks = wall >= 12;
  const plain = ['garage', 'garages', 'shed', 'industrial', 'warehouse', 'service'].includes(t.building);
  const wallSet = plain ? WALLS.plain : blocks ? WALLS.block : Math.hypot(x, z) < START_ZONE ? WALLS.start
    : onSquareEast(x, z) ? WALLS.squareEast : nearCentre(x, z) ? WALLS.centre : WALLS.house;
  const roofSet = shape === ROOF.flat ? ROOFS.flat : (id % 7 === 0 ? ROOFS.grey : ROOFS.tile);
  const w = t['building:colour'] ? colourIndex(wallPalette, t['building:colour']) : null;
  const r = t['roof:colour'] ? colourIndex(roofPalette, t['roof:colour']) : null;
  if (w !== null) bump('facadeFromData');
  if (r !== null) bump('roofFromData');
  return { wall: w ?? wallPalette.indexOf(pick(wallSet, id)), roof: r ?? roofPalette.indexOf(pick(roofSet, id * 31 + 5)) };
}

// Domy, které zasahují do silnice a výběhu, přijdou o přední část: fasáda ustoupí za výběh.
// Řadová zástavba tak drží u sebe, posun celého domu by ji rozházel do sousedů.
function clearRoad(ring) {
  const r = subdivideRing(ring, 4);
  let moved = 0, side = 0, conflict = false;
  const out = r.map((p) => {
    const n = nearAxis(p[0], p[1]);
    if (!n) return p;
    const k = n.k;
    const need = clearance(k);
    if (n.d >= need) return p;
    const lat = (p[0] - cl.px[k]) * cl.rx[k] + (p[1] - cl.pz[k]) * cl.rz[k];
    const s = Math.sign(lat) || 1;
    if (side && s !== side) conflict = true;
    side = s;
    moved = Math.max(moved, need - n.d);
    return [cl.px[k] + cl.rx[k] * s * need, cl.pz[k] + cl.rz[k] * s * need];
  });
  return { ring: out, moved, conflict };
}

// Dominanta se bude modelovat ručně, proto se neořezává: odsune se celá, o nejmenší posun,
// po kterém je mimo výběh ze všech stran (v zatáčce by ji postupné odsouvání přehazovalo mezi úseky).
function shiftClear(ring) {
  const pts = subdivideRing(ring, 2);
  const clear = (dx, dz) => pts.every((p) => {
    const n = nearAxis(p[0] + dx, p[1] + dz);
    return !n || n.d >= clearance(n.k) - 0.05;
  });
  if (clear(0, 0)) return { ring, moved: 0 };
  for (let d = 0.25; d <= 30; d += 0.25) {
    for (let a = 0; a < 48; a++) {
      const dx = Math.cos((a * Math.PI) / 24) * d, dz = Math.sin((a * Math.PI) / 24) * d;
      if (clear(dx, dz)) return { ring: ring.map((p) => [p[0] + dx, p[1] + dz]), moved: d };
    }
  }
  return shiftAway(ring);
}
function shiftAway(ring) {
  let r = ring, sx = 0, sz = 0;
  for (let iter = 0; iter < 12; iter++) {
    let worst = 0, dx = 0, dz = 0;
    for (const p of subdivideRing(r, 2)) {
      const n = nearAxis(p[0], p[1]);
      if (!n) continue;
      const k = n.k, need = clearance(k) - n.d;
      if (need <= worst) continue;
      const lat = (p[0] - cl.px[k]) * cl.rx[k] + (p[1] - cl.pz[k]) * cl.rz[k];
      const s = Math.sign(lat) || 1;
      worst = need;
      dx = cl.rx[k] * s * need;
      dz = cl.rz[k] * s * need;
    }
    if (worst < 0.05) break;
    r = r.map((p) => [p[0] + dx, p[1] + dz]);
    sx += dx;
    sz += dz;
  }
  return { ring: r, moved: Math.hypot(sx, sz) };
}

const buildings = [];
const landmarks = [];
const landmarkRings = [];
const pushback = [];

const overlapsLandmark = (r) => landmarkRings.some((l) => r.some((p) => pointInRing(p[0], p[1], l)) || l.some((p) => pointInRing(p[0], p[1], r)));

// dominanty napřed: domy, které by se s odsunutou dominantou překryly, se pak vynechají
for (const e of area) {
  const id = LANDMARKS[e.id];
  if (!id || !e.tags?.building) continue;
  const t = e.tags;
  const r0 = cleanRing(e.geometry.map((p) => toGame(p.lat, p.lon)));
  const { ring: r, moved } = shiftClear(r0);
  const m = massing(t, Math.abs(signedArea(r)), minRect(r)[0]);
  if (moved > 0) console.log(`dominanta ${id}: odsunuta o ${moved.toFixed(1)} m`);
  landmarkRings.push(r);
  landmarks.push({
    id, name: t.name ?? null, wall: dm(m.wall), levels: parseFloat(t['building:levels']) || null,
    height: parseFloat(t.height) || null, facade: t['building:colour'] ?? null, roofColour: t['roof:colour'] ?? null, roofShape: t['roof:shape'] ?? null,
    moved: +moved.toFixed(1), p: flat(simplifyRing(r, 0.3)),
  });
}

for (const e of area) {
  const t = e.tags;
  if (!t?.building || t.building === 'roof' || t.building === 'carport') continue;
  const rings = e.type === 'relation' ? joinOuter(e.members ?? []) : [(e.geometry ?? []).map((p) => [p.lat, p.lon])];
  for (const latlon of rings) {
    let r = cleanRing(latlon.map(([la, lo]) => toGame(la, lo)));
    if (r.length < 3) continue;
    const d = r.reduce((m, p) => Math.min(m, axisDist(p[0], p[1])), Infinity);
    if (d > REACH) continue;
    const a0 = Math.abs(signedArea(r));
    if (LANDMARKS[e.id]) continue;
    if (a0 < 12) { bump('tinySkipped'); continue; }
    if (overlapsLandmark(r)) { bump('droppedForLandmark'); continue; }
    const c = clearRoad(r);
    if (c.conflict) { bump('droppedOnRoad'); continue; }
    if (c.moved > 0) {
      const a1 = Math.abs(signedArea(c.ring));
      if (a1 < 16 || a1 < a0 * 0.3) { bump('droppedTooSmall'); continue; }
      r = c.ring;
      pushback.push(c.moved);
    }
    r = cleanRing(simplifyRing(r, d < 150 ? 0.5 : 1.2));
    if (r.length < 3) continue;
    if (signedArea(r) < 0) r.reverse();
    const areaM2 = Math.abs(signedArea(r));
    const [short] = minRect(r);
    const so = ruianOf(t, latlon);
    const measured = roofPoints && roofOf(roofPoints, latlon.map(([la, lo]) => wgsToKrovak(la, lo)), dem.krovak);
    if (measured) bump('heightFromDmp');
    else if (so) bump('levelsFromRuian');
    const m = massing(t, areaM2, short, so?.levels, measured);
    const cx = r.reduce((s, p) => s + p[0], 0) / r.length, cz = r.reduce((s, p) => s + p[1], 0) / r.length;
    const st = styleOf(e, t, cx, cz, m.shape, m.wall);
    buildings.push([dm(m.wall), dm(m.roof), m.shape, st.wall, st.roof, ...flat(r)]);
  }
}
stats.buildings = buildings.length;
stats.landmarks = landmarks.length;
stats.buildingsTrimmed = pushback.length;
stats.maxTrim = +Math.max(0, ...pushback).toFixed(1);

// --- zeleň, voda, zpevněné plochy ----------------------------------------------

// trávníky před radnicí: stromy v OSM nejsou, na fotkách náměstí ano
const TOWN_HALL_LAWNS = new Set([1314555286, 1314555287]);

const AREA_KIND = (t) => {
  if (t.landuse === 'forest' || t.natural === 'wood') return 'forest';
  if (t.natural === 'scrub') return 'forest';
  if (t.name === 'Francouzský park') return 'garden';
  if (t.leisure === 'park' || t.leisure === 'garden') return 'park';
  if (t.landuse === 'cemetery') return 'cemetery';
  if (t.landuse === 'meadow' || t.landuse === 'grass') return 'grass';
  if (t.landuse === 'farmland') return 'field';
  if (t.landuse === 'allotments') return 'allotments';
  if (t.leisure === 'pitch' || t.leisure === 'stadium' || t.leisure === 'track') return 'pitch';
  return null;
};
const ringsOf = (e) => (e.type === 'relation'
  ? joinOuter(e.members ?? []).map((r) => r.map(([la, lo]) => toGame(la, lo)))
  : e.geometry ? [e.geometry.map((p) => toGame(p.lat, p.lon))] : []);
const closed = (e) => e.type === 'relation' || (e.nodes && e.nodes[0] === e.nodes[e.nodes.length - 1]);

const areas = [];
for (const e of area) {
  const kind = e.tags && (TOWN_HALL_LAWNS.has(e.id) ? 'lawn' : AREA_KIND(e.tags));
  if (!kind || !closed(e)) continue;
  for (const raw of ringsOf(e)) {
    const r = clipRing(cleanRing(raw), bounds);
    if (r.length < 3 || Math.abs(signedArea(r)) < 60) continue;
    areas.push([kind, ...flat(simplifyRing(r, kind === 'forest' || kind === 'field' ? 4 : 1.5))]);
  }
}

const water = [];
for (const e of area) {
  if (e.tags?.natural !== 'water' || !closed(e)) continue;
  for (const raw of ringsOf(e)) {
    const whole = cleanRing(raw);
    // břeh ustoupí silnici stejně jako fasády, voda nesmí do výběhu
    const shore = clearRoad(whole);
    if (shore.moved > 0) bump('shoresMoved');
    const r = clipRing(shore.ring, bounds);
    if (r.length < 3 || Math.abs(signedArea(r)) < 80) continue;
    // hladina: medián DMR uvnitř, DMR má na vodě skoro rovinu
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of whole) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    const hs = [];
    const step = Math.max(4, Math.min(x1 - x0, z1 - z0) / 12);
    for (let x = x0; x <= x1; x += step) for (let z = z0; z <= z1; z += step) {
      if (!pointInRing(x, z, whole)) continue;
      const h = dem.height(...proj.inverse(x, -z));
      if (!Number.isNaN(h)) hs.push(h);
    }
    hs.sort((a, b) => a - b);
    const level = hs.length ? hs[Math.floor(hs.length / 2)] - base : null;
    water.push({ name: e.tags.name ?? null, level: level === null ? null : dm(level), p: flat(simplifyRing(r, 1.5)) });
  }
}

const paved = [];
// Mírové náměstí nemá v OSM plochu: obrys dá obal jeho ulic včetně pruhů kolem;
// musí zůstat první plochou 'square', podle toho hra pozná, kam patří historické lampy
{
  const pts = [];
  for (const w of roads) if (w.tags.name === 'Mírové náměstí') for (const p of w.geometry) pts.push(toGame(p.lat, p.lon));
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (list) => {
    const h = [];
    for (const p of list) {
      while (h.length > 1) {
        const a = h[h.length - 2], b = h[h.length - 1];
        if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) > 0) break;
        h.pop();
      }
      h.push(p);
    }
    return h.slice(0, -1);
  };
  paved.push(['square', ...flat([...half(pts), ...half([...pts].reverse())])]);
}
for (const e of extra) {
  const t = e.tags;
  if (!t || !closed(e)) continue;
  const kind = t.place === 'square' ? 'square' : t.amenity === 'parking' ? 'parking' : null;
  if (!kind) continue;
  for (const raw of ringsOf(e)) {
    const r = cleanRing(raw);
    if (r.length < 3 || r.reduce((m, p) => Math.min(m, axisDist(p[0], p[1])), Infinity) > REACH) continue;
    paved.push([kind, ...flat(simplifyRing(r, 0.8))]);
  }
}

// Zaparkovaná auta: OSM nemá parking:lane, ale plochy parkovišť ano, často s orientation a capacity.
// Stání se rozvrhnou do řad podél delší strany, obsazené jsou zhruba dvě třetiny.
const CAR_W = 2.6, CAR_L = 5.2, CAR_GAP = 6.2, AISLE = 6, OCCUPIED = 0.65;
const houseRings = [...buildings, ...landmarks.map((l) => [0, 0, 0, 0, 0, ...l.p])].map((b) => {
  const r = [];
  for (let i = 5; i + 1 < b.length; i += 2) r.push([b[i] / 10, b[i + 1] / 10]);
  const xs = r.map((p) => p[0]), zs = r.map((p) => p[1]);
  return { r, box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] };
});
const inHouse = (x, z) => houseRings.some((h) => x > h.box[0] && x < h.box[2] && z > h.box[1] && z < h.box[3] && pointInRing(x, z, h.r));
const hash01 = (a, b) => (Math.imul(a ^ Math.imul(b, 0x9e3779b1), 0x85ebca6b) >>> 0) / 4294967296;
const cars = [];

// výlohy: domy, ve kterých OSM eviduje obchod, restauraci, banku, lékárnu nebo poštu (index do buildings)
const poiShops = existsSync(join(DATA, 'osm_shops.json')) ? read('osm_shops.json') : [];
const shops = [];
for (const e of poiShops) {
  if (e.tags?.highway === 'crossing') continue;
  const ll = e.center ?? e;
  if (ll.lat === undefined) continue;
  const [x, z] = toGame(ll.lat, ll.lon);
  const i = houseRings.findIndex((h) => x > h.box[0] && x < h.box[2] && z > h.box[1] && z < h.box[3] && pointInRing(x, z, h.r));
  if (i >= 0 && i < buildings.length && !shops.includes(i)) shops.push(i);
}
shops.sort((a, b) => a - b);

// přechody s vodorovným značením ležící na trati, jako body ve světě; aspoň 15 m od sebe a 30 m od startu
const MARKED = new Set(['zebra', 'uncontrolled', 'traffic_signals', 'marked']);
const crossings = [];
for (const e of poiShops) {
  const t = e.tags;
  if (t?.highway !== 'crossing' || e.type !== 'node') continue;
  const marks = t['crossing:markings'];
  if (!(MARKED.has(t.crossing) || (marks && marks !== 'no'))) continue;
  if (t.crossing === 'unmarked') continue;
  const [x, z] = toGame(e.lat, e.lon);
  const n = nearAxis(x, z);
  if (!n || n.d > 4 || cl.s[n.k] < 30 || cl.s[n.k] > cl.L - 30) continue;
  if (crossings.some((c) => Math.abs(c.s - cl.s[n.k]) < 15)) continue;
  crossings.push({ s: cl.s[n.k], p: at(n.k) });
}
def.crossings = crossings.sort((a, b) => a.s - b.s).map((c) => c.p);
for (const e of extra) {
  const t = e.tags;
  if (t?.amenity !== 'parking' || !closed(e) || ['underground', 'multi-storey', 'rooftop'].includes(t.parking)) continue;
  for (const raw of ringsOf(e)) {
    const r = cleanRing(raw);
    if (r.length < 3 || r.reduce((m, p) => Math.min(m, axisDist(p[0], p[1])), Infinity) > REACH) continue;
    const f = minRectFrame(r);
    const depth = f.b1 - f.b0;
    const parallel = t.orientation === 'parallel' || (!t.orientation && depth < 4.5);
    // řady napříč plochou: podélná stání po 2,6 m, kolmá do dvojic zády k sobě s uličkou;
    // úzký pás u ulice (null) sleduje vlastní střed, obrysy v OSM bývají mělčí než auto a lomené
    const need = parallel ? CAR_W : CAR_L;
    const rows = [];
    if (depth < 2 * need) rows.push(null);
    else if (parallel) for (let b = f.b0 + CAR_W / 2; b <= f.b1 - CAR_W / 2 + 0.3; b += CAR_W) rows.push(b);
    else {
      for (let b = f.b0; b + CAR_L <= f.b1 + 0.3; b += 2 * CAR_L + AISLE) {
        rows.push(b + CAR_L / 2);
        if (b + 2 * CAR_L <= f.b1 + 0.3) rows.push(b + 1.5 * CAR_L);
      }
    }
    const pitch = parallel ? CAR_GAP : CAR_W;
    const slots = [];
    const toXZ = (a, b) => [f.ux * a - f.uz * b, f.uz * a + f.ux * b];
    for (const row of rows) {
      const n = Math.floor((f.a1 - f.a0) / pitch);
      const start = (f.a0 + f.a1) / 2 - ((n - 1) * pitch) / 2;
      for (let i = 0; i < n; i++) {
        const a = start + i * pitch;
        let b = row, hb = need / 2 - 0.3;
        if (row === null) {
          // nejdelší úsek napříč pásem, který leží v ploše
          let best = [0, 0];
          for (let s = f.b0, run = null; s <= f.b1 + 0.25; s += 0.25) {
            if (s <= f.b1 && pointInRing(...toXZ(a, s), r)) run ??= s;
            else if (run !== null) { if (s - run > best[1] - best[0]) best = [run, s]; run = null; }
          }
          if (best[1] - best[0] < need * 0.7) continue;
          b = (best[0] + best[1]) / 2;
          hb = 0;
        }
        const at = (da, db) => toXZ(a + da, b + db);
        const [x, z] = at(0, 0);
        const ha = (parallel ? CAR_L : CAR_W) / 2 - 0.3;
        if (![[0, 0], [-ha, -hb], [ha, -hb], [-ha, hb], [ha, hb]].every(([da, db]) => pointInRing(...at(da, db), r))) continue;
        const n2 = nearAxis(x, z);
        if ((n2 && n2.d < clearance(n2.k) + 1.5) || inHouse(x, z)) continue;
        // směr auta: podél u u podélného stání, jinak napříč; náhodně čelem tam nebo zpět
        const dx = parallel ? f.ux : -f.uz, dz = parallel ? f.uz : f.ux;
        const flip = hash01(e.id, slots.length + 7) < 0.5 ? Math.PI : 0;
        slots.push([x, z, Math.atan2(dx, dz) + flip]);
      }
    }
    const cap = Math.round((+t.capacity || slots.length) * OCCUPIED);
    const taken = slots.filter((_, i) => hash01(e.id, i) < OCCUPIED).slice(0, cap);
    for (const [x, z, hd] of taken) cars.push(dm(x), dm(z), Math.round(hd * 100));
  }
}

// --- čáry a body -----------------------------------------------------------------

const near = (p) => axisDist(p[0], p[1]) < REACH;
const lineOf = (pts, eps) => flat(douglasPeucker(pts, eps));

// ulice mimo trať: z cest vypadnou úseky, po kterých jede závod
const streets = [];
for (const w of roads) {
  const guess = STREET_W[w.tags.highway];
  if (!guess) continue;
  let run = [];
  const flush = () => {
    if (run.length > 1 && run.some(near)) {
      const width = roadWidth(w.tags, corridorOf(run.map(([x, z]) => [x, -z])));
      bump(width ? 'streetWidthMeasured' : 'streetWidthGuessed');
      streets.push([dm(width ?? guess), ...lineOf(run, 0.8)]);
    }
    run = [];
  };
  w.nodes.forEach((id, i) => {
    run.push(toGame(w.geometry[i].lat, w.geometry[i].lon));
    if (i + 1 < w.nodes.length && loop.used.has(edgeKey(id, w.nodes[i + 1]))) flush();
  });
  flush();
}

// --- dopravní značky a zastávky z OSM ------------------------------------------------
// Uzel značky leží na ose silnice: značka se postaví vpravo od řidiče, kterému platí
// (direction=forward/backward vůči cestě, nebo stupně), čelem k němu.
const SIGN = { give_way: 0, stop: 1, maxspeed: 2, city_limit: 3, bus_stop: 4, traffic_signals: 5, speed_camera: 6 };
const signNames = [];
const signs = [];
if (existsSync(join(DATA, 'osm_signs.json'))) {
  const onWay = new Map();
  for (const w of roads) w.nodes.forEach((id, i) => { if (!onWay.has(id)) onWay.set(id, []); onWay.get(id).push({ w, i }); });
  const nameIndex = (n) => (signNames.includes(n) ? signNames.indexOf(n) : signNames.push(n) - 1);
  for (const e of read('osm_signs.json')) {
    const t = e.tags ?? {};
    const kind = SIGN[t.highway] ?? SIGN[t.traffic_sign];
    if (kind === undefined || e.type !== 'node') continue;
    const p = toGame(e.lat, e.lon);
    if (axisDist(p[0], p[1]) > REACH) continue;
    // semafor: hodnota 1 = na trati (stožár s výložníkem nad pruhem), 0 = na vedlejší ulici (sloupek)
    let value = kind === SIGN.maxspeed ? +t.maxspeed || 0 : kind === SIGN.city_limit || kind === SIGN.bus_stop ? nameIndex(t.name ?? '') : 0;
    const host = onWay.get(e.id)?.[0];
    let dir = null, half = null;
    if (host) {
      const g = host.w.geometry, i = host.i;
      const a = toGame(g[Math.max(0, i - 1)].lat, g[Math.max(0, i - 1)].lon), b = toGame(g[Math.min(g.length - 1, i + 1)].lat, g[Math.min(g.length - 1, i + 1)].lon);
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      let fwd = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
      const way = t.direction ?? t['traffic_signals:direction'];
      if (way === 'backward') fwd = [-fwd[0], -fwd[1]];
      else if (way !== 'forward' && !/^\d/.test(way ?? '')) {
        // bez směru (dej přednost): k bližšímu konci cesty, tam bývá křižovatka
        const len = (from, to) => { let s = 0; for (let k = from; k < to; k++) s += Math.hypot(g[k + 1].lat - g[k].lat, (g[k + 1].lon - g[k].lon) * 0.65); return s; };
        if (len(0, i) < len(i, g.length - 1)) fwd = [-fwd[0], -fwd[1]];
      }
      dir = fwd;
      const onTrack = (i > 0 && loop.used.has(edgeKey(host.w.nodes[i - 1], e.id))) || (i + 1 < host.w.nodes.length && loop.used.has(edgeKey(e.id, host.w.nodes[i + 1])));
      if (kind === SIGN.traffic_signals) value = onTrack ? 1 : 0;
      const n = nearAxis(p[0], p[1]);
      half = onTrack && n ? clWidth[n.k] / 2 + RUNOFF + 0.6 : (STREET_W[host.w.tags.highway] ?? 6) / 2 + 1.2;
    }
    if (/^\d/.test(t.direction ?? '')) {
      // stupně od severu po směru hodinek: kam značka (kamera) hledí, řidič jede proti
      const deg = (parseFloat(t.direction) * Math.PI) / 180;
      dir = [-Math.sin(deg), Math.cos(deg)];
    }
    if (!dir) {
      // zastávka vedle silnice: deska hledí proti autobusům, které jedou po té straně (vpravo)
      let best = null;
      for (const w of roads) {
        const g = w.geometry;
        for (let k = 0; k + 1 < g.length; k++) {
          const a = toGame(g[k].lat, g[k].lon), b = toGame(g[k + 1].lat, g[k + 1].lon);
          const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
          const s = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
          const d = Math.hypot(p[0] - a[0] - dx * s, p[1] - a[1] - dz * s);
          if (!best || d < best.d) best = { d, dx, dz, side: dx * (p[1] - a[1]) - dz * (p[0] - a[0]) };
        }
      }
      if (best && best.d < 20) {
        const l = Math.hypot(best.dx, best.dz) || 1, s = best.side > 0 ? 1 : -1;
        dir = [(best.dx / l) * s, (best.dz / l) * s];
      }
    }
    let x = p[0], z = p[1];
    if (dir && half) {
      // vpravo od směru jízdy (x na východ, z na jih)
      x += -dir[1] * half;
      z += dir[0] * half;
    }
    // stojí-li i tak ve výběhu (zastávka u trati), ustoupí za něj
    const n = nearAxis(x, z);
    if (n && n.d < clWidth[n.k] / 2 + RUNOFF + 0.5) {
      const lat = (x - cl.px[n.k]) * cl.rx[n.k] + (z - cl.pz[n.k]) * cl.rz[n.k];
      const need = (Math.sign(lat) || 1) * (clWidth[n.k] / 2 + RUNOFF + 0.6);
      x = cl.px[n.k] + cl.rx[n.k] * need;
      z = cl.pz[n.k] + cl.rz[n.k] * need;
    }
    // natočení: deska hledí proti směru jízdy
    const face = dir ? Math.atan2(-dir[0], -dir[1]) : 0;
    signs.push(kind, value, dm(x), dm(z), Math.round(face * 100));
  }
}

// Autobusy na nádraží: skupina aspoň čtyř nástupišť stejného jména je stanoviště (na Dobříši
// Mírové náměstí 1–9). U části z nich stojí autobus na nejbližší silnici, nástupiště má po pravé ruce.
const BUS_L = 12, BUS_W = 2.55, BUS_STAND = 0.6;
const buses = [];
if (existsSync(join(DATA, 'osm_signs.json'))) {
  const stops = read('osm_signs.json').filter((e) => e.type === 'node' && e.tags?.highway === 'bus_stop' && e.tags.name);
  const count = new Map();
  for (const e of stops) count.set(e.tags.name, (count.get(e.tags.name) ?? 0) + 1);
  const lanes = roads.filter((w) => STREET_W[w.tags.highway] && w.tags.service !== 'parking_aisle');
  for (const e of stops.filter((s) => count.get(s.tags.name) >= 4).sort((a, b) => a.id - b.id)) {
    if (hash01(e.id, 3) > BUS_STAND) continue;
    const p = toGame(e.lat, e.lon);
    if (axisDist(p[0], p[1]) > REACH) continue;
    let best = null;
    for (const w of lanes) {
      const g = w.geometry;
      for (let k = 0; k + 1 < g.length; k++) {
        const a = toGame(g[k].lat, g[k].lon), b = toGame(g[k + 1].lat, g[k + 1].lon);
        const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
        const s = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
        const f = [a[0] + dx * s, a[1] + dz * s], d = Math.hypot(p[0] - f[0], p[1] - f[1]);
        if (!best || d < best.d) best = { d, f, dx, dz };
      }
    }
    if (!best || best.d > 12) continue;
    // směr jízdy tak, aby nástupiště bylo vpravo (vpravo od (dx, dz) je (-dz, dx))
    const l = Math.hypot(best.dx, best.dz) || 1;
    let ux = best.dx / l, uz = best.dz / l;
    if ((p[0] - best.f[0]) * -uz + (p[1] - best.f[1]) * ux < 0) { ux = -ux; uz = -uz; }
    // bok autobusu 0,3 m od nástupiště
    const off = Math.max(0, best.d - BUS_W / 2 - 0.3);
    const x = best.f[0] - uz * off, z = best.f[1] + ux * off;
    const ends = [-1, -0.5, 0, 0.5, 1].map((t) => [x + ux * t * (BUS_L / 2), z + uz * t * (BUS_L / 2)]);
    if (ends.some(([ex, ez]) => { const n = nearAxis(ex, ez); return (n && n.d < clWidth[n.k] / 2 + RUNOFF + BUS_W / 2 + 0.3) || inHouse(ex, ez); })) continue;
    if (buses.some((b) => Math.hypot(b[0] - x, b[1] - z) < BUS_L + 1)) continue;
    buses.push([x, z, Math.atan2(ux, uz)]);
  }
}

const paths = [];
for (const e of area) {
  const h = e.tags?.highway;
  if (!['footway', 'path', 'steps', 'cycleway'].includes(h) || !e.geometry) continue;
  const r = e.geometry.map((p) => toGame(p.lat, p.lon));
  if (r.some(near)) paths.push(lineOf(r, 1));
}

const streams = [];
for (const e of area) {
  if (!e.tags?.waterway || e.tags.tunnel || !e.geometry) continue;
  const r = e.geometry.map((p) => toGame(p.lat, p.lon));
  if (r.some((p) => p[0] > bounds.minX && p[0] < bounds.maxX && p[1] > bounds.minZ && p[1] < bounds.maxZ)) streams.push(lineOf(r, 2));
}

// zdi a ploty: kus, který by stál ve výběhu, se vynechá
const BARRIER = { wall: 0, retaining_wall: 1, fence: 2, hedge: 3 };
const barriers = [];
for (const e of area) {
  const type = BARRIER[e.tags?.barrier];
  if (type === undefined || !e.geometry) continue;
  let run = [];
  const flush = () => {
    if (run.length > 1 && run.some(near)) barriers.push([type, ...lineOf(run, 0.7)]);
    run = [];
  };
  const r = subdivideRing(e.geometry.map((p) => toGame(p.lat, p.lon)), 3);
  for (const p of r) {
    const n = nearAxis(p[0], p[1]);
    if (n && n.d < clearance(n.k)) flush();
    else run.push(p);
  }
  flush();
}

const pointsOf = (filter) => area.filter(filter).map((e) => toGame(e.lat, e.lon)).filter(near).flatMap((p) => [dm(p[0]), dm(p[1])]);
const lamps = pointsOf((e) => e.type === 'node' && e.tags?.highway === 'street_lamp');
const trees = pointsOf((e) => e.type === 'node' && e.tags?.natural === 'tree');
trees.push(-930, -80, -820, -90); // před průčelím radnice: v OSM nejsou, na fotkách ano
const poi = read('osm_poi.json');
const statues = poi.filter((e) => e.type === 'node' && (e.tags?.artwork_type === 'statue' || e.tags?.memorial === 'statue'))
  .map((e) => toGame(e.lat, e.lon)).filter(near).flatMap((p) => [dm(p[0]), dm(p[1])]);
// komíny převyšují město, proto stačí, když leží na terénu; bez výšky v OSM 25 m
const chimneys = poi.filter((e) => e.tags?.man_made === 'chimney' && e.type === 'node').flatMap((e) => {
  const p = toGame(e.lat, e.lon);
  return p[0] > bounds.minX && p[0] < bounds.maxX && p[1] > bounds.minZ && p[1] < bounds.maxZ ? [[dm(p[0]), dm(p[1]), dm(parseFloat(e.tags.height) || 25)]] : [];
});
const treeRows = area.filter((e) => e.tags?.natural === 'tree_row' && e.geometry).map((e) => lineOf(e.geometry.map((p) => toGame(p.lat, p.lon)), 1));

// stromy podle DMP 1G: koruny ve městě a v pásu lesa u trati, dál v lese je rozmístí hra
const FOREST_EDGE = 60;
const canopy = [];
if (dmp) {
  // S-JTSK → herní souřadnice: na pár kilometrech stačí afinní převod proložený mřížkou bodů
  const rows = [];
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
    const x = minX - REACH + ((maxX - minX + 2 * REACH) * i) / 4, z = minZ - REACH + ((maxZ - minZ + 2 * REACH) * j) / 4;
    rows.push([...wgsToKrovak(...proj.inverse(x, -z)), x, z]);
  }
  const fit = (col) => {
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0];
    for (const r of rows) {
      const a = [r[0] - rows[0][0], r[1] - rows[0][1], 1];
      for (let p = 0; p < 3; p++) { v[p] += a[p] * r[col]; for (let q = 0; q < 3; q++) M[p][q] += a[p] * a[q]; }
    }
    // Cramerovo pravidlo pro 3×3
    const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const d = det(M);
    const k = [0, 1, 2].map((c) => det(M.map((row, p) => row.map((x, q) => (q === c ? v[p] : x)))) / d);
    return (e, n) => k[0] * (e - rows[0][0]) + k[1] * (n - rows[0][1]) + k[2];
  };
  const gx = fit(2), gz = fit(3);
  const es = rows.map((r) => r[0]), ns = rows.map((r) => r[1]);
  const forests = areas.filter((a) => a[0] === 'forest').map((a) => {
    const r = [];
    for (let i = 1; i + 1 < a.length; i += 2) r.push([a[i] / 10, a[i + 1] / 10]);
    return r;
  });
  for (const t of treesOf(dmp.trees, dem.krovak, [Math.min(...es), Math.min(...ns), Math.max(...es), Math.max(...ns)])) {
    const x = gx(t.e, t.n), z = gz(t.e, t.n);
    const d = axisDist(x, z);
    if (d > REACH || (d > FOREST_EDGE && forests.some((r) => pointInRing(x, z, r)))) continue;
    canopy.push(dm(x), dm(z), dm(t.h), dm(t.r));
  }
  stats.treesFromDmp = canopy.length / 4;
}

// --- výšková mřížka ---------------------------------------------------------------

const nx = Math.ceil((bounds.maxX - bounds.minX) / DEM_CELL) + 1;
const nz = Math.ceil((bounds.maxZ - bounds.minZ) / DEM_CELL) + 1;
const heights = new Array(nx * nz);
let holes = 0;
for (let j = 0; j < nz; j++) {
  for (let i = 0; i < nx; i++) {
    const x = bounds.minX + i * DEM_CELL, z = bounds.minZ + j * DEM_CELL;
    let s = 0, n = 0;
    for (const [dx, dz] of [[0, 0], [-4, -4], [4, -4], [-4, 4], [4, 4]]) {
      const h = dem.height(...proj.inverse(x + dx, -(z + dz)));
      if (!Number.isNaN(h)) { s += h; n++; }
    }
    if (!n) holes++;
    heights[j * nx + i] = n ? dm(s / n - base) : null;
  }
}
if (holes) throw new Error(`Výšková mřížka nemá data v ${holes} bodech, doplň listy DMR v fetch-data.mjs.`);

// --- výstup -------------------------------------------------------------------------

const scene = {
  v: 1,
  license: 'ODbL-1.0',
  credit: 'Mapová data © přispěvatelé OpenStreetMap, licence ODbL 1.0. Výškopis DMR 5G © ČÚZK, CC BY 4.0, převzorkováno a vyhlazeno. Výšky budov a stromy z DMP 1G, počty podlaží a silniční pozemky z RÚIAN © ČÚZK, CC BY 4.0.',
  origin: { lat: +lat0.toFixed(6), lon: +lon0.toFixed(6), base: +base.toFixed(2) },
  dem: { x0: Math.round(bounds.minX), z0: Math.round(bounds.minZ), cell: DEM_CELL, nx, nz, h: heights },
  palette: { wall: wallPalette, roof: roofPalette, plain: WALLS.plain.map((c) => wallPalette.indexOf(c)) },
  buildings, landmarks, areas, water, paved, streets, paths, streams, barriers, lamps, trees, treeRows, canopy, statues, chimneys, cars, shops, signs, signNames,
  buses: buses.flatMap(([x, z, hd]) => [dm(x), dm(z), Math.round(hd * 100)]),
};

// centrum (Mírové náměstí a Pražská u startu): místo svodidel obrubník a sloupky, jízda se nemění
const URBAN_START = 140;
def.urban = spansWhere((k) => alongCentre(cl.px[k], cl.pz[k]).d < 50 || Math.hypot(cl.px[k], cl.pz[k]) < URBAN_START);

mkdirSync(join(GAME, 'data'), { recursive: true });
const json = JSON.stringify(scene);
writeFileSync(join(GAME, 'data/dobris.json'), json);

const lines = def.points.map((p) => `    [${p.join(', ')}],`).join('\n');
const { points: _p, widths: _w, ...head } = def;
const fields = Object.entries(head).map(([k, v]) => `  ${k}: ${JSON.stringify(v).replace(/"/g, "'")},`).join('\n');
writeFileSync(join(GAME, 'js/tracks-dobris.js'), `// Vygenerováno nástrojem tools/osm2track.mjs, ručně neupravovat.
// Osa podle OpenStreetMap (ODbL), výšky z DMR 5G © ČÚZK (CC BY 4.0).
export const DOBRIS = {
${fields}
  // poměr šířek mezi úseky: [metr od startu, šířka silnice]
  widths: ${JSON.stringify(def.widths)},
  points: [
${lines}
  ],
};
`);

const size = (o) => (JSON.stringify(o).length / 1024).toFixed(0);
let maxDiff = 0;
{
  let j = 0;
  for (let k = 0; k < cl.N; k++) {
    let best = j, bd = Infinity;
    for (let o = -60; o <= 200; o++) {
      const i = (j + o + axis.length) % axis.length;
      const d = (axis[i].x - cl.px[k]) ** 2 + (axis[i].y + cl.pz[k]) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    j = best;
    maxDiff = Math.max(maxDiff, Math.abs(cl.py[k] - relAxis[best].hs));
  }
}
const win = Math.round(50 / cl.step);
let grade50 = 0;
for (let k = 0; k < cl.N; k++) grade50 = Math.max(grade50, Math.abs(cl.py[(k + win) % cl.N] - cl.py[k]) / (win * cl.step));
const c = countCorners(cl);
console.log(`trať: ${(cl.L / 1000).toFixed(2)} km, bodů ${def.points.length}, min. R ${check.minRadius.toFixed(1)} m, min. odstup ${check.minSeparation.toFixed(0)} m, stoupání okamžité ${(check.maxGrade * 100).toFixed(1)} % / přes 50 m ${(grade50 * 100).toFixed(1)} %, zatáčky ${c.count} (ostré ${c.tight}), odchylka výšky od DMR max. ${maxDiff.toFixed(2)} m`);
console.log(`šířky: ${[...new Set(def.widths.map((w) => w[1]))].sort((a, b) => a - b).join(', ')} m, úseků ${def.widths.length}, start ${lat0.toFixed(5)}, ${lon0.toFixed(5)}`);
console.log('statistika:', JSON.stringify(stats));
console.log(`počty: areas ${areas.length}, water ${water.length}, paved ${paved.length}, streets ${streets.length}, paths ${paths.length}, streams ${streams.length}, barriers ${barriers.length}, lamps ${lamps.length / 2}, trees ${trees.length / 2}, treeRows ${treeRows.length}, cars ${cars.length / 3}, autobusy ${buses.length}, shops ${shops.length}, přechody ${def.crossings.length}, značky ${signs.length / 5}, stromy z DMP ${canopy.length / 4}`);
console.log('hladiny:', water.filter((w) => w.name).map((w) => `${w.name} ${w.level === null ? '?' : ((w.level / 10 + base).toFixed(1) + ' m')}`).join(', '));
console.log(`velikost: celkem ${(json.length / 1024).toFixed(0)} kB (dem ${size(scene.dem)}, budovy ${size(buildings)}, dominanty ${size(landmarks)}, plochy ${size(areas)}, voda ${size(water)}, zpevněné ${size(paved)}, ulice ${size(streets)}, cesty ${size(paths)}, potoky ${size(streams)}, zdi ${size(barriers)}, auta ${size(cars)})`);
