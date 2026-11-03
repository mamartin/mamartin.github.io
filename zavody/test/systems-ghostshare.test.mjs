// Sdílený ghost (#g=...): platný odkaz se přečte beze ztrát, upravený nebo poškozený odkaz
// skončí chybou (hra pak napíše „Odkaz na ghost se nepodařilo přečíst“) a jméno je jen text.
// Spuštění: node --test test/systems-ghostshare.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeGhost, decodeGhost } from '../js/ghostshare.js';

const frames = [];
for (let i = 0; i < 100; i++) frames.push(i * 2.5, 1, -i, 0.01 * i);
const code = await encodeGhost('sumava~r', 'car', 'Ája', { time: 41.234, rate: 20, frames });
const data = code.split('.')[1];
const head = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

test('platný odkaz (i obrácený směr) projde beze změny', async () => {
  const d = await decodeGhost(code);
  assert.equal(d.trackId, 'sumava~r');
  assert.equal(d.name, 'Ája');
  assert.equal(d.ghost.time, 41.234);
  assert.equal(d.ghost.rate, 20);
  assert.deepEqual(d.ghost.frames.slice(-4), [247.5, 1, -99, 0.99]);
});

test('bez jména je to Kamarád, jméno je oříznutý text', async () => {
  assert.equal((await decodeGhost(`${head({ t: 'sumava', ms: 40000, r: 20 })}.${data}`)).name, 'Kamarád');
  assert.equal((await decodeGhost(`${head({ t: 'sumava', n: { a: 1 }, ms: 40000 })}.${data}`)).name, 'Kamarád');
  const long = (await decodeGhost(`${head({ t: 'sumava', n: 'x'.repeat(500), ms: 40000 })}.${data}`)).name;
  assert.equal(long.length, 40);
});

const bad = {
  'bez času kola': { t: 'sumava', n: 'X', r: 20 },
  'záporný čas': { t: 'sumava', n: 'X', ms: -5, r: 20 },
  'čas jako text': { t: 'sumava', n: 'X', ms: 'abc', r: 20 },
  'nesmyslná frekvence': { t: 'sumava', n: 'X', ms: 40000, r: 1e9 },
  'záporná frekvence': { t: 'sumava', n: 'X', ms: 40000, r: -20 },
  'hlavička je pole': [1, 2],
  'hlavička je null': null,
  'trať není text': { t: 5, ms: 40000 },
};
for (const [name, h] of Object.entries(bad)) {
  test(`odmítne: ${name}`, async () => {
    await assert.rejects(decodeGhost(`${head(h)}.${data}`));
  });
}

test('odmítne odkaz bez dat a s rozbitými daty', async () => {
  await assert.rejects(decodeGhost(head({ t: 'sumava', ms: 40000 })));
  await assert.rejects(decodeGhost(`${head({ t: 'sumava', ms: 40000 })}.rAAAA`));
  await assert.rejects(decodeGhost(`${head({ t: 'sumava', ms: 40000 })}.zAAAAAAAA`));
});
