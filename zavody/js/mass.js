// Skládání budov do sloučených geometrií: domy z půdorysů i díly ručních modelů.
import * as THREE from 'three';

export const FLOOR = 3; // metrů na patro i na okno
export const SHAPE = { GABLE: 0, HIP: 1, FLAT: 2, TENT: 3, SHED: 4, CROSS: 5 }; // CROSS: sedlová s hřebenem napříč
const BLOCK_PITCH = 3.8; // rozestup oken na fasádě vysokých domů
const BLANK = [0, 0, 0.5, 0.5]; // roh buňky textury, kde žádné okno není
const SHOP_H = 3.6, SHOP_W = 4.5; // výška přízemí s výlohou a šířka jedné výlohy

export function orientedBox(r) {
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
  if (shape === SHAPE.CROSS) return { at: (a) => Math.max(0, 1 - Math.abs(a) / hl), lines: [[1, 0, 0]] };
  if (shape === SHAPE.SHED) return { at: (a, d) => (d + hw) / (2 * hw), lines: [] };
  return { at: () => 0, lines: [] };
}

export const mix = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];

// do obrysu vloží body, kde ho protíná lomová čára: horní hrana stěny pak přesně sleduje střechu
export function splitRing(ring, f) {
  const out = [];
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length];
    const a = f(p), b = f(q);
    out.push(p);
    if ((a > 1e-6 && b < -1e-6) || (a < -1e-6 && b > 1e-6)) out.push(mix(p, q, a / (a - b)));
  });
  return out;
}

export function splitTriangles(tris, f) {
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

export function triangulate(ring) {
  const contour = ring.map((p) => new THREE.Vector2(p[0], p[1]));
  return THREE.ShapeUtils.triangulateShape(contour, []).map((t) => t.map((i) => ring[i]));
}

export const part = () => ({ pos: [], nor: [], col: [], uv: [] });

export function vertex(o, p, n, c, u = 0, v = 0) {
  o.pos.push(p[0], p[1], p[2]);
  o.nor.push(n[0], n[1], n[2]);
  o.col.push(c.r, c.g, c.b);
  o.uv.push(u, v);
}

// obdélník s rohy a (dole), b (nahoře), c (nahoře), d (dole), barva dole a nahoře zvlášť
export function panel(o, a, b, c, d, n, low, high, uv) {
  const [u0, u1, v0, v1] = uv ?? [0, 0, 0, 0];
  vertex(o, a, n, low, u0, v0); vertex(o, b, n, high, u0, v1); vertex(o, c, n, high, u1, v1);
  vertex(o, a, n, low, u0, v0); vertex(o, c, n, high, u1, v1); vertex(o, d, n, low, u1, v0);
}

export function roofTriangle(o, a, b, c, col) {
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

export const areaOf = (r) => r.reduce((s, p, i) => {
  const q = r[(i + 1) % r.length];
  return s + p[0] * q[1] - q[0] * p[1];
}, 0);

// --- křídla domů do L, T a U: každé dostane vlastní střechu ---------------------

// obdélník kolem obrysu natočený podle směru u (osa a = u)
function frameAlong(r, ux, uz) {
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const p of r) {
    const a = p[0] * ux + p[1] * uz, b = -p[0] * uz + p[1] * ux;
    a0 = Math.min(a0, a); a1 = Math.max(a1, a);
    b0 = Math.min(b0, b); b1 = Math.max(b1, b);
  }
  return { ux, uz, a0, a1, b0, b1 };
}
function frameBox(f) {
  const ca = (f.a0 + f.a1) / 2, cb = (f.b0 + f.b1) / 2;
  return { ux: f.ux, uz: f.uz, cx: ca * f.ux - cb * f.uz, cz: ca * f.uz + cb * f.ux, hl: (f.a1 - f.a0) / 2, hw: Math.max(0.5, (f.b1 - f.b0) / 2) };
}

// část obrysu, kde nx·x + nz·z <= c
function clipHalf(ring, nx, nz, c) {
  const out = [];
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length];
    const a = nx * p[0] + nz * p[1] - c, b = nx * q[0] + nz * q[1] - c;
    if (a <= 1e-6) out.push(p);
    if ((a < -1e-6 && b > 1e-6) || (a > 1e-6 && b < -1e-6)) out.push(mix(p, q, a / (a - b)));
  });
  return out.filter((p, i) => Math.hypot(p[0] - out[(i + 1) % out.length][0], p[1] - out[(i + 1) % out.length][1]) > 0.05);
}

const fillOf = (r) => {
  const b = orientedBox(r);
  return Math.abs(areaOf(r)) / 2 / (4 * b.hl * b.hw);
};

// Obrys se řeže čarou z vnitřního rohu podél jeho hrany, dokud z něj nejsou skoro obdélníky.
// Řez musí obrys protnout jen jednou (u U by čára přes obě ramena dala tři kusy).
export function splitWings(ring, depth = 0) {
  const n = ring.length;
  const whole = fillOf(ring);
  if (depth >= 3 || n < 6 || whole > 0.9) return [{ ring, cuts: [] }];
  let best = null;
  ring.forEach((v, i) => {
    const a = ring[(i - 1 + n) % n], b = ring[(i + 1) % n];
    if ((v[0] - a[0]) * (b[1] - v[1]) - (v[1] - a[1]) * (b[0] - v[0]) >= 0) return; // vypouklý roh
    for (const p of [a, b]) {
      const dx = v[0] - p[0], dz = v[1] - p[1], l = Math.hypot(dx, dz);
      if (l < 0.8) continue;
      const nx = -dz / l, nz = dx / l, c = nx * v[0] + nz * v[1];
      let changes = 0, last = 0;
      for (const q of [...ring, ring[0]]) {
        const s = nx * q[0] + nz * q[1] - c;
        const sg = s > 0.05 ? 1 : s < -0.05 ? -1 : 0;
        if (sg && last && sg !== last) changes++;
        if (sg) last = sg;
      }
      if (changes !== 2) continue;
      const A = clipHalf(ring, nx, nz, c), B = clipHalf(ring, -nx, -nz, -c);
      if (A.length < 3 || B.length < 3) continue;
      const aA = Math.abs(areaOf(A)) / 2, aB = Math.abs(areaOf(B)) / 2;
      if (aA < 12 || aB < 12 || orientedBox(A).hw < 1.5 || orientedBox(B).hw < 1.5) continue;
      // při shodě vyhraje řez, který nechá hlavní křídlo celé
      const score = (fillOf(A) * aA + fillOf(B) * aB) / (aA + aB) + 0.01 * Math.max(aA, aB) / (aA + aB);
      if (!best || score > best.score) best = { score, A, B, cut: { nx, nz, c } };
    }
  });
  if (!best || best.score < whole + 0.08) return [{ ring, cuts: [] }];
  return [...splitWings(best.A, depth + 1), ...splitWings(best.B, depth + 1)].map((w) => ({ ...w, cuts: [best.cut, ...w.cuts] }));
}

// Střechy křídel: hlavní (největší) křídlo má hřeben po delší straně, ostatní kolmo na řez,
// prodloužený pod střechu sousedního křídla, takže se v úžlabí protnou samy.
function wingRoofs(ring, shape, roof) {
  const wings = splitWings(ring);
  if (wings.length < 2) return null;
  const kind = shape === SHAPE.HIP ? SHAPE.HIP : SHAPE.GABLE;
  const area = (w) => Math.abs(areaOf(w.ring));
  const main = wings.reduce((m, w) => (area(w) > area(m) ? w : m));
  const mainBox = orientedBox(main.ring);
  const top = Math.min(roof, mainBox.hw * 1.4), pitch = top / mainBox.hw;
  return wings.map((w) => {
    let box = mainBox, ext = null;
    if (w !== main) {
      const on = (cut) => w.ring.filter((p) => Math.abs(cut.nx * p[0] + cut.nz * p[1] - cut.c) < 0.05).length >= 2;
      const cut = w.cuts.find(on);
      if (!cut) return null;
      const f = frameAlong(w.ring, cut.nx, cut.nz);
      const hw = (f.b1 - f.b0) / 2, out = hw + 0.3;
      // strana řezu: křídlo leží na straně, kde nx·x + nz·z < c, nebo naopak
      const toward = f.a1 <= cut.c + 0.05 ? 1 : -1;
      const ac = toward > 0 ? f.a1 : f.a0;
      const ea = ac + toward * out;
      const rect = [[ac, f.b0], [ea, f.b0], [ea, f.b1], [ac, f.b1]].map(([a, b]) => [a * f.ux - b * f.uz, a * f.uz + b * f.ux]);
      const mid = [(rect[0][0] + rect[2][0]) / 2, (rect[0][1] + rect[2][1]) / 2];
      if (toward > 0) f.a1 = ea; else f.a0 = ea;
      box = frameBox(f);
      if (areaOf(rect) < 0) rect.reverse();
      ext = pointInPoly(mid, ring) ? rect : null;
    }
    return { ring: w.ring, ext, box, shape: kind, roof: Math.min(top, pitch * box.hw), cuts: w.cuts };
  });
}

function pointInPoly(p, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if ((r[i][1] > p[1]) !== (r[j][1] > p[1]) && p[0] < ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) inside = !inside;
  }
  return inside;
}

// úseky stěny p→q, které přiléhají k sousednímu domu (společná zeď, bez oken)
function partyRuns(p, q, n, len, party) {
  const steps = Math.max(2, Math.ceil(len));
  const runs = [];
  for (let k = 0; k < steps; k++) {
    const t = (k + 0.5) / steps;
    const blank = party(p[0] + (q[0] - p[0]) * t + n[0], p[1] + (q[1] - p[1]) * t + n[2]);
    const last = runs[runs.length - 1];
    if (last && last.blank === blank) last.t1 = (k + 1) / steps;
    else runs.push({ t0: k / steps, t1: (k + 1) / steps, blank });
  }
  // kousky kratší než okno se přidají k sousedům
  for (let i = runs.length - 1; i > 0; i--) {
    if ((runs[i].t1 - runs[i].t0) * len < 1.5 || (runs[i - 1].t1 - runs[i - 1].t0) * len < 1.5) {
      runs[i - 1] = { t0: runs[i - 1].t0, t1: runs[i].t1, blank: runs[i - 1].blank && runs[i].blank };
      runs.splice(i, 1);
    }
  }
  return runs;
}

// shopFront(x, z): bod 6 m před stěnou leží na ulici, kam patří výloha (jen u domů s obchodem)
// party(x, z): bod leží v sousedním domě, stěna k němu je společná a nemá okna; wings: dům do L, T a U dostane střechu po křídlech
export function addBuilding(tile, terrain, ringIn, { wall, roof, shape, face, top, plain, uvOf, shopFront, party, wings }) {
  const ring = areaOf(ringIn) > 0 ? ringIn : [...ringIn].reverse();
  const box = orientedBox(ring);
  const sloped = shape === SHAPE.GABLE || shape === SHAPE.HIP || shape === SHAPE.CROSS;
  const roofs = (wings && sloped && roof > 0 && wingRoofs(ring, shape, roof)) || [{ ring, ext: null, box, shape, roof, cuts: [] }];
  if (roofs.some((r) => !r)) roofs.splice(0, roofs.length, { ring, ext: null, box, shape, roof, cuts: [] });
  for (const r of roofs) {
    const b = r.box;
    r.A = (p) => (p[0] - b.cx) * b.ux + (p[1] - b.cz) * b.uz;
    r.D = (p) => -(p[0] - b.cx) * b.uz + (p[1] - b.cz) * b.ux;
    r.prof = roofProfile(r.shape, b.hl, b.hw);
    r.fns = r.prof.lines.map(([a, bb, c]) => (p) => a * r.A(p) + bb * r.D(p) + c);
  }
  let sum = 0, low = Infinity;
  for (const p of ring) {
    const h = terrain.heightAt(p[0], p[1]);
    sum += h;
    low = Math.min(low, h);
  }
  const eave = sum / ring.length + wall;
  low -= 0.6;
  const heightOf = (r, p) => eave + r.roof * r.prof.at(r.A(p), r.D(p));

  // horní hrana stěn sleduje střechu křídla, kterému stěna patří; řezy mezi křídly dělí obrys taky
  let rim = ring;
  for (const r of roofs) for (const f of [...r.fns, ...r.cuts.map((c) => (p) => c.nx * p[0] + c.nz * p[1] - c.c)]) rim = splitRing(rim, f);
  const ownerOf = (m) => (roofs.length > 1 && roofs.find((r) => pointInPoly(m, r.ring))) || roofs[0];

  const out = plain ? tile.plain : tile.walls;
  const shade = face.clone().multiplyScalar(0.8);
  // patrové domy mají okna řidší; dlouhý dům s plochou střechou má štítové stěny bez oken jako panelák
  const pitch = wall >= 12 ? BLOCK_PITCH : FLOOR;
  const blankEnds = wall >= 7 && shape === SHAPE.FLAT && box.hl > box.hw * 1.4;
  const wallPanel = (a, b, n, uv) => panel(out, [a[0], low, a[1]], [a[0], eave, a[1]], [b[0], eave, b[1]], [b[0], low, b[1]], n, shade, face, uv);
  const windows = (len) => [0, Math.max(1, Math.round(len / pitch)) / 4, (low - eave) / (FLOOR * 4), 0];
  rim.forEach((p, i) => {
    const q = rim[(i + 1) % rim.length];
    const dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
    if (len < 0.05) return;
    const n = [dz / len, 0, -dx / len];
    const end = blankEnds && Math.abs(dx * box.ux + dz * box.uz) < 0.4 * len;
    const cells = !plain && len >= 2.2 ? Math.max(1, Math.round(len / pitch)) : 0;
    const runs = party && cells && !end && !uvOf ? partyRuns(p, q, n, len, party) : null;
    const uv = uvOf ? uvOf(len, low, eave) : end ? BLANK : cells ? windows(len) : null;
    const mx = (p[0] + q[0]) / 2 + n[0] * 6, mz = (p[1] + q[1]) / 2 + n[2] * 6;
    const shopY = eave - wall + SHOP_H;
    if (runs && (runs.length > 1 || runs[0].blank)) {
      // u souseda zůstane stěna slepá, zbytek má okna jako obvykle
      for (const r of runs) {
        const l = (r.t1 - r.t0) * len;
        wallPanel(mix(p, q, r.t0), mix(p, q, r.t1), n, r.blank || l < 2.2 ? BLANK : windows(l));
      }
    } else if (shopFront && cells && !end && len >= 3 && eave - shopY >= 2.4 && shopFront(mx, mz)) {
      // výloha v přízemí, nad ní okna pater zarovnaná od římsy
      const v = (low - shopY) / SHOP_H;
      panel(tile.shops, [p[0], low, p[1]], [p[0], shopY, p[1]], [q[0], shopY, q[1]], [q[0], low, q[1]], n, shade, face,
        [0, Math.max(1, Math.round(len / SHOP_W)), v, 1]);
      panel(out, [p[0], shopY, p[1]], [p[0], eave, p[1]], [q[0], eave, q[1]], [q[0], shopY, q[1]], n, face, face,
        [0, cells / 4, (shopY - eave) / (FLOOR * 4), 0]);
    } else wallPanel(p, q, n, uv);
    const own = ownerOf([(p[0] + q[0]) / 2 - n[0] * 0.05, (p[1] + q[1]) / 2 - n[2] * 0.05]);
    const yp = heightOf(own, p), yq = heightOf(own, q);
    if (yp > eave + 0.02 || yq > eave + 0.02) panel(out, [p[0], eave, p[1]], [p[0], yp, p[1]], [q[0], yq, q[1]], [q[0], eave, q[1]], n, face, face);
  });
  for (const r of roofs) {
    let tris = triangulate(r.ring);
    if (r.ext) tris.push(...triangulate(r.ext));
    for (const f of r.fns) tris = splitTriangles(tris, f);
    for (const t of tris) roofTriangle(tile.plain, ...t.map((p) => [p[0], heightOf(r, p), p[1]]), top);
    // štít na řezu: vidět je jen tam, kde je toto křídlo vyšší než sousední (prodloužené křídlo ho nepotřebuje)
    if (!r.ext) r.ring.forEach((p, i) => {
      const q = r.ring[(i + 1) % r.ring.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 0.3 || !r.cuts.some((c) => [p, q].every((v) => Math.abs(c.nx * v[0] + c.nz * v[1] - c.c) < 0.05))) return;
      const n = [(q[1] - p[1]) / len, 0, -(q[0] - p[0]) / len];
      const ts = [0, 1];
      for (const f of r.fns) {
        const a = f(p), b = f(q);
        if ((a > 1e-6 && b < -1e-6) || (a < -1e-6 && b > 1e-6)) ts.push(a / (a - b));
      }
      ts.sort((x, y) => x - y);
      for (let k = 0; k + 1 < ts.length; k++) {
        const a = mix(p, q, ts[k]), b = mix(p, q, ts[k + 1]), ya = heightOf(r, a), yb = heightOf(r, b);
        if (ya > eave + 0.02 || yb > eave + 0.02) panel(out, [a[0], eave, a[1]], [a[0], ya, a[1]], [b[0], yb, b[1]], [b[0], eave, b[1]], n, face, face);
      }
    });
  }
  return { box, eave, ground: sum / ring.length, low };
}

export function toMesh(o, mat, castShadow) {
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

const colorCache = new Map();
export function color(hex) {
  if (!colorCache.has(hex)) colorCache.set(hex, new THREE.Color(hex));
  return colorCache.get(hex);
}

// trojúhelník s plochou normálou, proti směru hodinek při pohledu zvenku
export function tri(o, a, b, c, col) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz);
  if (l < 1e-5) return;
  const n = [nx / l, ny / l, nz / l];
  vertex(o, a, n, col); vertex(o, b, n, col); vertex(o, c, n, col);
}

// obdélník jako obrys: u = směr delší osy, hl a hw = poloviční rozměry
export function rectRing(cx, cz, ux, uz, hl, hw) {
  const vx = -uz, vz = ux;
  return [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]].map(([a, b]) => [cx + ux * a + vx * b, cz + uz * a + vz * b]);
}

// svislé stěny obrysu; uvOf(délka hrany, střed x, střed z) vrací [u0, u1, v0, v1]
export function wallRing(o, ring, low, high, colLow, colHigh, uvOf) {
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length];
    const dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
    if (len < 0.02) return;
    panel(o, [p[0], low, p[1]], [p[0], high, p[1]], [q[0], high, q[1]], [q[0], low, q[1]], [dz / len, 0, -dx / len], colLow, colHigh,
      uvOf?.(len, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2));
  });
}

// obrys posunutý ven o d
export function offsetRing(ring, d) {
  return ring.map((p, i) => {
    const a = ring[(i - 1 + ring.length) % ring.length], b = ring[(i + 1) % ring.length];
    const l1 = Math.hypot(p[0] - a[0], p[1] - a[1]) || 1, l2 = Math.hypot(b[0] - p[0], b[1] - p[1]) || 1;
    const n1 = [(p[1] - a[1]) / l1, -(p[0] - a[0]) / l1], n2 = [(b[1] - p[1]) / l2, -(b[0] - p[0]) / l2];
    const mx = n1[0] + n2[0], mz = n1[1] + n2[1];
    const k = (2 * d) / Math.max(0.5, mx * mx + mz * mz);
    return [p[0] + mx * k, p[1] + mz * k];
  });
}

export function capRing(o, ring, y, col) {
  for (const t of triangulate(ring)) roofTriangle(o, ...t.map((p) => [p[0], y, p[1]]), col);
}

// kvádr natočený podle u
export function box(o, cx, cz, ux, uz, hl, hw, y0, y1, col, low = col) {
  const ring = rectRing(cx, cz, ux, uz, hl, hw);
  wallRing(o, ring, y0, y1, low, col);
  capRing(o, ring, y1, col);
}

// rotační tvar z profilu [[poloměr, výška, barva pásu], ...]; plochy zůstávají ostré
export function lathe(o, cx, cz, sides, profile, col, turn = 0) {
  const at = (r, i, y) => {
    const a = turn + (i / sides) * Math.PI * 2;
    return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
  };
  for (let j = 0; j + 1 < profile.length; j++) {
    const [r0, y0] = profile[j], [r1, y1, c = col] = profile[j + 1];
    for (let i = 0; i < sides; i++) {
      const a = at(r0, i, y0), b = at(r0, i + 1, y0), d = at(r1, i, y1), e = at(r1, i + 1, y1);
      tri(o, a, d, e, c);
      tri(o, a, e, b, c);
    }
  }
}

// střecha z prstenců stejné délky, od římsy k vrcholu; poslední se uzavře
export function stack(o, rings, col) {
  for (let j = 0; j + 1 < rings.length; j++) {
    const r0 = rings[j], r1 = rings[j + 1];
    r0.forEach((p, i) => {
      const n = (i + 1) % r0.length;
      roofTriangle(o, p, r0[n], r1[n], col);
      roofTriangle(o, p, r1[n], r1[i], col);
    });
  }
  const top = rings[rings.length - 1];
  for (let i = 1; i + 1 < top.length; i++) roofTriangle(o, top[0], top[i], top[i + 1], col);
}

// tenká zeď nebo živý plot podél čáry, kopíruje terén
export function fenceLine(tileOf, terrain, line, f, clear) {
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
      if (clear && !clear(mid[0], mid[1])) continue;
      const ya = terrain.heightAt(a[0], a[1]), yb = terrain.heightAt(b[0], b[1]);
      const o = tileOf(mid[0], mid[1]).plain;
      const A = (s, y) => [a[0] + s * ox, y, a[1] + s * oz], B = (s, y) => [b[0] + s * ox, y, b[1] + s * oz];
      const t0 = ya + f.h, t1 = yb + f.h;
      panel(o, A(1, ya - 0.3), A(1, t0), B(1, t1), B(1, yb - 0.3), [nx, 0, nz], low, col);
      panel(o, B(-1, yb - 0.3), B(-1, t1), A(-1, t0), A(-1, ya - 0.3), [-nx, 0, -nz], low, col);
      panel(o, A(1, t0), A(-1, t0), B(-1, t1), B(1, t1), [0, 1, 0], col, col);
    }
  }
}
