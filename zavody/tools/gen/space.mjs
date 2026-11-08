// Dotazy na prostor kolem trati: převod do souřadnic hry, vzdálenost od osy, rozsah scény,
// centrum města a odsunutí obrysů (fasády, břehy, dominanty) za výběh.
import { subdivideRing, pointInRing, joinOuter } from '../lib/poly.mjs';
import { RUNOFF, MARGIN, FACADE_GAP } from './inputs.mjs';

const CELL = 24;

export function addSpace(g) {
  const { proj, cl, clWidth, city } = g;
  const toGame = (lat, lon) => {
    const [x, y] = proj.forward(lat, lon);
    return [x, -y];
  };
  const hash = new Map();
  for (let k = 0; k < cl.N; k++) {
    const key = `${Math.floor(cl.px[k] / CELL)},${Math.floor(cl.pz[k] / CELL)}`;
    if (!hash.has(key)) hash.set(key, []);
    hash.get(key).push(k);
  }
  // nejbližší vzorek osy v okolí, null když je trať dál než pár buněk
  function nearAxis(x, z) {
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
    let best = -1, bd = Infinity;
    for (let j = cj - 2; j <= cj + 2; j++) {
      for (let i = ci - 2; i <= ci + 2; i++) {
        for (const k of hash.get(`${i},${j}`) ?? []) {
          const d = (cl.px[k] - x) ** 2 + (cl.pz[k] - z) ** 2;
          if (d < bd) { bd = d; best = k; }
        }
      }
    }
    return best < 0 ? null : { k: best, d: Math.sqrt(bd) };
  }
  // hrubá vzdálenost od osy i daleko od trati
  function axisDist(x, z) {
    let m = Infinity;
    for (let k = 0; k < cl.N; k += 8) m = Math.min(m, (cl.px[k] - x) ** 2 + (cl.pz[k] - z) ** 2);
    return Math.sqrt(m);
  }
  const clearance = (k) => clWidth[k] / 2 + RUNOFF + FACADE_GAP;
  // boční poloha bodu vůči vzorku osy k (kladná vpravo)
  const latOf = (x, z, k) => (x - cl.px[k]) * cl.rx[k] + (z - cl.pz[k]) * cl.rz[k];

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let k = 0; k < cl.N; k++) {
    minX = Math.min(minX, cl.px[k]); maxX = Math.max(maxX, cl.px[k]);
    minZ = Math.min(minZ, cl.pz[k]); maxZ = Math.max(maxZ, cl.pz[k]);
  }
  const extent = { minX, maxX, minZ, maxZ };
  const bounds = { minX: minX - MARGIN, maxX: maxX + MARGIN, minZ: minZ - MARGIN, maxZ: maxZ + MARGIN };

  // Vzdálená místa (city.far): stavby a stromy kolem nich jsou ve scéně i za dosahem kulis
  // a výšková mřížka je pokryje i s okolím, aby byly vidět v dálce (Svatá Hora v Příbrami).
  const FAR = (city.far ?? []).map((f) => ({ ...f, xz: toGame(...f.at) }));
  for (const f of FAR) {
    const m = f.r + 250;
    bounds.minX = Math.min(bounds.minX, f.xz[0] - m); bounds.maxX = Math.max(bounds.maxX, f.xz[0] + m);
    bounds.minZ = Math.min(bounds.minZ, f.xz[1] - m); bounds.maxZ = Math.max(bounds.maxZ, f.xz[1] + m);
  }
  const inFar = (x, z) => FAR.some((f) => Math.hypot(x - f.xz[0], z - f.xz[1]) < f.r);
  const inBounds = (p) => p[0] > bounds.minX && p[0] < bounds.maxX && p[1] > bounds.minZ && p[1] < bounds.maxZ;

  const centreLine = city.centre?.map(([la, lo]) => toGame(la, lo));
  // poloha vůči ose centra (náměstí): t od začátku (0) na konec (1), d kolmo; bez centra nekonečno
  function alongCentre(x, z) {
    if (!centreLine) return { t: 0, d: Infinity };
    const [a, b] = centreLine;
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
    return { t, d: Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) };
  }

  // obrysy plochy z OSM v souřadnicích hry (relace: vnější obrysy)
  const ringsOf = (e) => (e.type === 'relation'
    ? joinOuter(e.members ?? []).map((r) => r.map(([la, lo]) => toGame(la, lo)))
    : e.geometry ? [e.geometry.map((p) => toGame(p.lat, p.lon))] : []);

  Object.assign(g, {
    toGame, nearAxis, axisDist, clearance, latOf, extent, bounds, FAR, inFar, inBounds, alongCentre, ringsOf,
    near: (p) => axisDist(p[0], p[1]) < g.REACH,
    minAxisDist: (r) => r.reduce((m, p) => Math.min(m, axisDist(p[0], p[1])), Infinity),
  });
}

// Domy, které zasahují do silnice a výběhu, přijdou o přední část: fasáda ustoupí za výběh.
// Řadová zástavba tak drží u sebe, posun celého domu by ji rozházel do sousedů.
export function clearRoad(g, ring) {
  const { cl, nearAxis, clearance, latOf } = g;
  const r = subdivideRing(ring, 4);
  let moved = 0, side = 0, conflict = false;
  const out = r.map((p) => {
    const n = nearAxis(p[0], p[1]);
    if (!n) return p;
    const k = n.k;
    const need = clearance(k);
    if (n.d >= need) return p;
    const s = Math.sign(latOf(p[0], p[1], k)) || 1;
    if (side && s !== side) conflict = true;
    side = s;
    moved = Math.max(moved, need - n.d);
    return [cl.px[k] + cl.rx[k] * s * need, cl.pz[k] + cl.rz[k] * s * need];
  });
  return { ring: out, moved, conflict };
}

// Dominanta se bude modelovat ručně, proto se neořezává: odsune se celá, o nejmenší posun,
// po kterém je mimo výběh ze všech stran (v zatáčce by ji postupné odsouvání přehazovalo mezi úseky).
export function shiftClear(g, ring) {
  const { nearAxis, clearance } = g;
  const pts = subdivideRing(ring, 2);
  const clear = (dx, dz) => pts.every((p) => {
    const n = nearAxis(p[0] + dx, p[1] + dz);
    return !n || n.d >= clearance(n.k) - 0.05;
  });
  if (clear(0, 0)) return { ring, moved: 0 };
  for (let d = 0.25; d <= 30; d += 0.25) {
    for (let a = 0; a < 48; a++) {
      const dx = Math.cos((a * Math.PI) / 24) * d, dz = Math.sin((a * Math.PI) / 24) * d;
      if (clear(dx, dz)) return { ring: ring.map((p) => [p[0] + dx, p[1] + dz]), moved: d };
    }
  }
  return shiftAway(g, ring);
}

function shiftAway(g, ring) {
  const { cl, nearAxis, clearance, latOf } = g;
  let r = ring, sx = 0, sz = 0;
  for (let iter = 0; iter < 12; iter++) {
    let worst = 0, dx = 0, dz = 0;
    for (const p of subdivideRing(r, 2)) {
      const n = nearAxis(p[0], p[1]);
      if (!n) continue;
      const k = n.k, need = clearance(k) - n.d;
      if (need <= worst) continue;
      const s = Math.sign(latOf(p[0], p[1], k)) || 1;
      worst = need;
      dx = cl.rx[k] * s * need;
      dz = cl.rz[k] * s * need;
    }
    if (worst < 0.05) break;
    r = r.map((p) => [p[0] + dx, p[1] + dz]);
    sx += dx;
    sz += dz;
  }
  return { ring: r, moved: Math.hypot(sx, sz) };
}

// půdorysy domů a dominant pro dotaz „stojí bod v domě?“ (parkování, výlohy, dvory)
export function addHouses(g) {
  const { buildings, landmarks } = g.out;
  const houseRings = [...buildings, ...landmarks.map((l) => [0, 0, 0, 0, 0, ...l.p])].map((b) => {
    const r = [];
    for (let i = 5; i + 1 < b.length; i += 2) r.push([b[i] / 10, b[i + 1] / 10]);
    const xs = r.map((p) => p[0]), zs = r.map((p) => p[1]);
    return { r, box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] };
  });
  g.houseAt = (x, z) => houseRings.findIndex((h) => x > h.box[0] && x < h.box[2] && z > h.box[1] && z < h.box[3] && pointInRing(x, z, h.r));
  g.inHouse = (x, z) => houseRings.some((h) => x > h.box[0] && x < h.box[2] && z > h.box[1] && z < h.box[3] && pointInRing(x, z, h.r));
}
