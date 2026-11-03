// Uložení (store.js) a sezóna (season.js) bez prohlížeče, s náhradou localStorage:
// poškozené nebo cizí hodnoty v uložení nesmí shodit ukládání rekordů ani hvězd.
// Spuštění: node --test test/systems-store.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
const { Store } = await import('../js/store.js');
const { submitEvent, eventStars, totalStars } = await import('../js/season.js');
const KEY = 'turbo-okruh-v1';

beforeEach(() => mem.clear());

// po načtení musí jít uložit kolo, závod, sektor i hvězdy a výsledek přežít nové načtení
function roundTrip() {
  const s = new Store();
  assert.equal(typeof s.settings.laps, 'number');
  assert.deepEqual(s.submit('sumava', { lap: 40, race: 130, laps: 3, mode: 'race' }), { lap: true, race: true });
  assert.equal(s.submitSector('sumava', 'car', 1, 12.5).better, true);
  submitEvent(s, 's1', 0b101);
  const again = new Store();
  assert.equal(again.record('sumava').lap, 40);
  assert.equal(again.record('sumava').race[3], 130);
  assert.equal(again.record('sumava').sectors[1], 12.5);
  assert.equal(eventStars(again, 's1'), 2);
  assert.equal(totalStars(again), 2);
}

const CASES = {
  'nic uloženo': null,
  'nečitelný JSON': '{oops',
  'kořen je pole': '[1,2,3]',
  'kořen je číslo': '42',
  'části nejsou objekty': JSON.stringify({ settings: 'x', records: 'x', season: 'x', custom: {} }),
  'záznam trati je číslo': JSON.stringify({ records: { sumava: 5 } }),
  'závody a sektory jiného typu': JSON.stringify({ records: { sumava: { lap: 50, race: 'x', sectors: 3 } } }),
  'sezóna.done je text': JSON.stringify({ season: { done: 'x' } }),
  'vlastní tratě s nesmysly': JSON.stringify({ custom: [null, 5, { id: 'custom-a', name: 'A' }] }),
};
for (const [name, raw] of Object.entries(CASES)) {
  test(`uložení: ${name}`, () => {
    if (raw != null) mem.set(KEY, raw);
    roundTrip();
  });
}

test('vlastní tratě: přežijí jen položky s id', () => {
  mem.set(KEY, CASES['vlastní tratě s nesmysly']);
  const s = new Store();
  assert.deepEqual(s.custom.map((t) => t.id), ['custom-a']);
  assert.equal(s.getCustom('custom-a').name, 'A');
});

test('starší uložení: rekord auta pod holým id trati, ostatní vozy s @typ', () => {
  mem.set(KEY, JSON.stringify({ settings: { color: 2 }, records: { kanon: { lap: 51.2, race: { 3: 160 } } } }));
  const s = new Store();
  assert.equal(s.settings.color, 2);
  assert.equal(s.record('kanon', 'car').lap, 51.2);
  assert.deepEqual(s.record('kanon', 'formula'), {});
  s.submit('kanon', { lap: 49, laps: 3, mode: 'time' }, 'formula');
  assert.equal(new Store().records['kanon@formula'].lap, 49);
  assert.equal(new Store().record('kanon').lap, 51.2);
});
