// Akustika města: jak sevřená je trať domy po obou stranách. Počítá se jednou při stavbě trati
// z obrysů budov (town.js) do polí po STEP metrech trati; za jízdy se jen čte (audio.js).
import { clamp } from './rng.js';

const STEP = 2; // m trati mezi vzorky
const REACH = 40; // m od osy: dál už dům znatelný odraz nedělá
const CELL = 16; // m, mřížka hran stěn
const RAYS = [-0.45, 0, 0.45]; // paprsky na každou stranu (rad od kolmice), mezery mezi domy se tak průměrují
const SMOOTH = 3; // vzorků na každou stranu klouzavého průměru

// hrany stěn budov a dominant do mřížky
function wallIndex(town, terrain) {
  const ax = [], az = [], bx = [], bz = [], h = [];
  const add = (ring, height) => {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      ax.push(p[0]); az.push(p[1]); bx.push(q[0]); bz.push(q[1]); h.push(Math.max(2, height || 8));
    }
  };
  // domy, které ustoupily tribuně, ve hře nestojí (stejně jako v town.js)
  for (const b of town.buildings) if (!b.ring.some((p) => terrain.keepOut?.(p[0], p[1]))) add(b.ring, b.wall);
  for (const l of town.landmarks) add(l.ring, l.height ?? (l.levels ? l.levels * 3.2 : 8));
  const grid = new Map();
  for (let e = 0; e < ax.length; e++) {
    const gx0 = Math.floor(Math.min(ax[e], bx[e]) / CELL), gx1 = Math.floor(Math.max(ax[e], bx[e]) / CELL);
    const gz0 = Math.floor(Math.min(az[e], bz[e]) / CELL), gz1 = Math.floor(Math.max(az[e], bz[e]) / CELL);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const key = gx * 65536 + gz;
        let list = grid.get(key);
        if (!list) grid.set(key, (list = []));
        list.push(e);
      }
    }
  }
  const F = (a) => Float32Array.from(a);
  return { ax: F(ax), az: F(az), bx: F(bx), bz: F(bz), h: F(h), grid };
}

function smooth(a) {
  const n = a.length, out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let o = -SMOOTH; o <= SMOOTH; o++) sum += a[(i + o + n) % n];
    out[i] = sum / (2 * SMOOTH + 1);
  }
  return out;
}

// Profil ulic: left/right = jak blízko a vysoko stojí domy po stranách (0–1), dl/dr = zpoždění
// odrazu od nich (s), wet = míra dozvuku (sevřená ulice z obou stran nejvíc).
export function streetProfile(town, track, terrain) {
  const W = wallIndex(town, terrain);
  const n = Math.max(1, Math.round(track.L / STEP));
  const step = track.L / n;
  const side = [new Float32Array(n), new Float32Array(n)];
  const dist = [new Float32Array(n), new Float32Array(n)];
  const seen = new Int32Array(W.h.length).fill(-1);
  const P = {};
  const R = RAYS.length * 2;
  const best = new Float32Array(R), bestH = new Float32Array(R);
  const dx = new Float32Array(R), dz = new Float32Array(R);
  const cosA = RAYS.map(Math.cos), sinA = RAYS.map(Math.sin);
  const { ax, az, bx, bz, h, grid } = W;
  const reach2 = REACH * REACH;
  for (let i = 0; i < n; i++) {
    track.sampleAt(i * step, 0, P);
    const cx = P.cx, cz = P.cz, rx = P.rx, rz = P.rz, fx = rz, fz = -rx;
    const hw = track.hwAt(P.i);
    for (let s = 0; s < 2; s++) {
      const sg = s ? 1 : -1;
      for (let k = 0; k < RAYS.length; k++) {
        const r = s * RAYS.length + k;
        dx[r] = sg * rx * cosA[k] + fx * sinA[k];
        dz[r] = sg * rz * cosA[k] + fz * sinA[k];
      }
    }
    best.fill(REACH);
    bestH.fill(0);
    // hrany ze čtverců mřížky v dosahu, každá jednou
    const gx0 = Math.floor((cx - REACH) / CELL), gx1 = Math.floor((cx + REACH) / CELL);
    const gz0 = Math.floor((cz - REACH) / CELL), gz1 = Math.floor((cz + REACH) / CELL);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const list = grid.get(gx * 65536 + gz);
        if (!list) continue;
        for (let j = 0; j < list.length; j++) {
          const e = list[j];
          if (seen[e] === i) continue;
          seen[e] = i;
          const ox = ax[e] - cx, oz = az[e] - cz;
          const ex = bx[e] - ax[e], ez = bz[e] - az[e];
          // nejbližší bod hrany dál než dosah: žádný paprsek ji netrefí
          const w = Math.min(1, Math.max(0, -(ox * ex + oz * ez) / (ex * ex + ez * ez || 1)));
          const qx = ox + ex * w, qz = oz + ez * w;
          if (qx * qx + qz * qz > reach2) continue;
          for (let r = 0; r < R; r++) {
            const den = dx[r] * ez - dz[r] * ex;
            if (den > -1e-9 && den < 1e-9) continue;
            const t = (ox * ez - oz * ex) / den; // vzdálenost po paprsku
            if (t <= 0 || t >= best[r]) continue;
            const u = (ox * dz[r] - oz * dx[r]) / den; // poloha na hraně
            if (u >= 0 && u <= 1) { best[r] = t; bestH[r] = h[e]; }
          }
        }
      }
    }
    for (let s = 0; s < 2; s++) {
      let sum = 0, near = 0, hits = 0;
      for (let k = 0; k < RAYS.length; k++) {
        const r = s * RAYS.length + k;
        if (bestH[r] <= 0) continue;
        const perp = best[r] * Math.cos(RAYS[k]);
        // stěna u chodníku odráží naplno, 25 m za krajem silnice už skoro vůbec; nízký dům méně
        sum += clamp(1 - (perp - hw - 2) / 23, 0, 1) * clamp(bestH[r] / 10, 0.3, 1);
        near += perp;
        hits++;
      }
      side[s][i] = sum / RAYS.length;
      dist[s][i] = hits ? near / hits : REACH;
    }
  }
  const left = smooth(side[0]), right = smooth(side[1]);
  const dl = smooth(dist[0]), dr = smooth(dist[1]);
  const wet = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // cesta k domu a zpět, rychlost zvuku 343 m/s
    dl[i] = (2 * dl[i]) / 343;
    dr[i] = (2 * dr[i]) / 343;
    wet[i] = clamp(Math.sqrt(left[i] * right[i]) * 0.75 + (left[i] + right[i]) * 0.125, 0, 1);
  }
  return {
    n, step, left, right, dl, dr, wet,
    // index vzorku pro metr trati s
    at(s) {
      const k = Math.floor(s / step) % n;
      return k < 0 ? k + n : k;
    },
  };
}

// Kola na kamenném obrubníku v centru (track.urbans). prev = stav z minula: hystereze 5 cm,
// ať auto jedoucí po hraně neklepe každý snímek.
export function onKerb(track, car, prev) {
  if (!track.urbans.length || car.cut) return false;
  const P = car.proj;
  if (!track.onUrban(P.s)) return false;
  const over = Math.abs(P.lat) + car.spec.halfWidth - track.hwAt(P.i);
  return over > (prev ? -0.05 : 0.05);
}
