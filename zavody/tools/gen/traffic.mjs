// Doprava a ulice kolem trati: výlohy, přechody, zaparkovaná auta, dopravní značky a semafory,
// ostrůvky kruhových objezdů a autobusy na nádraží.
import { cleanRing, minRectFrame, pointInRing } from '../lib/poly.mjs';
import { edgeKey } from '../lib/roads.mjs';
import { dm, hash01, closed, nearestOnLines } from './util.mjs';
import { RUNOFF, STREET_W } from './inputs.mjs';

const CAR_W = 2.6, CAR_L = 5.2, CAR_GAP = 6.2, AISLE = 6, OCCUPIED = 0.65;
export const SIGN = { give_way: 0, stop: 1, maxspeed: 2, city_limit: 3, bus_stop: 4, traffic_signals: 5, speed_camera: 6 };
const BUS_L = 12, BUS_W = 2.55, BUS_STAND = 0.6;
// přechody s vodorovným značením
const MARKED = new Set(['zebra', 'uncontrolled', 'traffic_signals', 'marked']);
// podélné stání podle parking:left/right/both a parking:lane:*
const PARKED = new Set(['lane', 'street_side', 'on_kerb', 'half_on_kerb', 'shoulder', 'parallel']);

// výlohy: domy, ve kterých OSM eviduje obchod, restauraci, banku, lékárnu nebo poštu (index do buildings)
function shopsStep(g) {
  const { poiShops, toGame, houseAt } = g;
  const shops = [];
  for (const e of poiShops) {
    if (e.tags?.highway === 'crossing') continue;
    const ll = e.center ?? e;
    if (ll.lat === undefined) continue;
    const i = houseAt(...toGame(ll.lat, ll.lon));
    if (i >= 0 && i < g.out.buildings.length && !shops.includes(i)) shops.push(i);
  }
  g.out.shops = shops.sort((a, b) => a - b);
}

// přechody s vodorovným značením ležící na trati, jako body ve světě; aspoň 15 m od sebe a 30 m od startu
function crossingsStep(g) {
  const { poiShops, toGame, nearAxis, cl, at, def } = g;
  const crossings = [];
  for (const e of poiShops) {
    const t = e.tags;
    if (t?.highway !== 'crossing' || e.type !== 'node') continue;
    const marks = t['crossing:markings'];
    if (!(MARKED.has(t.crossing) || (marks && marks !== 'no'))) continue;
    if (t.crossing === 'unmarked') continue;
    const n = nearAxis(...toGame(e.lat, e.lon));
    if (!n || n.d > 4 || cl.s[n.k] < 30 || cl.s[n.k] > cl.L - 30) continue;
    if (crossings.some((c) => Math.abs(c.s - cl.s[n.k]) < 15)) continue;
    crossings.push({ s: cl.s[n.k], p: at(n.k) });
  }
  crossings.sort((a, b) => a.s - b.s);
  def.crossings = crossings.map((c) => c.p);
  g.crossingS = crossings.map((c) => c.s);
}

// Zaparkovaná auta na parkovištích: OSM nemá parking:lane, ale plochy parkovišť ano, často s orientation a capacity.
// Stání se rozvrhnou do řad podél delší strany, obsazené jsou zhruba dvě třetiny.
function parkingLotsStep(g) {
  const { extra, ringsOf, minAxisDist, nearAxis, clearance, inHouse, REACH } = g;
  const cars = g.out.cars;
  for (const e of extra) {
    const t = e.tags;
    if (t?.amenity !== 'parking' || !closed(e) || ['underground', 'multi-storey', 'rooftop'].includes(t.parking)) continue;
    for (const raw of ringsOf(e)) {
      const r = cleanRing(raw);
      if (r.length < 3 || minAxisDist(r) > REACH) continue;
      const f = minRectFrame(r);
      const depth = f.b1 - f.b0;
      const parallel = t.orientation === 'parallel' || (!t.orientation && depth < 4.5);
      // řady napříč plochou: podélná stání po 2,6 m, kolmá do dvojic zády k sobě s uličkou;
      // úzký pás u ulice (null) sleduje vlastní střed, obrysy v OSM bývají mělčí než auto a lomené
      const need = parallel ? CAR_W : CAR_L;
      const rows = [];
      if (depth < 2 * need) rows.push(null);
      else if (parallel) for (let b = f.b0 + CAR_W / 2; b <= f.b1 - CAR_W / 2 + 0.3; b += CAR_W) rows.push(b);
      else {
        for (let b = f.b0; b + CAR_L <= f.b1 + 0.3; b += 2 * CAR_L + AISLE) {
          rows.push(b + CAR_L / 2);
          if (b + 2 * CAR_L <= f.b1 + 0.3) rows.push(b + 1.5 * CAR_L);
        }
      }
      const pitch = parallel ? CAR_GAP : CAR_W;
      const slots = [];
      const toXZ = (a, b) => [f.ux * a - f.uz * b, f.uz * a + f.ux * b];
      for (const row of rows) {
        const n = Math.floor((f.a1 - f.a0) / pitch);
        const start = (f.a0 + f.a1) / 2 - ((n - 1) * pitch) / 2;
        for (let i = 0; i < n; i++) {
          const a = start + i * pitch;
          let b = row, hb = need / 2 - 0.3;
          if (row === null) {
            // nejdelší úsek napříč pásem, který leží v ploše
            let best = [0, 0];
            for (let s = f.b0, run = null; s <= f.b1 + 0.25; s += 0.25) {
              if (s <= f.b1 && pointInRing(...toXZ(a, s), r)) run ??= s;
              else if (run !== null) { if (s - run > best[1] - best[0]) best = [run, s]; run = null; }
            }
            if (best[1] - best[0] < need * 0.7) continue;
            b = (best[0] + best[1]) / 2;
            hb = 0;
          }
          const at = (da, db) => toXZ(a + da, b + db);
          const [x, z] = at(0, 0);
          const ha = (parallel ? CAR_L : CAR_W) / 2 - 0.3;
          if (![[0, 0], [-ha, -hb], [ha, -hb], [-ha, hb], [ha, hb]].every(([da, db]) => pointInRing(...at(da, db), r))) continue;
          const n2 = nearAxis(x, z);
          if ((n2 && n2.d < clearance(n2.k) + 1.5) || inHouse(x, z)) continue;
          // směr auta: podél u u podélného stání, jinak napříč; náhodně čelem tam nebo zpět
          const dx = parallel ? f.ux : -f.uz, dz = parallel ? f.uz : f.ux;
          const flip = hash01(e.id, slots.length + 7) < 0.5 ? Math.PI : 0;
          slots.push([x, z, Math.atan2(dx, dz) + flip]);
        }
      }
      const cap = Math.round((+t.capacity || slots.length) * OCCUPIED);
      const taken = slots.filter((_, i) => hash01(e.id, i) < OCCUPIED).slice(0, cap);
      for (const [x, z, hd] of taken) cars.push(dm(x), dm(z), Math.round(hd * 100));
    }
  }
}

// city.markings: podélné stání podél trati podle parking:left/right/both (lane, street_side, on_kerb …);
// trať je širší než ulice, auta proto stojí hned za chodníkem a zábradlí na té straně chybí (def.parking)
function streetParkingStep(g) {
  const { def, cl, clWidth, clAxis, axis, loop, at, spansWhere, tagsAt, nearAxis, inHouse, crossingS, bump } = g;
  const cars = g.out.cars;
  const sideOf = (t, side) => PARKED.has(t[`parking:${side}`] ?? t['parking:both'] ?? t[`parking:lane:${side}`] ?? t['parking:lane:both']);
  def.parking = [];
  for (const side of ['left', 'right']) {
    // směr cesty v OSM vůči trati: OSM vlevo je vlevo, jen když cesta vede stejným směrem jako trať
    const test = (k) => {
      const seg = axis[clAxis[k]].seg, nodes = loop.edges[seg].way.nodes;
      const fwd = nodes.indexOf(loop.nodes[seg].id) < nodes.indexOf(loop.nodes[(seg + 1) % loop.nodes.length].id);
      return sideOf(tagsAt(k), fwd ? side : side === 'left' ? 'right' : 'left');
    };
    for (const [a, b] of spansWhere(test, 20)) {
      const ka = nearAxis(...a).k, kb = nearAxis(...b).k;
      const sgn = side === 'right' ? 1 : -1;
      def.parking.push([a, b, at((ka + Math.round(((kb - ka + cl.N) % cl.N) / 2)) % cl.N, sgn * 30)]);
      const len = (cl.s[kb] - cl.s[ka] + cl.L) % cl.L;
      for (let d = CAR_GAP / 2; d < len - CAR_GAP / 2; d += CAR_GAP) {
        const k = (ka + Math.round(d / cl.step)) % cl.N, sk = cl.s[k];
        if (crossingS.some((c) => Math.abs(c - sk) < 8) || hash01(k, 3) > OCCUPIED) continue;
        const lat = sgn * (clWidth[k] / 2 + RUNOFF + 1.3);
        const x = cl.px[k] + cl.rx[k] * lat, z = cl.pz[k] + cl.rz[k] * lat;
        if (inHouse(x, z)) continue;
        const flip = hash01(k, 5) < 0.85 ? 0 : Math.PI; // většinou po směru jízdy v pruhu
        const hd = Math.atan2(cl.rz[k], -cl.rx[k]) + (sgn > 0 ? 0 : Math.PI) + flip; // po směru trati, vlevo proti
        cars.push(dm(x), dm(z), Math.round(hd * 100));
        bump('streetCars');
      }
    }
  }
}

// Dopravní značky a zastávky z OSM. Uzel značky leží na ose silnice: značka se postaví vpravo od řidiče,
// kterému platí (direction=forward/backward vůči cestě, nebo stupně), čelem k němu.
function signsStep(g) {
  const { roads, osmSigns, toGame, axisDist, nearAxis, latOf, cl, clWidth, loop, REACH } = g;
  const signNames = [];
  const signs = [];
  g.out.signs = signs;
  g.out.signNames = signNames;
  if (!osmSigns) return;
  const onWay = new Map();
  for (const w of roads) w.nodes.forEach((id, i) => { if (!onWay.has(id)) onWay.set(id, []); onWay.get(id).push({ w, i }); });
  const nameIndex = (n) => (signNames.includes(n) ? signNames.indexOf(n) : signNames.push(n) - 1);
  let roadLines = null;
  for (const e of osmSigns) {
    const t = e.tags ?? {};
    const kind = SIGN[t.highway] ?? SIGN[t.traffic_sign];
    if (kind === undefined || e.type !== 'node') continue;
    const p = toGame(e.lat, e.lon);
    if (axisDist(p[0], p[1]) > REACH) continue;
    // semafor: hodnota 1 = na trati (stožár s výložníkem nad pruhem), 0 = na vedlejší ulici (sloupek)
    let value = kind === SIGN.maxspeed ? +t.maxspeed || 0 : kind === SIGN.city_limit || kind === SIGN.bus_stop ? nameIndex(t.name ?? '') : 0;
    const host = onWay.get(e.id)?.[0];
    let dir = null, half = null;
    if (host) {
      const geo = host.w.geometry, i = host.i;
      const a = toGame(geo[Math.max(0, i - 1)].lat, geo[Math.max(0, i - 1)].lon), b = toGame(geo[Math.min(geo.length - 1, i + 1)].lat, geo[Math.min(geo.length - 1, i + 1)].lon);
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      let fwd = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
      const way = t.direction ?? t['traffic_signals:direction'];
      if (way === 'backward') fwd = [-fwd[0], -fwd[1]];
      else if (way !== 'forward' && !/^\d/.test(way ?? '')) {
        // bez směru (dej přednost): k bližšímu konci cesty, tam bývá křižovatka
        const len = (from, to) => { let s = 0; for (let k = from; k < to; k++) s += Math.hypot(geo[k + 1].lat - geo[k].lat, (geo[k + 1].lon - geo[k].lon) * 0.65); return s; };
        if (len(0, i) < len(i, geo.length - 1)) fwd = [-fwd[0], -fwd[1]];
      }
      dir = fwd;
      const onTrack = (i > 0 && loop.used.has(edgeKey(host.w.nodes[i - 1], e.id))) || (i + 1 < host.w.nodes.length && loop.used.has(edgeKey(e.id, host.w.nodes[i + 1])));
      if (kind === SIGN.traffic_signals) value = onTrack ? 1 : 0;
      const n = nearAxis(p[0], p[1]);
      half = onTrack && n ? clWidth[n.k] / 2 + RUNOFF + 0.6 : (STREET_W[host.w.tags.highway] ?? 6) / 2 + 1.2;
    }
    if (/^\d/.test(t.direction ?? '')) {
      // stupně od severu po směru hodinek: kam značka (kamera) hledí, řidič jede proti
      const deg = (parseFloat(t.direction) * Math.PI) / 180;
      dir = [-Math.sin(deg), Math.cos(deg)];
    }
    if (!dir) {
      // zastávka vedle silnice: deska hledí proti autobusům, které jedou po té straně (vpravo)
      roadLines ??= roads.map((w) => w.geometry.map((q) => toGame(q.lat, q.lon)));
      const best = nearestOnLines(roadLines, p);
      if (best && best.d < 20) {
        const l = Math.hypot(best.dx, best.dz) || 1, s = best.side > 0 ? 1 : -1;
        dir = [(best.dx / l) * s, (best.dz / l) * s];
      }
    }
    let x = p[0], z = p[1];
    if (dir && half) {
      // vpravo od směru jízdy (x na východ, z na jih)
      x += -dir[1] * half;
      z += dir[0] * half;
    }
    // stojí-li i tak ve výběhu (zastávka u trati), ustoupí za něj
    const n = nearAxis(x, z);
    if (n && n.d < clWidth[n.k] / 2 + RUNOFF + 0.5) {
      const need = (Math.sign(latOf(x, z, n.k)) || 1) * (clWidth[n.k] / 2 + RUNOFF + 0.6);
      x = cl.px[n.k] + cl.rx[n.k] * need;
      z = cl.pz[n.k] + cl.rz[n.k] * need;
    }
    // natočení: deska hledí proti směru jízdy
    const face = dir ? Math.atan2(-dir[0], -dir[1]) : 0;
    signs.push(kind, value, dm(x), dm(z), Math.round(face * 100));
  }
}

// city.markings: přechody se semafory (crossing=traffic_signals) na trati, kde OSM samotný semafor nemá;
// stožár s výložníkem 3 m před přechodem vpravo pro oba směry jízdy
function crossingSignalsStep(g) {
  const { poiShops, toGame, nearAxis, cl, clWidth } = g;
  const signs = g.out.signs;
  const onTrackSignals = [];
  for (let i = 0; i < signs.length; i += 5) if (signs[i] === SIGN.traffic_signals && signs[i + 1] === 1) onTrackSignals.push([signs[i + 2] / 10, signs[i + 3] / 10]);
  const placed = [];
  for (const e of poiShops) {
    if (e.type !== 'node' || e.tags?.highway !== 'crossing' || e.tags.crossing !== 'traffic_signals') continue;
    const [x, z] = toGame(e.lat, e.lon);
    const n = nearAxis(x, z);
    if (!n || n.d > 8) continue;
    // u křižovatky se semaforem už stojí; přechody téhož místa (obě ramena) jen jednou
    if (onTrackSignals.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 30) || placed.some((s) => Math.abs(s - cl.s[n.k]) < 25)) continue;
    placed.push(cl.s[n.k]);
    const half = clWidth[n.k] / 2 + RUNOFF + 0.6;
    for (const dirSign of [1, -1]) {
      const k = (n.k - dirSign * Math.round(3 / cl.step) + cl.N) % cl.N;
      const fx = cl.rz[k] * dirSign, fz = -cl.rx[k] * dirSign;
      const px = cl.px[k] - fz * half, pz = cl.pz[k] + fx * half;
      signs.push(SIGN.traffic_signals, 1, dm(px), dm(pz), Math.round(Math.atan2(-fx, -fz) * 100));
    }
  }
  g.stats.crossingSignals = placed.length;
}

// city.markings: středové ostrůvky kruhových objezdů, kterými trať projíždí ([x, z, poloměr] ve hře);
// ostrůvek začíná za okrajem chodníku na vnitřní straně, širší trať než skutečná ho proto zmenší
function islandsStep(g) {
  const { roads, toGame, nearAxis, cl, clWidth, def } = g;
  const rings = roads.filter((w) => w.tags.junction === 'roundabout' && w.geometry).map((w) => w.geometry.map((q) => toGame(q.lat, q.lon)));
  const groups = [];
  for (const pts of rings) {
    const near = groups.find((gr) => gr.some((q) => pts.some((p) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1)));
    if (near) near.push(...pts);
    else groups.push([...pts]);
  }
  def.islands = [];
  for (const pts of groups) {
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const R = pts.reduce((a, p) => a + Math.hypot(p[0] - cx, p[1] - cz), 0) / pts.length;
    if (!pts.some((p) => nearAxis(p[0], p[1])?.d < 6)) continue;
    let room = Infinity;
    for (let k = 0; k < cl.N; k++) room = Math.min(room, Math.hypot(cl.px[k] - cx, cl.pz[k] - cz) - clWidth[k] / 2 - RUNOFF - 0.2);
    const r = Math.min(R - 4.5, room);
    if (r >= 1) def.islands.push([+cx.toFixed(1), +cz.toFixed(1), +r.toFixed(1)]);
  }
  g.stats.islands = def.islands.length;
}

// Autobusy na nádraží: skupina aspoň čtyř nástupišť stejného jména je stanoviště (na Dobříši
// Mírové náměstí 1–9). U části z nich stojí autobus na nejbližší silnici, nástupiště má po pravé ruce.
function busesStep(g) {
  const { roads, osmSigns, toGame, axisDist, nearAxis, clWidth, inHouse, REACH } = g;
  const buses = [];
  g.out.buses = buses;
  if (!osmSigns) return;
  const stops = osmSigns.filter((e) => e.type === 'node' && e.tags?.highway === 'bus_stop' && e.tags.name);
  const count = new Map();
  for (const e of stops) count.set(e.tags.name, (count.get(e.tags.name) ?? 0) + 1);
  const lanes = roads.filter((w) => STREET_W[w.tags.highway] && w.tags.service !== 'parking_aisle').map((w) => w.geometry.map((q) => toGame(q.lat, q.lon)));
  for (const e of stops.filter((s) => count.get(s.tags.name) >= 4).sort((a, b) => a.id - b.id)) {
    if (hash01(e.id, 3) > BUS_STAND) continue;
    const p = toGame(e.lat, e.lon);
    if (axisDist(p[0], p[1]) > REACH) continue;
    const best = nearestOnLines(lanes, p);
    if (!best || best.d > 12) continue;
    // směr jízdy tak, aby nástupiště bylo vpravo (vpravo od (dx, dz) je (-dz, dx))
    const l = Math.hypot(best.dx, best.dz) || 1;
    let ux = best.dx / l, uz = best.dz / l;
    if ((p[0] - best.f[0]) * -uz + (p[1] - best.f[1]) * ux < 0) { ux = -ux; uz = -uz; }
    // bok autobusu 0,3 m od nástupiště
    const off = Math.max(0, best.d - BUS_W / 2 - 0.3);
    const x = best.f[0] - uz * off, z = best.f[1] + ux * off;
    const ends = [-1, -0.5, 0, 0.5, 1].map((t) => [x + ux * t * (BUS_L / 2), z + uz * t * (BUS_L / 2)]);
    if (ends.some(([ex, ez]) => { const n = nearAxis(ex, ez); return (n && n.d < clWidth[n.k] / 2 + RUNOFF + BUS_W / 2 + 0.3) || inHouse(ex, ez); })) continue;
    if (buses.some((b) => Math.hypot(b[0] - x, b[1] - z) < BUS_L + 1)) continue;
    buses.push([x, z, Math.atan2(ux, uz)]);
  }
}

export function buildTraffic(g) {
  g.out.cars = [];
  shopsStep(g);
  crossingsStep(g);
  parkingLotsStep(g);
  if (g.city.markings) streetParkingStep(g);
  signsStep(g);
  if (g.city.markings) crossingSignalsStep(g);
  if (g.city.markings) islandsStep(g);
  busesStep(g);
}
