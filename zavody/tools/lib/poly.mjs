// Drobná geometrie pro převod dat z OSM.
import { douglasPeucker } from './roads.mjs';

export function signedArea(r) {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + 1) % r.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

// bez zopakovaného posledního bodu a bez bodů na stejném místě
export function cleanRing(r) {
  const out = [];
  for (const p of r) {
    const l = out[out.length - 1];
    if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 0.05) out.push(p);
  }
  while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 0.05) out.pop();
  return out;
}

export function simplifyRing(r, eps) {
  if (r.length < 5) return r;
  let far = 0, fd = 0;
  r.forEach((p, i) => {
    const d = Math.hypot(p[0] - r[0][0], p[1] - r[0][1]);
    if (d > fd) { fd = d; far = i; }
  });
  return [
    ...douglasPeucker(r.slice(0, far + 1), eps).slice(0, -1),
    ...douglasPeucker([...r.slice(far), r[0]], eps).slice(0, -1),
  ];
}

export function subdivideRing(r, maxLen) {
  const out = [];
  r.forEach((p, i) => {
    const q = r[(i + 1) % r.length];
    const n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / maxLen);
    for (let k = 0; k < n; k++) out.push([p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n]);
  });
  return out;
}

// nejmenší obepsaný obdélník podle směrů hran: [kratší strana, delší strana]
export function minRect(r) {
  let best = null, bestA = Infinity;
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
    const area = (a1 - a0) * (b1 - b0);
    if (area < bestA) { bestA = area; best = [Math.min(a1 - a0, b1 - b0), Math.max(a1 - a0, b1 - b0)]; }
  }
  return best ?? [1, 1];
}

// Sutherland-Hodgman na obdélník
export function clipRing(r, b) {
  const planes = [
    [(p) => p[0] >= b.minX, (p, q) => (b.minX - p[0]) / (q[0] - p[0])],
    [(p) => p[0] <= b.maxX, (p, q) => (b.maxX - p[0]) / (q[0] - p[0])],
    [(p) => p[1] >= b.minZ, (p, q) => (b.minZ - p[1]) / (q[1] - p[1])],
    [(p) => p[1] <= b.maxZ, (p, q) => (b.maxZ - p[1]) / (q[1] - p[1])],
  ];
  let out = r;
  for (const [inside, cut] of planes) {
    const src = out;
    out = [];
    src.forEach((p, i) => {
      const q = src[(i + 1) % src.length];
      const a = inside(p), c = inside(q);
      if (a) out.push(p);
      if (a !== c) {
        const t = cut(p, q);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    });
    if (!out.length) return [];
  }
  return out;
}

// vnější cesty multipolygonu pospojuje do uzavřených prstenců
export function joinOuter(members) {
  const open = members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => m.geometry.map((p) => [p.lat, p.lon]));
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  const rings = [];
  while (open.length) {
    let cur = open.shift();
    for (let joined = true; joined && !same(cur[0], cur[cur.length - 1]);) {
      joined = false;
      for (let i = 0; i < open.length; i++) {
        const w = open[i];
        const end = cur[cur.length - 1];
        if (same(w[0], end)) cur = cur.concat(w.slice(1));
        else if (same(w[w.length - 1], end)) cur = cur.concat(w.slice(0, -1).reverse());
        else continue;
        open.splice(i, 1);
        joined = true;
        break;
      }
    }
    rings.push(cur);
  }
  return rings;
}

export function pointInRing(x, z, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
