// Kulisy trati podle skutečného města: data z OSM a DMR (viz tools/README.md) se načtou
// až při výběru trati. Pozemek je jedna namalovaná textura terénu, budovy jsou sloučené
// po dlaždicích, takže celé město stojí jen pár volání kreslení.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG } from './rng.js';
import { instancedChunks, colored, spruceGeometry, broadleafGeometry } from './scenery.js';
import { pointInRing } from './terrain.js';
import { part, vertex, addBuilding, areaOf, color, fenceLine, mix, toMesh, triangulate } from './mass.js';
import { buildLandmarks } from './landmarks.js';

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
    statues: pairs(raw.statues),
    chimneys: raw.chimneys.map((c) => ({ x: c[0] / 10, z: c[1] / 10, height: c[2] / 10 })),
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
  for (const kind of ['field', 'grass', 'allotments', 'forest', 'park', 'garden', 'cemetery', 'pitch']) {
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
  for (const l of town.landmarks) placed.push(l.ring);
  const clear = (x, z) => terrain.distAt(x, z) >= track.edge + 1 && !terrain.keepOut(x, z);
  for (const b of town.barriers) fenceLine(tileOf, terrain, b.line, FENCES[b.type], clear);
  group.add(buildLandmarks(town, track, terrain, tileOf, shadows, anisotropy));

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
