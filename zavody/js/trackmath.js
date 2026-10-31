// Čistá matematika středové čáry trati – bez závislosti na three.js,
// aby šla ověřovat i v Node.
//
// Konvence: svět je Y-up, trať leží v rovině XZ.
// Směr jízdy (heading) psi: dopředu = (sin psi, cos psi), vpravo = (-cos psi, sin psi).
// Zakřivení kappa = d(psi)/ds, kladné = levotočivá zatáčka.
// Boční offset "lat" je kladný vpravo.

import { clamp, angleDiff, RNG } from './rng.js';

// def.points: [[x, z, výška, poloměr zaoblení], ...]
// Rohy polygonu se zaoblí kruhovými oblouky, pak se celá čára převzorkuje a vyhladí.
export function buildCenterline(def, step = 2) {
  const P = def.points.map((p) => ({ x: p[0], z: p[1], h: p[2] || 0, r: p[3] || 0 }));
  const n = P.length;
  const segDir = [];
  const segLen = [];
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n];
    const dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz);
    segDir.push({ x: dx / l, z: dz / l });
    segLen.push(l);
  }

  const corners = [];
  for (let i = 0; i < n; i++) {
    const d1 = segDir[(i - 1 + n) % n], d2 = segDir[i];
    const cross = d1.x * d2.z - d1.z * d2.x;
    const theta = Math.acos(clamp(d1.x * d2.x + d1.z * d2.z, -1, 1));
    corners.push({ theta, cross, t: P[i].r * Math.tan(theta / 2), r: P[i].r });
  }
  // Oblouky musí vejít na sousední úsečky.
  for (let iter = 0; iter < 6; iter++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const need = corners[i].t + corners[j].t;
      const avail = segLen[i] * 0.98;
      if (need > avail) {
        const f = avail / need;
        corners[i].t *= f;
        corners[j].t *= f;
      }
    }
  }
  for (const c of corners) c.rEff = c.theta > 1e-4 ? c.t / Math.tan(c.theta / 2) : Infinity;

  // Hustá polyline (krok ~0.5 m) + délka ke středu každého rohu kvůli výškám.
  const dense = [];
  const cornerS = [];
  let acc = 0;
  const push = (x, z) => {
    if (dense.length) {
      const last = dense[dense.length - 1];
      acc += Math.hypot(x - last[0], z - last[1]);
    }
    dense.push([x, z]);
  };
  for (let i = 0; i < n; i++) {
    const c = corners[i], p = P[i];
    const d1 = segDir[(i - 1 + n) % n], d2 = segDir[i];
    const sx = p.x - d1.x * c.t, sz = p.z - d1.z * c.t;
    if (c.theta > 1e-3 && c.t > 1e-3) {
      const r = c.rEff;
      const nx = c.cross > 0 ? -d1.z : d1.z;
      const nz = c.cross > 0 ? d1.x : -d1.x;
      const cx = sx + nx * r, cz = sz + nz * r;
      const a0 = Math.atan2(sz - cz, sx - cx);
      const sweep = c.theta * Math.sign(c.cross);
      const steps = Math.max(2, Math.ceil((r * c.theta) / 0.5));
      const startAcc = acc;
      for (let k = 0; k <= steps; k++) {
        const a = a0 + (sweep * k) / steps;
        push(cx + Math.cos(a) * r, cz + Math.sin(a) * r);
      }
      cornerS.push((startAcc + acc) / 2);
    } else {
      push(sx, sz);
      cornerS.push(acc);
    }
    const ex = p.x + d2.x * c.t, ez = p.z + d2.z * c.t;
    const q = P[(i + 1) % n];
    const cn = corners[(i + 1) % n];
    const nx2 = q.x - d2.x * cn.t, nz2 = q.z - d2.z * cn.t;
    const len = Math.hypot(nx2 - ex, nz2 - ez);
    const steps = Math.ceil(len / 0.5);
    for (let k = 1; k < steps; k++) push(ex + ((nx2 - ex) * k) / steps, ez + ((nz2 - ez) * k) / steps);
  }
  // Uzavření smyčky.
  const first = dense[0], last = dense[dense.length - 1];
  const totalDense = acc + Math.hypot(first[0] - last[0], first[1] - last[1]);

  // Rovnoměrné převzorkování.
  const N = Math.round(totalDense / step);
  const denseS = new Float64Array(dense.length + 1);
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1], b = dense[i % dense.length];
    denseS[i] = denseS[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  let px = new Float64Array(N), pz = new Float64Array(N);
  let j = 0;
  for (let k = 0; k < N; k++) {
    const target = (k / N) * totalDense;
    while (j < dense.length - 1 && denseS[j + 1] < target) j++;
    const a = dense[j], b = dense[(j + 1) % dense.length];
    const segL = denseS[j + 1] - denseS[j] || 1;
    const u = (target - denseS[j]) / segL;
    px[k] = a[0] + (b[0] - a[0]) * u;
    pz[k] = a[1] + (b[1] - a[1]) * u;
  }

  // Vyhlazení (plynulý přechod rovinka -> oblouk).
  const smoothPasses = def.smooth ?? 3;
  for (let pass = 0; pass < smoothPasses; pass++) {
    const nx = new Float64Array(N), nz = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      let sx = 0, sz = 0;
      for (let o = -3; o <= 3; o++) {
        const idx = (k + o + N) % N;
        sx += px[idx];
        sz += pz[idx];
      }
      nx[k] = sx / 7;
      nz[k] = sz / 7;
    }
    px = nx;
    pz = nz;
  }

  // Délky oblouku po vyhlazení.
  const s = new Float64Array(N + 1);
  for (let k = 1; k <= N; k++) {
    s[k] = s[k - 1] + Math.hypot(px[k % N] - px[k - 1], pz[k % N] - pz[k - 1]);
  }
  const L = s[N];
  const scale = L / totalDense;

  // Výšky: Hermiteova interpolace přes rohy (Catmull-Rom tečny).
  const vs = cornerS.map((v) => v * scale);
  const vh = P.map((p) => p.h);
  const slope = [];
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n, b = (i + 1) % n;
    let ds = vs[b] - vs[a];
    if (ds <= 0) ds += L;
    slope.push((vh[b] - vh[a]) / ds);
  }
  const py = new Float64Array(N);
  let seg = n - 1;
  for (let k = 0; k < N; k++) {
    const sk = s[k];
    // najdi úsek rohů [seg, seg+1] obsahující sk (s ohledem na přetočení)
    let found = false;
    for (let t = 0; t < n && !found; t++) {
      const i = (seg + t) % n, i2 = (i + 1) % n;
      let a = vs[i], b = vs[i2];
      let x = sk;
      if (b <= a) {
        b += L;
        if (x < a) x += L;
      }
      if (x >= a && x <= b) {
        const h = b - a;
        const u = (x - a) / h;
        const u2 = u * u, u3 = u2 * u;
        py[k] =
          (2 * u3 - 3 * u2 + 1) * vh[i] +
          (u3 - 2 * u2 + u) * h * slope[i] +
          (-2 * u3 + 3 * u2) * vh[i2] +
          (u3 - u2) * h * slope[i2];
        seg = i;
        found = true;
      }
    }
    if (!found) py[k] = vh[0];
  }

  // Směr, zakřivení, náklon.
  const hd = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    const a = (k - 1 + N) % N, b = (k + 1) % N;
    hd[k] = Math.atan2(px[b] - px[a], pz[b] - pz[a]);
  }
  // délka centrální diference kolem vzorku k (s přetočením přes start)
  const span = (k) => (k === 0 ? s[1] + (L - s[N - 1]) : s[k + 1] - s[k - 1]);
  const kappa = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    const a = (k - 1 + N) % N, b = (k + 1) % N;
    kappa[k] = angleDiff(hd[a], hd[b]) / span(k);
  }
  const kappaS = smoothCircular(kappa, 12);
  const maxBank = def.maxBank ?? 0.07;
  const bankK = def.bankK ?? 2.2;
  const bank = new Float64Array(N);
  for (let k = 0; k < N; k++) bank[k] = clamp(kappaS[k] * bankK * 12, -maxBank, maxBank);
  const bankS = smoothCircular(bank, 8);

  const grade = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    const a = (k - 1 + N) % N, b = (k + 1) % N;
    grade[k] = (py[b] - py[a]) / span(k);
  }

  const out = {
    N,
    L,
    step: L / N,
    px: new Float32Array(px),
    py: new Float32Array(py),
    pz: new Float32Array(pz),
    s: new Float32Array(s.subarray(0, N)),
    hd: new Float32Array(hd),
    kappa: new Float32Array(kappa),
    kappaS: new Float32Array(kappaS),
    bank: new Float32Array(bankS),
    grade: new Float32Array(grade),
    rx: new Float32Array(N),
    rz: new Float32Array(N),
    corners,
  };
  for (let k = 0; k < N; k++) {
    out.rx[k] = -Math.cos(hd[k]);
    out.rz[k] = Math.sin(hd[k]);
  }
  return out;
}

export function smoothCircular(arr, radius) {
  const N = arr.length;
  const out = new Float64Array(N);
  const w = radius * 2 + 1;
  let sum = 0;
  for (let o = -radius; o <= radius; o++) sum += arr[(o + N) % N];
  for (let k = 0; k < N; k++) {
    out[k] = sum / w;
    sum += arr[(k + radius + 1) % N] - arr[(k - radius + N) % N];
  }
  return out;
}

// Kontrola geometrie: minimální poloměr, sklon, a zda se úseky trati nepřekrývají.
export function validateCenterline(cl, hw, runoff) {
  let maxK = 0, maxGrade = 0;
  for (let k = 0; k < cl.N; k++) {
    maxK = Math.max(maxK, Math.abs(cl.kappa[k]));
    maxGrade = Math.max(maxGrade, Math.abs(cl.grade[k]));
  }
  const edge = hw + runoff;
  const minSep = edge * 2 + 6;
  const skip = Math.ceil((edge * 5 + 40) / cl.step);
  let worst = Infinity, worstPair = null;
  const stride = 2;
  for (let i = 0; i < cl.N; i += stride) {
    for (let j = i + skip; j < cl.N; j += stride) {
      if (cl.N - j + i < skip) continue;
      const d = Math.hypot(cl.px[i] - cl.px[j], cl.pz[i] - cl.pz[j]);
      if (d < worst) {
        worst = d;
        worstPair = [i, j];
      }
    }
  }
  const minRadius = 1 / maxK;
  return {
    length: cl.L,
    minRadius,
    maxGrade,
    minSeparation: worst,
    worstPair,
    ok: minRadius > edge + 2 && worst > minSep && maxGrade < 0.16,
  };
}

// Náhodná trať: body kolem kružnice s náhodným poloměrem (hvězdicový tvar se nikdy nekříží).
export function randomTrackDef(seed) {
  const rng = new RNG(seed);
  const count = rng.int(8, 12);
  const R = rng.range(230, 320);
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng.range(-0.18, 0.18);
    const r = R * rng.range(0.55, 1.15);
    pts.push([Math.cos(a) * r, Math.sin(a) * r, 0, rng.range(28, 85)]);
  }
  // výšky: hladké vlnění
  const phase = rng.range(0, Math.PI * 2);
  const amp = rng.range(3, 9);
  for (let i = 0; i < count; i++) {
    pts[i][2] = Math.sin((i / count) * Math.PI * 2 + phase) * amp + amp;
  }
  // start na nejdelší úsečce
  let best = 0, bestLen = 0;
  for (let i = 0; i < count; i++) {
    const a = pts[i], b = pts[(i + 1) % count];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l > bestLen) {
      bestLen = l;
      best = i;
    }
  }
  const a = pts[best], b = pts[(best + 1) % count];
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, 0];
  const ordered = [mid];
  for (let i = 1; i <= count; i++) ordered.push(pts[(best + i) % count]);
  // náhodně otoč směr jízdy
  if (rng.chance(0.5)) {
    const rest = ordered.slice(1).reverse();
    ordered.length = 1;
    ordered.push(...rest);
  }
  return ordered;
}

// Zkratka: úzká vlastní cesta mezi dvěma místy trati, zadaná body ve světě (první a poslední leží
// u trati). Pro fyziku je to kus trati: project() vrací stejná pole jako
// Track.project, s se mapuje na vynechaný úsek. V místech, kde se cesta odpojuje a připojuje, je ve
// svodidle mezera (gapIn, gapOut, měřeno od s0), jinde cestu lemují vlastní valy.
export class Cut {
  constructor(track, spec) {
    const L = track.L;
    const via = spec.via;
    const a = track.project(via[0][0], via[0][1], -1, {});
    const b = track.project(via[via.length - 1][0], via[via.length - 1][1], -1, {});
    this.track = track;
    this.spec = spec;
    this.hw = spec.width / 2;
    this.s0 = a.s;
    this.span = (b.s - a.s + L) % L;
    this.side = Math.sign((via[1][0] - a.cx) * a.rx + (via[1][1] - a.cz) * a.rz) || 1;
    const lat = this.side * (track.edge - 2.5);
    const at = (s) => track.sampleAt(s, lat, {});
    const A = at(a.s), B = at(b.s);
    const ctrl = [at(a.s - 30), A, ...via.slice(1, -1).map(([x, z]) => ({ x, z })), B, at(b.s + 30)];
    // Catmull-Rom přes řídicí body, pak převzorkovat po 2 m
    const dense = [];
    for (let i = 1; i < ctrl.length - 2; i++) {
      const [p0, p1, p2, p3] = [ctrl[i - 1], ctrl[i], ctrl[i + 1], ctrl[i + 2]];
      for (let t = 0; t < 1; t += 0.02) {
        const f = (q) => 0.5 * (2 * p1[q] + (p2[q] - p0[q]) * t + (2 * p0[q] - 5 * p1[q] + 4 * p2[q] - p3[q]) * t * t + (3 * p1[q] - p0[q] - 3 * p2[q] + p3[q]) * t * t * t);
        dense.push({ x: f('x'), z: f('z') });
      }
    }
    dense.push({ x: B.x, z: B.z });
    const pts = [dense[0]];
    let run = 0;
    for (let i = 1; i < dense.length; i++) {
      run += Math.hypot(dense[i].x - dense[i - 1].x, dense[i].z - dense[i - 1].z);
      if (run >= 2) {
        pts.push(dense[i]);
        run = 0;
      }
    }
    pts.push(dense[dense.length - 1]);
    const n = (this.n = pts.length);
    this.px = Float32Array.from(pts, (p) => p.x);
    this.pz = Float32Array.from(pts, (p) => p.z);
    this.py = new Float32Array(n);
    this.hd = new Float32Array(n);
    this.d = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const u = k / (n - 1);
      this.py[k] = A.y + (B.y - A.y) * u * u * (3 - 2 * u);
      const q = Math.min(k, n - 2);
      this.hd[k] = Math.atan2(pts[q + 1].x - pts[q].x, pts[q + 1].z - pts[q].z);
      if (k) this.d[k] = this.d[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z);
    }
    this.len = this.d[n - 1];
    // kde už celá šířka cesty leží za svodidlem
    const clear = (k, hint) => {
      const p = track.project(this.px[k], this.pz[k], hint, {});
      return { p, ok: Math.abs(p.lat) - this.hw > track.edge + 0.6 };
    };
    let hint = a.i;
    let k0 = 0;
    for (; k0 < n; k0++) {
      const c = clear(k0, hint);
      hint = c.p.i;
      if (c.ok) {
        this.gapIn = (c.p.s - this.s0 + L) % L;
        break;
      }
    }
    hint = b.i;
    let k1 = n - 1;
    for (; k1 > k0; k1--) {
      const c = clear(k1, hint);
      hint = c.p.i;
      if (c.ok) {
        this.gapOut = (c.p.s - this.s0 + L) % L;
        break;
      }
    }
    this.k0 = k0;
    this.k1 = k1;
    this.rocks = (spec.rocks || []).map(([t, l, r]) => {
      const k = Math.round(t * (n - 1));
      return { x: this.px[k] - Math.cos(this.hd[k]) * l, z: this.pz[k] + Math.sin(this.hd[k]) * l, y: this.py[k], r };
    });
  }

  // je místo s, lat na hlavní trati v mezeře ve svodidle?
  inGap(s, side) {
    if (side !== this.side) return false;
    const rel = ((s - this.s0) % this.track.L + this.track.L) % this.track.L;
    return rel < this.gapIn || (rel >= this.gapOut && rel < this.span);
  }

  // nejbližší místo na cestě; hint v out.cutK (-1 = hledat všude)
  project(x, z, out) {
    const { n, px, pz } = this;
    const from = out.cutK >= 0 ? Math.max(0, out.cutK - 12) : 0;
    const to = out.cutK >= 0 ? Math.min(n - 1, out.cutK + 12) : n - 1;
    let k = from, best = Infinity;
    for (let q = from; q <= to; q++) {
      const dx = x - px[q], dz = z - pz[q];
      const d = dx * dx + dz * dz;
      if (d < best) {
        best = d;
        k = q;
      }
    }
    const a = Math.min(k, n - 2);
    const dx = px[a + 1] - px[a], dz = pz[a + 1] - pz[a];
    const raw = ((x - px[a]) * dx + (z - pz[a]) * dz) / (dx * dx + dz * dz || 1);
    const u = clamp(raw, 0, 1);
    const dist = this.d[a] + (this.d[a + 1] - this.d[a]) * u;
    out.cutK = k;
    out.cutEnd = raw > 1 && a === n - 2 ? 1 : raw < 0 && a === 0 ? -1 : 0;
    out.s = (this.s0 + (dist / this.len) * this.span) % this.track.L;
    out.i = this.track.indexAt(out.s);
    out.u = 0;
    out.cx = px[a] + dx * u;
    out.cz = pz[a] + dz * u;
    out.cy = this.py[a] + (this.py[a + 1] - this.py[a]) * u;
    out.hd = this.hd[a];
    out.rx = -Math.cos(out.hd);
    out.rz = Math.sin(out.hd);
    out.tanBank = 0;
    out.bank = 0;
    out.grade = (this.py[a + 1] - this.py[a]) / Math.max(0.1, this.d[a + 1] - this.d[a]);
    out.kappa = 0;
    out.lat = (x - out.cx) * out.rx + (z - out.cz) * out.rz;
    out.y = out.cy;
    return out;
  }
}
