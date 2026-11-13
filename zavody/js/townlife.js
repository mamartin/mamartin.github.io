// Život ve městě (jen vzhled, do jízdy nezasahuje): lidé čekající u přechodů, diváci na startovní rovince
// a v centru za sloupky, chodci na chodnících a auta čekající v bočních ulicích u trati.
// Všichni stojí za okrajem trati (track.edgeAt), auta závodu se jich nedotknou.
import * as THREE from 'three';
import { RNG } from './rng.js';
import { personGeometry, personMaterial, tickPeople, blobGeometry, blobMaterial, walkClock } from './people.js';
import { instancedLevels, placeInstance } from './lod.js';

const CLOTHES = ['#2f4a6e', '#9c2a26', '#e8e6df', '#3b3f45', '#5d7a4a', '#c79a3a', '#6d2f3a', '#8a8f96', '#2a2c30', '#d26a3c', '#4b6fa8', '#efe2c4'];
const SPECTATOR_REACH = 160; // m od startu na obě strany: rovinka s diváky
const WALK_MIN = 10; // m: kratší volný úsek chodníku za procházku nestojí, postava tam jen stojí
const WALK_MAX = 60; // m na každou stranu od místa, kde chodec začíná
const TURN = 0.7; // s na otočení na konci úseku

// blocked(x, z): v domě, na ploše, kam nic nepatří (terrain.keepOut a obrysy domů dodá town.js)
export function buildLife(town, track, terrain, { view, night, seed, blocked }) {
  const rng = new RNG(seed);
  const people = [];
  const at = (s, lat) => {
    const p = track.sampleAt(s, lat);
    return { x: p.x, z: p.z, hd: p.hd };
  };
  // postava na místě (s, strana, odstup od okraje), čelem k trati nebo podél ní
  const place = (s, side, out, facing, fan = false) => {
    const k = track.indexAt(s);
    const lat = side * (track.edgeAt(k) + out);
    const p = at(s, lat);
    if (terrain.keepOut(p.x, p.z) || blocked(p.x, p.z)) return;
    if (track.openEdge(s, side, [p.x, 0, p.z]) || track.cutAt(s, side)) return;
    // k trati: směr -strana * pravá ruka
    const ry = facing === 'track' ? p.hd + (side > 0 ? Math.PI / 2 : -Math.PI / 2) + rng.range(-0.5, 0.5) : p.hd + (rng.next() < 0.5 ? 0 : Math.PI);
    // terén těsně za okrajem je kvůli krajnici 0,7 m pod silnicí (terrain.js): postava stojí aspoň v úrovni
    // chodníku, jinak by jí obrubník schoval nohy i stín
    const top = track.sampleAt(s, side * track.edgeAt(k)).y + (track.onUrban(s) ? 0.13 : 0);
    people.push({ x: p.x, y: Math.max(terrain.heightAt(p.x, p.z), top), z: p.z, ry, s: rng.range(0.92, 1.08), color: rng.pick(CLOTHES), fan });
  };
  // chodec na místě (s, strana, odstup od okraje): poloha, výška a směr podél trati
  const tmp = {};
  const walkAt = (s, side, out, o = {}) => {
    track.sampleAt(s, 0, tmp);
    const k = tmp.i, n = (k + 1) % track.N;
    const edge = track.edgeAt(k) + (track.edgeAt(n) - track.edgeAt(k)) * tmp.u;
    const lat = side * (edge + out);
    o.x = tmp.cx + tmp.rx * lat;
    o.z = tmp.cz + tmp.rz * lat;
    o.y = Math.max(terrain.heightAt(o.x, o.z), tmp.cy + side * edge * tmp.tanBank + 0.13);
    o.hd = tmp.hd;
    return o;
  };
  // smí tudy chodec jít: chodník ve městě mimo rovinku s diváky, volné místo za okrajem
  const walkable = (s, side, out) => {
    if (!track.onUrban(s) || Math.min(s, track.L - s) < SPECTATOR_REACH) return false;
    if (track.edges && track.edgeKind(s, side) === 'grass') return false;
    const p = walkAt(s, side, out);
    if (terrain.keepOut(p.x, p.z) || blocked(p.x, p.z)) return false;
    return !track.openEdge(s, side, [p.x, 0, p.z]) && !track.cutAt(s, side);
  };
  const walkers = [];
  const urban = (s) => track.onUrban(s);
  const L = track.L;

  // u přechodů čekají lidé na zelenou
  for (const c of track.crossings) {
    for (const side of [-1, 1]) {
      const n = rng.int(0, night ? 1 : 3);
      for (let i = 0; i < n; i++) place(c + rng.range(-2, 2), side, rng.range(0.5, 1.4), 'track');
    }
  }
  // diváci: startovní rovinka a centrum se sloupky (náměstí), v řadách za okrajem
  for (let s = 0; s < L; s += 2) {
    const start = Math.min(s, L - s) < SPECTATOR_REACH;
    const centre = track.bollardSpans && track.onBollards(s);
    if (!start && !centre) continue;
    for (const side of [-1, 1]) {
      for (const [row, p] of [[0.6, 0.5], [1.4, 0.28], [2.2, 0.1]]) {
        if (rng.next() < p) place(s + rng.range(-0.4, 0.4), side, row + rng.range(-0.15, 0.15), 'track', true);
      }
    }
  }
  // chodci na chodnících po městě, v noci méně
  const every = night ? 70 : 28;
  for (let s = rng.range(0, every); s < L; s += every * rng.range(0.6, 1.4)) {
    if (!urban(s) || Math.min(s, L - s) < SPECTATOR_REACH) continue;
    const side = rng.next() < 0.5 ? -1 : 1;
    if (track.edges && track.edgeKind(s, side) === 'grass') continue;
    const n = rng.next() < 0.3 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const at = s + i * 0.8, out = rng.range(0.5, 1.0);
      // kam až se dá dojít oběma směry; kde je místa málo, postava jen stojí
      let s0 = at, s1 = at;
      if (walkable(at, side, out)) {
        while (at - s0 < WALK_MAX && walkable(s0 - 2, side, out)) s0 -= 2;
        while (s1 - at < WALK_MAX && walkable(s1 + 2, side, out)) s1 += 2;
      }
      if (s1 - s0 < WALK_MIN) place(at, side, out, 'along');
      else walkers.push({ s: at, s0, s1, side, out, dir: rng.next() < 0.5 ? 1 : -1, speed: rng.range(1.1, 1.5), scale: rng.range(0.92, 1.08), color: rng.pick(CLOTHES), turn: 0 });
    }
  }

  const group = new THREE.Group();
  group.name = 'life';
  const opts = { cull: Math.min(view.cull, 260 * view.reach) };
  if (people.length) {
    // bez stínů: stovky drobných postav by stínovou mapu zdražily víc, než přidají; fanoušci (diváci)
    // se hýbou, ostatní stojí (people.js), každá skupina je jedno volání kreslení
    const geo = personGeometry();
    for (const fans of [true, false]) {
      const list = people.filter((t) => t.fan === fans);
      if (!list.length) continue;
      const pool = instancedLevels([[0, [[geo, list]]]], personMaterial(fans ? 'fans' : 'still'), opts);
      pool.traverse((o) => { if (o.isMesh) o.onBeforeRender = tickPeople; });
      group.add(pool);
    }
    // měkký stín pod každým, jen zblízka (dál není vidět)
    const blob = instancedLevels([[0, [[blobGeometry(1.1, 0.9), people.map(({ color, ...t }) => t)]]]], blobMaterial(), { cull: Math.min(opts.cull, 90) });
    blob.traverse((o) => { if (o.isMesh) o.renderOrder = 1; });
    group.add(blob);
  }
  // chodci: polohu jim každý snímek přepíše update (jdou podél trati tam a zpět), krok dělá shader
  if (walkers.length) {
    const o = {};
    const items = walkers.map((w) => {
      walkAt(w.s, w.side, w.out, o);
      return { x: o.x, y: o.y, z: o.z, ry: o.hd + (w.dir > 0 ? 0 : Math.PI), s: w.scale, color: w.color };
    });
    const bodies = instancedLevels([[0, [[personGeometry(), items]]]], personMaterial('walk'), opts);
    const shade = instancedLevels([[0, [[blobGeometry(1.1, 0.9), items.map(({ color, ...t }) => t)]]]], blobMaterial(), { cull: Math.min(opts.cull, 90) });
    shade.traverse((m) => { if (m.isMesh) m.renderOrder = 1; });
    group.add(bodies, shade);
    const pools = [bodies.userData.pool, shade.userData.pool];
    group.userData.update = (dt) => {
      if (dt <= 0) return;
      dt = Math.min(dt, 0.1);
      walkClock.value = (walkClock.value + dt) % 3600;
      walkers.forEach((w, i) => {
        if (w.turn > 0) w.turn -= dt;
        else {
          w.s += w.dir * w.speed * dt;
          if (w.s >= w.s1 || w.s <= w.s0) {
            w.s = Math.min(w.s1, Math.max(w.s0, w.s));
            w.dir = -w.dir;
            w.turn = TURN;
          }
        }
        walkAt(w.s, w.side, w.out, o);
        // při otáčení se postava plynule dotočí do nového směru
        const ry = o.hd + (w.dir > 0 ? 0 : Math.PI) + Math.PI * Math.max(0, w.turn) / TURN;
        for (const pool of pools) placeInstance(pool, i, o.x, o.y, o.z, ry, w.scale);
      });
    };
  }
  group.userData.people = people.length + walkers.length;
  group.userData.walkers = walkers.length;
  return group;
}

// auta čekající v bočních ulicích na výjezd do trati: [{x, z, hd}] pro buildCars, v noci se světly
export function waitingCars(town, track, terrain, { seed, blocked }) {
  const rng = new RNG(seed);
  const out = [];
  const edge = (x, z) => terrain.distAt(x, z);
  for (const st of town.streets) {
    const line = st.line;
    // obslužné komunikace a uličky parkovišť (užší než 5 m) se nepočítají
    if (line.length < 2 || st.width < 5) continue;
    for (const end of [0, 1]) {
      const pts = end ? [...line].reverse() : line;
      // konec ulice u trati, ulice od ní vede pryč
      if (edge(pts[0][0], pts[0][1]) > track.edge + 2 || rng.next() > 0.55) continue;
      // po ulici od trati na místo 4 m za okrajem (dopočtené na úsečce, i když je dlouhá)
      const want = track.edge + 4;
      let i = 1;
      while (i < pts.length && edge(pts[i][0], pts[i][1]) <= want) i++;
      if (i === pts.length) continue;
      const q = pts[i - 1], r = pts[i];
      let lo = 0, hi = 1;
      for (let it = 0; it < 12; it++) {
        const t = (lo + hi) / 2;
        if (edge(q[0] + (r[0] - q[0]) * t, q[1] + (r[1] - q[1]) * t) > want) hi = t;
        else lo = t;
      }
      const p = [q[0] + (r[0] - q[0]) * hi, q[1] + (r[1] - q[1]) * hi];
      let dx = q[0] - r[0], dz = q[1] - r[1];
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len; // směr k trati
      const lane = Math.max(1.2, st.width / 4);
      const n = rng.next() < 0.35 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const back = 2.6 + k * 6.2;
        const x = p[0] - dx * back - dz * lane, z = p[1] - dz * back + dx * lane;
        if (edge(x, z) < track.edge + 2.5 || terrain.keepOut(x, z) || blocked(x, z)) break;
        out.push({ x, z, hd: Math.atan2(dx, dz), waiting: true });
      }
    }
  }
  return out;
}
