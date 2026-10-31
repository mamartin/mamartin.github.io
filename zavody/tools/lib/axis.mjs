// Osa trati: z uzlů OSM po 2 m s výškou z DMR a převod na body trati s poloměry rohů.

import { douglasPeucker } from './roads.mjs';
import { buildCenterline } from '../../js/trackmath.js';

// R = poloměr vyhlazení výšek ve vzorcích po 2 m
export function sampleAxis(seq, dem, proj, { R = 20 } = {}) {
  const out = [];
  for (let i = 0; i < seq.length; i++) {
    const a = seq[i], b = seq[(i + 1) % seq.length];
    const n = Math.max(1, Math.round(Math.hypot(a.x - b.x, a.y - b.y) / 2));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      out.push({ x, y, seg: i, h: dem.height(...proj.inverse(x, y)) });
    }
  }
  const hs = out.map((_, i) => {
    let s = 0;
    for (let o = -R; o <= R; o++) s += out[(i + o + out.length) % out.length].h;
    return s / (2 * R + 1);
  });
  out.forEach((p, i) => { p.hs = hs[i]; });
  return out;
}

// smyčka začínající vzorkem nejblíž bodu (x, y)
export function rotateAxis(axis, x, y) {
  let best = 0, bd = Infinity;
  axis.forEach((p, i) => {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bd) { bd = d; best = i; }
  });
  return [...axis.slice(best), ...axis.slice(0, best)];
}

// oblouk smí uříznout roh ulice jen o maxDev metrů, jinak by trať zkracovala přes domy
function radiusFor(th, o) {
  if (th < 1e-3) return 0;
  return Math.max(o.minR, Math.min(140, o.maxDev / (1 / Math.cos(th / 2) - 1)));
}

function withRadii(pts, o) {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const l1 = Math.hypot(p[0] - a[0], p[1] - a[1]), l2 = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const c = ((p[0] - a[0]) * (b[0] - p[0]) + (p[1] - a[1]) * (b[1] - p[1])) / (l1 * l2);
    const r = i === 0 && o.startFlat ? 0 : radiusFor(Math.acos(Math.max(-1, Math.min(1, c))), o);
    // osa z je v herním světě obrácený sever, jinak by se město zrcadlilo
    return [+p[0].toFixed(1), +(-p[1]).toFixed(1), +p[2].toFixed(1), +r.toFixed(1)];
  });
}

function meet(a, b, c, d) {
  const dx1 = b[0] - a[0], dy1 = b[1] - a[1], dx2 = d[0] - c[0], dy2 = d[1] - c[1];
  const den = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(den) < 1e-6) return null;
  const t = ((c[0] - a[0]) * dy2 - (c[1] - a[1]) * dx2) / den;
  return [a[0] + dx1 * t, a[1] + dy1 * t];
}

// první bod smyčky se nikdy neslévá, je na něm start
const pairOf = (i, n, start) => {
  if (!start) return i;
  if (i === 0) return 1;
  if (i === n - 1) return n - 2;
  return i;
};

// Ostré místo: krátkou úsečku u něj nahradí jedním rohem na průsečíku sousedních úseček,
// tím se oblouk vejde a tvar křižovatky zůstane.
function fitCorners(start, o) {
  let pts = start;
  for (let iter = 0; iter < 80 && pts.length > 8; iter++) {
    const def = { width: o.width, runoff: o.runoff, smooth: o.smooth, points: withRadii(pts, o) };
    const cl = buildCenterline(def);
    let k = 0, m = 0;
    for (let i = 0; i < cl.N; i++) if (Math.abs(cl.kappa[i]) > m) { m = Math.abs(cl.kappa[i]); k = i; }
    if (1 / m >= o.targetR) break;
    const n = pts.length;
    let v = 0, vd = Infinity;
    pts.forEach((p, i) => {
      const d = Math.hypot(p[0] - cl.px[k], -p[1] - cl.pz[k]);
      if (d < vd) { vd = d; v = i; }
    });
    const lenTo = (i) => Math.hypot(pts[i][0] - pts[(i + 1) % n][0], pts[i][1] - pts[(i + 1) % n][1]);
    const i = pairOf(lenTo((v - 1 + n) % n) < lenTo(v) ? (v - 1 + n) % n : v, n, o.startFlat);
    const b = pts[i], c = pts[(i + 1) % n];
    const x = meet(pts[(i - 1 + n) % n], b, pts[(i + 2) % n], c);
    const mid = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2];
    const use = x && Math.hypot(x[0] - mid[0], x[1] - mid[1]) < 35 ? x : mid;
    pts = pts.slice();
    pts[i] = [use[0], use[1], (b[2] + c[2]) / 2];
    pts.splice((i + 1) % n, 1);
  }
  return pts;
}

// dlouhé úsečky dělí kvůli výškám: hra interpoluje výšku jen mezi body trati
function densify(points, axis, maxLen) {
  const out = [];
  const n = points.length;
  points.forEach((p, i) => {
    out.push(p);
    const q = points[(i + 1) % n];
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const parts = Math.floor(l / maxLen);
    for (let k = 1; k < parts; k++) {
      const x = p[0] + ((q[0] - p[0]) * k) / parts, z = p[1] + ((q[1] - p[1]) * k) / parts;
      let best = axis[0], bd = Infinity;
      for (const a of axis) {
        const d = (a.x - x) ** 2 + (a.y + z) ** 2;
        if (d < bd) { bd = d; best = a; }
      }
      out.push([+x.toFixed(1), +z.toFixed(1), +best.hs.toFixed(1), 0]);
    }
  });
  return out;
}

// axis musí začínat vzorkem, kde má být první bod trati
export function fitTrack(axis, opts) {
  const o = { smooth: 2, minR: 16, targetR: 14, maxDev: 4, startFlat: false, maxLen: 0, ...opts };
  const cl = axis.map((p) => [p.x, p.y, p.hs]);
  // Douglas-Peucker potřebuje otevřenou křivku: smyčku rozdělí v nejvzdálenějším bodu od začátku
  let far = 0, farD = 0;
  cl.forEach((p, i) => {
    const d = Math.hypot(p[0] - cl[0][0], p[1] - cl[0][1]);
    if (d > farD) { farD = d; far = i; }
  });
  const pts = [
    ...douglasPeucker(cl.slice(0, far + 1), 2.5).slice(0, -1),
    ...douglasPeucker([...cl.slice(far), cl[0]], 2.5).slice(0, -1),
  ];
  if (pts.some((p, i) => { const q = pts[(i + 1) % pts.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.5; })) {
    throw new Error('Trasa se vrací stejnou ulicí, uprav průjezdní body v loops.json.');
  }
  // krátké úsečky slije, jinak by se ostrý roh nedal zaoblit
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 4; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) >= 16) continue;
      if (o.startFlat && (i === 0 || i === pts.length - 1)) continue;
      pts[i] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      pts.splice((i + 1) % pts.length, 1);
      changed = true;
      break;
    }
  }
  const points = withRadii(fitCorners(pts, o), o);
  return o.maxLen ? densify(points, axis, o.maxLen) : points;
}

export function countCorners(cl) {
  let count = 0, tight = 0, run = 0, runMax = 0;
  const close = () => {
    if (Math.abs(run) > 0.45) {
      count++;
      if (runMax > 1 / 30) tight++;
    }
    run = 0;
    runMax = 0;
  };
  for (let k = 0; k < cl.N; k++) {
    const kap = cl.kappaS[k];
    if (Math.abs(kap) > 1 / 120) {
      if (run !== 0 && Math.sign(run) !== Math.sign(kap)) close();
      run += kap * cl.step;
      runMax = Math.max(runMax, Math.abs(kap));
    } else if (run !== 0) close();
  }
  return { count, tight };
}
