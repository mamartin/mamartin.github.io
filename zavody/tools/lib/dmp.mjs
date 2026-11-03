// Body z DMP 1G (ČÚZK, LAZ po listech SM5), souřadnice S-JTSK: třída 6 = budovy, 5 = vysoká vegetace.
// Z budov se pro každý půdorys odhadne výška okapu, hřebene a jestli je střecha plochá, z vegetace koruny stromů.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createLazPerf } from 'laz-perf';
import { pointInRing, minRectFrame } from './poly.mjs';

const CELL = 8;   // mřížka pro hledání bodů v půdorysu
const ROOF = 6;   // třída LAS „budova“
const TREE = 5;   // třída LAS „vysoká vegetace“

function indexPoints(e, n, z) {
  const grid = new Map();
  for (let i = 0; i < e.length; i++) {
    const key = `${Math.floor(e[i] / CELL)},${Math.floor(n[i] / CELL)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  }
  return { e, n, z, grid, count: e.length };
}

// načte všechny listy z dir/raw_*/*.laz: body budov (roofs) a vysoké vegetace (trees); bez dat vrací null
export async function loadDmp(dir) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((d) => d.startsWith('raw_'))
    .flatMap((d) => readdirSync(join(dir, d)).filter((f) => f.endsWith('.laz')).map((f) => join(dir, d, f)));
  if (!files.length) return null;
  const Laz = await createLazPerf();
  const out = { [ROOF]: [[], [], []], [TREE]: [[], [], []] };
  for (const f of files) {
    const buf = readFileSync(f);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const count = dv.getUint32(107, true), rec = dv.getUint16(105, true);
    const scale = [131, 139, 147].map((o) => dv.getFloat64(o, true)), offset = [155, 163, 171].map((o) => dv.getFloat64(o, true));
    const filePtr = Laz._malloc(buf.byteLength);
    Laz.HEAPU8.set(buf, filePtr);
    const zip = new Laz.LASZip();
    zip.open(filePtr, buf.byteLength);
    const p = Laz._malloc(rec);
    for (let i = 0; i < count; i++) {
      zip.getPoint(p);
      const v = new DataView(Laz.HEAPU8.buffer, p, rec);
      const list = out[v.getUint8(15) & 31];
      if (!list) continue;
      list[0].push(v.getInt32(0, true) * scale[0] + offset[0]);
      list[1].push(v.getInt32(4, true) * scale[1] + offset[1]);
      list[2].push(v.getInt32(8, true) * scale[2] + offset[2]);
    }
    zip.delete();
    Laz._free(p);
    Laz._free(filePtr);
  }
  return { roofs: indexPoints(...out[ROOF]), trees: indexPoints(...out[TREE]) };
}

// Stromy z bodů vegetace: model výšek porostu po 2 m, vrcholy jsou místní maxima v okolí
// velikosti koruny. box: [e0, n0, e1, n1] v S-JTSK; vrací [{ e, n, h, r }] (výška a poloměr koruny v m).
const CHM = 2;
export function treesOf(pts, ground, [e0, n0, e1, n1]) {
  const nx = Math.ceil((e1 - e0) / CHM), ny = Math.ceil((n1 - n0) / CHM);
  const raw = new Float32Array(nx * ny);
  for (let i = 0; i < pts.count; i++) {
    const x = pts.e[i], y = pts.n[i];
    if (x < e0 || x >= e1 || y < n0 || y >= n1) continue;
    const h = pts.z[i] - ground(x, y);
    if (!(h > 2 && h < 45)) continue;
    const c = Math.floor((y - n0) / CHM) * nx + Math.floor((x - e0) / CHM);
    if (h > raw[c]) raw[c] = h;
  }
  // body jsou na tvar koruny moc řídké, šíře se proto odhadne z výšky (r ≈ 0,3 h)
  const out = [];
  for (let j = 4; j < ny - 4; j++) {
    for (let i = 4; i < nx - 4; i++) {
      const c = j * nx + i, h = raw[c];
      if (h < 4) continue;
      const r = Math.max(1.5, Math.min(6, 0.3 * h));
      const R = Math.max(1, Math.min(4, Math.round(r / CHM)));
      let top = true;
      for (let dj = -R; dj <= R && top; dj++) {
        for (let di = -R; di <= R; di++) {
          if (!di && !dj || di * di + dj * dj > R * R) continue;
          const o = raw[c + dj * nx + di];
          if (o > h || (o === h && dj * nx + di < 0)) { top = false; break; }
        }
      }
      if (top) out.push({ e: e0 + (i + 0.5) * CHM, n: n0 + (j + 0.5) * CHM, h, r });
    }
  }
  return out;
}

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];

function edgeDist(x, y, r) {
  let m = Infinity;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2));
    m = Math.min(m, Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t));
  }
  return m;
}

// ring: půdorys v S-JTSK, ground(e, n): výška terénu z DMR. Vrací { wall, roof, flat, points } nebo null.
export function roofOf(pts, ring, ground) {
  const es = ring.map((p) => p[0]), ns = ring.map((p) => p[1]);
  const e0 = Math.min(...es), e1 = Math.max(...es), n0 = Math.min(...ns), n1 = Math.max(...ns);
  const rel = [], edge = [];
  for (let gx = Math.floor(e0 / CELL); gx <= Math.floor(e1 / CELL); gx++) {
    for (let gy = Math.floor(n0 / CELL); gy <= Math.floor(n1 / CELL); gy++) {
      for (const i of pts.grid.get(`${gx},${gy}`) ?? []) {
        const x = pts.e[i], y = pts.n[i];
        if (x < e0 || x > e1 || y < n0 || y > n1 || !pointInRing(x, y, ring)) continue;
        const h = pts.z[i] - ground(x, y);
        if (!(h > 1.5 && h < 80)) continue;
        rel.push(h);
        if (edgeDist(x, y, ring) < 1.8) edge.push(h);
      }
    }
  }
  if (rel.length < 5) return null;
  const shape = roofShape(ring, pts, rel.length >= 15 ? ground : null, e0, e1, n0, n1);
  rel.sort((a, b) => a - b);
  edge.sort((a, b) => a - b);
  const low = quantile(rel, 0.1), mid = quantile(rel, 0.5), top = quantile(rel, 0.95);
  // plochá střecha: většina bodů v jedné výšce, strojovny výtahů a atiky hrají jen horní pětinu
  if (quantile(rel, 0.8) - low < 1.2) return { wall: mid, roof: 0, flat: true, shape: 'flat', points: rel.length };
  // okap: okrajové body (u sedlové střechy převažují podélné strany), jinak spodní decil
  const eave = edge.length >= 3 ? quantile(edge, 0.35) : low;
  return { wall: eave, roof: Math.max(0.8, top - eave), flat: false, shape, points: rel.length };
}

// Tvar šikmé střechy: který model výšky nejlíp vysvětlí body (korelace).
// gable = hřeben podél delší strany, cross = hřeben napříč (štít do delší strany), hip = valbová.
function roofShape(ring, pts, ground, e0, e1, n0, n1) {
  if (!ground) return 'gable';
  const f = minRectFrame(ring);
  const vx = -f.uz, vy = f.ux;
  const ac = (f.a0 + f.a1) / 2, bc = (f.b0 + f.b1) / 2, hl = (f.a1 - f.a0) / 2, hw = Math.max(0.5, (f.b1 - f.b0) / 2);
  const models = {
    gable: (a, b) => Math.max(0, 1 - Math.abs(b - bc) / hw),
    cross: (a, b) => Math.max(0, 1 - Math.abs(a - ac) / hl),
    hip: (a, b) => Math.max(0, Math.min(1 - Math.abs(b - bc) / hw, (hl - Math.abs(a - ac)) / hw)),
  };
  const sums = Object.fromEntries(Object.keys(models).map((k) => [k, { m: 0, mm: 0, mh: 0 }]));
  let n = 0, sh = 0, shh = 0;
  for (let gx = Math.floor(e0 / CELL); gx <= Math.floor(e1 / CELL); gx++) {
    for (let gy = Math.floor(n0 / CELL); gy <= Math.floor(n1 / CELL); gy++) {
      for (const i of pts.grid.get(`${gx},${gy}`) ?? []) {
        const x = pts.e[i], y = pts.n[i];
        if (x < e0 || x > e1 || y < n0 || y > n1 || !pointInRing(x, y, ring)) continue;
        const h = pts.z[i] - ground(x, y);
        if (!(h > 1.5 && h < 80)) continue;
        const a = x * f.ux + y * f.uz, b = x * vx + y * vy;
        n++; sh += h; shh += h * h;
        for (const [k, fn] of Object.entries(models)) {
          const m = fn(a, b), s = sums[k];
          s.m += m; s.mm += m * m; s.mh += m * h;
        }
      }
    }
  }
  const r2 = (s) => {
    const cov = s.mh - (s.m * sh) / n, vm = s.mm - (s.m * s.m) / n, vh = shh - (sh * sh) / n;
    return vm > 1e-6 && vh > 1e-6 && cov > 0 ? (cov * cov) / (vm * vh) : 0;
  };
  const score = Object.fromEntries(Object.entries(sums).map(([k, s]) => [k, r2(s)]));
  // sedlová podél delší strany je výchozí, jiný tvar musí body vysvětlit znatelně líp
  let best = 'gable';
  for (const k of ['cross', 'hip']) if (score[k] > score[best] + 0.08) best = k;
  return best;
}
