// Kroky generátoru trati na malých umělých vstupech, bez stažených dat města.
// Spuštění: node --test tools/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spansOf, lanesOf, realWidth, roadWidth, matchAxis } from '../gen/track.mjs';
import { massing, ROOF, ROOF_CROSS } from '../gen/buildings.mjs';
import { areaKind, hullOf } from '../gen/surfaces.mjs';
import { affineFrom, hash01, flat, ringOf, nearestOnLines, closed } from '../gen/util.mjs';
import { addSpace, clearRoad, shiftClear } from '../gen/space.mjs';
import { RUNOFF, FACADE_GAP } from '../gen/inputs.mjs';
import { peakOf, indexPoints } from '../lib/dmp.mjs';
import { signedArea } from '../lib/poly.mjs';

// Rovná osa po ose x (vpravo je +z), N vzorků po 2 m, uzavřená jako okruh; šířka vozovky 10 m.
function straight(N = 300, width = 10) {
  const cl = { N, step: 2, L: N * 2, s: new Float32Array(N), px: new Float32Array(N), pz: new Float32Array(N), rx: new Float32Array(N), rz: new Float32Array(N) };
  for (let k = 0; k < N; k++) { cl.s[k] = k * 2; cl.px[k] = k * 2; cl.rz[k] = 1; }
  const g = { cl, clWidth: new Float32Array(N).fill(width), city: {}, REACH: 400, proj: { forward: (la, lo) => [lo, la] } };
  addSpace(g);
  return g;
}
const at = (k) => [k, 0];

test('spansOf: úseky delší než minLen, dlouhé dělené na třetiny kola, úsek přes cíl končí na startu', () => {
  const cl = straight(300).cl;
  assert.deepEqual(spansOf(cl, (k) => k >= 10 && k < 40, 20, at), [[[10, 0], [39, 0]]]);
  // krátký úsek (8 m) zmizí
  assert.deepEqual(spansOf(cl, (k) => k >= 10 && k < 15, 20, at), []);
  // celé kolo: tři kusy po N/3 a poslední končí na startu (bez mezery na švu)
  assert.deepEqual(spansOf(cl, () => true, 20, at), [[[0, 0], [100, 0]], [[100, 0], [200, 0]], [[200, 0], [0, 0]]]);
  // úsek až do cíle bez startu končí na posledním vzorku
  assert.deepEqual(spansOf(cl, (k) => k >= 250, 20, at), [[[250, 0], [299, 0]]]);
});

test('lanesOf: čáry podle OSM', () => {
  assert.equal(lanesOf({ highway: 'secondary', lane_markings: 'no', lanes: '2' }), 0);
  assert.equal(lanesOf({ highway: 'residential' }), 0);
  assert.equal(lanesOf({ highway: 'secondary' }), 2);
  assert.equal(lanesOf({ highway: 'primary', lanes: '3' }), 3);
  assert.equal(lanesOf({ highway: 'primary', lanes: '6' }), 4);
  assert.equal(lanesOf({ highway: 'tertiary', junction: 'roundabout', lanes: '1' }), 1);
});

test('šířka vozovky: měření z katastru má přednost, jinak kategorie', () => {
  assert.equal(realWidth({ highway: 'secondary', lanes: '3' }), 10);
  assert.equal(realWidth({ highway: 'secondary', surface: 'sett' }), 8.5);
  assert.equal(roadWidth({ highway: 'service' }, 20), null);
  assert.equal(roadWidth({ highway: 'residential' }, 10), 5.2);
  assert.equal(roadWidth({ highway: 'residential' }, 40), 10);
  assert.equal(roadWidth({ highway: 'residential' }, null), null);
});

test('matchAxis: každému vzorku hry nejbližší vzorek osy OSM (y na sever)', () => {
  const { cl } = straight(50);
  // osa OSM je okruh delší než okno hledání (60 vzorků zpět), po 0,5 m
  const axis = Array.from({ length: 200 }, (_, i) => ({ x: i * 0.5, y: 0 }));
  const idx = matchAxis(cl, axis);
  assert.equal(idx[0], 0);
  assert.equal(idx[10], 40);
  assert.equal(idx[49], 196);
});

test('massing: výška z OSM, podlaží a měření DMP', () => {
  // podlaží z RÚIAN
  assert.deepEqual(massing({ building: 'apartments' }, 300, 12, 5), { wall: 15, roof: 0, shape: ROOF.flat });
  // height=60 u 15 podlaží je chyba OSM, platí podlaží
  assert.equal(massing({ building: 'apartments', height: '60' }, 300, 12, 15).wall, 45);
  // malý dům bez údajů: sedlová střecha, stěna 4,5 m
  const house = massing({ building: 'house' }, 120, 9);
  assert.equal(house.shape, ROOF.gabled);
  assert.equal(house.wall, 4.5);
  // změřeno v DMP: přednost před vším, hřeben napříč má střechu 9 m
  assert.deepEqual(massing({ building: 'church' }, 400, 14, 2, { wall: 11, roof: 12, shape: 'cross' }), { wall: 11, roof: 9, shape: ROOF_CROSS });
});

test('areaKind a hullOf', () => {
  assert.equal(areaKind({ landuse: 'forest' }), 'forest');
  assert.equal(areaKind({ leisure: 'garden', name: 'Zámecký park' }, new Set(['Zámecký park'])), 'garden');
  assert.equal(areaKind({ building: 'yes' }), null);
  const hull = hullOf([[0, 0], [10, 0], [10, 10], [0, 10], [5, 5], [3, 7]]);
  assert.equal(hull.length, 4);
  assert.equal(Math.abs(signedArea(hull)), 100);
});

test('util: afinní převod, decimetry, stálá náhoda, nejbližší úsek', () => {
  const f = (e, n) => [3 + 0.5 * e - 0.2 * n, -7 + 0.1 * e + 0.9 * n];
  const src = [[0, 0], [100, 0], [0, 100], [100, 100], [37, 61]];
  const t = affineFrom(src, src.map(([e, n]) => f(e, n)));
  const [x, z] = t(50, 25);
  assert.ok(Math.abs(x - f(50, 25)[0]) < 1e-9 && Math.abs(z - f(50, 25)[1]) < 1e-9);
  assert.deepEqual(flat([[1.23, -4.56]]), [12, -46]);
  assert.deepEqual(ringOf([0, 0, 15, 25], 0), [[0, 0], [1.5, 2.5]]);
  assert.equal(hash01(42, 7), hash01(42, 7));
  assert.ok(hash01(42, 7) >= 0 && hash01(42, 7) < 1);
  const best = nearestOnLines([[[0, 0], [10, 0]], [[0, 5], [10, 5]]], [4, 4]);
  assert.deepEqual(best.f, [4, 5]);
  assert.equal(closed({ type: 'way', nodes: [1, 2, 3, 1] }), true);
  assert.equal(closed({ type: 'way', nodes: [1, 2, 3] }), false);
});

test('prostor: vzdálenost od osy a ústup fasády za výběh', () => {
  const g = straight(300);
  const n = g.nearAxis(100.4, 3);
  assert.equal(n.k, 50);
  assert.ok(Math.abs(n.d - Math.hypot(0.4, 3)) < 1e-9);
  assert.equal(g.nearAxis(100, 200), null);
  const need = 5 + RUNOFF + FACADE_GAP;
  // dům, jehož přední hrana je 4 m od osy vpravo: fasáda ustoupí na 9,2 m, zadní část zůstane
  const house = [[100, 4], [112, 4], [112, 20], [100, 20]];
  const c = clearRoad(g, house);
  assert.equal(c.conflict, false);
  assert.ok(Math.abs(c.moved - (need - 4)) < 1e-6);
  assert.ok(c.ring.every((p) => p[1] >= need - 1e-6));
  // dům přes celou silnici nejde ořezat
  assert.equal(clearRoad(g, [[100, -10], [110, -10], [110, 10], [100, 10]]).conflict, true);
  // dominanta se odsune celá a tvar zůstane
  const s = shiftClear(g, [[200, 2], [210, 2], [210, 12], [200, 12]]);
  assert.ok(s.moved > 0);
  assert.ok(s.ring.every((p) => g.nearAxis(p[0], p[1]).d >= need - 0.06));
  assert.ok(Math.abs(Math.abs(signedArea(s.ring)) - 100) < 1e-6);
});

test('peakOf: věž kostela v bodech DMP', () => {
  // loď 30 × 12 m s hřebenem 14 m, věž 6 × 6 m vysoká 40 m na západním konci
  const e = [], n = [], z = [];
  for (let x = 0; x <= 30; x += 1) for (let y = 0; y <= 12; y += 1) {
    const tower = x <= 6 && y >= 3 && y <= 9;
    e.push(1000 + x); n.push(2000 + y); z.push(300 + (tower ? 40 - Math.hypot(x - 3, y - 6) * 2 : 8 + 6 * (1 - Math.abs(y - 6) / 6)));
  }
  const ring = [[1000, 2000], [1030, 2000], [1030, 2012], [1000, 2012]];
  const p = peakOf(indexPoints(e, n, z), ring, () => 300);
  assert.ok(Math.abs(p.top - 40) < 0.01);
  assert.ok(Math.abs(p.e - 1003) < 1.5 && Math.abs(p.n - 2006) < 1.5);
  assert.ok(p.nave && p.nave.ridge > 12 && p.nave.ridge <= 14 && p.nave.eave >= 8 && p.nave.eave < 12);
  assert.equal(peakOf(indexPoints([], [], []), ring, () => 300), null);
});
