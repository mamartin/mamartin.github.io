// Život ve městě (jen vzhled, do jízdy nezasahuje): lidé čekající u přechodů, diváci na startovní rovince
// a v centru za sloupky, chodci na chodnících a auta čekající v bočních ulicích u trati.
// Všichni stojí za okrajem trati (track.edgeAt), auta závodu se jich nedotknou.
import * as THREE from 'three';
import { RNG } from './rng.js';
import { personGeometry, personMaterial, tickPeople } from './people.js';
import { instancedLevels } from './lod.js';

const CLOTHES = ['#2f4a6e', '#9c2a26', '#e8e6df', '#3b3f45', '#5d7a4a', '#c79a3a', '#6d2f3a', '#8a8f96', '#2a2c30', '#d26a3c', '#4b6fa8', '#efe2c4'];
const SPECTATOR_REACH = 160; // m od startu na obě strany: rovinka s diváky

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
    people.push({ x: p.x, y: terrain.heightAt(p.x, p.z), z: p.z, ry, s: rng.range(0.92, 1.08), color: rng.pick(CLOTHES), fan });
  };
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
    for (let i = 0; i < n; i++) place(s + i * 0.8, side, rng.range(0.5, 1.0), 'along');
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
      const pool = instancedLevels([[0, [[geo, list]]]], personMaterial(fans), opts);
      pool.traverse((o) => { if (o.isMesh) o.onBeforeRender = tickPeople; });
      group.add(pool);
    }
  }
  group.userData.people = people.length;
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
