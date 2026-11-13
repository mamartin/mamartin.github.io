// Provoz ve městě mimo trať (jen kulisa): auta jezdí po okruzích ulic (streetgraph.js), vpravo,
// před křižovatkou zpomalí a v ní si náhodně vyberou, kam dál. Za autem před sebou drží odstup.
// K trati se nepřiblíží (ulice u ní z grafu vypadnou), závodních aut se nedotknou. Všechna auta jsou
// jedno pole instancí, druhé je měkký stín pod nimi (v noci ještě dvě se světly), polohy se přepisují každý snímek.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG, angleDiff } from './rng.js';
import { colored } from './scenery.js';
import { instancedLevels, placeInstance } from './lod.js';
import { streetGraph, alongEdge, nextEdge } from './streetgraph.js';
import { blobGeometry, blobMaterial } from './people.js';

const CLEAR = 9; // m za okrajem trati, kam auta nesmí
const REACH = 280; // m od trati: dál provoz není vidět
const SPACING = 115; // m ulic na jedno auto
const MAX_CARS = 40;
const CRUISE = [7.5, 10.5]; // m/s (27–38 km/h)
const NODE_SPEED = 3.2; // m/s v křižovatce
const GAP = 7.5; // m odstup za autem vpředu

// stojící i jedoucí auto: bílá karoserie dostane barvu instance, okna a kola zůstanou tmavá
export function townCarGeometry() {
  return mergeGeometries([
    colored(new THREE.BoxGeometry(1.76, 0.68, 4.3).translate(0, 0.62, 0), '#ffffff'),
    colored(new THREE.BoxGeometry(1.56, 0.52, 2.2).translate(0, 1.22, -0.25), '#4a525c'),
    colored(new THREE.BoxGeometry(1.5, 0.08, 1.9).translate(0, 1.5, -0.3), '#ffffff'),
    ...[-1.35, 1.35].map((z) => colored(new THREE.BoxGeometry(1.84, 0.56, 0.64).translate(0, 0.28, z), '#1d1e20')),
  ]);
}

// lak aut ve zkušebním realistickém vzhledu: lesklý, odráží oblohu
export const carPaint = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.2, envMapIntensity: 0.8 });

// přední a koncová světla (v noci)
export function townCarLights() {
  return {
    front: mergeGeometries([-0.6, 0.6].map((x) => new THREE.BoxGeometry(0.3, 0.14, 0.05).translate(x, 0.72, 2.16))),
    rear: mergeGeometries([-0.62, 0.62].map((x) => new THREE.BoxGeometry(0.26, 0.12, 0.05).translate(x, 0.76, -2.16))),
  };
}

// colors = barvy karoserií (stejné jako u stojících aut)
// shape = podrobný tvar auta zblízka (zkušební realistický vzhled), jinak všude krabice
export function buildTraffic(town, track, terrain, { view, night, seed, shadows, colors, shape = null }) {
  const group = new THREE.Group();
  group.name = 'traffic';
  const allowed = (x, z) => {
    const d = terrain.distAt(x, z);
    return d > track.edge + CLEAR && d < REACH && !terrain.keepOut(x, z);
  };
  const graph = streetGraph(town.streets, allowed, { minWidth: 3.5 });
  const total = graph.edges.reduce((a, e) => a + e.len, 0);
  group.userData.count = { cars: 0, streets: Math.round(total) };
  if (!graph.edges.length) return group;
  const rng = new RNG(seed);
  // auta rozmístěná po délce sítě rovnoměrně s náhodným posunem
  const n = Math.min(MAX_CARS, Math.floor(total / SPACING));
  const cars = [];
  const p = [];
  const lane = (e) => Math.min(1.7, Math.max(0.95, e.width / 4));
  for (let i = 0; i < n; i++) {
    let at = ((i + rng.next() * 0.6) / n) * total, edge = 0;
    while (edge < graph.edges.length - 1 && at > graph.edges[edge].len) at -= graph.edges[edge++].len;
    const dir = rng.next() < 0.5 ? 1 : -1;
    const cruise = rng.range(CRUISE[0], CRUISE[1]);
    alongEdge(graph.edges[edge], at, dir, p);
    // next = kam auto pojede z křižovatky na konci hrany (ví to předem, ať může zatáčet plynule)
    cars.push({ edge, dir, d: at, cruise, v: cruise * 0.6, hd: Math.atan2(p[2], p[3]), off: lane(graph.edges[edge]), color: rng.pick(colors), next: nextEdge(graph, edge, dir, rng.next()) });
  }
  // bod na trase auta o `ahead` metrů dál, i za křižovatkou
  const q = [];
  const lookAhead = (c, ahead) => {
    const e = graph.edges[c.edge];
    if (c.d + ahead <= e.len) return alongEdge(e, c.d + ahead, c.dir, q);
    return alongEdge(graph.edges[c.next[0]], c.d + ahead - e.len, c.next[1], q);
  };
  const pose = (c, o) => {
    const e = graph.edges[c.edge];
    alongEdge(e, c.d, c.dir, p);
    // vpravo od směru jízdy (auto míří k +z, vpravo je −x)
    o.x = p[0] - Math.cos(c.hd) * c.off;
    o.z = p[1] + Math.sin(c.hd) * c.off;
    o.y = terrain.heightAt(o.x, o.z);
    return o;
  };
  const o = {};
  const items = cars.map((c) => {
    pose(c, o);
    return { x: o.x, y: o.y, z: o.z, ry: c.hd, color: c.color };
  });
  const opts = { cull: Math.min(view.cull, 380 * view.reach) };
  const pools = [];
  const add = (geo, list, mat, shadow) => {
    const pool = instancedLevels([[0, [[geo, list, shadow]]]], mat, opts);
    group.add(pool);
    pools.push(pool.userData.pool);
  };
  if (shape) {
    const pool = instancedLevels([[0, [[shape, items, !!shadows]]], [70 * view.reach, [[townCarGeometry(), items]]]], carPaint(), opts);
    group.add(pool);
    pools.push(pool.userData.pool);
  } else add(townCarGeometry(), items, new THREE.MeshLambertMaterial({ vertexColors: true }), !!shadows);
  // měkký stín pod autem (stínová mapa sahá jen kolem závodního auta)
  add(blobGeometry(2.7, 5.4, 0.04), items.map(({ color, ...t }) => t), blobMaterial(), false);
  group.children[group.children.length - 1].traverse((m) => { if (m.isMesh) m.renderOrder = 1; });
  if (night) {
    const plain = items.map(({ color, ...t }) => t);
    const { front, rear } = townCarLights();
    add(front, plain, new THREE.MeshLambertMaterial({ color: 0, emissive: '#fff3d8', emissiveIntensity: 4 }), false);
    add(rear, plain, new THREE.MeshLambertMaterial({ color: 0, emissive: '#ff2a1a', emissiveIntensity: 2.5 }), false);
  }
  group.userData.count.cars = n;
  group.userData.update = (dt) => {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.1);
    cars.forEach((c, i) => {
      const e = graph.edges[c.edge];
      const rem = e.len - c.d;
      // před křižovatkou a za ní pomalu, mezi nimi cestovní rychlostí
      let want = Math.min(c.cruise, NODE_SPEED + 0.55 * Math.min(rem, c.d + 4));
      // odstup za nejbližším autem vpředu na stejné hraně a ve stejném směru
      for (const b of cars) {
        if (b === c || b.edge !== c.edge || b.dir !== c.dir || b.d <= c.d) continue;
        const gap = b.d - c.d;
        if (gap < GAP * 2.2) want = Math.min(want, Math.max(0, (gap - GAP) * 1.2));
      }
      c.v += Math.max(-7 * dt, Math.min(2.5 * dt, want - c.v));
      c.d += c.v * dt;
      if (c.d >= e.len) {
        const over = c.d - e.len;
        [c.edge, c.dir] = c.next;
        c.next = nextEdge(graph, c.edge, c.dir, rng.next());
        c.d = Math.min(over, graph.edges[c.edge].len);
      }
      const now = graph.edges[c.edge];
      alongEdge(now, c.d, c.dir, p);
      // auto míří na bod 5 m před sebou na své trase, takže do zatáčky začne točit včas;
      // směr a boční posun se dotáčí plynule (zatáčka, jiná šířka ulice)
      lookAhead(c, 5);
      const k = 1 - Math.exp(-dt * (0.8 + c.v * 0.45));
      c.hd += angleDiff(c.hd, Math.atan2(q[0] - p[0], q[1] - p[1])) * k;
      c.off += (lane(now) - c.off) * k;
      pose(c, o);
      for (const pool of pools) placeInstance(pool, i, o.x, o.y, o.z, c.hd);
    });
  };
  return group;
}
