// Kulisy trati podle skutečného města: data z OSM a DMR (viz tools/README.md) se načtou
// až při výběru trati. Pozemek je jedna namalovaná textura terénu, budovy jsou sloučené
// po blocích 300 m (na nízké kvalitě 400 m): blok mimo záběr se nekreslí a za mlhou zmizí celý. Stromy, auta a lampy
// jsou instance přes celou trať se stupni podrobnosti podle vzdálenosti kamery, viditelné vybírá lod.js.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG, clamp } from './rng.js';
import { colored, spruceGeometry, broadleafGeometry, farSpruceGeometry, farBroadleafGeometry } from './scenery.js';
import { pointInRing } from './terrain.js';
import { part, vertex, addBuilding, areaOf, color, fenceLine, mix, panel, toMesh, tri, triangulate } from './mass.js';
import { buildLandmarks, CASTLE_GRAVEL } from './landmarks.js';
import { buildRoadSigns } from './roadsigns.js';
import { lodAt, instancedLevels } from './lod.js';
import { readScene } from './scenecodec.js';
import { buildLife, waitingCars } from './townlife.js';

// jak daleko od osy trati ještě něco vrhá stín
const SHADOW_REACH = 70;
// pás lesa podél trati, kde stojí hustý listnatý porost
const FOREST_EDGE = 60;
// Strana bloku domů (m): menší se lépe ořezává, větší stojí méně volání kreslení. Na nízké kvalitě
// (slabý procesor) větší. Dohled na drobnosti násobí vzdálenosti, kde se zjednoduší nebo zmizí.
const VIEW = {
  low: { block: 400, reach: 0.6 },
  medium: { block: 300, reach: 0.8 },
  high: { block: 300, reach: 1 },
  ultra: { block: 300, reach: 1.25 },
};

const pairs = (a, from = 0) => {
  const out = [];
  for (let i = from; i + 1 < a.length; i += 2) out.push([a[i] / 10, a[i + 1] / 10]);
  return out;
};

function decode(raw) {
  return {
    dem: raw.dem,
    palette: raw.palette,
    water: raw.water.map((w) => ({ ring: pairs(w.p), level: w.level / 10 })),
    buildings: raw.buildings.map((b) => ({ wall: b[0] / 10, roof: b[1] / 10, shape: b[2], face: b[3], top: b[4], ring: pairs(b, 5) })),
    levels: new Map(Array.from({ length: Math.floor((raw.levels?.length ?? 0) / 2) }, (_, i) => [raw.levels[i * 2], raw.levels[i * 2 + 1]])),
    facades: new Map(Array.from({ length: Math.floor((raw.facades?.length ?? 0) / 2) }, (_, i) => [raw.facades[i * 2], raw.facades[i * 2 + 1]])),
    landmarks: raw.landmarks.map((l) => ({ ...l, ring: pairs(l.p) })),
    areas: raw.areas.map((a) => ({ kind: a[0], ring: pairs(a, 1) })),
    paved: raw.paved.map((a) => ({ kind: a[0], ring: pairs(a, 1) })),
    streets: raw.streets.map((s) => ({ width: s[0] / 10, line: pairs(s, 1) })),
    paths: raw.paths.map((p) => pairs(p)),
    streams: raw.streams.map((p) => pairs(p)),
    treeRows: raw.treeRows.map((p) => pairs(p)),
    barriers: raw.barriers.map((b) => ({ type: b[0], line: pairs(b, 1) })),
    lamps: pairs(raw.lamps),
    trees: pairs(raw.trees),
    canopy: Array.from({ length: Math.floor((raw.canopy?.length ?? 0) / 4) }, (_, i) => ({ x: raw.canopy[i * 4] / 10, z: raw.canopy[i * 4 + 1] / 10, h: raw.canopy[i * 4 + 2] / 10, r: raw.canopy[i * 4 + 3] / 10 })),
    statues: pairs(raw.statues),
    chimneys: raw.chimneys.map((c) => ({ x: c[0] / 10, z: c[1] / 10, height: c[2] / 10 })),
    shops: new Set(raw.shops ?? []),
    signs: Array.from({ length: Math.floor((raw.signs?.length ?? 0) / 5) }, (_, i) => ({ kind: raw.signs[i * 5], value: raw.signs[i * 5 + 1], x: raw.signs[i * 5 + 2] / 10, z: raw.signs[i * 5 + 3] / 10, ry: raw.signs[i * 5 + 4] / 100 })),
    signNames: raw.signNames ?? [],
    cars: Array.from({ length: Math.floor((raw.cars?.length ?? 0) / 3) }, (_, i) => ({ x: raw.cars[i * 3] / 10, z: raw.cars[i * 3 + 1] / 10, hd: raw.cars[i * 3 + 2] / 100 })),
    buses: Array.from({ length: Math.floor((raw.buses?.length ?? 0) / 3) }, (_, i) => ({ x: raw.buses[i * 3] / 10, z: raw.buses[i * 3 + 1] / 10, hd: raw.buses[i * 3 + 2] / 100 })),
  };
}

const loaded = new Map();
export function loadTown(url) {
  if (!loaded.has(url)) {
    loaded.set(url, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      return r.arrayBuffer();
    }).then(readScene).then(decode).catch((e) => {
      loaded.delete(url);
      throw e;
    }));
  }
  return loaded.get(url);
}

function trace(ctx, list, close) {
  ctx.beginPath();
  list.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  if (close) ctx.closePath();
}

function strokeLines(ctx, lines, width, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  for (const l of lines) {
    trace(ctx, l);
    ctx.stroke();
  }
}

function fillRings(ctx, rings, color) {
  ctx.fillStyle = color;
  for (const r of rings) {
    trace(ctx, r, true);
    ctx.fill();
  }
}

// pás podél celé trati, šířka podle silnice v daném místě
function trackBand(ctx, track, extra, color) {
  ctx.fillStyle = color;
  for (let k = 0; k < track.N; k += 3) {
    const n = (k + 4) % track.N;
    const e0 = track.edgeAt(k) + extra, e1 = track.edgeAt(n) + extra;
    const a = track.point(k, -e0), b = track.point(k, e0), c = track.point(n, e1), d = track.point(n, -e1);
    trace(ctx, [[a[0], a[2]], [b[0], b[2]], [c[0], c[2]], [d[0], d[2]]], true);
    ctx.fill();
  }
}

const terrainRect = (terrain) => ({ x0: terrain.x0, z0: terrain.z0, w: (terrain.nx - 1) * terrain.cell, h: (terrain.nz - 1) * terrain.cell });

// plátno pro obdélník světa { x0, z0, w, h }
function worldCanvas(rect, width) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = Math.round((width * rect.h) / rect.w);
  const ctx = c.getContext('2d', { willReadFrequently: false });
  const sx = c.width / rect.w, sy = c.height / rect.h;
  ctx.setTransform(sx, 0, 0, sy, -rect.x0 * sx, -rect.z0 * sy);
  ctx.lineCap = ctx.lineJoin = 'round';
  return { c, ctx, sx, sy };
}

const AREA_COLORS = {
  forest: '#3f6235', park: '#73a24f', grass: '#7fa858', lawn: '#7fa858', field: '#b9ad68',
  cemetery: '#628a52', allotments: '#809f58', pitch: '#55a049', garden: '#84b35c',
};

function grain(rng) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = rng.range(205, 255);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// jemnější textura země v okolí trati (px na šířku), na nízké kvalitě žádná
const DETAIL = { low: 0, medium: 2048, high: 3072, ultra: 4096 };
const BLOTCHES = 5.1e-4; // skvrn trávy na m², stejně v hrubé i jemné textuře

export function paintGround(town, track, terrain, quality, anisotropy) {
  const size = quality === 'low' ? 1024 : quality === 'ultra' ? 4096 : 2048;
  const tex = paintRect(town, track, terrainRect(terrain), size, anisotropy);
  if (DETAIL[quality]) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < track.N; k++) {
      x0 = Math.min(x0, track.px[k]); x1 = Math.max(x1, track.px[k]);
      z0 = Math.min(z0, track.pz[k]); z1 = Math.max(z1, track.pz[k]);
    }
    const t = terrainRect(terrain), pad = 80;
    const rect = { x0: Math.max(t.x0, x0 - pad), z0: Math.max(t.z0, z0 - pad) };
    rect.w = Math.min(t.x0 + t.w, x1 + pad) - rect.x0;
    rect.h = Math.min(t.z0 + t.h, z1 + pad) - rect.z0;
    tex.userData.detail = { map: paintRect(town, track, rect, DETAIL[quality], anisotropy), rect };
  }
  return tex;
}

function paintRect(town, track, rect, size, anisotropy) {
  const { c, ctx } = worldCanvas(rect, size);
  const rng = new RNG(4711);
  const W = rect.w, H = rect.h;
  ctx.fillStyle = '#6f9849';
  ctx.fillRect(rect.x0, rect.z0, W, H);
  for (let i = 0, n = Math.round(W * H * BLOTCHES); i < n; i++) {
    ctx.fillStyle = ['#5f8a42', '#7fa654', '#688f45', '#8aa95a'][i % 4];
    ctx.globalAlpha = 0.28;
    ctx.beginPath();
    ctx.ellipse(rect.x0 + rng.range(0, W), rect.z0 + rng.range(0, H), rng.range(6, 34), rng.range(5, 24), rng.range(0, 3.14), 0, 6.3);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // zeleň na náměstí je v datech: plocha je jen obal jeho ulic, proto až pod ní
  fillRings(ctx, town.paved.filter((a) => a.kind === 'square').map((a) => a.ring), '#aaa69c');
  // dvory, nádvoří a komunikace podle katastru: pod zelení z OSM, ta je přesnější
  fillRings(ctx, town.paved.filter((a) => a.kind === 'yard').map((a) => a.ring), '#a3a097');
  if (town.landmarks.some((l) => l.id === 'zamek')) fillRings(ctx, CASTLE_GRAVEL, '#cdc2a6');
  for (const kind of ['field', 'grass', 'lawn', 'allotments', 'forest', 'park', 'garden', 'cemetery', 'pitch']) {
    fillRings(ctx, town.areas.filter((a) => a.kind === kind).map((a) => a.ring), AREA_COLORS[kind]);
  }
  fillRings(ctx, town.paved.filter((a) => a.kind === 'parking').map((a) => a.ring), '#7d7e80');
  const water = town.water.map((w) => w.ring);
  ctx.strokeStyle = '#a89d78';
  ctx.lineWidth = 7;
  for (const r of water) {
    trace(ctx, r, true);
    ctx.stroke();
  }
  fillRings(ctx, water, '#39606f');
  strokeLines(ctx, town.streams, 2.6, '#3f6c7e');
  strokeLines(ctx, town.paths, 2, '#bcae92');
  // chodník vznikne širší stopou pod asfaltem ulice
  for (const s of town.streets) strokeLines(ctx, [s.line], s.width + 3.4, '#a9a69e');
  for (const s of town.streets) strokeLines(ctx, [s.line], s.width, '#58595c');
  trackBand(ctx, track, 3.6, '#adaaa2');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = ctx.createPattern(grain(rng), 'repeat');
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalCompositeOperation = 'source-over';
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

// bílá stěna s okny, barvu fasády dodají vrcholy; rohy buněk zůstávají čisté pro plné plochy
function windowTexture(rng, anisotropy, rects = []) {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S * 4;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, S * 4, S * 4);
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      const x = i * S + 18, y = j * S + 12, w = 28, h = 34;
      ctx.fillStyle = '#dcd8cf';
      ctx.fillRect(x - 3, y - 3, w + 6, h + 7);
      ctx.fillStyle = '#f7f6f2';
      ctx.fillRect(x - 1.5, y - 1.5, w + 3, h + 3);
      ctx.fillStyle = ['#46586a', '#3c4c5e', '#55697a', '#40505c'][rng.int(0, 3)];
      ctx.fillRect(x, y, w, h);
      rects.push([x, y, w, h]);
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(x, y, w, h * 0.34);
      ctx.fillStyle = '#f7f6f2';
      ctx.fillRect(x + w / 2 - 1, y, 2, h);
      ctx.fillRect(x, y + h * 0.36, w, 2);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  return tex;
}

// pásová okna (školy, úřady): v každém patře souvislý pás skla s úzkými sloupky, pod ním parapet
function ribbonTexture(anisotropy, rects = []) {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S * 4;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, S * 4, S * 4);
  for (let j = 0; j < 4; j++) {
    const y = j * S + 10, h = 30;
    ctx.fillStyle = '#d9d6ce';
    ctx.fillRect(0, y - 3, S * 4, h + 6);
    ctx.fillStyle = ['#4a5d6e', '#42566a', '#506476', '#46596b'][j];
    ctx.fillRect(0, y, S * 4, h);
    for (let x = 0; x < S * 4; x += S / 2) rects.push([x + 2, y, S / 2 - 2, h]);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(0, y, S * 4, h * 0.35);
    ctx.fillStyle = '#e8e6e0';
    for (let x = 0; x < S * 4; x += S / 2) ctx.fillRect(x, y, 2, h);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  return tex;
}

// panelák: sloupce oken a lodžií (tmavé zapuštění, světlý parapet přes spodní část, balkonové dveře vzadu)
function panelTexture(rng, anisotropy, rects = []) {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S * 4;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, S * 4, S * 4);
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      const x0 = i * S, y0 = j * S;
      if (i === 1 || i === 2) {
        // dvě buňky tvoří jednu širokou lodžii: zapuštění ve stínu přes celou výšku patra, vzadu dveře a okno,
        // vpředu šedý betonový parapet s horní hranou
        const l = i === 1 ? 4 : 0, r = i === 2 ? 4 : 0;
        ctx.fillStyle = '#5a5853';
        ctx.fillRect(x0 + l, y0, S - l - r, S);
        ctx.fillStyle = ['#2f3b47', '#36424f', '#2b3640'][rng.int(0, 2)];
        if (i === 1) { ctx.fillRect(x0 + 18, y0 + 6, 20, 40); rects.push([x0 + 18, y0 + 6, 20, 30]); } // dveře
        else { ctx.fillRect(x0 + 6, y0 + 6, 34, 24); rects.push([x0 + 6, y0 + 6, 34, 24]); } // okno
        ctx.fillStyle = '#a9adb0';
        ctx.fillRect(x0 + l, y0 + 36, S - l - r, 28); // parapet
        ctx.fillStyle = '#d6d8d9';
        ctx.fillRect(x0 + l, y0 + 36, S - l - r, 3);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(x0 + l, y0, S - l - r, 5); // stín pod stropní deskou
      } else {
        const x = x0 + 14, y = y0 + 12, w = 36, h = 30;
        ctx.fillStyle = '#e2dfd8';
        ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
        ctx.fillStyle = ['#46586a', '#3c4c5e', '#55697a'][rng.int(0, 2)];
        ctx.fillRect(x, y, w, h);
        rects.push([x, y, w, h]);
        ctx.fillStyle = '#f7f6f2';
        ctx.fillRect(x + w / 2 - 1, y, 2, h);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  return tex;
}

// přízemí s výlohou: světlá stěna (barvu dodají vrcholy), tmavý štít nad výlohou, sokl dole
// v noci rozsvícená okna: černá textura se stejným rozložením, část oken teple svítí (emissiveMap materiálu)
function litTexture(rects, rng, share, size = 256, wrapT = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);
  for (const [x, y, w, h] of rects) {
    if (rng.next() > share) continue;
    ctx.fillStyle = rng.next() < 0.12 ? '#8fa8d8' : ['#ffcf86', '#ffdca2', '#f6c070', '#ffe6bd'][rng.int(0, 3)];
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x, y + h * 0.7, w, h * 0.3); // parapet a záclona dole tmavší
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  if (wrapT) tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function shopTexture(anisotropy) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#3a4048';
  ctx.fillRect(6, 8, 116, 18); // štít s nápisem
  ctx.fillStyle = '#e9e6dd';
  for (let x = 16; x < 112; x += 12) ctx.fillRect(x, 14, 7, 6);
  ctx.fillStyle = '#4b4f55';
  ctx.fillRect(10, 32, 108, 88); // rám výlohy
  ctx.fillStyle = '#5d7486';
  ctx.fillRect(14, 36, 66, 80);
  ctx.fillStyle = '#384754';
  ctx.fillRect(86, 36, 28, 84); // dveře
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(14, 36, 66, 26);
  ctx.fillStyle = '#8f8b84';
  ctx.fillRect(0, 120, 128, 8); // sokl
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  return tex;
}

const FENCES = [
  { h: 2, t: 0.4, color: '#b9aea0' }, // zeď
  { h: 1.5, t: 0.5, color: '#a3a097' }, // opěrná zeď
  { h: 1.4, t: 0.12, color: '#6f7a6d' }, // plot
  { h: 1.6, t: 0.9, color: '#3f6a34' }, // živý plot
];

function buildWater(town) {
  const o = part();
  const n = [0, 1, 0], c = color('#ffffff');
  for (const w of town.water) {
    for (const t of triangulate(areaOf(w.ring) > 0 ? w.ring : [...w.ring].reverse())) {
      const [a, b, d] = t.map((p) => [p[0], w.level, p[1]]);
      const cross = (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]);
      vertex(o, a, n, c);
      vertex(o, cross > 0 ? b : d, n, c);
      vertex(o, cross > 0 ? d : b, n, c);
    }
  }
  const mesh = toMesh(o, new THREE.MeshStandardMaterial({ color: '#4d7f97', roughness: 0.2, metalness: 0.15 }), false);
  mesh.name = 'water';
  return mesh;
}

// nejbližší místo na trati; nápovědu dá mřížka terénu, ať se nehledá po celé trati
function nearTrack(track, terrain, x, z) {
  const i = clamp(Math.round((x - terrain.x0) / terrain.cell), 0, terrain.nx - 1);
  const j = clamp(Math.round((z - terrain.z0) / terrain.cell), 0, terrain.nz - 1);
  const o = track.project(x, z, terrain.near[j * terrain.nx + i]);
  o.edge = track.edgeAt(track.indexAt(o.s));
  return o;
}

// Silnice ve hře je širší než skutečná, takže stromořadí, zdi a ploty podél ní by padly
// do výběhu. Bod souběžné čáry se odsune za okraj výběhu, napříč jdoucí čára zůstane
// (a kus ve výběhu se pak vynechá). dir = směr čáry v bodě.
function pushOut(track, terrain, p, dir, gap) {
  const o = nearTrack(track, terrain, p[0], p[1]);
  if (Math.abs(o.lat) >= o.edge + gap) return p;
  // směr trati je kolmý na její pravou stranu (rx, rz)
  if (Math.abs(dir[0] * o.rz - dir[1] * o.rx) < 0.8) return p;
  const lat = (Math.sign(o.lat) || 1) * (o.edge + gap);
  return [o.cx + o.rx * lat, o.cz + o.rz * lat];
}

function unit(p, q) {
  const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
  return [(q[0] - p[0]) / l, (q[1] - p[1]) / l];
}

// čára rozdělená po nejvýš 4 m s odsunutými body
function pushLine(track, terrain, line, gap) {
  const out = [];
  for (let i = 0; i + 1 < line.length; i++) {
    const p = line[i], q = line[i + 1], dir = unit(p, q);
    const n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 4);
    for (let k = 0; k < n; k++) out.push(pushOut(track, terrain, mix(p, q, k / n), dir, gap));
  }
  const l = line.length;
  if (l > 1) out.push(pushOut(track, terrain, line[l - 1], unit(line[l - 2], line[l - 1]), gap));
  return out;
}

// maska míst, kam nesmí strom: ulice, domy, voda, náměstí a trať
function occupancy(town, track, terrain, buildings) {
  const { c, ctx, sx, sy } = worldCanvas(terrainRect(terrain), Math.ceil(((terrain.nx - 1) * terrain.cell) / 2));
  const ink = '#000';
  for (const s of town.streets) strokeLines(ctx, [s.line], s.width + 3.5, ink);
  strokeLines(ctx, town.paths, 2.5, ink);
  fillRings(ctx, town.paved.filter((a) => a.kind !== 'square').map((a) => a.ring), ink);
  fillRings(ctx, town.water.map((w) => w.ring), ink);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 3;
  for (const r of buildings) {
    trace(ctx, r, true);
    ctx.fill();
    ctx.stroke();
  }
  trackBand(ctx, track, 3, ink);
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  return (x, z) => {
    const i = Math.floor((x - terrain.x0) * sx), j = Math.floor((z - terrain.z0) * sy);
    if (i < 0 || j < 0 || i >= c.width || j >= c.height) return true;
    return data[(j * c.width + i) * 4 + 3] > 40;
  };
}

function plantArea(ring, spacing, rng, free, put) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of ring) {
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
    z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]);
  }
  for (let x = x0; x < x1; x += spacing) {
    for (let z = z0; z < z1; z += spacing) {
      const tx = x + rng.range(-0.45, 0.45) * spacing, tz = z + rng.range(-0.45, 0.45) * spacing;
      if (pointInRing(tx, tz, ring) && free(tx, tz)) put(tx, tz);
    }
  }
}

function buildGreenery(town, track, terrain, buildings, density, shadows, rng, view) {
  const blocked = occupancy(town, track, terrain, buildings);
  const near = (x, z) => terrain.distAt(x, z) < track.edge + 1.5 || terrain.keepOut(x, z);
  // Stromy z DMP 1G stojí na svých místech s výškou podle skenu (šíře koruny je z výšky). Sken má
  // vegetaci jen ve větších porostech, zahrady a stromořadí se proto dál osazují, ale jen tam,
  // kde do 8 m žádný změřený strom nestojí.
  const measured = ringIndex(town.canopy.map((t) => [[t.x - 8, t.z - 8], [t.x + 8, t.z - 8], [t.x + 8, t.z + 8], [t.x - 8, t.z + 8]]));
  const free = (x, z) => !blocked(x, z) && !near(x, z) && !measured(x, z, -1);
  const spruce = [], broad = [];
  const place = (list, x, z, hue, size) => {
    const s = size * rng.range(0.85, 1.25);
    list.push({
      x, y: terrain.heightAt(x, z) - 0.2, z, s, sy: s * rng.range(0.9, 1.2), ry: rng.range(0, 6.28),
      color: new THREE.Color().setHSL(hue + rng.range(-0.03, 0.03), 0.42, rng.range(0.72, 1)).getHex(),
    });
  };
  const leaf = (x, z) => place(broad, x, z, 0.24, 1.25);
  const pine = (x, z) => place(spruce, x, z, 0.3, 1.25);
  const inside = (x, z) => buildings.some((r) => pointInRing(x, z, r));
  for (const t of town.canopy) {
    if (near(t.x, t.z) || inside(t.x, t.z)) continue;
    broad.push({
      x: t.x, y: terrain.heightAt(t.x, t.z) - 0.2, z: t.z, s: clamp(t.r / 2.6, 0.5, 2.4), sy: clamp(t.h / 7.3, 0.55, 4), ry: rng.range(0, 6.28),
      color: new THREE.Color().setHSL(0.24 + rng.range(-0.03, 0.03), 0.42, rng.range(0.72, 1)).getHex(),
    });
  }
  for (const p of town.trees) if (!near(p[0], p[1]) && !measured(p[0], p[1], -1)) leaf(p[0], p[1]);
  for (const line of town.treeRows) {
    for (let i = 0; i + 1 < line.length; i++) {
      const p = line[i], q = line[i + 1], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      for (let d = 0; d < len; d += 9) {
        const m = mix(p, q, d / len);
        if (measured(m[0], m[1], -1)) continue;
        if (!near(m[0], m[1])) leaf(m[0], m[1]);
        else {
          const t = pushOut(track, terrain, m, unit(p, q), 2.2);
          if (t !== m && !terrain.keepOut(t[0], t[1]) && !inside(t[0], t[1])) leaf(t[0], t[1]);
        }
      }
    }
  }
  // v OSM je skoro žádný strom: lesy, parky a zahrady se osadí podle ploch a domů
  const scale = 1 / Math.sqrt(density);
  for (const a of town.areas) {
    // u trati je podle ortofota hustý listnatý porost (zámecký park), dál smrčiny
    if (a.kind === 'forest') {
      plantArea(a.ring, 8.5 * scale, rng, free, (x, z) => {
        if (terrain.distAt(x, z) < FOREST_EDGE) (rng.chance(0.8) ? leaf : pine)(x, z);
        else if (rng.chance(0.25)) (rng.chance(0.68) ? pine : leaf)(x, z); // dál hustota jako dřív (17 m)
      });
    }
    else if (a.kind === 'park') plantArea(a.ring, 27 * scale, rng, free, leaf);
    else if (a.kind === 'lawn') plantArea(a.ring, 11 * scale, rng, free, leaf);
    else if (a.kind === 'cemetery') plantArea(a.ring, 24 * scale, rng, free, pine);
    else if (a.kind === 'allotments') plantArea(a.ring, 30 * scale, rng, free, leaf);
  }
  for (const r of buildings) {
    if (!rng.chance(0.4 * density)) continue;
    const c = r[Math.floor(rng.range(0, r.length - 0.01))];
    const x = c[0] + rng.range(-11, 11), z = c[1] + rng.range(-11, 11);
    if (free(x, z)) leaf(x, z);
  }
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const group = new THREE.Group();
  group.name = 'greenery';
  // Stín padá jen kolem auta, takže plný model a stín má jen to, co je u trati, a jen zblízka.
  // Dál stačí silueta, ještě dál jednoduchý tvar a za mlhou nic.
  const close = (t) => shadows && terrain.distAt(t.x, t.z) < SHADOW_REACH;
  const far = (t) => !close(t);
  const { reach, cull } = view;
  const d1 = 140 * reach, d2 = 360 * reach;
  const [fullS, farS] = [spruceGeometry(), farSpruceGeometry()];
  const [fullB, farB] = [broadleafGeometry(), farBroadleafGeometry()];
  // nejdál oba druhy jedním tvarem a voláním, barvu druhu nese barva instance
  const tinted = (list, hex) => list.map((t) => ({ ...t, color: new THREE.Color(t.color).multiply(color(hex)).getHex() }));
  const tiny = [...tinted(spruce, '#305f31'), ...tinted(broad, '#72a040')];
  group.add(instancedLevels([
    [0, [[fullS, spruce.filter(close), true], [fullB, broad.filter(close), true], [farS, spruce.filter(far)], [farB, broad.filter(far)]]],
    [d1, [[farS, spruce], [farB, broad]]],
    [d2, [[tinyTreeGeometry(), tiny]]],
  ], mat, { cull }));
  return group;
}

// nejvzdálenější stromy: čtyřboký dvojjehlan bez kmene, nejširší v dolní třetině (smrk i koruna)
function tinyTreeGeometry() {
  const g = new THREE.OctahedronGeometry(1, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setXYZ(i, p.getX(i) * 2.6, y > 0 ? 3.0 + y * 4.6 : 3.0 + y * 1.6, p.getZ(i) * 2.6);
  }
  return colored(g, '#ffffff');
}

function buildLamps(town, track, terrain, rng, view, night = false) {
  // první plocha náměstí v datech je Mírové náměstí (osm2track ji skládá z jeho ulic)
  const squares = town.paved.filter((a) => a.kind === 'square').slice(0, 1).map((a) => a.ring);
  const historic = [];
  const items =town.lamps.filter((p) => terrain.distAt(p[0], p[1]) > track.edge + 0.5).map((p) => ({
    x: p[0], y: terrain.heightAt(p[0], p[1]), z: p[1], ry: rng.range(0, 6.28),
  }));
  // OSM zná jen 42 lamp, podél trati se doplní po stranách střídavě
  const step = Math.round(44 / track.step);
  for (let k = 0, side = 1; k < track.N; k += step, side = -side) {
    const lat = side * (track.edgeAt(k) + 0.8);
    const p = track.point(k, lat);
    if (terrain.keepOut(p[0], p[2])) continue;
    const dx = track.px[k] - p[0], dz = track.pz[k] - p[2];
    const lamp = { x: p[0], y: terrain.heightAt(p[0], p[2]), z: p[2], ry: Math.atan2(-dz, dx) };
    // na náměstí stojí podle panoramat historické lampy se dvěma koulemi, rameno podél ulice
    if (squares.some((r) => pointInRing(p[0], p[2], r))) historic.push({ ...lamp, ry: lamp.ry + Math.PI / 2 });
    else items.push(lamp);
  }
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const geo = mergeGeometries([
    colored(new THREE.CylinderGeometry(0.06, 0.1, 7.2, 5).translate(0, 3.6, 0), '#5c6168'),
    colored(new THREE.BoxGeometry(1.8, 0.07, 0.09).translate(0.9, 7.1, 0), '#5c6168'),
    colored(new THREE.BoxGeometry(0.55, 0.1, 0.22).translate(1.7, 7.05, 0), '#ded9c8'),
  ]);
  const iron = '#2f3833', globe = '#f4f0e0';
  const old = mergeGeometries([
    colored(new THREE.CylinderGeometry(0.2, 0.26, 0.9, 6).translate(0, 0.45, 0).toNonIndexed(), iron),
    colored(new THREE.CylinderGeometry(0.07, 0.12, 3.6, 6).translate(0, 2.6, 0).toNonIndexed(), iron),
    colored(new THREE.BoxGeometry(1.3, 0.07, 0.07).translate(0, 4.25, 0).toNonIndexed(), iron),
    ...[-0.6, 0.6].map((x) => colored(new THREE.IcosahedronGeometry(0.24, 1).translate(x, 4.55, 0), globe)),
    ...[-0.6, 0.6].map((x) => colored(new THREE.ConeGeometry(0.1, 0.16, 6).translate(x, 4.86, 0).toNonIndexed(), iron)),
  ]);
  // tenký sloup je dál než pár set metrů menší než pixel
  const opts = { cull: Math.min(view.cull, 320 * view.reach) };
  const group = new THREE.Group();
  group.add(instancedLevels([[0, [[geo, items], [old, historic]]]], mat, opts));
  if (night) {
    // svítidla září (bloom) a pod nimi je teplý kruh světla na silnici a chodníku
    const heads = new THREE.MeshLambertMaterial({ color: 0x000000, emissive: '#ffd59a', emissiveIntensity: 3 });
    const head = new THREE.BoxGeometry(0.5, 0.06, 0.2).translate(1.7, 6.99, 0);
    const globes = mergeGeometries([-0.6, 0.6].map((x) => new THREE.IcosahedronGeometry(0.25, 1).translate(x, 4.55, 0)));
    group.add(instancedLevels([[0, [[head, items], [globes, historic]]]], heads, { cull: Math.min(view.cull, 600 * view.reach) }));
    const spots = [
      ...items.map((l) => [l.x + Math.cos(l.ry) * 1.7, l.z - Math.sin(l.ry) * 1.7]),
      ...historic.map((l) => [l.x, l.z]),
    ].filter(([x, z]) => terrain.distAt(x, z) < track.edge + 25);
    group.add(buildLightPools(spots, track, terrain));
  }
  return group;
}

// kruhy světla lamp: síť 5 × 5 po silnici, chodníku a terénu, jedno volání kreslení, sčítání barev
function buildLightPools(spots, track, terrain) {
  const R = 8.5, N = 5;
  const pos = [], uv = [], idx = [];
  const at = {};
  const heightAt = (x, z) => {
    if (terrain.distAt(x, z) > track.edge + 4) return terrain.heightAt(x, z);
    track.project(x, z, -1, at);
    const a = Math.abs(at.lat);
    return a <= track.hwAt(at.i) ? at.y : a <= track.edgeAt(at.i) ? at.y + 0.13 : terrain.heightAt(x, z);
  };
  for (const [cx, cz] of spots) {
    const base = pos.length / 3;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = cx + (i / (N - 1) * 2 - 1) * R, z = cz + (j / (N - 1) * 2 - 1) * R;
        pos.push(x, heightAt(x, z) + 0.06, z);
        uv.push(i / (N - 1), j / (N - 1));
      }
    }
    for (let j = 0; j + 1 < N; j++) {
      for (let i = 0; i + 1 < N; i++) {
        const a = base + j * N + i;
        idx.push(a, a + N, a + 1, a + 1, a + N, a + N + 1);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, color: '#b9874c', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'lightPools';
  mesh.renderOrder = 1;
  return mesh;
}

// středové ostrůvky kruhových objezdů (track.def.islands): kamenný obrubník po terénu a tráva, přejízdný střed z kostek
function buildIslands(track, terrain) {
  const o = part();
  const kerb = color('#b6b2a9'), grass = color('#6a9446');
  const sett = color('#7f7b74'), kerbFlat = color('#c9c5bb'), at = {};
  for (const [cx, cz, r, flat] of track.def.islands ?? []) {
    const n = Math.max(16, Math.round(r * 2.2));
    if (flat) {
      // přejízdný střed: obruba z bílé žuly a mírně vyklenutá dlažba nad vozovkou (výška podle trati, ne terénu)
      const road = (x, z, dy) => { track.project(x, z, -1, at); return [x, at.y + dy, z]; };
      const ringAt = (f, dy) => Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2;
        return road(cx + Math.cos(a) * r * f, cz + Math.sin(a) * r * f, dy);
      });
      const outer = ringAt(1, 0.04), inner = ringAt(1 - 0.35 / r, 0.06), mid = road(cx, cz, 0.14);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        tri(o, outer[i], inner[i], inner[j], kerbFlat);
        tri(o, outer[i], inner[j], outer[j], kerbFlat);
        tri(o, inner[i], mid, inner[j], sett);
      }
      continue;
    }
    const ring = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      return [x, terrain.heightAt(x, z), z];
    });
    const top = (p, d = 0) => [cx + (p[0] - cx) * (1 - d / r), p[1] + 0.16, cz + (p[2] - cz) * (1 - d / r)];
    const mid = [cx, terrain.heightAt(cx, cz) + 0.2, cz];
    ring.forEach((p, i) => {
      const q = ring[(i + 1) % n];
      // líc obrubníku ven a jeho vrch (pruh 0,3 m), uvnitř tráva
      panel(o, [p[0], p[1] - 0.3, p[2]], [p[0], p[1] + 0.16, p[2]], [q[0], q[1] + 0.16, q[2]], [q[0], q[1] - 0.3, q[2]],
        [Math.cos(((i + 0.5) / n) * Math.PI * 2), 0, Math.sin(((i + 0.5) / n) * Math.PI * 2)], kerb, kerb);
      tri(o, top(p), top(p, 0.3), top(q, 0.3), kerb);
      tri(o, top(p), top(q, 0.3), top(q), kerb);
      tri(o, top(p, 0.3), mid, top(q, 0.3), grass);
    });
  }
  const mesh = toMesh(o, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), false);
  mesh.name = 'islands';
  return mesh;
}

// zaparkovaná auta z ploch parkovišť (rozvrh stání dělá tools/osm2track.mjs)
const CAR_COLORS = ['#e8e8e6', '#e8e8e6', '#b9bcc0', '#b9bcc0', '#7c8086', '#2a2c30', '#2a2c30', '#2f4a6e', '#9c2a26', '#4f5f4a', '#d9d4c5', '#6d2f3a'];

function buildCars(town, track, terrain, shadows, view, extra = [], night = false) {
  const rng = new RNG(91);
  // u trati rozhoduje místní šířka (podélné stání hned za chodníkem), jinde stačí hrubá vzdálenost
  const free = (c) => {
    if (terrain.distAt(c.x, c.z) > track.edge + 1.5) return true;
    const o = nearTrack(track, terrain, c.x, c.z);
    return Math.abs(o.lat) > o.edge + 1.1;
  };
  const items = [...town.cars, ...extra].filter((c) => free(c) && !terrain.keepOut(c.x, c.z)).map((c) => ({
    x: c.x, y: terrain.heightAt(c.x, c.z), z: c.z, ry: c.hd, color: rng.pick(CAR_COLORS), waiting: c.waiting,
  }));
  // bílá karoserie dostane barvu instance, okna a kola zůstanou tmavá
  const geo = mergeGeometries([
    colored(new THREE.BoxGeometry(1.76, 0.68, 4.3).translate(0, 0.62, 0), '#ffffff'),
    colored(new THREE.BoxGeometry(1.56, 0.52, 2.2).translate(0, 1.22, -0.25), '#4a525c'),
    colored(new THREE.BoxGeometry(1.5, 0.08, 1.9).translate(0, 1.5, -0.3), '#ffffff'),
    ...[-1.35, 1.35].map((z) => colored(new THREE.BoxGeometry(1.84, 0.56, 0.64).translate(0, 0.28, z), '#1d1e20')),
  ]);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const close = (t) => shadows && terrain.distAt(t.x, t.z) < SHADOW_REACH;
  const group = new THREE.Group();
  group.name = 'cars';
  const opts = { cull: Math.min(view.cull, 380 * view.reach) };
  group.add(instancedLevels([[0, [[geo, items.filter(close), true], [geo, items.filter((t) => !close(t))]]]], mat, opts));
  // v noci svítí auta čekající na výjezd (přední světla a koncová)
  const waiting = items.filter((t) => t.waiting).map(({ color, ...t }) => t);
  if (night && waiting.length) {
    const front = mergeGeometries([-0.6, 0.6].map((x) => new THREE.BoxGeometry(0.3, 0.14, 0.05).translate(x, 0.72, 2.16)));
    const rear = mergeGeometries([-0.62, 0.62].map((x) => new THREE.BoxGeometry(0.26, 0.12, 0.05).translate(x, 0.76, -2.16)));
    group.add(instancedLevels([[0, [[front, waiting]]]], new THREE.MeshLambertMaterial({ color: 0, emissive: '#fff3d8', emissiveIntensity: 4 }), opts));
    group.add(instancedLevels([[0, [[rear, waiting]]]], new THREE.MeshLambertMaterial({ color: 0, emissive: '#ff2a1a', emissiveIntensity: 2.5 }), opts));
  }
  return group;
}

// autobusy u nástupišť autobusového nádraží (stání určuje tools/osm2track.mjs), čelem k +z
const BUS_COLORS = ['#f2f2ef', '#f2f2ef', '#e6dcc2', '#c9372c', '#2f66ad'];

function buildBuses(town, track, terrain, shadows, view) {
  const rng = new RNG(57);
  const items = town.buses.filter((b) => terrain.distAt(b.x, b.z) > track.edge + 1.3 && !terrain.keepOut(b.x, b.z)).map((b) => ({
    x: b.x, y: terrain.heightAt(b.x, b.z), z: b.z, ry: b.hd, color: rng.pick(BUS_COLORS),
  }));
  const group = new THREE.Group();
  group.name = 'buses';
  if (!items.length) return group;
  // karoserie a střešní kryt dostanou barvu instance, okna, kola a pás pod okny jsou tmavé
  const glass = '#2b333c';
  const geo = mergeGeometries([
    colored(new THREE.BoxGeometry(2.5, 2.55, 11.9).translate(0, 1.62, 0), '#ffffff'),
    colored(new THREE.BoxGeometry(2.54, 1.0, 10.4).translate(0, 2.15, -0.45), glass),
    colored(new THREE.BoxGeometry(2.3, 1.55, 0.08).translate(0, 1.95, 5.95), glass),
    colored(new THREE.BoxGeometry(2.0, 1.2, 0.08).translate(0, 2.2, -5.95), glass),
    colored(new THREE.BoxGeometry(2.52, 0.14, 11.92).translate(0, 1.2, 0), '#55595e'),
    colored(new THREE.BoxGeometry(1.7, 0.24, 0.06).translate(0, 2.78, 5.98), '#e8a92e'),
    // dveře na pravém boku (vpravo od směru +z je −x)
    ...[4.6, 0.4, -3.8].map((z) => colored(new THREE.BoxGeometry(0.06, 2.2, 1.2).translate(-1.26, 1.45, z), glass)),
    colored(new THREE.BoxGeometry(1.6, 0.3, 3.2).translate(0, 3.05, -2.4), '#ffffff'),
    ...[3.6, -2.7].map((z) => colored(new THREE.BoxGeometry(2.56, 0.9, 1.0).translate(0, 0.45, z), '#1d1e20')),
  ]);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const opts = { cull: Math.min(view.cull, 500 * view.reach) };
  group.add(instancedLevels([[0, [[geo, items, shadows]]]], mat, opts));
  return group;
}

function joinParts(a, b) {
  if (!b.pos.length) return a;
  if (!a.pos.length) return b;
  return { pos: a.pos.concat(b.pos), nor: a.nor.concat(b.nor), col: a.col.concat(b.col), uv: a.uv.concat(b.uv) };
}

// (x, z, self) → leží bod v jiném obrysu než self? Mřížka po 16 m, ať se nehledá ve všech domech.
function ringIndex(rings) {
  const CELL = 16, grid = new Map();
  rings.forEach((r, i) => {
    const xs = r.map((p) => p[0]), zs = r.map((p) => p[1]);
    for (let gx = Math.floor(Math.min(...xs) / CELL); gx <= Math.floor(Math.max(...xs) / CELL); gx++) {
      for (let gz = Math.floor(Math.min(...zs) / CELL); gz <= Math.floor(Math.max(...zs) / CELL); gz++) {
        const key = `${gx},${gz}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(i);
      }
    }
  });
  return (x, z, self) => (grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? []).some((j) => j !== self && pointInRing(x, z, rings[j]));
}

// fogFar: kde mlha vše zakryje; za ní se nic nekreslí
export function buildTown(town, track, terrain, quality, seed, anisotropy, fogFar = Infinity, night = false) {
  const rng = new RNG(seed);
  const shadows = quality !== 'low';
  const density = quality === 'low' ? 0.5 : quality === 'medium' ? 0.75 : 1;
  const v = VIEW[quality] ?? VIEW.high, BLOCK = v.block;
  // hranice úrovní se měří od každé instance; za mlhou (s rezervou na korunu stromu) nic
  const view = { ...v, cull: fogFar + 10 };
  const group = new THREE.Group();
  group.name = 'town';
  const tiles = new Map();
  const tileOf = (x, z) => {
    const near = shadows && terrain.distAt(x, z) < SHADOW_REACH;
    const bx = Math.floor(x / BLOCK), bz = Math.floor(z / BLOCK);
    const key = `${near}:${bx}:${bz}`;
    if (!tiles.has(key)) tiles.set(key, { walls: part(), plain: part(), shops: part(), ribbon: part(), panel: part(), near, block: `${bx}:${bz}` });
    return tiles.get(key);
  };
  const plainWalls = new Set(town.palette.plain);
  const placed = [];
  // výloha patří na stěnu do trati nebo na náměstí
  const squares = town.paved.filter((a) => a.kind === 'square').map((a) => a.ring);
  const shopFront = (x, z) => terrain.distAt(x, z) < track.edge + 6 || squares.some((r) => pointInRing(x, z, r));
  const standing = town.buildings.map((b, i) => ({ ...b, shop: town.shops.has(i), levels: town.levels.get(i), facade: town.facades?.get(i) ?? 0 })).filter((b) => !b.ring.some((p) => terrain.keepOut(p[0], p[1])));
  const neighbourAt = ringIndex([...standing.map((b) => b.ring), ...town.landmarks.map((l) => l.ring)]);
  standing.forEach((b, i) => {
    const c = b.ring[0];
    placed.push(b.ring);
    addBuilding(tileOf(c[0], c[1]), terrain, b.ring, {
      wall: b.wall, roof: b.roof, shape: b.shape,
      face: color(town.palette.wall[b.face]), top: color(town.palette.roof[b.top]), plain: plainWalls.has(b.face),
      shopFront: b.shop ? shopFront : null,
      party: (x, z) => neighbourAt(x, z, i), wings: true, levels: b.levels, facade: b.facade,
    });
  });
  for (const l of town.landmarks) placed.push(l.ring);
  // hrubá mřížka stačí daleko od trati, u ní rozhoduje přesná vzdálenost
  const clear = (x, z) => {
    if (terrain.keepOut(x, z)) return false;
    if (terrain.distAt(x, z) > track.edge + 12) return true;
    const o = nearTrack(track, terrain, x, z);
    return Math.abs(o.lat) >= o.edge + 0.6;
  };
  for (const b of town.barriers) {
    const near = b.line.some((p) => terrain.distAt(p[0], p[1]) < track.edge + 12);
    fenceLine(tileOf, terrain, near ? pushLine(track, terrain, b.line, 1) : b.line, FENCES[b.type], clear);
  }
  group.add(buildLandmarks(town, track, terrain, tileOf, shadows, anisotropy));

  // Stěny bez oken, střechy a ploty mají všude stejné UV (0, 0), tedy bílý roh textury oken:
  // s okny se proto kreslí jedním voláním. Konstantní UV nemá derivace, takže se vždy
  // čte nejostřejší mipmapa a barva zůstane přesně barvou vrcholů.
  // v noci svítí část oken (vlastní náhoda, ať se denní město nezmění), výlohy všechny
  const litRng = new RNG(seed + 77);
  const rects = { wall: [], ribbon: [], panel: [] };
  const glow = (map, lit) => (night ? { map, vertexColors: true, emissive: 0xffffff, emissiveMap: lit, emissiveIntensity: 1.25 } : { map, vertexColors: true });
  const wallTex = windowTexture(rng, anisotropy, rects.wall), ribbonTex = ribbonTexture(anisotropy, rects.ribbon), panelTex = panelTexture(rng, anisotropy, rects.panel);
  const wallMat = new THREE.MeshLambertMaterial(glow(wallTex, night && litTexture(rects.wall, litRng, 0.3)));
  const shopMat = new THREE.MeshLambertMaterial(glow(shopTexture(anisotropy), night && litTexture([[14, 36, 66, 80], [86, 36, 28, 84], [6, 8, 116, 18]], litRng, 1, 128, false)));
  const ribbonMat = new THREE.MeshLambertMaterial(glow(ribbonTex, night && litTexture(rects.ribbon, litRng, 0.2)));
  const panelMat = new THREE.MeshLambertMaterial(glow(panelTex, night && litTexture(rects.panel, litRng, 0.35)));
  const blocks = new Map();
  for (const t of tiles.values()) {
    if (!blocks.has(t.block)) blocks.set(t.block, new THREE.Group());
    const b = blocks.get(t.block);
    const solid = joinParts(t.walls, t.plain);
    if (solid.pos.length) b.add(toMesh(solid, wallMat, t.near));
    if (t.shops.pos.length) b.add(toMesh(t.shops, shopMat, t.near));
    if (t.ribbon.pos.length) b.add(toMesh(t.ribbon, ribbonMat, t.near));
    if (t.panel.pos.length) b.add(toMesh(t.panel, panelMat, t.near));
  }
  // blok za mlhou se nekreslí; hranice od středu bloku, proto + polovina úhlopříčky
  for (const [key, b] of blocks) {
    const [bx, bz] = key.split(':').map(Number);
    const lod = lodAt({ x: (bx + 0.5) * BLOCK, z: (bz + 0.5) * BLOCK }, [[b, 0], [null, fogFar + BLOCK * 0.71]]);
    lod.name = 'blok';
    group.add(lod);
  }
  group.add(buildWater(town));
  group.add(buildGreenery(town, track, terrain, placed, density, shadows, rng, view));
  group.add(buildLamps(town, track, terrain, rng, view, night));
  const blocked = (x, z) => neighbourAt(x, z, -1);
  group.add(buildCars(town, track, terrain, shadows, view, waitingCars(town, track, terrain, { seed: seed + 31, blocked }), night));
  group.add(buildLife(town, track, terrain, { view, night, seed: seed + 41, blocked }));
  if (track.def.islands?.length) group.add(buildIslands(track, terrain));
  group.add(buildBuses(town, track, terrain, shadows, view));
  group.add(buildRoadSigns(town, track, terrain, anisotropy, (x, z) => neighbourAt(x, z, -1)));
  return group;
}
