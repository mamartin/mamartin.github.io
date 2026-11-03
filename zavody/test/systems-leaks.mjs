// Úniky geometrií, textur a shaderů při opakovaném načtení trati a opakovaných závodech.
// Po každém kole přepínání se vrací na stejnou trať a stejné počasí, počty v G.info() (živé
// geometrie a textury na GPU) se po zahřátí nesmí zvyšovat. G.info() počítá jen to, co už se
// vykreslilo, a kamera v menu obíhá, proto tolerance ±3 (únik při každém načtení by dal +18 za kolo).
// Spuštění: node test/systems-leaks.mjs
import { openGame, checker, skipUnderNodeTest } from './systems-harness.mjs';

skipUnderNodeTest();
const t = checker('leaks');
const { page, errors, close } = await openGame();

const snap = () => page.evaluate(() => {
  const G = window.__game;
  const i = G.info();
  return { g: i.geometries, t: i.textures, p: G.renderer.info.programs?.length ?? 0 };
});
const settle = () => page.waitForTimeout(400);

// 1) přepínání tratí (různé biomy, město s daty, noční/zimní) a počasí, vždy zpět na Šumavu
const tracks = ['kanon', 'mesto', 'serpentiny', 'dobris', 'daily', 'random'];
const rounds = [];
for (let k = 0; k < 5; k++) {
  for (const weather of ['dry', 'rain', 'mix']) {
    for (const id of tracks) {
      await page.evaluate(([id, weather]) => {
        window.__game.store.settings.weather = weather;
        return window.__game.selectTrack(id, true);
      }, [id, weather]);
    }
  }
  await page.evaluate(() => {
    window.__game.store.settings.weather = 'dry';
    return window.__game.selectTrack('sumava', true);
  });
  await settle();
  rounds.push(await snap());
}
console.log('menu po kolech přepínání:', rounds.map((r) => `g${r.g} t${r.t} p${r.p}`).join(' | '));
const [, second, , , last] = rounds;
t.ok(last.g <= second.g + 3 && last.t <= second.t + 3, `5× přepnutí 18 variant tratí: geometrie ${second.g}→${last.g}, textury ${second.t}→${last.t}`);
t.ok(last.p <= second.p + 2, `shadery se nehromadí: ${second.p}→${last.p}`);

// 2) závody s power-upy a poškozením, návrat do menu uprostřed i restart
const races = [];
for (let k = 0; k < 5; k++) {
  await page.evaluate(async () => {
    const G = window.__game;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await G.start({ mode: 'race', track: 'mesto', weapons: true, weather: 'mix', laps: 2 });
    G.autopilot(true);
    G.setTimeScale(8);
    await wait(1500);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Backspace', key: 'Backspace' }));
    await wait(200);
    while (G.starting) await wait(50);
    G.autopilot(true);
    await wait(1500);
    G.setTimeScale(1);
    G.toMenu();
    G.store.settings.weather = 'dry';
    await G.selectTrack('sumava', true);
  });
  await settle();
  races.push(await snap());
}
console.log('menu po závodech:', races.map((r) => `g${r.g} t${r.t} p${r.p}`).join(' | '));
t.ok(races[4].g <= races[1].g + 3 && races[4].t <= races[1].t + 3, `5× závod + restart + menu: geometrie ${races[1].g}→${races[4].g}, textury ${races[1].t}→${races[4].t}`);
const errs = errors.filter((e) => !/Failed to load resource/.test(e));
t.ok(!errs.length, `bez chyb v konzoli ${errs.slice(0, 2).join(' | ')}`);
await close();
t.done();
