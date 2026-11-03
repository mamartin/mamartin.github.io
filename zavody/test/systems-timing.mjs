// Časování herní smyčky: velké zrychlení (G.setTimeScale) nesmí po návratu na 1× nechat
// nahromaděný dluh kroků fyziky. Dřív smyčka udělala nejvýš 1200 kroků za snímek a zbytek
// G.acc rostl dál: po přepnutí zpět hra ještě dlouho běžela zrychleně a vykreslení aut
// extrapolovalo daleko před skutečnou polohu (alpha = G.acc / STEP ≫ 1).
// Spuštění: node test/systems-timing.mjs
import { openGame, checker, skipUnderNodeTest } from './systems-harness.mjs';

skipUnderNodeTest();
const t = checker('timing');
const { page, errors, close } = await openGame();

const r = await page.evaluate(async () => {
  const G = window.__game;
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  await G.start({ mode: 'race', track: 'sumava', weapons: false });
  G.autopilot(true);
  // pevné snímky po 0,1 s, nezávisle na rychlosti SwiftShaderu
  let fake = performance.now();
  window.requestAnimationFrame = (cb) => setTimeout(() => cb((fake += 100)), 0);
  G.setTimeScale(300); // 30 s herního času na snímek, víc než 1200 kroků po 1/120 s
  await wait(1500);
  G.setTimeScale(1);
  await wait(300); // pár snímků na uklidnění
  const race = G.race, p = race.player;
  const t0 = race.time, f0 = fake;
  await wait(1500);
  const game = race.time - t0, real = (fake - f0) / 1000;
  // vykreslená poloha auta má ležet mezi polohou z minulého a z posledního kroku
  const m = p.mesh.root.position;
  const seg = Math.hypot(p.x - p.px, p.z - p.pz);
  const off = Math.min(Math.hypot(m.x - p.x, m.z - p.z), Math.hypot(m.x - p.px, m.z - p.pz));
  return { acc: G.acc, game, real, seg, renderOff: Math.hypot(m.x - p.x, m.z - p.z), off, state: race.state };
});
t.ok(r.acc < 1 / 120 + 1e-9, `po zpomalení zpět na 1× nezůstal dluh kroků (G.acc = ${r.acc.toFixed(3)} s)`);
t.ok(Math.abs(r.game - r.real) < 0.25, `na 1× běží závod reálným časem (${r.game.toFixed(2)} s hry za ${r.real.toFixed(2)} s)`);
t.ok(r.renderOff <= r.seg + 0.01, `vykreslené auto je mezi posledními dvěma kroky (odchylka ${r.renderOff.toFixed(2)} m, krok ${r.seg.toFixed(2)} m)`);
const errs = errors.filter((e) => !/Failed to load resource/.test(e));
t.ok(!errs.length, `bez chyb v konzoli ${errs.slice(0, 2).join(' | ')}`);
await close();
t.done();
