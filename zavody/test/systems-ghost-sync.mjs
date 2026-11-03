// Ghost má v čase t od startu kola stát tam, kde v tom čase bylo auto při záznamu.
// Časovka s autopilotem: zapamatuje se skutečná dráha auta ve 2. kole a po jeho dojetí se
// porovná s uloženým ghostem. Snímky po 0,1 s a po 0,6 s herního času (pomalé zařízení se
// zrychlením 6×), tedy 12 a 72 kroků fyziky v jednom snímku.
// Spuštění: node test/systems-ghost-sync.mjs
import { openGame, checker, skipUnderNodeTest } from './systems-harness.mjs';

skipUnderNodeTest();

const t = checker('ghost-sync');

for (const fps of [60, 10]) {
  const label = `snímek ${((6 / fps)).toFixed(1).replace('.', ',')} s`;
  const { page, errors, close } = await openGame();
  const res = await page.evaluate(async (fps) => {
    const G = window.__game;
    localStorage.removeItem('turbo-okruh-ghost-sumava');
    await G.start({ mode: 'time', track: 'sumava', reverse: false, laps: 3, weather: 'dry' });
    G.autopilot(true);
    const race = G.race, p = race.player;
    // skutečná dráha ve 2. kole po krocích fyziky
    const path = [];
    const step = race.step.bind(race);
    race.step = (dt, c) => {
      step(dt, c);
      if (p.lap === 1) path.push([race.time - p.lapStart, p.x, p.z]);
    };
    // pomalé zařízení: herní smyčka dostává delší snímky (rawDt je ve hře omezené na 0,1 s)
    // snímky s pevnou délkou 1/fps s (zrychlené 6×), nezávisle na rychlosti SwiftShaderu
    G.setTimeScale(6);
    let fake = performance.now();
    window.requestAnimationFrame = (cb) => setTimeout(() => cb((fake += 1000 / fps)), 0);
    const t0 = performance.now();
    while (p.lap < 2 && performance.now() - t0 < 240000) await new Promise((r) => setTimeout(r, 200));
    G.setTimeScale(0);
    const data = JSON.parse(localStorage.getItem('turbo-okruh-ghost-sumava') || 'null');
    if (!data || p.lap < 2) return { error: 'kolo nedojeto' };
    // ghost odpovídá 2. kolu (letmé kolo je rychlejší než první se startem z místa)
    const lap2 = p.lapTimes[1];
    const f = data.frames, rate = data.rate;
    const at = (tt) => {
      const pos = tt * rate, i = Math.floor(pos), u = pos - i;
      if (i + 1 >= f.length / 4) return null;
      return [f[i * 4] + (f[i * 4 + 4] - f[i * 4]) * u, f[i * 4 + 2] + (f[i * 4 + 6] - f[i * 4 + 2]) * u];
    };
    let worst = 0;
    for (const [tt, x, z] of path) {
      if (tt > lap2 - 0.2) break;
      const g = at(tt);
      if (g) worst = Math.max(worst, Math.hypot(g[0] - x, g[1] - z));
    }
    return { lap2, ghostTime: data.time, worst, samples: path.length };
  }, fps);
  if (res.error) {
    t.ok(false, `${label}: ${res.error}`);
    await close();
    continue;
  }
  t.ok(Math.abs(res.ghostTime - res.lap2) < 1e-6, `${label}: uložený ghost je 2. kolo (${res.lap2.toFixed(3)} s)`);
  t.ok(res.worst < 0.6, `${label}: ghost se od skutečné dráhy liší nejvýš ${res.worst.toFixed(2)} m (limit 0,6 m)`);
  const errs = errors.filter((e) => !/Failed to load resource/.test(e));
  t.ok(!errs.length, `${label}: bez chyb v konzoli ${errs.slice(0, 2).join(' | ')}`);
  await close();
}
t.done();
