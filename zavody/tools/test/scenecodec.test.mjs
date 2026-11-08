// Binární formát scény (js/scenecodec.js): zápis a čtení musí vrátit přesně stejná data.
// Spuštění: node --test tools/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { encodeScene, decodeScene, readScene } from '../../js/scenecodec.js';

const scene = {
  v: 1,
  license: 'ODbL-1.0',
  origin: { lat: 49.7, lon: 14.0, base: 471.25 },
  dem: { x0: -800, z0: -600, cell: 12, nx: 3, nz: 2, h: [0, 5, -3, 120, 118, 4000] },
  palette: { wall: ['#ffffff'], roof: ['#000000'], plain: [0] },
  buildings: [[90, 30, 0, 0, 0, 10, 20, 50, 20, 50, -60], [45, 0, 2, 0, 0, -12345, 678, -12000, 700, -12000, 900]],
  levels: [0, 5],
  facades: [0, 2, 1, 3],
  landmarks: [{ id: 'kostel', name: 'Sv. Jakub', p: [1, 2, 3, 4, 5, 6], peak: [1, 2, 3, 4, 5, 0, 0] }],
  areas: [['forest', 0, 0, 100, 0, 100, 100], ['park', -5, -5, 5, -5, 0, 5]],
  water: [{ name: null, level: null, p: [0, 0, 1, 0, 1, 1] }],
  paved: [],
  streets: [[55, 0, 0, 10, 10]],
  paths: [[1, 1, 2, 2, 3]],
  streams: [],
  barriers: [[2, 0, 0, 3, 3]],
  lamps: [10, 20, 30, 40],
  trees: [],
  treeRows: [],
  canopy: [1, 2, 3, 4, 5, 6, 7, 8],
  statues: [],
  chimneys: [[1, 2, 250]],
  cars: [100, 200, -314, 110, 210, 314],
  shops: [0, 1],
  signs: [5, 1, 100, 200, -157],
  signNames: ['Příbram', ''],
  buses: [],
};

test('scéna projde zápisem a čtením beze změny', () => {
  assert.deepEqual(decodeScene(encodeScene(scene)), scene);
});

test('hra čte soubor zabalený gzipem i už rozbalený', async () => {
  const bytes = encodeScene(scene);
  assert.deepEqual(await readScene(new Uint8Array(gzipSync(bytes)).buffer), scene);
  assert.deepEqual(await readScene(bytes.slice().buffer), scene);
});

test('velká čísla, záporná čísla a dlouhé pole', () => {
  // + 0: zápornou nulu formát (stejně jako JSON) vrátí jako nulu
  const h = Array.from({ length: 5000 }, (_, i) => Math.round(Math.sin(i / 50) * 3000 + i) + 0);
  const big = { dem: { x0: 0, z0: 0, cell: 12, nx: 100, nz: 50, h }, cars: [2 ** 40, -(2 ** 40), 0] };
  assert.deepEqual(decodeScene(encodeScene(big)), big);
});

test('vadný soubor se pozná', () => {
  const bytes = encodeScene(scene);
  assert.throws(() => decodeScene(bytes.subarray(0, bytes.length - 3)), /useknutý|zbyly|JSON/);
  assert.throws(() => decodeScene(new Uint8Array([1, 2, 3, 4, 1, 0])), /neznámý formát/);
});

test('pole, která nejsou celá čísla, zůstanou v hlavičce', () => {
  const odd = { cars: [1.5, 2, 3], buildings: [[1, 'x', 2]] };
  assert.deepEqual(decodeScene(encodeScene(odd)), odd);
});
