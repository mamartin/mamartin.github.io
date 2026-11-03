// Cena vykreslování trati podle skutečného města v headless Chromiu (WebGL přes SwiftShader).
// Kamera stojí za autem v každém bodě trati (krok STEP m), pro každý bod jeden renderer.render
// s vynulovaným renderer.info; vypíše průměr a maximum volání kreslení a trojúhelníků.
//
//   node zavody/test/perf-lod.mjs                        vysoká a nízká kvalita
//   node zavody/test/perf-lod.mjs --quality high,medium,low --track dobris --step 10
//   node zavody/test/perf-lod.mjs --race                 navíc závod autopilotem: 2 kola tam i zpět
//   node zavody/test/perf-lod.mjs --shots out/           snímky zblízka a zdálky do složky
//   node zavody/test/perf-lod.mjs --breakdown            průměr volání a trojúhelníků po částech scény
//
// three.js se bere z node_modules (nebo ze složky v THREE_DIR), CDN se tak nemusí stahovat.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Playwright z node_modules projektu, jinak globální instalace (require zná NODE_PATH, import ne)
const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const QUALITIES = opt('quality', 'high,low').split(',');
const TRACK = opt('track', 'dobris');
const STEP = Number(opt('step', 10));
const SHOTS = opt('shots', null);
const RACE = args.includes('--race');
const BREAKDOWN = args.includes('--breakdown');

function threeDir() {
  if (process.env.THREE_DIR) return process.env.THREE_DIR;
  for (const from of [join(ROOT, 'test/'), join(ROOT, 'tools/'), process.cwd() + '/']) {
    try {
      return dirname(createRequire(from).resolve('three/package.json'));
    } catch { /* další místo */ }
  }
  return null;
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(ROOT, path.endsWith('/') ? path + 'index.html' : path);
  if (!file.startsWith(ROOT) || !existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(await readFile(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function openGame(settings, viewport = { width: 960, height: 540 }) {
  // service worker by podstrčil starou verzi souborů
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  const three = threeDir();
  if (three) {
    await context.route(/cdn\.jsdelivr\.net\/npm\/three@[^/]+\//, async (route) => {
      const rel = new URL(route.request().url()).pathname.replace(/^\/npm\/three@[^/]+\//, '');
      const file = join(three, rel);
      if (!existsSync(file)) return route.fulfill({ status: 404 });
      route.fulfill({ status: 200, contentType: 'text/javascript', body: await readFile(file) });
    });
  }
  // písma nejsou k měření potřeba (a v uzavřené síti by jen hlásila chybu)
  await context.route(/fonts\.googleapis\.com/, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.addInitScript((s) => {
    if (location.protocol === 'http:') localStorage.setItem('turbo-okruh-v1', JSON.stringify({ settings: s }));
  }, settings);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base + 'index.html');
  await page.waitForFunction(() => (window.__game?.screen === 'menu' && window.__game.world) || !document.getElementById('error').hidden, null, { timeout: 180000 });
  if (!(await page.evaluate(() => document.getElementById('error').hidden))) throw new Error(`hra se nenačetla: ${errors.join(' | ')}`);
  return { page, context, errors };
}

// kamera za autem jako v honičce: 6,8 m za, 2,6 m nad, pohled 3,5 m před auto
async function measure(page, step, shots, breakdown) {
  return page.evaluate(async ({ step, shots, breakdown }) => {
    const G = window.__game;
    const { renderer, scene, camera } = G;
    const w = G.world, t = w.track;
    const sun = w.lights.sun;
    const every = Math.max(1, Math.round(step / t.step));
    const calls = [], tris = [], ms = [];
    const place = (k, back = 6.8, up = 2.6) => {
      const hd = t.hd[k], s = Math.sin(hd), c = Math.cos(hd);
      const x = t.px[k], y = t.py[k], z = t.pz[k];
      camera.position.set(x - s * back, y + up, z - c * back);
      camera.lookAt(x + s * 3.5, y + 1.15, z + c * 3.5);
      camera.updateMatrixWorld();
      sun.target.position.set(x, y, z);
      sun.position.set(x, y, z).addScaledVector(sun.userData.dir, 260);
      w.sky.position.copy(camera.position);
      w.lod?.(camera);
    };
    // rozpad podle pojmenované skupiny (u města podle jeho části), stínový průchod zvlášť
    const parts = new Map();
    if (breakdown) {
      const orig = renderer.renderBufferDirect.bind(renderer);
      renderer.renderBufferDirect = (cam, sc, geo, mat, obj, grp) => {
        let o = obj, label = obj.name || obj.type;
        while (o) {
          if (o.name && o.parent?.name === 'town') { label = 'town/' + o.name; break; }
          if (o.name === 'town') { label = 'town/domy'; break; }
          if (o.name && o.parent === w.group) { label = o.name; break; }
          if (o.parent === scene) { label = 'mimo trať/' + (o.name || o.type); break; }
          o = o.parent;
        }
        if (mat.isMeshDepthMaterial || mat.isMeshDistanceMaterial) label += ' (stín)';
        const before = renderer.info.render.triangles, c0 = renderer.info.render.calls;
        orig(cam, sc, geo, mat, obj, grp);
        const e = parts.get(label) ?? { calls: 0, tris: 0 };
        e.calls += renderer.info.render.calls - c0;
        e.tris += renderer.info.render.triangles - before;
        parts.set(label, e);
      };
    }
    // auta na roštu v menu nepatří k trati (v závodě jsou u hráče), měření by jen rozmazala
    for (const c of w.showcase) c.mesh.root.visible = false;
    camera.fov = 66;
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    for (let k = 0; k < t.N; k += every) {
      place(k);
      renderer.info.reset();
      const t0 = performance.now();
      renderer.render(scene, camera);
      ms.push(performance.now() - t0);
      calls.push(renderer.info.render.calls);
      tris.push(renderer.info.render.triangles);
    }
    const stat = (a) => ({ avg: Math.round(a.reduce((s, v) => s + v, 0) / a.length), max: Math.max(...a) });
    const out = { points: calls.length, calls: stat(calls), tris: stat(tris), ms: stat(ms) };
    if (breakdown) {
      out.parts = [...parts].sort((a, b) => b[1].calls - a[1].calls)
        .map(([k, v]) => ({ part: k, calls: +(v.calls / calls.length).toFixed(1), tris: Math.round(v.tris / calls.length) }));
    }
    if (shots) {
      out.shots = [];
      // zblízka za autem na náměstí a u zámku, zdálky z nadhledu nad městem
      for (const [name, frac, back, up] of [['blizko-namesti', 0.93, 6.8, 2.6], ['blizko-zamek', 0.12, 6.8, 2.6], ['dalka-pohled', 0.3, 60, 45]]) {
        place(Math.floor(frac * t.N), back, up);
        renderer.render(scene, camera);
        out.shots.push({ name, url: renderer.domElement.toDataURL('image/png') });
      }
    }
    return out;
  }, { step, shots, breakdown });
}

const results = [];
for (const quality of QUALITIES) {
  const viewport = SHOTS ? { width: 1280, height: 720 } : undefined;
  const { page, context, errors } = await openGame({ quality, track: TRACK, laps: 2 }, viewport);
  // ať se během měření nic jiného nekreslí
  await page.evaluate(() => (window.__game.screen = 'editor'));
  const r = await measure(page, STEP, !!SHOTS, BREAKDOWN);
  if (SHOTS) {
    await mkdir(SHOTS, { recursive: true });
    const { writeFile } = await import('node:fs/promises');
    for (const s of r.shots) await writeFile(join(SHOTS, `${quality}-${s.name}.png`), Buffer.from(s.url.split(',')[1], 'base64'));
    delete r.shots;
  }
  results.push({ quality, ...r, errors: errors.length });
  console.log(`${quality.padEnd(7)} bodů ${r.points}  volání ø ${r.calls.avg} / max ${r.calls.max}  trojúhelníků ø ${(r.tris.avg / 1000).toFixed(0)} tis. / max ${(r.tris.max / 1000).toFixed(0)} tis.  CPU ø ${r.ms.avg} ms${errors.length ? `  CHYBY: ${errors.join(' | ')}` : ''}`);
  if (r.parts) for (const p of r.parts) console.log(`        ${p.part.padEnd(28)} ø ${String(p.calls).padStart(6)} volání  ${String(p.tris).padStart(8)} trojúhelníků`);
  await context.close();
}

let failed = results.some((r) => r.errors);
if (RACE) {
  for (const reverse of [false, true]) {
    const { page, context, errors } = await openGame({ quality: 'low', track: TRACK, laps: 2, reverse, mode: 'race', difficulty: 'medium' });
    await page.evaluate(() => window.__game.start());
    await page.waitForFunction(() => window.__game.race, null, { timeout: 60000 });
    await page.evaluate(() => {
      window.__game.autopilot(true);
      window.__game.setTimeScale(8);
    });
    const t0 = Date.now();
    const state = await page.waitForFunction(() => {
      const r = window.__game.race;
      return r && r.player.finished && { time: r.time, lap: r.player.lap };
    }, null, { timeout: 900000, polling: 1000 }).then((h) => h.jsonValue()).catch(() => null);
    const ok = !!state && !errors.length;
    failed ||= !ok;
    console.log(`závod ${reverse ? 'zpět' : 'tam '}: ${state ? `dojel za ${state.time.toFixed(1)} s herního času (${((Date.now() - t0) / 1000).toFixed(0)} s)` : 'NEDOJEL'}${errors.length ? `  CHYBY: ${errors.join(' | ')}` : '  bez chyb v konzoli'}`);
    await context.close();
  }
}

await browser.close();
server.close();
process.exit(failed ? 1 : 0);
