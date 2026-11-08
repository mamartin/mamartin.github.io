// Drobné pomůcky generátoru scény: decimetry, hashe pro stálou náhodu, afinní převod.
import { douglasPeucker } from '../lib/roads.mjs';

// kulisy jsou v decimetrech jako celá čísla
export const dm = (v) => Math.round(v * 10);
export const flat = (r) => r.flatMap((p) => [dm(p[0]), dm(p[1])]);
export const lineOf = (pts, eps) => flat(douglasPeucker(pts, eps));
// dvojice v dm od indexu from zpět na body v metrech
export function ringOf(a, from = 0) {
  const r = [];
  for (let i = from; i + 1 < a.length; i += 2) r.push([a[i] / 10, a[i + 1] / 10]);
  return r;
}

// stálá náhoda podle id: stejný vstup dá vždy stejné rozhodnutí
export const hash01 = (a, b) => (Math.imul(a ^ Math.imul(b, 0x9e3779b1), 0x85ebca6b) >>> 0) / 4294967296;
export const pick = (list, id) => list[(Math.imul(id, 2654435761) >>> 16) % list.length];

// uzavřená plocha v OSM: relace, nebo cesta, která končí v prvním uzlu
export const closed = (e) => e.type === 'relation' || (e.nodes && e.nodes[0] === e.nodes[e.nodes.length - 1]);

// afinní převod nejmenšími čtverci (body src -> dst), pro přenesení bodu z S-JTSK do souřadnic hry
export function affineFrom(src, dst) {
  const n = src.length, cx = src.reduce((a, p) => a + p[0], 0) / n, cy = src.reduce((a, p) => a + p[1], 0) / n;
  const dx = dst.reduce((a, p) => a + p[0], 0) / n, dy = dst.reduce((a, p) => a + p[1], 0) / n;
  let sxx = 0, sxy = 0, syy = 0, ax = 0, bx = 0, ay = 0, by = 0;
  src.forEach((p, i) => {
    const u = p[0] - cx, v = p[1] - cy, X = dst[i][0] - dx, Y = dst[i][1] - dy;
    sxx += u * u; sxy += u * v; syy += v * v; ax += u * X; bx += v * X; ay += u * Y; by += v * Y;
  });
  const det = sxx * syy - sxy * sxy;
  const m = [(ax * syy - bx * sxy) / det, (bx * sxx - ax * sxy) / det, (ay * syy - by * sxy) / det, (by * sxx - ay * sxy) / det];
  return (e, nn) => [dx + m[0] * (e - cx) + m[1] * (nn - cy), dy + m[2] * (e - cx) + m[3] * (nn - cy)];
}

// nejbližší bod na lomených čarách (body ve hře): { d, f (pata kolmice), dx, dz (směr úseku), side }
export function nearestOnLines(lines, p) {
  let best = null;
  for (const g of lines) {
    for (let k = 0; k + 1 < g.length; k++) {
      const a = g[k], b = g[k + 1];
      const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
      const s = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
      const f = [a[0] + dx * s, a[1] + dz * s], d = Math.hypot(p[0] - f[0], p[1] - f[1]);
      if (!best || d < best.d) best = { d, f, dx, dz, side: dx * (p[1] - a[1]) - dz * (p[0] - a[0]) };
    }
  }
  return best;
}
