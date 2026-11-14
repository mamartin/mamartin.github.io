// Skládání budov do sloučených geometrií: domy z půdorysů i díly ručních modelů.
import * as THREE from 'three';

export const FLOOR = 3; // metrů na patro i na okno
export const SHAPE = { GABLE: 0, HIP: 1, FLAT: 2, TENT: 3, SHED: 4, CROSS: 5 }; // CROSS: sedlová s hřebenem napříč
const BLOCK_PITCH = 3.8; // rozestup oken na fasádě vysokých domů
const BLANK = [0, 0, 0.5, 0.5]; // roh buňky textury, kde žádné okno není
// kvádr na půdorysu (funkce box níž); uvnitř addBuilding je jméno box obsazené ohraničením domu
const prism = (...args) => box(...args);
const DOORS = ['#5b3a26', '#3f4a3a', '#6b2f2a', '#4a4f57', '#7a5a3c', '#2f3c4a']; // barvy domovních dveří
const SHOP_H = 3.6, SHOP_W = 4.5; // výška přízemí s výlohou a šířka jedné výlohy
// styl fasády ze scény (tools/gen/buildings.mjs FACADE): pásová okna, panelák s lodžiemi, starý dům s římsou
export const FACADE = { RIBBON: 1, PANEL: 2, OLD: 3 };
const RIBBON_PITCH = 3.0, GROUND_H = 4.2; // šířka pole pásových oken, výška přízemí starého domu

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
// parapety pod okny jednoho kusu stěny p→q (okna obyčejné textury: sklo uprostřed buňky na 48 % šířky,
// spodní hrana 0,77 řady pod horní hranou řady); řady se počítají od římsy `top` dolů k `bottom`
function sills(o, p, q, n, edge, cellsAll, top, bottom, rowH, col) {
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const cellLen = edge.L / cellsAll, hw = cellLen * 0.27, out = 0.13, th = 0.07;
  const lo = col.clone().multiplyScalar(0.7);
  const ux = (q[0] - p[0]) / len, uz = (q[1] - p[1]) / len;
  for (let c = 0; c < cellsAll; c++) {
    const t = (c + 0.5) / cellsAll;
    if (t < edge.t0 || t > edge.t1) continue;
    const at = ((t - edge.t0) / (edge.t1 - edge.t0)) * len;
    if (at - hw < 0.1 || at + hw > len - 0.1) continue;
    const cx = p[0] + ux * at, cz = p[1] + uz * at;
    for (let k = 0; ; k++) {
      const y = top - k * rowH - 0.77 * rowH;
      if (y < bottom + 0.5) break;
      const A = (s, d, yy) => [cx + ux * s + n[0] * d, yy, cz + uz * s + n[2] * d];
      panel(o, A(-hw, out, y - th), A(-hw, out, y), A(hw, out, y), A(hw, out, y - th), n, lo, col); // líc
      panel(o, A(hw, 0, y), A(hw, out, y), A(-hw, out, y), A(-hw, 0, y), [0, 1, 0], col, col); // vrch
      panel(o, A(-hw, 0, y - th), A(-hw, out, y - th), A(hw, out, y - th), A(hw, 0, y - th), [0, -1, 0], lo, lo); // spodek
      // boční plošky (7 × 13 cm) se vynechávají: zdálky nejsou vidět a stály by 40 % trojúhelníků
    }
  }
}

// detail: dům u trati dostane parapety jako geometrii (vidět jsou jen zblízka)
// rich = zkušební realistický vzhled u domů blízko trati: přesah střechy s okapem a svodem, lemování štítů,
// dveře se schodem na stěně k trati a komín; doorY(x, z) = výška země u dveří (chodník)
export function addBuilding(tile, terrain, ringIn, { wall, roof, shape, face, top, plain, uvOf, shopFront, party, wings, levels, facade = 0, detail = false, rich = false, doorY = null }) {
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
  // okna podle stylu: pásová a lodžie mají vlastní texturu (jiná část dlaždice), jinak obyčejná okna
  const styled = !plain && !uvOf && (facade === FACADE.RIBBON ? tile.ribbon : facade === FACADE.PANEL ? tile.panel : null);
  const old = !plain && !uvOf && facade === FACADE.OLD && wall >= GROUND_H + 2;
  // patrové domy mají okna řidší; dlouhý dům s plochou střechou má štítové stěny bez oken jako panelák
  const pitch = facade === FACADE.RIBBON ? RIBBON_PITCH : wall >= 12 ? BLOCK_PITCH : FLOOR;
  const blankEnds = wall >= 7 && shape === SHAPE.FLAT && box.hl > box.hw * 1.4;
  const wallPanel = (a, b, n, uv, o = out) => panel(o, [a[0], low, a[1]], [a[0], eave, a[1]], [b[0], eave, b[1]], [b[0], low, b[1]], n, shade, face, uv);
  // výška řady oken: s počtem podlaží z katastru stěna na patra, jinak po 3 m
  const rowH = levels ? Math.min(4.5, Math.max(2.6, wall / levels)) : FLOOR;
  // stěna rozdělená střechou (valba, křídla) na kusy: okna se počítají po celé původní hraně obrysu,
  // aby navazovala a sloupce textury (lodžie) se střídaly i přes hranice kusů
  const along = (p, q) => {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 0.05) continue;
      const t = (v) => ((v[0] - a[0]) * (b[0] - a[0]) + (v[1] - a[1]) * (b[1] - a[1])) / (L * L);
      const off = (v) => Math.abs((v[0] - a[0]) * (b[1] - a[1]) - (v[1] - a[1]) * (b[0] - a[0])) / L;
      const t0 = t(p), t1 = t(q);
      if (off(p) < 0.02 && off(q) < 0.02 && t0 > -1e-3 && t1 < 1 + 1e-3 && t1 > t0) return { L, t0, t1 };
    }
    return null;
  };
  const vLow = (low - eave) / (rowH * 4);
  const sillColor = face.clone().lerp(WHITE, 0.45);
  // díly navíc (rich): barvy a nejlepší místo pro dveře (nejdelší stěna s okny otočená k trati)
  const trim = rich ? { gutter: new THREE.Color('#6f757b'), soffit: face.clone().multiplyScalar(0.5), board: face.clone().lerp(WHITE, 0.55), roofEdge: top.clone().multiplyScalar(0.8) } : null;
  let door = null;
  const OVER = 0.38; // m přesahu střechy
  rim.forEach((p, i) => {
    const q = rim[(i + 1) % rim.length];
    const dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
    if (len < 0.05) return;
    const n = [dz / len, 0, -dx / len];
    const end = blankEnds && Math.abs(dx * box.ux + dz * box.uz) < 0.4 * len;
    const edge = along(p, q) ?? { L: len, t0: 0, t1: 1 };
    const cellsAll = !plain && edge.L >= 2.2 ? Math.max(1, Math.round(edge.L / pitch)) : 0;
    const cells = cellsAll && len >= 0.3 ? cellsAll * (edge.t1 - edge.t0) : 0;
    const u0 = (edge.t0 * cellsAll) / 4, u1 = (edge.t1 * cellsAll) / 4;
    const windows = (f0 = 0, f1 = 1) => [u0 + (u1 - u0) * f0, u0 + (u1 - u0) * f1, vLow, 0];
    const runs = party && cells && !end && !uvOf ? partyRuns(p, q, n, len, party) : null;
    const uv = uvOf ? uvOf(len, low, eave) : end ? BLANK : cells ? windows() : null;
    const mx = (p[0] + q[0]) / 2 + n[0] * 6, mz = (p[1] + q[1]) / 2 + n[2] * 6;
    const shopY = eave - wall + SHOP_H;
    if (runs && (runs.length > 1 || runs[0].blank)) {
      // u souseda zůstane stěna slepá, zbytek má okna jako obvykle
      for (const r of runs) {
        const blank = r.blank || (r.t1 - r.t0) * len < 0.3;
        wallPanel(mix(p, q, r.t0), mix(p, q, r.t1), n, blank ? BLANK : windows(r.t0, r.t1), !blank && styled ? styled : out);
      }
    } else if (shopFront && cells && !end && len >= 3 && eave - shopY >= 2.4 && shopFront(mx, mz)) {
      // výloha v přízemí, nad ní okna pater zarovnaná od římsy
      const v = (low - shopY) / SHOP_H;
      panel(tile.shops, [p[0], low, p[1]], [p[0], shopY, p[1]], [q[0], shopY, q[1]], [q[0], low, q[1]], n, shade, face,
        [0, Math.max(1, Math.round(len / SHOP_W)), v, 1]);
      panel(out, [p[0], shopY, p[1]], [p[0], eave, p[1]], [q[0], eave, q[1]], [q[0], shopY, q[1]], n, face, face,
        [u0, u1, (shopY - eave) / (FLOOR * 4), 0]);
    } else if (styled && cells && !end) {
      panel(styled, [p[0], low, p[1]], [p[0], eave, p[1]], [q[0], eave, q[1]], [q[0], low, q[1]], n, shade, face, uv);
    } else if (old && cells && !end) {
      // vyšší přízemí: jedna řada oken roztažená přes celé přízemí, patra nad ním zarovnaná od římsy
      const gy = eave - wall + GROUND_H;
      panel(out, [p[0], low, p[1]], [p[0], gy, p[1]], [q[0], gy, q[1]], [q[0], low, q[1]], n, shade, face, [u0, u1, -0.25, 0]);
      panel(out, [p[0], gy, p[1]], [p[0], eave, p[1]], [q[0], eave, q[1]], [q[0], gy, q[1]], n, face, face, [u0, u1, (gy - eave) / (rowH * 4), 0]);
    } else wallPanel(p, q, n, uv);
    if (detail && cells && !end && !styled && !uvOf && !(runs && (runs.length > 1 || runs[0].blank))) {
      // parapety: u obchodu až nad výlohou, u starého domu nad vyšším přízemím
      const shop = shopFront && len >= 3 && eave - shopY >= 2.4 && shopFront(mx, mz);
      const bottom = shop ? shopY : old ? eave - wall + GROUND_H : eave - wall;
      sills(tile.plain, p, q, n, edge, cellsAll, eave, bottom, shop ? FLOOR : rowH, sillColor);
    }
    const own = ownerOf([(p[0] + q[0]) / 2 - n[0] * 0.05, (p[1] + q[1]) / 2 - n[2] * 0.05]);
    const yp = heightOf(own, p), yq = heightOf(own, q);
    if (yp > eave + 0.02 || yq > eave + 0.02) panel(out, [p[0], eave, p[1]], [p[0], yp, p[1]], [q[0], yq, q[1]], [q[0], eave, q[1]], n, face, face);
    if (rich && sloped && roof > 0 && len > 0.4) {
      const ex = dx / len, ez = dz / len, o = tile.plain;
      // body hrany posunuté ven o d a podél hrany o e (přes rohy, ať v nich nezůstane díra)
      const at = (v, d, e, y) => [v[0] + n[0] * d + ex * e, y, v[1] + n[2] * d + ez * e];
      if (yp <= eave + 0.02 && yq <= eave + 0.02) {
        // okapová hrana: střecha přetažená přes stěnu, podhled, žlab a u konce dlouhé stěny svod
        const up = [n[0] * 0.3, 0.95, n[2] * 0.3];
        panel(o, at(p, OVER, -OVER, eave - 0.07), at(p, -0.02, -OVER, eave + 0.05), at(q, -0.02, OVER, eave + 0.05), at(q, OVER, OVER, eave - 0.07), up, top, top);
        panel(o, at(p, 0, -OVER, eave - 0.1), at(p, OVER, -OVER, eave - 0.1), at(q, OVER, OVER, eave - 0.1), at(q, 0, OVER, eave - 0.1), [0, -1, 0], trim.soffit, trim.soffit);
        panel(o, at(p, OVER + 0.04, -OVER, eave - 0.2), at(p, OVER + 0.04, -OVER, eave - 0.05), at(q, OVER + 0.04, OVER, eave - 0.05), at(q, OVER + 0.04, OVER, eave - 0.2), n, trim.gutter, trim.gutter);
        panel(o, at(p, OVER - 0.08, -OVER, eave - 0.2), at(p, OVER + 0.04, -OVER, eave - 0.2), at(q, OVER + 0.04, OVER, eave - 0.2), at(q, OVER - 0.08, OVER, eave - 0.2), [0, -1, 0], trim.gutter, trim.gutter);
        if (edge.L >= 5 && edge.t1 > 0.999) prism(o, q[0] + n[0] * 0.1 - ex * 0.35, q[1] + n[2] * 0.1 - ez * 0.35, ex, ez, 0.05, 0.05, low, eave - 0.12, trim.gutter);
      } else {
        // štít: střecha přetažená přes stěnu podél spádu a pod ní světlé prkno (závětrná lišta)
        const up = [n[0] * 0.2, 0.97, n[2] * 0.2];
        panel(o, at(p, OVER * 0.7, 0, yp + 0.02), at(p, -0.02, 0, yp + 0.06), at(q, -0.02, 0, yq + 0.06), at(q, OVER * 0.7, 0, yq + 0.02), up, top, top);
        panel(o, at(p, OVER * 0.7, 0, yp - 0.16), at(p, OVER * 0.7, 0, yp + 0.02), at(q, OVER * 0.7, 0, yq + 0.02), at(q, OVER * 0.7, 0, yq - 0.16), n, trim.board, trim.board);
        panel(o, at(p, 0, 0, yp - 0.16), at(p, OVER * 0.7, 0, yp - 0.16), at(q, OVER * 0.7, 0, yq - 0.16), at(q, 0, 0, yq - 0.16), [0, -1, 0], trim.soffit, trim.soffit);
      }
    }
    // dveře: stěna s okny otočená k trati (bod před stěnou je trati blíž než stěna sama), bez výlohy
    if (rich && cells >= 1 && !end && !styled && !uvOf && len >= 3.2 && !(runs && (runs.length > 1 || runs[0].blank)) && (!door || len > door.len)) {
      const cx = (p[0] + q[0]) / 2, cz = (p[1] + q[1]) / 2;
      const shop = shopFront && len >= 3 && eave - shopY >= 2.4 && shopFront(mx, mz);
      if (!shop && terrain.distAt(cx + n[0] * 4, cz + n[2] * 4) < terrain.distAt(cx - n[0] * 2, cz - n[2] * 2)) {
        // střed buňky oken nejblíž středu stěny: dveře nahradí okno v přízemí
        const k = Math.min(cellsAll - 1, Math.max(0, Math.round(((edge.t0 + edge.t1) / 2) * cellsAll - 0.5)));
        const f = ((k + 0.5) / cellsAll - edge.t0) / (edge.t1 - edge.t0);
        if (f > 0.12 && f < 0.88) door = { len, at: mix(p, q, f), n, ex: dx / len, ez: dz / len };
      }
    }
  });
  if (door) {
    const { at, n, ex, ez } = door, o = tile.plain;
    const y0 = doorY ? doorY(at[0] + n[0] * 0.3, at[1] + n[2] * 0.3) : eave - wall;
    // barva dveří podle polohy (stálá náhoda)
    const pick = Math.abs(Math.round(at[0] * 7.3 + at[1] * 3.1)) % DOORS.length;
    const leaf = new THREE.Color(DOORS[pick]), stone = new THREE.Color('#9a968d'), glass = new THREE.Color('#27323c');
    const slab = (d, hw, ya, yb, col) => prism(o, at[0] + n[0] * d / 2, at[1] + n[2] * d / 2, ex, ez, hw, d / 2, ya, yb, col);
    slab(0.14, 0.82, low, y0 + 2.72, sillColor); // ostění, zakryje okno za sebou
    slab(0.2, 0.52, y0 + 0.02, y0 + 2.1, leaf); // křídlo
    slab(0.2, 0.52, y0 + 2.16, y0 + 2.5, glass); // nadsvětlík
    slab(0.26, 0.2, y0 + 0.7, y0 + 1.25, leaf.clone().multiplyScalar(0.72)); // výplň
    slab(0.3, 0.035, y0 + 0.98, y0 + 1.1, new THREE.Color('#b9b3a2')); // klika
    prism(o, at[0] + n[0] * 0.3, at[1] + n[2] * 0.3, ex, ez, 0.8, 0.3, low, y0 + 0.02, stone); // schod
    prism(o, at[0] + n[0] * 0.5, at[1] + n[2] * 0.5, ex, ez, 0.95, 0.5, low, y0 - 0.14, stone);
  }
  // komín u hřebene hlavní střechy
  if (rich && sloped && roof > 1.2) {
    const r = roofs[0], b = r.box;
    const c = [b.cx + b.ux * b.hl * 0.45 + -b.uz * b.hw * 0.18, b.cz + b.uz * b.hl * 0.45 + b.ux * b.hw * 0.18];
    if (pointInPoly(c, r.ring)) {
      const y = heightOf(r, c), brick = new THREE.Color('#8d6253');
      prism(tile.plain, c[0], c[1], b.ux, b.uz, 0.3, 0.24, y - 0.4, y + 1.0, brick, brick.clone().multiplyScalar(0.85));
      prism(tile.plain, c[0], c[1], b.ux, b.uz, 0.36, 0.3, y + 1.0, y + 1.08, new THREE.Color('#5a5650'));
    }
  }
  // starý dům: profilovaná římsa pod střechou (líc a podhled) a tmavší sokl
  if (old) {
    const cornice = face.clone().lerp(WHITE, 0.35), under = face.clone().multiplyScalar(0.62), plinth = face.clone().multiplyScalar(0.55);
    const outer = offsetRing(ring, 0.32), y0 = eave - 0.5;
    ring.forEach((p, i) => {
      const j = (i + 1) % ring.length, q = ring[j], a = outer[i], b = outer[j];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 0.05) return;
      const n = [(q[1] - p[1]) / len, 0, -(q[0] - p[0]) / len];
      panel(out, [a[0], y0, a[1]], [a[0], eave, a[1]], [b[0], eave, b[1]], [b[0], y0, b[1]], n, cornice, cornice);
      panel(out, [p[0], y0, p[1]], [a[0], y0, a[1]], [b[0], y0, b[1]], [q[0], y0, q[1]], [0, -1, 0], under, under);
    });
    wallRing(out, offsetRing(ring, 0.05), low, eave - wall + 0.7, plinth, plinth);
  }
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
  if (o.ao && o.ao.length === (o.pos.length / 3) * 2) g.setAttribute('ao', new THREE.Float32BufferAttribute(o.ao, 2));
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = castShadow;
  m.receiveShadow = true;
  return m;
}

const colorCache = new Map();
const WHITE = new THREE.Color('#ffffff');
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
