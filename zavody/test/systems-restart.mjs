// Restart závodu krátce po startu (Backspace / Restart v pauze) a nový závod po návratu do menu:
// stav z minulého závodu nesmí prosáknout do nového.
// 1) Semafor: po zhasnutí světel běží 2,5 s odpočet G.lightsOff; restart v té době ho nechal
//    běžet a v novém odpočtu pak semafor předčasně zhasl (svítil jen část odpočtu).
// 2) Časovka: náskok/ztráta na ghost (race.ghostDelta) má hned po startu odpovídat skutečnosti,
//    i když minulý závod skončil jinde na trati (dřív se hledalo od staré polohy ghostu).
// Spuštění: node test/systems-restart.mjs
import { openGame, checker, skipUnderNodeTest } from './systems-harness.mjs';

skipUnderNodeTest();
const t = checker('restart');
const { page, errors, close } = await openGame();

const lights = await page.evaluate(async () => {
  const G = window.__game;
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  // pevné snímky po 1/30 s
  let fake = performance.now();
  window.requestAnimationFrame = (cb) => setTimeout(() => cb((fake += 1000 / 30)), 0);
  await G.start({ mode: 'race', track: 'sumava', reverse: false, laps: 2, weapons: false });
  while (G.race.state === 'countdown') await wait(20);
  await wait(200); // pár snímků po startu: světla zhasínají za 2,5 s
  // restart jako klávesou Backspace
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Backspace', key: 'Backspace' }));
  while (!G.race || G.race.time > 0 || G.race.clock > 0.5) await wait(10);
  // stav semaforu během odpočtu nového závodu
  const race = G.race;
  const lit = () => G.world.track.startLights.filter((m) => m.color.r > 1).length;
  const seen = [];
  while (race.state === 'countdown') {
    seen.push([+race.clock.toFixed(2), lit()]);
    await wait(15);
  }
  // po čísle 3 (0,6 s) má svítit aspoň jedno světlo až do startu
  const dark = seen.filter(([c, n]) => c > 0.75 && c < 3.5 && n === 0);
  return { dark: dark.length, first: dark[0], samples: seen.length };
});
t.ok(lights.dark === 0, `po rychlém restartu svítí semafor celý odpočet (${lights.samples} vzorků, tma: ${lights.dark}${lights.first ? ' od ' + lights.first[0] + ' s' : ''})`);

const delta = await page.evaluate(async () => {
  const G = window.__game;
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  await G.toMenu();
  // ghost: rovnoměrná jízda podél středu trati, 30 m/s
  await G.selectTrack('kanon');
  const tr = G.world.track;
  const frames = [];
  for (let k = 0; k < 20 * 60; k++) {
    const p = tr.sampleAt((k / 20) * 30, 0, {});
    frames.push(p.x, p.y, p.z, p.hd);
  }
  localStorage.setItem('turbo-okruh-ghost-kanon', JSON.stringify({ time: 60, rate: 20, frames }));
  // první časovka: dojet do druhé půlky trati, pak zpět do menu
  await G.start({ mode: 'time', track: 'kanon', reverse: false, laps: 2 });
  G.autopilot(true);
  G.setTimeScale(8);
  while (G.race.player.progress < tr.L * 0.55) await wait(50);
  G.setTimeScale(1);
  G.toMenu();
  // druhá časovka: ghostDelta hned po startu proti výpočtu od nuly
  await G.start({ mode: 'time', track: 'kanon', reverse: false, laps: 2 });
  G.autopilot(true);
  G.setTimeScale(2);
  const race = G.race, p = race.player;
  while (race.state !== 'running' || race.time < 1.5) await wait(10);
  const worst = [];
  for (let n = 0; n < 20; n++) {
    await wait(30);
    const g = race.ghostPos;
    if (!g || race.ghostDelta == null) continue;
    const proj = tr.project(g.x, g.z, -1, {});
    let ds = p.proj.s - proj.s;
    if (ds > tr.L / 2) ds -= tr.L;
    else if (ds < -tr.L / 2) ds += tr.L;
    const want = -ds / Math.max(12, p.speed);
    worst.push(Math.abs(want - race.ghostDelta));
  }
  G.setTimeScale(1);
  return { n: worst.length, worst: Math.max(...worst) };
});
t.ok(delta.n > 5 && delta.worst < 0.3, `časovka po předchozí jízdě: rozdíl na ghost odpovídá (${delta.n} vzorků, největší chyba ${delta.worst.toFixed(2)} s)`);
const errs = errors.filter((e) => !/Failed to load resource/.test(e));
t.ok(!errs.length, `bez chyb v konzoli ${errs.slice(0, 2).join(' | ')}`);
await close();
t.done();
