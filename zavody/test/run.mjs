// Test hry v headless Chromiu: měření výkonu na Dobříši a závody autopilotem.
// Spouští se přes `npm test` ve složce zavody (předtím proběhne tools/check-scene.mjs).
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PERF, PERF_POINTS, RACE, RACES } from './limits.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const THREE_DIR = join(ROOT, 'node_modules/three');
const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.169.0/';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
};

const fails = [];
const ok = (cond, msg) => {
  console.log(`${cond ? 'OK  ' : 'CHYBA'} ${msg}`);
  if (!cond) fails.push(msg);
  return cond;
};
const k = (n) => `${Math.round(n / 1000)} tis.`;

// --- statický server bez mezipaměti -----------------------------------------------------

function serve() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = normalize(join(ROOT, path));
    if (file !== ROOT && !file.startsWith(ROOT + sep)) return res.writeHead(403).end();
    if (path.endsWith('/')) file = join(file, 'index.html');
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Cache-Control': 'no-store' }).end();
    }
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

// --- prohlížeč --------------------------------------------------------------------------

async function openGame(origin) {
  let browser;
  try {
    browser = await chromium.launch({
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
    });
  } catch (e) {
    console.error('Chromium pro Playwright chybí, nainstaluj ho: npx playwright install chromium');
    throw e;
  }
  // 16:9 jako běžný monitor (na poměru stran závisí ořez pohledem), menší kvůli rychlosti SwiftShaderu
  const context = await browser.newContext({ viewport: { width: 640, height: 360 }, serviceWorkers: 'block' });
  const errors = [];
  const external = new Set();
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(origin)) return route.continue();
    // three.js z CDN nahradí lokální kopie z npm, písma se vynechají (hra má náhradní)
    if (url.startsWith(THREE_CDN)) {
      const file = normalize(join(THREE_DIR, url.slice(THREE_CDN.length).split('?')[0]));
      if (file.startsWith(THREE_DIR + sep)) {
        try {
          return await route.fulfill({ body: await readFile(file), contentType: 'text/javascript; charset=utf-8' });
        } catch { /* soubor v balíčku není */ }
      }
      errors.push(`three.js: chybí lokálně ${url}`);
      return route.abort();
    }
    if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url)) return route.fulfill({ body: '', contentType: 'text/css' });
    external.add(new URL(url).origin);
    return route.abort();
  });
  // čisté nastavení: kvalita Vysoká (jako na počítači), bez zvuku a bez úvodní nápovědy kláves
  await context.addInitScript(() => {
    if (location.protocol !== 'about:' && !localStorage.getItem('turbo-okruh-v1')) {
      localStorage.setItem('turbo-okruh-v1', JSON.stringify({
        settings: { track: 'dobris', quality: 'high', sound: false, music: false, voice: false, controlsSeen: true, racesStarted: 1 },
      }));
    }
  });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e.stack || e)));
  page.on('requestfailed', (r) => {
    if (r.url().startsWith(origin)) errors.push(`načtení selhalo: ${r.url().slice(origin.length)} (${r.failure()?.errorText})`);
  });
  await page.goto(origin + '/index.html');
  await page.waitForFunction(() => window.__game?.screen === 'menu' && window.__game.world, null, { timeout: 180_000 });
  const gl = await page.evaluate(() => window.__game.renderer.getContext().getParameter(0x1f01));
  console.log(`hra načtená (${gl})`);
  return { browser, page, errors, external };
}

// --- výkon: kamera za autem v bodech podél trati, jedno vykreslení ------------------------

async function measurePerf(page) {
  const rows = await page.evaluate((n) => {
    const G = window.__game;
    const { track, sky } = G.world;
    const cam = G.camera.clone();
    cam.fov = 68;
    cam.aspect = 16 / 9;
    cam.updateProjectionMatrix();
    const a = {}, b = {}, c = {};
    const out = [];
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) * (track.L / n);
      // auto stojí na ose v s; kamera jako v pohledu zezadu: 7 m za ním, 2,7 m nad ním, dívá se 3,5 m před auto
      track.sampleAt(s, 0, a);
      track.sampleAt(s - 7, 0, b);
      track.sampleAt(s + 3.5, 0, c);
      cam.position.set(b.x, Math.max(a.y + 2.7, b.y + 1.2), b.z);
      cam.lookAt(c.x, c.y + 1.15, c.z);
      cam.updateMatrixWorld();
      G.aimSun(a.x, a.y, a.z);
      sky.position.copy(cam.position);
      G.renderer.info.reset();
      G.renderer.render(G.scene, cam);
      out.push({ s: Math.round(s), calls: G.renderer.info.render.calls, triangles: G.renderer.info.render.triangles });
    }
    return out;
  }, PERF_POINTS);
  const avg = (key) => rows.reduce((t, r) => t + r[key], 0) / rows.length;
  const top = (key) => rows.reduce((m, r) => (r[key] > m[key] ? r : m));
  const res = {
    avgCalls: avg('calls'), avgTriangles: avg('triangles'),
    maxCalls: top('calls').calls, maxCallsAt: top('calls').s,
    maxTriangles: top('triangles').triangles, maxTrianglesAt: top('triangles').s,
    points: rows,
  };
  ok(res.avgCalls <= PERF.avgCalls && res.avgTriangles <= PERF.avgTriangles,
    `výkon Dobříš, průměr: ${Math.round(res.avgCalls)} volání (limit ${PERF.avgCalls}), ${k(res.avgTriangles)} trojúhelníků (limit ${k(PERF.avgTriangles)})`);
  ok(res.maxCalls <= PERF.maxCalls && res.maxTriangles <= PERF.maxTriangles,
    `výkon Dobříš, maximum: ${res.maxCalls} volání v ${res.maxCallsAt} m (limit ${PERF.maxCalls}), ${k(res.maxTriangles)} trojúhelníků v ${res.maxTrianglesAt} m (limit ${k(PERF.maxTriangles)})`);
  return res;
}

// --- závod autopilotem --------------------------------------------------------------------

async function runRace(page, { track, reverse }) {
  const t0 = Date.now();
  const info = await page.evaluate(async ({ track, reverse, laps }) => {
    const G = window.__game;
    await G.start({ track, reverse, mode: 'race', laps, weapons: false, players: 1 });
    G.autopilot(true);
    return { name: G.world.def.name, L: G.world.track.L, cars: G.race.cars.length };
  }, { track, reverse, laps: RACE.laps });
  await page.evaluate((v) => window.__game.setTimeScale(v), RACE.timeScale);
  const limit = (RACE.laps * info.L) / (RACE.slowestKmh / 3.6) + 10;
  let state;
  for (;;) {
    state = await page.evaluate(() => {
      const r = window.__game.race;
      return {
        time: r.time, state: r.state, laps: r.laps,
        cars: r.cars.map((c) => ({ name: c.name, player: c.isPlayer, finished: c.finished, best: c.bestLap, finish: c.finishTime, lap: c.lap })),
      };
    });
    if (state.cars.every((c) => c.finished) || state.time > limit) break;
    await page.waitForTimeout(500);
  }
  await page.evaluate(() => window.__game.setTimeScale(1));
  const label = `${info.name}, ${state.laps} kola`;
  const stuck = state.cars.filter((c) => !c.finished).map((c) => `${c.name} (kolo ${c.lap})`);
  ok(!stuck.length, `${label}: dojelo ${state.cars.length - stuck.length}/${state.cars.length} aut za ${state.time.toFixed(0)} s hry${stuck.length ? `, nedojeli: ${stuck.join(', ')}` : ''}`);
  const p = state.cars.find((c) => c.player);
  const kmh = Number.isFinite(p.best) ? (info.L / p.best) * 3.6 : 0;
  ok(kmh >= RACE.lapSpeed.min && kmh <= RACE.lapSpeed.max,
    `${label}: nejlepší kolo hráče ${Number.isFinite(p.best) ? p.best.toFixed(2) + ' s' : '–'}, ${(info.L / 1000).toFixed(2)} km, průměr ${kmh.toFixed(0)} km/h (rozmezí ${RACE.lapSpeed.min}–${RACE.lapSpeed.max}), ${((Date.now() - t0) / 1000).toFixed(0)} s skutečného času`);
  await page.evaluate(() => window.__game.toMenu());
  return { track, reverse, length: info.L, time: state.time, cars: state.cars };
}

// --- běh ----------------------------------------------------------------------------------

const server = await serve();
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const report = {};
try {
  const game = await openGame(origin);
  browser = game.browser;
  report.perf = await measurePerf(game.page);
  report.races = [];
  for (const r of RACES) report.races.push(await runRace(game.page, r));
  report.errors = game.errors;
  ok(!game.errors.length, `chyby v konzoli: ${game.errors.length}${game.errors.length ? '\n  ' + game.errors.slice(0, 10).join('\n  ') : ''}`);
  if (game.external.size) console.log(`pozn.: zablokované vnější požadavky ${[...game.external].join(', ')}`);
} catch (e) {
  ok(false, `test spadl: ${e.message}`);
} finally {
  await browser?.close();
  server.close();
}
await mkdir(join(ROOT, 'test/out'), { recursive: true });
await writeFile(join(ROOT, 'test/out/vysledek.json'), JSON.stringify(report, null, 1));
console.log(fails.length ? `\n${fails.length} ${fails.length === 1 ? 'chyba' : fails.length < 5 ? 'chyby' : 'chyb'}` : '\nhra v pořádku');
process.exit(fails.length ? 1 : 0);
