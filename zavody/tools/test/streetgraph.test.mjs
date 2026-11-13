// Síť ulic pro provoz: zůstanou jen okruhy, auto v uzlu nepokračuje zpět po hraně, po které přijelo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streetGraph, alongEdge, nextEdge } from '../../js/streetgraph.js';

// čtverec 100 × 100 m ze čtyř ulic, slepá ulice z rohu, příčka uprostřed (sdílí bod s bočními ulicemi
// jako křižovatka v OSM) a úzká úhlopříčka
const square = [
  { width: 6, line: [[0, 0], [100, 0]] },
  { width: 6, line: [[100, 0], [100, 50], [100, 100]] },
  { width: 6, line: [[100, 100], [0, 100]] },
  { width: 6, line: [[0, 100], [0, 50], [0, 0]] },
  { width: 6, line: [[100, 100], [160, 100], [200, 140]] },
  { width: 6, line: [[0, 50], [100, 50]] },
  { width: 2, line: [[0, 0], [100, 100]] },
];
const everywhere = () => true;

test('slepá ulice a úzká ulice vypadnou, okruh zůstane', () => {
  const g = streetGraph(square, everywhere);
  // příčka dělí levou a pravou stranu na dvě hrany: 2 + 2 × 2 + 1 příčka
  assert.equal(g.edges.length, 7);
  assert.equal(Math.round(g.edges.reduce((a, e) => a + e.len, 0)), 500);
  for (const list of g.nodes.values()) assert.ok(list.length >= 2);
});

test('hrana přes zakázané místo vypadne i se vším, co na ní visí', () => {
  const g = streetGraph(square, (x, z) => !(x > 40 && x < 60 && z > 40 && z < 60));
  // bez příčky zbyde obvod (boční ulice zůstanou rozdělené v bodě, kde příčka začínala)
  assert.equal(g.edges.length, 6);
  assert.equal(Math.round(g.edges.reduce((a, e) => a + e.len, 0)), 400);
  // bez spodní ulice zbyde jen horní okruh přes příčku: spodní poloviny bočních ulic jsou slepé
  const top = streetGraph(square, (x, z) => !(x > 40 && x < 60 && z < 10));
  assert.equal(Math.round(top.edges.reduce((a, e) => a + e.len, 0)), 300);
  assert.ok(top.edges.every((e) => e.pts.every((p) => p[1] >= 50)));
});

test('poloha na hraně a volba další hrany', () => {
  const g = streetGraph(square, everywhere);
  const e = g.edges.findIndex((x) => x.len === 100 && x.pts[0][1] === 0 && x.pts[1][1] === 0);
  const p = alongEdge(g.edges[e], 30, 1);
  assert.deepEqual(p.map((v) => Math.round(v)), [30, 0, 1, 0]);
  const q = alongEdge(g.edges[e], 30, -1);
  assert.deepEqual(q.map((v) => Math.round(v) + 0), [70, 0, -1, 0]);
  for (const pick of [0, 0.5, 0.99]) {
    const [next, dir] = nextEdge(g, e, 1, pick);
    assert.notEqual(next, e);
    const n = g.edges[next];
    assert.equal(dir > 0 ? n.a : n.b, g.edges[e].b);
  }
});
