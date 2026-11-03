// Záznam závodu na obrácené trati: přehrání od začátku, posun, TV kamery i kamera za autem,
// sledování vedoucího, ukončení. Po ukončení musí být auta přesně tam, kde byla před přehráním,
// a výsledky zpět na obrazovce.
// Spuštění: node test/systems-replay.mjs
import { openGame, checker, skipUnderNodeTest } from './systems-harness.mjs';

skipUnderNodeTest();
const t = checker('replay');
const { page, errors, close } = await openGame();

const r = await page.evaluate(async () => {
  const G = window.__game;
  const $ = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  await G.start({ mode: 'race', track: 'kanon', reverse: true, laps: 1, weapons: true, weather: 'dry' });
  G.autopilot(true);
  G.setTimeScale(12);
  const t0 = performance.now();
  while ($('results').hidden && performance.now() - t0 < 180000) await wait(200);
  G.setTimeScale(0); // závod stojí, ať jde porovnat stav aut
  await wait(100);
  const race = G.race;
  const snap = () => race.cars.map((c) => [c.x, c.z, c.hd, c.progress, c.speed]);
  const before = snap();
  const raceTime = race.time;
  $('replay-btn').click();
  const out = { screen: G.screen, duration: G.replay?.duration, raceTime, reversed: G.world.def.reversed };
  G.setTimeScale(4);
  const finite = [];
  const check = (label) => {
    const cam = G.camera.position;
    const car = G.replay.target();
    finite.push([label, Number.isFinite(cam.x + cam.y + cam.z), cam.distanceTo(car.mesh.root.position)]);
  };
  await wait(800);
  check('tv');
  G.replay.seek(G.replay.duration / 2);
  await wait(400);
  check('seek');
  $('rp-cam').querySelector('[data-cam="chase"]').click();
  $('rp-follow').querySelector('[data-follow="leader"]').click();
  await wait(600);
  check('chase-leader');
  out.orderRows = $('rp-order').children.length;
  out.cars = race.cars.length;
  G.replay.seek(G.replay.duration);
  await wait(300);
  out.endPlaying = G.replay.playing;
  G.setTimeScale(0); // po ukončení se závod jinak hned rozjede dál
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }));
  for (let n = 0; n < 100 && G.screen === 'replay'; n++) await wait(50);
  await wait(200);
  const after = snap();
  out.maxDiff = Math.max(...after.flatMap((a, i) => a.map((v, j) => Math.abs(v - before[i][j]))));
  out.back = G.screen;
  out.results = !$('results').hidden;
  out.finite = finite;
  G.setTimeScale(1);
  return out;
});
t.ok(r.screen === 'replay' && r.reversed, `záznam se spustil na obrácené trati (${r.screen})`);
t.ok(Math.abs(r.duration - r.raceTime) < 6, `délka záznamu ${r.duration?.toFixed(1)} s odpovídá závodu (${r.raceTime.toFixed(1)} s + čekání na výsledky)`);
for (const [label, ok, dist] of r.finite) t.ok(ok && dist < 150, `kamera ${label}: platná poloha, ${dist.toFixed(0)} m od sledovaného auta`);
t.ok(r.orderRows === r.cars, `pořadí v přehrávání má všechna auta (${r.orderRows}/${r.cars})`);
t.ok(r.endPlaying === false, 'na konci záznamu se přehrávání zastaví');
t.ok(r.back === 'race' && r.results, `po ukončení zpět výsledky (${r.back})`);
t.ok(r.maxDiff < 1e-9, `auta jsou po přehrání tam, kde byla (rozdíl ${r.maxDiff})`);
const errs = errors.filter((e) => !/Failed to load resource/.test(e));
t.ok(!errs.length, `bez chyb v konzoli ${errs.slice(0, 2).join(' | ')}`);
await close();
t.done();
