// Dominanty Dobříše: ruční nízkopolygonové modely usazené na půdorysy z OSM.
// Předlohou jsou volně licencované fotky z Wikimedia Commons (kategorie Dobříš).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { instancedChunks, colored } from './scenery.js';
import { pointInRing } from './terrain.js';
import {
  SHAPE, addBuilding, areaOf, box, capRing, color, fenceLine, lathe, mix, offsetRing, orientedBox, panel, part,
  rectRing, roofTriangle, stack, toMesh, tri, wallRing,
} from './mass.js';

const WHITE = color('#ffffff');
const CREAM = color('#e8dcc0');
const STUCCO = color('#f3eee2');
const SALMON = color('#c98673');
const SLATE = color('#43464c');
const SLATE_TOP = color('#54575d');
const SOOT = color('#34373b');
const TILE = color('#b4603c');
const DARK = color('#2c3238');
const COPPER = color('#6f9d8a');
const SOLID = [0, 0, 0.5, 0.5]; // místo v textuře bez okna

const castTexture = (canvas, anisotropy) => {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
};

function archWindow(ctx, x, y, w, h, frame, glass) {
  const path = (ox, oy, ww, hh) => {
    ctx.beginPath();
    ctx.moveTo(ox, oy + hh);
    ctx.lineTo(ox, oy + ww / 2);
    ctx.arc(ox + ww / 2, oy + ww / 2, ww / 2, Math.PI, 0);
    ctx.lineTo(ox + ww, oy + hh);
    ctx.closePath();
  };
  ctx.fillStyle = frame;
  path(x - 4, y - 4, w + 8, h + 7);
  ctx.fill();
  ctx.fillStyle = glass;
  path(x, y, w, h);
  ctx.fill();
  ctx.fillStyle = frame;
  ctx.fillRect(x + w / 2 - 1, y, 2, h);
  ctx.fillRect(x, y + h * 0.5, w, 2);
}

// fasáda zámku: horní polovina křídla, dolní rizality; jedna osa okna na šířku textury
function castleTexture(anisotropy) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 512;
  const ctx = c.getContext('2d');
  const trim = '#e8dcc0', wall = '#c98673', glass = '#34424e', frame = '#f5f1e6';
  for (const row of [0, 256]) {
    ctx.fillStyle = wall;
    ctx.fillRect(0, row, 128, 256);
    ctx.fillStyle = trim;
    ctx.fillRect(0, row, 128, 12); // kladí pod římsou
    ctx.fillRect(0, row + 122, 128, 9); // kordonová římsa
    ctx.fillRect(0, row + 232, 128, 24); // sokl
    if (row) {
      ctx.fillRect(0, row, 18, 256); // lizény rizalitu
      ctx.fillRect(110, row, 18, 256);
    }
    // patro
    ctx.fillStyle = trim;
    ctx.fillRect(38, row + 28, 52, 84);
    ctx.fillStyle = frame;
    ctx.fillRect(43, row + 33, 42, 74);
    ctx.fillStyle = glass;
    ctx.fillRect(47, row + 38, 34, 66);
    ctx.fillStyle = frame;
    ctx.fillRect(63, row + 38, 2, 66);
    ctx.fillRect(47, row + 66, 34, 2);
    // přízemí v obloukové nice
    archWindow(ctx, 44, row + 144, 40, 78, trim, row ? '#2a2f35' : '#a96a59');
    if (!row) {
      ctx.fillStyle = frame;
      ctx.fillRect(50, row + 165, 28, 52);
      ctx.fillStyle = glass;
      ctx.fillRect(53, row + 168, 22, 46);
    }
  }
  return castTexture(c, anisotropy);
}

// omítka s obloukovým oknem, barvu dodají vrcholy
function churchTexture(anisotropy) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 128, 256);
  ctx.fillStyle = '#dcd6c8';
  ctx.fillRect(0, 232, 128, 24);
  ctx.fillRect(0, 0, 128, 10);
  ctx.fillRect(0, 0, 8, 256);
  ctx.fillRect(120, 0, 8, 256);
  archWindow(ctx, 40, 44, 48, 150, '#f6f3ea', '#39485a');
  const tex = castTexture(c, anisotropy);
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

const unit = (x, z) => {
  const l = Math.hypot(x, z);
  return [x / l, z / l];
};

// obdélník svislé plochy se středem v (x, z), n míří ven
function facePanel(o, x, z, nx, nz, w, y0, y1, low, high = low, uv) {
  const dx = -nz * w / 2, dz = nx * w / 2;
  panel(o, [x - dx, y0, z - dz], [x - dx, y1, z - dz], [x + dx, y1, z + dz], [x + dx, y0, z + dz], [nx, 0, nz], low, high, uv);
}

function pediment(o, x, z, nx, nz, w, y, h, depth, rim, fill) {
  const dx = -nz * w / 2, dz = nx * w / 2;
  const L = [x - dx, y, z - dz], R = [x + dx, y, z + dz], T = [x, y + h, z];
  const back = (p) => [p[0] - nx * depth, p[1], p[2] - nz * depth];
  tri(o, L, T, R, rim);
  roofTriangle(o, L, T, back(T), rim);
  roofTriangle(o, L, back(T), back(L), rim);
  roofTriangle(o, T, R, back(R), rim);
  roofTriangle(o, T, back(R), back(T), rim);
  if (!fill) return;
  const f = 0.68, ox = nx * 0.06, oz = nz * 0.06;
  tri(o, [x - dx * f + ox, y + 0.28, z - dz * f + oz], [x + ox, y + 0.28 + h * f * 0.9, z + oz], [x + dx * f + ox, y + 0.28, z + dz * f + oz], fill);
}

function dormer(o, x, z, nx, nz, y, w, h, col, roof = SLATE) {
  const ux = -nz, uz = nx;
  box(o, x - nx * 0.6, z - nz * 0.6, ux, uz, w / 2, 0.6, y, y + h, col);
  pediment(o, x, z, nx, nz, w + 0.2, y + h, w * 0.32, 1.2, roof);
  facePanel(o, x + nx * 0.02, z + nz * 0.02, nx, nz, w * 0.56, y + h * 0.2, y + h * 0.84, DARK);
}

function cross(o, x, z, y, s = 1) {
  box(o, x, z, 1, 0, 0.05 * s, 0.05 * s, y, y + 1.5 * s, DARK);
  box(o, x, z, 1, 0, 0.42 * s, 0.05 * s, y + 0.85 * s, y + 0.95 * s, DARK);
}

const WINGS = [
  { a: [395, -37.7], b: [502.6, -64.5], hw: 7.6, stacks: [-40, -14, 20, 42] },
  { a: [482.9, -60], b: [496.6, -5], hw: 7.4, stacks: [-16, 16] },
  { a: [411.5, 20], b: [517.5, -7.3], hw: 6.9, stacks: [-38, -18, 22, 40] },
];
const AXIS_S = unit(106, -27.3), AXIS_N = unit(107.6, -26.8);
const RISALITS = [
  { c: [464.6, 7.4], u: AXIS_S, hl: 11, hw: 7, front: [466.3, 13.7], n: [AXIS_S[1] * -1, AXIS_S[0]] },
  { c: [449, -53.7], u: AXIS_N, hl: 10.5, hw: 8.1, front: [447.4, -61.6], n: [AXIS_N[1], -AXIS_N[0]] },
];

const inside = (r, x, z, m) => {
  const dx = x - r.c[0], dz = z - r.c[1];
  return Math.abs(dx * r.u[0] + dz * r.u[1]) < r.hl + m && Math.abs(-dx * r.u[1] + dz * r.u[0]) < r.hw + m;
};

function buildCastle(l, terrain, facade, tileOf) {
  const plain = tileOf(460, -30).plain;
  const ring = areaOf(l.ring) > 0 ? l.ring : [...l.ring].reverse();
  let sum = 0, low = Infinity;
  for (const p of ring) {
    const h = terrain.heightAt(p[0], p[1]);
    sum += h;
    low = Math.min(low, h);
  }
  const eave = sum / ring.length + 9.6;
  low -= 0.8;
  wallRing(facade, ring, low, eave, WHITE, WHITE, (len, x, z) => {
    const span = len < 2.5 ? len / 4.2 : Math.max(1, Math.round(len / 4.2));
    return RISALITS.some((r) => inside(r, x, z, 1)) ? [0, span, 0.01, 0.49] : [0, span, 0.51, 0.99];
  });
  const rim = offsetRing(ring, 0.35);
  wallRing(plain, rim, eave - 0.4, eave + 0.1, CREAM, CREAM);
  capRing(plain, rim, eave + 0.1, SLATE);

  const wings = WINGS.map((w) => {
    const [ux, uz] = unit(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    return { ...w, ux, uz, c: mix(w.a, w.b, 0.5), u: [ux, uz], hl: Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) / 2 };
  });
  const y0 = eave + 0.1, y1 = eave + 3.6, y2 = eave + 5;
  const lift = (r, y) => r.map((p) => [p[0], y, p[1]]);
  wings.forEach((w, i) => {
    const R = (grow) => rectRing(w.c[0], w.c[1], w.ux, w.uz, w.hl + grow, w.hw + grow);
    stack(plain, [lift(R(0.1), y0), lift(R(-1.5), y1)], SLATE);
    stack(plain, [lift(R(-1.5), y1), lift(R(-4.6), y2)], SLATE_TOP);
    const vx = -w.uz, vz = w.ux;
    for (const side of [-1, 1]) {
      for (let t = -w.hl + 5; t < w.hl - 4; t += 6.6) {
        const s = side * (w.hw - 0.75);
        const x = w.c[0] + w.ux * t + vx * s, z = w.c[1] + w.uz * t + vz * s;
        const taken = RISALITS.some((r) => inside(r, x, z, 2)) || wings.some((o, j) => j !== i && inside({ ...o, c: o.c }, x, z, 2));
        if (!taken) dormer(plain, x, z, vx * side, vz * side, eave + 0.8, 1.5, 1.9, CREAM);
      }
    }
    for (const t of w.stacks) {
      const x = w.c[0] + w.ux * t, z = w.c[1] + w.uz * t;
      box(plain, x, z, w.ux, w.uz, 0.85, 0.45, y2 - 0.6, y2 + 2.2, STUCCO);
      box(plain, x, z, w.ux, w.uz, 1, 0.6, y2 + 2.2, y2 + 2.5, SOOT);
    }
  });
  for (const r of RISALITS) {
    const R = (hl, hw) => rectRing(r.c[0], r.c[1], r.u[0], r.u[1], hl, hw);
    stack(plain, [lift(R(r.hl + 0.2, r.hw + 0.2), y0), lift(R(r.hl - 1.1, r.hw - 1.1), eave + 4)], SLATE);
    stack(plain, [lift(R(r.hl - 1.1, r.hw - 1.1), eave + 4), lift(R(Math.max(1, r.hl - r.hw + 0.8), 0.7), eave + 6.6)], SLATE_TOP);
    pediment(plain, r.front[0] + r.n[0] * 1, r.front[1] + r.n[1] * 1, r.n[0], r.n[1], r.hl * 1.7, eave - 0.2, 3.3, 2.4, CREAM, SALMON);
  }
}

function buildTrinity(terrain, church, tileOf) {
  const plain = tileOf(380, -90).plain;
  const face = color('#ecd27c'), shade = face.clone().multiplyScalar(0.84);
  const O = [372.2, -86.1], u = [0.983, -0.182], v = [0.182, 0.983];
  const P = (t, s) => [O[0] + u[0] * t + v[0] * s, O[1] + u[1] * t + v[1] * s];
  const LEN = 22.2, HW = 6.9, APSE = 4.4;
  const arc = [];
  for (let i = 1; i < 6; i++) arc.push(P(-5 - APSE * Math.sin((i / 6) * Math.PI), APSE * Math.cos((i / 6) * Math.PI)));
  const back = [P(0, HW), P(0, APSE), P(-5, APSE), ...arc, P(-5, -APSE), P(0, -APSE), P(0, -HW)];
  const ring = [P(LEN, -HW), P(LEN, HW), ...back];
  const hs = ring.map((p) => terrain.heightAt(p[0], p[1]));
  const ground = hs.reduce((a, b) => a + b) / hs.length, low = Math.min(...hs) - 0.8;
  const eave = ground + 10.5, ridge = ground + 18;
  const uv = (len) => (len > 5 ? [0, Math.round(len / 6.6), 0, 1] : SOLID);
  wallRing(church, ring, low, eave, shade, face, uv);
  wallRing(plain, offsetRing(ring, 0.3), eave - 0.45, eave + 0.05, STUCCO, STUCCO);

  const up = (p, y) => [p[0], y, p[1]];
  const r0 = up(P(3, 0), ridge), r1 = up(P(LEN, 0), ridge);
  const quad = (a, b, c, d) => {
    roofTriangle(plain, a, b, c, TILE);
    roofTriangle(plain, a, c, d, TILE);
  };
  quad(up(P(3, -HW), eave), up(P(LEN, -HW), eave), r1, r0);
  quad(up(P(LEN, HW), eave), up(P(3, HW), eave), r0, r1);
  const fan = [P(3, HW), ...back, P(3, -HW)];
  for (let i = 0; i + 1 < fan.length; i++) roofTriangle(plain, up(fan[i], eave), up(fan[i + 1], eave), r0, TILE);
  pediment(plain, ...P(LEN + 0.1, 0), u[0], u[1], HW * 2, eave, ridge - eave, 0.25, face);

  // věž v průčelí
  const [tx, tz] = P(LEN - 1.1, 0);
  const top = ground + 23.5;
  wallRing(church, rectRing(tx, tz, u[0], u[1], 2.7, 2.7), low, top, shade, face, () => [0, 1, 0, 2.4]);
  box(plain, tx, tz, u[0], u[1], 3, 3, top, top + 0.45, STUCCO);
  box(plain, tx, tz, u[0], u[1], 3, 3, eave - 0.3, eave + 0.1, STUCCO);
  const lantern = color('#ddc982');
  lathe(plain, tx, tz, 8, [[2.9, top + 0.45], [2.75, top + 0.9], [1.9, top + 2.1], [1.05, top + 3], [0.5, top + 3.5],
    [0.8, top + 3.6], [0.8, top + 5.1, lantern], [1.05, top + 5.25], [0.72, top + 6], [0.28, top + 6.6], [0.42, top + 7], [0.1, top + 7.9]], SOOT, Math.PI / 8);
  cross(plain, tx, tz, top + 7.8, 1);

  // sanktusník nad presbytářem
  const [sx, sz] = P(3.2, 0);
  lathe(plain, sx, sz, 6, [[0.95, ridge - 0.7], [0.9, ridge + 1.4], [1.05, ridge + 1.5], [0.6, ridge + 2.2], [0.75, ridge + 3], [0.3, ridge + 3.6], [0.08, ridge + 4.6]], SOOT);
  cross(plain, sx, sz, ridge + 4.5, 0.7);

  const parts = { walls: church, plain };
  const low2 = { wall: 6.2, roof: 3.2, shape: SHAPE.HIP, face, top: TILE, plain: false, uvOf: (len) => (len > 4 ? [0, 1, 0, 1] : SOLID) };
  addBuilding(parts, terrain, [[366.8, -81], [367.7, -75.7], [374.6, -77], [374.1, -80.6]], low2);
  addBuilding(parts, terrain, [[364.8, -89], [364.3, -94.1], [370.5, -95.3], [370.9, -88.4]], low2);
}

function buildCemeteryChurch(terrain, church, tileOf) {
  const plain = tileOf(607, -209).plain;
  const [ux, uz] = unit(0.733, 0.68);
  const ring = rectRing(608.1, -208.5, ux, uz, 11.2, 4.5);
  const m = addBuilding({ walls: church, plain }, terrain, ring, {
    wall: 7.2, roof: 5.8, shape: SHAPE.HIP, face: color('#ead58e'), top: color('#bb5a3a'), plain: false,
    uvOf: (len) => (len > 12 ? [0, 4, 0, 1] : [0, 1, 0, 1]),
  });
  const ridge = m.eave + 5.8;
  const x = 608.1 - ux * 7.2, z = -208.5 - uz * 7.2;
  const spire = color('#bb4c34');
  box(plain, x, z, ux, uz, 1.25, 1.25, ridge - 2.6, ridge + 2.6, spire);
  for (const [nx, nz] of [[ux, uz], [-ux, -uz], [-uz, ux], [uz, -ux]]) {
    facePanel(plain, x + nx * 1.27, z + nz * 1.27, nx, nz, 0.8, ridge + 0.4, ridge + 2.1, DARK);
  }
  lathe(plain, x, z, 4, [[1.95, ridge + 2.6], [1.1, ridge + 3.3], [0.1, ridge + 10.6]], spire, Math.PI / 4 + Math.atan2(uz, ux));
  cross(plain, x, z, ridge + 10.5, 1);
}

function buildTownHall(l, terrain, tile) {
  const m = addBuilding(tile, terrain, l.ring, {
    wall: 8.6, roof: 6.4, shape: SHAPE.HIP, face: color('#f0ead9'), top: color('#b35a35'), plain: false,
  });
  const { cx, cz } = m.box;
  const y = m.eave + 6.4;
  const sill = color('#5f6468');
  lathe(tile.plain, cx, cz, 8, [[1.9, y - 1.2], [1.9, y + 0.8, sill], [1.45, y + 0.9], [1.45, y + 2.6, color('#8fb7a5')], [1.75, y + 2.75, sill],
    [1.1, y + 3.7, COPPER], [0.45, y + 4.3], [0.6, y + 4.7], [0.05, y + 6]], COPPER);
  wallRing(tile.plain, offsetRing(areaOf(l.ring) > 0 ? l.ring : [...l.ring].reverse(), 0.25), m.eave - 0.35, m.eave, STUCCO, STUCCO);
  const { ux, uz, hw } = m.box;
  for (const side of [-1, 1]) {
    const s = side * hw * 0.55;
    dormer(tile.plain, cx - uz * s, cz + ux * s, -uz * side, ux * side, m.eave + 2.2, 2, 0.9, STUCCO, color('#b35a35'));
  }
}

// bývalá synagoga: modrá omítka, bílé římsy, atika a oblý štít v průčelí
function buildSynagogue(l, terrain, church, tile, track) {
  const ring = areaOf(l.ring) > 0 ? l.ring : [...l.ring].reverse();
  const m = addBuilding({ walls: church, plain: tile.plain }, terrain, ring, {
    wall: 9.8, roof: 0, shape: SHAPE.FLAT, face: color('#a9c4e2'), top: color('#8b8e92'), plain: false,
    uvOf: (len) => (len > 4 ? [0, Math.round(len / 4.6), 0, 2] : SOLID),
  });
  const band = (r, a, b) => wallRing(tile.plain, offsetRing(ring, r), a, b, STUCCO, STUCCO);
  band(0.14, m.ground + 4.7, m.ground + 5.1);
  band(0.2, m.eave - 0.3, m.eave + 0.15);
  // štít na nejdelší hraně obrácené k trati
  let best = null;
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length];
    const x = (p[0] + q[0]) / 2, z = (p[1] + q[1]) / 2, len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const nx = (q[1] - p[1]) / len, nz = -(q[0] - p[0]) / len;
    let near = 1e9, tx = 0, tz = 0;
    for (let j = 0; j < track.N; j += 4) {
      const d = Math.hypot(track.px[j] - x, track.pz[j] - z);
      if (d < near) { near = d; tx = track.px[j]; tz = track.pz[j]; }
    }
    if ((tx - x) * nx + (tz - z) * nz > 0 && (!best || len > best.len)) best = { x, z, nx, nz, len };
  });
  if (!best) return;
  const { x, z, nx, nz } = best;
  const px = x + nx * 0.3, pz = z + nz * 0.3, top = m.eave + 0.7;
  const blue = color('#a9c4e2');
  facePanel(church, px, pz, nx, nz, 8.2, m.low, top, blue, blue, [0, 2, 0, 2]);
  const dx = -nz, dz = nx, R = 4.1;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI, b = ((i + 1) / 6) * Math.PI;
    const A = [px + dx * Math.cos(a) * R, top + Math.sin(a) * 1.3, pz + dz * Math.cos(a) * R];
    const B = [px + dx * Math.cos(b) * R, top + Math.sin(b) * 1.3, pz + dz * Math.cos(b) * R];
    tri(tile.plain, [px, top, pz], B, A, STUCCO);
    tri(tile.plain, [px, top, pz], A, B, STUCCO);
  }
}

function buildVargac(l, terrain, tile) {
  const m = addBuilding(tile, terrain, l.ring, {
    wall: 9.6, roof: 6.8, shape: SHAPE.HIP, face: color('#cdbfa2'), top: color('#b5623f'), plain: false,
  });
  const { cx, cz, ux, uz, hw } = m.box;
  for (const side of [-1, 1]) {
    for (const t of [-9, 0, 9]) {
      const s = side * (hw - 1.7);
      const y = m.eave + (6.8 * 1.7) / hw;
      dormer(tile.plain, cx + ux * t - uz * s, cz + uz * t + ux * s, -uz * side, ux * side, y - 0.2, 1.2, 1.1, color('#b5623f'), color('#b5623f'));
    }
  }
}

function buildOrangery(l, terrain, church, tile) {
  addBuilding({ walls: church, plain: tile.plain }, terrain, l.ring, {
    wall: 7.4, roof: 3.6, shape: SHAPE.HIP, face: color('#e4cc97'), top: color('#ad5c3b'), plain: false,
    uvOf: (len) => (len > 4 ? [0, Math.round(len / 4.6), 0, 1] : SOLID),
  });
}

// francouzský park: zámecká osa, záhony z živých plůtků, lemované bazény a tvarované tisy
function buildGarden(town, terrain, tileOf) {
  const area = town.areas.find((a) => a.kind === 'garden');
  if (!area) return null;
  const O = [418.5, 29.5], A = [0.97, -0.244], B = [0.244, 0.97];
  const at = (a, b) => [O[0] + A[0] * a + B[0] * b, O[1] + A[1] * a + B[1] * b];
  const HEDGE = { h: 0.55, t: 0.5, color: '#345c2e' };
  const curve = (f, n = 16) => Array.from({ length: n + 1 }, (_, i) => f(i / n));
  const line = (pts, style = HEDGE) => fenceLine(tileOf, terrain, pts, style);

  // vyšívaný parter ve střední části horní terasy
  for (const [a0, a1, b0, b1, flip] of [[33, 51, 4, 18.5, 1], [53, 71, 4, 18.5, -1], [33, 51, 20.5, 35, -1], [53, 71, 20.5, 35, 1]]) {
    const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2, ha = (a1 - a0) / 2, hb = (b1 - b0) / 2;
    line([...curve((t) => at(a0, b0 + (b1 - b0) * t), 2), ...curve((t) => at(a0 + (a1 - a0) * t, b1), 3), ...curve((t) => at(a1, b1 - (b1 - b0) * t), 2),
      ...curve((t) => at(a1 - (a1 - a0) * t, b0), 3)]);
    line(curve((t) => at(ca + ha * 0.82 * Math.sin(t * Math.PI * 2) * flip, cb + hb * 0.8 * (2 * t - 1))));
    line(curve((t) => at(ca + ha * 0.4 * Math.cos(t * Math.PI * 2), cb + hb * 0.4 * Math.sin(t * Math.PI * 2)), 10));
  }
  // bočním trávníkům stačí orámování
  for (const [a0, a1] of [[5, 27], [76, 92]]) {
    line([at(a0, 6), at(a1, 6), at(a1, 34), at(a0, 34), at(a0, 6)]);
  }

  const plain = tileOf(O[0], O[1]).plain;
  for (const w of town.water) {
    const c = w.ring.reduce((s, p) => [s[0] + p[0] / w.ring.length, s[1] + p[1] / w.ring.length], [0, 0]);
    if (!pointInRing(c[0], c[1], area.ring) || Math.abs(areaOf(w.ring)) > 1600) continue;
    line([...w.ring, w.ring[0]], { h: 0.5, t: 0.55, color: '#cfc8b8' });
    const y = w.level;
    lathe(plain, c[0], c[1], 8, [[1.3, y], [1.3, y + 0.5], [0.5, y + 0.6], [0.3, y + 1.5], [0.8, y + 1.6], [0.1, y + 2.1]], color('#c9c2b2'));
  }

  const yews = [];
  const yew = (a, b) => {
    const [x, z] = at(a, b);
    if (pointInRing(x, z, area.ring)) yews.push({ x, y: terrain.heightAt(x, z), z, s: 1 });
  };
  for (let a = 0; a <= 95; a += 11.9) {
    yew(a, -1.6);
    yew(a, 41.5);
  }
  for (let b = 10; b <= 170; b += 12) {
    yew(-1.6, b);
    yew(96, b);
  }
  const geo = mergeGeometries([
    colored(new THREE.CylinderGeometry(0.12, 0.14, 0.7, 5).translate(0, 0.35, 0), '#5a4a3a'),
    colored(new THREE.ConeGeometry(0.95, 3.1, 7).translate(0, 2.1, 0), '#2f5a33'),
  ]);
  return instancedChunks(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), yews, { chunk: 320, castShadow: false });
}

function statueGroup(town, terrain) {
  const stone = '#bdb6a6';
  const parts = [
    new THREE.BoxGeometry(1, 0.3, 1).translate(0, 0.15, 0).toNonIndexed(),
    new THREE.BoxGeometry(0.72, 1.5, 0.72).translate(0, 1.05, 0).toNonIndexed(),
    new THREE.BoxGeometry(0.95, 0.18, 0.95).translate(0, 1.87, 0).toNonIndexed(),
    new THREE.CylinderGeometry(0.2, 0.36, 1.25, 6).translate(0, 2.58, 0).toNonIndexed(),
    new THREE.BoxGeometry(0.95, 0.16, 0.2).rotateZ(0.55).translate(0.1, 3.05, 0).toNonIndexed(),
    new THREE.IcosahedronGeometry(0.2, 0).translate(0, 3.42, 0),
  ];
  const geo = mergeGeometries(parts.map((g) => colored(g, stone)));
  const items = town.statues.map((p, i) => ({ x: p[0], y: terrain.heightAt(p[0], p[1]) - 0.1, z: p[1], ry: i * 2.4 }));
  return instancedChunks(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), items, { chunk: 320, castShadow: false });
}

export function buildLandmarks(town, track, terrain, tileOf, shadows, anisotropy) {
  const group = new THREE.Group();
  group.name = 'landmarks';
  const facade = part(), church = part();
  const byId = Object.fromEntries(town.landmarks.map((l) => [l.id, l]));
  const tile = (l) => tileOf(l.ring[0][0], l.ring[0][1]);
  buildCastle(byId.zamek, terrain, facade, tileOf);
  buildTrinity(terrain, church, tileOf);
  buildCemeteryChurch(terrain, church, tileOf);
  buildTownHall(byId.radnice, terrain, tile(byId.radnice));
  buildSynagogue(byId.synagoga, terrain, church, tile(byId.synagoga), track);
  buildVargac(byId.vargac, terrain, tile(byId.vargac));
  buildOrangery(byId.oranzerie, terrain, church, tile(byId.oranzerie));
  for (const c of town.chimneys) {
    const y = terrain.heightAt(c.x, c.z) - 0.5, r = Math.max(1, c.height / 24);
    lathe(tileOf(c.x, c.z).plain, c.x, c.z, 10, [[r * 1.5, y], [r * 0.8, y + c.height * 0.92], [r * 0.8, y + c.height, SOOT]],
      color(c.height > 60 ? '#b3b0a8' : '#a4664a'));
  }
  group.add(toMesh(facade, new THREE.MeshLambertMaterial({ map: castleTexture(anisotropy), vertexColors: true }), shadows));
  group.add(toMesh(church, new THREE.MeshLambertMaterial({ map: churchTexture(anisotropy), vertexColors: true }), shadows));
  const garden = buildGarden(town, terrain, tileOf);
  if (garden) group.add(garden);
  group.add(statueGroup(town, terrain));
  return group;
}
