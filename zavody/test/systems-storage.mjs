// Poškozené nebo cizí uložení v localStorage: hra musí naběhnout do menu, odjet závod
// a ukázat výsledky (uložení rekordů nesmí spadnout). Každý případ = nové načtení stránky.
// Spuštění: node test/systems-storage.mjs
import { openGame, checker, skipUnderNodeTest } from './systems-harness.mjs';

skipUnderNodeTest();
const t = checker('storage');
const MAIN = 'turbo-okruh-v1';
const base = { quality: 'low', controlsSeen: true, racesStarted: 1 };
const frames = [];
for (let i = 0; i < 400; i++) frames.push(i, 0.5, i, 0);

const CASES = [
  { name: 'nečitelný JSON', storage: { [MAIN]: '{oops' } },
  { name: 'kořen je pole', storage: { [MAIN]: '[1,2,3]' } },
  { name: 'kořen je číslo', storage: { [MAIN]: '42' } },
  { name: 'záznamy, sezóna a nastavení nejsou objekty', storage: { [MAIN]: JSON.stringify({ settings: 'x', records: 'x', season: 'x', custom: {} }) } },
  { name: 'záznam trati je číslo', storage: { [MAIN]: JSON.stringify({ settings: base, records: { sumava: 5 } }) } },
  { name: 'sezóna.done je text', storage: { [MAIN]: JSON.stringify({ settings: { ...base, mode: 'season', seasonEvent: 's1' }, season: { done: 'x' } }) }, mode: 'season' },
  { name: 'neznámé hodnoty nastavení', storage: { [MAIN]: JSON.stringify({ settings: { ...base, difficulty: 'nesmysl', mode: 'nesmysl', track: 'neexistuje', vehicle: 'tank', keys: 'x', cup: 'zadny', seasonEvent: 's99' } }) } },
  { name: 'ghost: snímky jako text', storage: { [MAIN]: JSON.stringify({ settings: base }), 'turbo-okruh-ghost-sumava': JSON.stringify({ time: 30, rate: 20, frames: 'abcdefghijklmnopqrstuvwxyz' }) }, mode: 'time' },
  { name: 'ghost: bez frekvence', storage: { [MAIN]: JSON.stringify({ settings: base }), 'turbo-okruh-ghost-sumava': JSON.stringify({ time: 30, frames }) }, mode: 'time' },
  { name: 'sdílený ghost: nečitelný', storage: { [MAIN]: JSON.stringify({ settings: base }), 'turbo-okruh-sghost-sumava': '{oops' }, mode: 'time' },
  { name: 'mezipaměť medailí: nesmysl', storage: { [MAIN]: JSON.stringify({ settings: base }), 'turbo-okruh-ref': '{"v":4,"x":1}' } },
];

// jen vybrané případy: CASE=část názvu
const only = process.env.CASE;
const ignore = (e) => /Failed to load resource/.test(e);
for (const c of CASES.filter((c) => !only || c.name.includes(only))) {
  let game;
  try {
    game = await openGame({ storage: c.storage, quality: null });
  } catch (e) {
    t.ok(false, `${c.name}: hra nenaběhla do menu (${e.message.split('\n')[0]})`);
    continue;
  }
  const { page, errors, close } = game;
  const r = await page.evaluate(async (mode) => {
    const G = window.__game;
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const opts = mode === 'season' ? { mode } : { mode: mode || 'race', track: 'sumava', reverse: false, laps: 1, weapons: false };
    await G.start(opts);
    if (!G.race) return { error: 'závod se nespustil' };
    G.autopilot(true);
    G.setTimeScale(12);
    const t0 = performance.now();
    while (document.getElementById('results').hidden && performance.now() - t0 < 180000) await wait(250);
    G.setTimeScale(1);
    const p = G.race.player;
    const ghostOk = !G.ghost || !G.ghostMesh || [G.ghostMesh.root.position.x, G.ghostMesh.root.position.z].every(Number.isFinite);
    return { results: !document.getElementById('results').hidden, laps: G.race.laps, lap: p.lap, ghostOk, title: document.getElementById('res-title').textContent };
  }, c.mode).catch((e) => ({ error: e.message }));
  const errs = errors.filter((e) => !ignore(e));
  if (r.error) t.ok(false, `${c.name}: ${r.error}`);
  else t.ok(r.results && r.ghostOk && !errs.length, `${c.name}: výsledky ${r.results ? 'ukázány' : 'CHYBÍ'} („${r.title}“, ${r.lap}/${r.laps} kol)${r.ghostOk ? '' : ', ghost na NaN'}${errs.length ? ' · ' + errs[0].split('\n')[0] : ''}`);
  await close();
}
t.done();
