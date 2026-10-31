// Kulisy trati podle skutečného města: data z OSM a DMR (viz tools/README.md) se načtou
// až při výběru trati. Pozemek je jedna namalovaná textura terénu, budovy jsou sloučené
// po dlaždicích, takže celé město stojí jen pár volání kreslení.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG } from './rng.js';
import { instancedChunks, colored, spruceGeometry, broadleafGeometry } from './scenery.js';
import { pointInRing } from './terrain.js';

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
  };
}

const loaded = new Map();
export function loadTown(url) {
  if (!loaded.has(url)) {
    loaded.set(url, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      return r.json();
    }).then(decode).catch((e) => {
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

function worldCanvas(terrain, width) {
  const W = (terrain.nx - 1) * terrain.cell, H = (terrain.nz - 1) * terrain.cell;
  const c = document.createElement('canvas');
  c.width = width;
  c.height = Math.round((width * H) / W);
  const ctx = c.getContext('2d', { willReadFrequently: false });
  const sx = c.width / W, sy = c.height / H;
  ctx.setTransform(sx, 0, 0, sy, -terrain.x0 * sx, -terrain.z0 * sy);
  ctx.lineCap = ctx.lineJoin = 'round';
  return { c, ctx, sx, sy };
}

const AREA_COLORS = {
  forest: '#3f6235', park: '#73a24f', grass: '#7fa858', field: '#b9ad68',
  cemetery: '#628a52', allotments: '#809f58', pitch: '#55a049',
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

export function paintGround(town, track, terrain, quality, anisotropy) {
  const size = quality === 'low' ? 1024 : quality === 'ultra' ? 4096 : 2048;
  const { c, ctx, sx, sy } = worldCanvas(terrain, size);
  const rng = new RNG(4711);
  const W = (terrain.nx - 1) * terrain.cell, H = (terrain.nz - 1) * terrain.cell;
  ctx.fillStyle = '#6f9849';
  ctx.fillRect(terrain.x0, terrain.z0, W, H);
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = ['#5f8a42', '#7fa654', '#688f45', '#8aa95a'][i % 4];
    ctx.globalAlpha = 0.28;
    ctx.beginPath();
    ctx.ellipse(terrain.x0 + rng.range(0, W), terrain.z0 + rng.range(0, H), rng.range(6, 34), rng.range(5, 24), rng.range(0, 3.14), 0, 6.3);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (const kind of ['field', 'grass', 'allotments', 'forest', 'park', 'cemetery', 'pitch']) {
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
  fillRings(ctx, town.paved.filter((a) => a.kind === 'square').map((a) => a.ring), '#b6a994');
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
function windowTexture(rng, anisotropy) {
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

const FLOOR = 3; // metrů na patro i na okno
const SHAPE = { GABLE: 0, HIP: 1, FLAT: 2, TENT: 3, SHED: 4 };

function orientedBox(r) {
  let best = null;
  for (let i = 0; i < r.length; i++) {
    const q = r[(i + 1) % r.length];
    const dx = q[0] - r[i][0], dz = q[1] - r[i][1];
    const l = Math.hypot(dx, dz);
    if (l < 0.3) continue;
    const ux = dx / l, uz = dz / l;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of r) {
      const a = p[0] * ux + p[1] * uz, b = -p[0] * uz + p[1] * ux;
      a0 = Math.min(a0, a); a1 = Math.max(a1, a);
      b0 = Math.min(b0, b); b1 = Math.max(b1, b);
    }
    if (!best || (a1 - a0) * (b1 - b0) < best.area) best = { area: (a1 - a0) * (b1 - b0), ux, uz, a0, a1, b0, b1 };
  }
  let { ux, uz, a0, a1, b0, b1 } = best;
  // osa a je delší strana, po ní běží hřeben
  if (b1 - b0 > a1 - a0) [ux, uz, a0, a1, b0, b1] = [-uz, ux, b0, b1, -a1, -a0];
  const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2;
  return { ux, uz, cx: ca * ux - cb * uz, cz: ca * uz + cb * ux, hl: (a1 - a0) / 2, hw: Math.max(0.5, (b1 - b0) / 2) };
}

// výška střechy nad římsou v poměru 0..1 a čáry, podél kterých se lomí: [A, B, C] pro A·a + B·d + C = 0
function roofProfile(shape, hl, hw) {
  if (shape === SHAPE.GABLE) return { at: (a, d) => Math.max(0, 1 - Math.abs(d) / hw), lines: [[0, 1, 0]] };
  if (shape === SHAPE.HIP) {
    return {
      at: (a, d) => Math.max(0, Math.min(1 - Math.abs(d) / hw, (hl - Math.abs(a)) / hw)),
      lines: [[0, 1, 0], [1, 1, -hl], [1, -1, -hl], [-1, 1, -hl], [-1, -1, -hl]],
    };
  }
  if (shape === SHAPE.TENT) {
    return { at: (a, d) => Math.max(0, Math.min(1 - Math.abs(d) / hw, 1 - Math.abs(a) / hl)), lines: [[hw, hl, 0], [hw, -hl, 0]] };
  }
  if (shape === SHAPE.SHED) return { at: (a, d) => (d + hw) / (2 * hw), lines: [] };
  return { at: () => 0, lines: [] };
}

const mix = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];

// do obrysu vloží body, kde ho protíná lomová čára: horní hrana stěny pak přesně sleduje střechu
function splitRing(ring, f) {
  const out = [];
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length];
    const a = f(p), b = f(q);
    out.push(p);
    if ((a > 1e-6 && b < -1e-6) || (a < -1e-6 && b > 1e-6)) out.push(mix(p, q, a / (a - b)));
  });
  return out;
}

function splitTriangles(tris, f) {
  const out = [];
  for (const t of tris) {
    const v = t.map(f);
    const side = v.map((x) => x > 0);
    if (side[0] === side[1] && side[1] === side[2]) {
      out.push(t);
      continue;
    }
    const i = side[0] === side[1] ? 2 : side[0] === side[2] ? 1 : 0;
    const p = t[i], q = t[(i + 1) % 3], r = t[(i + 2) % 3];
    const pq = mix(p, q, v[i] / (v[i] - v[(i + 1) % 3])), pr = mix(p, r, v[i] / (v[i] - v[(i + 2) % 3]));
    out.push([p, pq, pr], [pq, q, r], [pq, r, pr]);
  }
  return out;
}

function triangulate(ring) {
  const contour = ring.map((p) => new THREE.Vector2(p[0], p[1]));
  return THREE.ShapeUtils.triangulateShape(contour, []).map((t) => t.map((i) => ring[i]));
}

const part = () => ({ pos: [], nor: [], col: [], uv: [] });

function vertex(o, p, n, c, u = 0, v = 0) {
  o.pos.push(p[0], p[1], p[2]);
  o.nor.push(n[0], n[1], n[2]);
  o.col.push(c.r, c.g, c.b);
  o.uv.push(u, v);
}

// obdélník s rohy a (dole), b (nahoře), c (nahoře), d (dole), barva dole a nahoře zvlášť
function panel(o, a, b, c, d, n, low, high, uv) {
  const [u0, u1, v0, v1] = uv ?? [0, 0, 0, 0];
  vertex(o, a, n, low, u0, v0); vertex(o, b, n, high, u0, v1); vertex(o, c, n, high, u1, v1);
  vertex(o, a, n, low, u0, v0); vertex(o, c, n, high, u1, v1); vertex(o, d, n, low, u1, v0);
}

function roofTriangle(o, a, b, c, col) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz);
  if (l < 1e-4) return;
  const flip = ny < 0 ? -1 : 1;
  const n = [(nx * flip) / l, (ny * flip) / l, (nz * flip) / l];
  vertex(o, a, n, col);
  if (flip > 0) {
    vertex(o, b, n, col); vertex(o, c, n, col);
  } else {
    vertex(o, c, n, col); vertex(o, b, n, col);
  }
}

const areaOf = (r) => r.reduce((s, p, i) => {
  const q = r[(i + 1) % r.length];
  return s + p[0] * q[1] - q[0] * p[1];
}, 0);

function addBuilding(tile, terrain, ringIn, { wall, roof, shape, face, top, plain }) {
  const ring = areaOf(ringIn) > 0 ? ringIn : [...ringIn].reverse();
  const box = orientedBox(ring);
  const A = (p) => (p[0] - box.cx) * box.ux + (p[1] - box.cz) * box.uz;
  const D = (p) => -(p[0] - box.cx) * box.uz + (p[1] - box.cz) * box.ux;
  const prof = roofProfile(shape, box.hl, box.hw);
  let sum = 0, low = Infinity;
  for (const p of ring) {
    const h = terrain.heightAt(p[0], p[1]);
    sum += h;
    low = Math.min(low, h);
  }
  const eave = sum / ring.length + wall;
  low -= 0.6;
  const roofY = (p) => eave + roof * prof.at(A(p), D(p));

  let rim = ring, tris = triangulate(ring);
  for (const [a, b, c] of prof.lines) {
    const f = (p) => a * A(p) + b * D(p) + c;
    rim = splitRing(rim, f);
    tris = splitTriangles(tris, f);
  }

  const out = plain ? tile.plain : tile.walls;
  const shade = face.clone().multiplyScalar(0.8);
  rim.forEach((p, i) => {
    const q = rim[(i + 1) % rim.length];
    const dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
    if (len < 0.05) return;
    const n = [dz / len, 0, -dx / len];
    const cells = !plain && len >= 2.2 ? Math.max(1, Math.round(len / FLOOR)) : 0;
    const uv = cells ? [0, cells / 4, (low - eave) / (FLOOR * 4), 0] : null;
    panel(out, [p[0], low, p[1]], [p[0], eave, p[1]], [q[0], eave, q[1]], [q[0], low, q[1]], n, shade, face, uv);
    const yp = roofY(p), yq = roofY(q);
    if (yp > eave + 0.02 || yq > eave + 0.02) panel(out, [p[0], eave, p[1]], [p[0], yp, p[1]], [q[0], yq, q[1]], [q[0], eave, q[1]], n, face, face);
  });
  for (const t of tris) {
    const [a, b, c] = t.map((p) => [p[0], roofY(p), p[1]]);
    roofTriangle(tile.plain, a, b, c, top);
  }
}

function toMesh(o, mat, castShadow) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(o.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(o.nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(o.col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(o.uv, 2));
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = castShadow;
  m.receiveShadow = true;
  return m;
}

// dominanty mají zatím jen hrubý objem, ruční modely přijdou ve fázi 4
const LANDMARK_MASS = {
  zamek: { wall: 11, roof: 5, shape: SHAPE.HIP, face: '#deb887', top: '#3a3d42' },
  trojice: { wall: 11, roof: 7, shape: SHAPE.GABLE, face: '#e3cfa0', top: '#8e4a36' },
  kriz: { wall: 11, roof: 7, shape: SHAPE.GABLE, face: '#ece6d6', top: '#6f7276' },
  radnice: { wall: 9, roof: 5, shape: SHAPE.HIP, face: '#e9c46a', top: '#8e4a36' },
  synagoga: { wall: 8, roof: 4, shape: SHAPE.HIP, face: '#ddd3bd', top: '#6f7276' },
  vargac: { wall: 9, roof: 5, shape: SHAPE.HIP, face: '#efe7d6', top: '#8e4a36' },
};

const colorCache = new Map();
function color(hex) {
  if (!colorCache.has(hex)) colorCache.set(hex, new THREE.Color(hex));
  return colorCache.get(hex);
}

const FENCES = [
  { h: 2, t: 0.4, color: '#b9aea0' }, // zeď
  { h: 1.5, t: 0.5, color: '#a3a097' }, // opěrná zeď
  { h: 1.4, t: 0.12, color: '#6f7a6d' }, // plot
  { h: 1.6, t: 0.9, color: '#3f6a34' }, // živý plot
];

function addFence(tileOf, terrain, track, { type, line }) {
  const f = FENCES[type];
  const col = color(f.color), low = col.clone().multiplyScalar(0.8);
  for (let i = 0; i + 1 < line.length; i++) {
    const p = line[i], q = line[i + 1];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len < 0.1) continue;
    const parts = Math.ceil(len / 6);
    const nx = (q[1] - p[1]) / len, nz = -(q[0] - p[0]) / len;
    const ox = (nx * f.t) / 2, oz = (nz * f.t) / 2;
    for (let k = 0; k < parts; k++) {
      const a = mix(p, q, k / parts), b = mix(p, q, (k + 1) / parts);
      const mid = mix(a, b, 0.5);
      if (terrain.distAt(mid[0], mid[1]) < track.edge + 1 || terrain.keepOut(mid[0], mid[1])) continue;
      const ya = terrain.heightAt(a[0], a[1]), yb = terrain.heightAt(b[0], b[1]);
      const o = tileOf(mid[0], mid[1]).plain;
      const A = (s, y) => [a[0] + s * ox, y, a[1] + s * oz], B = (s, y) => [b[0] + s * ox, y, b[1] + s * oz];
      const [t0, t1] = [ya + f.h, yb + f.h];
      panel(o, A(1, ya - 0.3), A(1, t0), B(1, t1), B(1, yb - 0.3), [nx, 0, nz], low, col);
      panel(o, B(-1, yb - 0.3), B(-1, t1), A(-1, t0), A(-1, ya - 0.3), [-nx, 0, -nz], low, col);
      panel(o, A(1, t0), A(-1, t0), B(-1, t1), B(1, t1), [0, 1, 0], col, col);
    }
  }
}

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

// maska míst, kam nesmí strom: ulice, domy, voda, náměstí a trať
function occupancy(town, track, terrain, buildings) {
  const { c, ctx, sx, sy } = worldCanvas(terrain, Math.ceil(((terrain.nx - 1) * terrain.cell) / 2));
  const ink = '#000';
  for (const s of town.streets) strokeLines(ctx, [s.line], s.width + 3.5, ink);
  strokeLines(ctx, town.paths, 2.5, ink);
  fillRings(ctx, town.paved.map((a) => a.ring), ink);
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

function buildGreenery(town, track, terrain, buildings, density, shadows, rng) {
  const blocked = occupancy(town, track, terrain, buildings);
  const near = (x, z) => terrain.distAt(x, z) < track.edge + 1.5 || terrain.keepOut(x, z);
  const free = (x, z) => !blocked(x, z) && !near(x, z);
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
  for (const p of town.trees) if (!near(p[0], p[1])) leaf(p[0], p[1]);
  for (const line of town.treeRows) {
    for (let i = 0; i + 1 < line.length; i++) {
      const p = line[i], q = line[i + 1], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      for (let d = 0; d < len; d += 9) {
        const m = mix(p, q, d / len);
        if (!near(m[0], m[1])) leaf(m[0], m[1]);
      }
    }
  }
  // v OSM je skoro žádný strom: lesy, parky a zahrady se osadí podle ploch a domů
  const scale = 1 / Math.sqrt(density);
  for (const a of town.areas) {
    if (a.kind === 'forest') plantArea(a.ring, 17 * scale, rng, free, (x, z) => (rng.chance(0.68) ? pine : leaf)(x, z));
    else if (a.kind === 'park') plantArea(a.ring, 27 * scale, rng, free, leaf);
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
  group.add(instancedChunks(spruceGeometry(), mat, spruce, { castShadow: shadows, chunk: 320 }));
  group.add(instancedChunks(broadleafGeometry(), mat, broad, { castShadow: shadows, chunk: 320 }));
  return group;
}

function buildLamps(town, track, terrain, rng) {
  const items = town.lamps.filter((p) => terrain.distAt(p[0], p[1]) > track.edge + 0.5).map((p) => ({
    x: p[0], y: terrain.heightAt(p[0], p[1]), z: p[1], ry: rng.range(0, 6.28),
  }));
  // OSM zná jen 42 lamp, podél trati se doplní po stranách střídavě
  const step = Math.round(44 / track.step);
  for (let k = 0, side = 1; k < track.N; k += step, side = -side) {
    const lat = side * (track.edgeAt(k) + 0.8);
    const p = track.point(k, lat);
    if (terrain.keepOut(p[0], p[2])) continue;
    const dx = track.px[k] - p[0], dz = track.pz[k] - p[2];
    items.push({ x: p[0], y: terrain.heightAt(p[0], p[2]), z: p[2], ry: Math.atan2(-dz, dx) });
  }
  const geo = mergeGeometries([
    colored(new THREE.CylinderGeometry(0.06, 0.1, 7.2, 5).translate(0, 3.6, 0), '#5c6168'),
    colored(new THREE.BoxGeometry(1.8, 0.07, 0.09).translate(0.9, 7.1, 0), '#5c6168'),
    colored(new THREE.BoxGeometry(0.55, 0.1, 0.22).translate(1.7, 7.05, 0), '#ded9c8'),
  ]);
  return instancedChunks(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), items, { castShadow: false, chunk: 320 });
}

export function buildTown(town, track, terrain, quality, seed, anisotropy) {
  const rng = new RNG(seed);
  const shadows = quality !== 'low';
  const density = quality === 'low' ? 0.5 : quality === 'medium' ? 0.75 : 1;
  const group = new THREE.Group();
  group.name = 'town';
  const tiles = new Map();
  const tileOf = (x, z) => {
    const key = Math.floor(x / 420) + ':' + Math.floor(z / 420);
    if (!tiles.has(key)) tiles.set(key, { walls: part(), plain: part() });
    return tiles.get(key);
  };
  const plainWalls = new Set(town.palette.plain);
  const placed = [];
  for (const b of town.buildings) {
    const c = b.ring[0];
    if (b.ring.some((p) => terrain.keepOut(p[0], p[1]))) continue;
    placed.push(b.ring);
    addBuilding(tileOf(c[0], c[1]), terrain, b.ring, {
      wall: b.wall, roof: b.roof, shape: b.shape,
      face: color(town.palette.wall[b.face]), top: color(town.palette.roof[b.top]), plain: plainWalls.has(b.face),
    });
  }
  for (const l of town.landmarks) {
    const m = LANDMARK_MASS[l.id];
    placed.push(l.ring);
    addBuilding(tileOf(l.ring[0][0], l.ring[0][1]), terrain, l.ring, { ...m, face: color(m.face), top: color(m.top), plain: false });
  }
  for (const b of town.barriers) addFence(tileOf, terrain, track, b);

  const wallMat = new THREE.MeshLambertMaterial({ map: windowTexture(rng, anisotropy), vertexColors: true });
  const plainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  for (const t of tiles.values()) {
    if (t.walls.pos.length) group.add(toMesh(t.walls, wallMat, shadows));
    if (t.plain.pos.length) group.add(toMesh(t.plain, plainMat, shadows));
  }
  group.add(buildWater(town));
  group.add(buildGreenery(town, track, terrain, placed, density, shadows, rng));
  group.add(buildLamps(town, track, terrain, rng));
  return group;
}
