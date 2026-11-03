// Společný základ reprodukčních skriptů herních systémů (soubory systems-*.mjs):
// statický server nad zavody/, headless Chromium s WebGL přes SwiftShader a three.js z npm
// místo CDN (když je síť zavřená). Spuštění: `node test/systems-<oblast>.mjs` ze složky zavody/.
//
// three.js hledá v THREE_DIR, jinak v node_modules/three (zavody/, zavody/test/ nebo aktuální složka);
// když ho nenajde, nechá načíst CDN. Playwright stačí globální (require('playwright')).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.bin': 'application/octet-stream' };

function findThree() {
  const cands = [process.env.THREE_DIR, join(ROOT, 'node_modules/three'), join(ROOT, 'test/node_modules/three'), join(process.cwd(), 'node_modules/three')];
  return cands.find((d) => d && existsSync(join(d, 'build/three.module.min.js'))) || null;
}

function loadPlaywright() {
  const req = createRequire(join(process.cwd(), 'x.js'));
  try {
    return req('playwright');
  } catch {
    return createRequire(import.meta.url)('playwright');
  }
}

function serve() {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = join(ROOT, path.endsWith('/') ? path + 'index.html' : path);
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

// prohlížečové skripty jsou ruční reprodukce; pod `node --test` (hromadné testy) se přeskočí,
// pokud je nespustí ZAVODY_BROWSER=1
export function skipUnderNodeTest() {
  if (process.env.NODE_TEST_CONTEXT && !process.env.ZAVODY_BROWSER) {
    console.log('přeskočeno (prohlížečová reprodukce, spusť přímo: node test/<soubor>)');
    process.exit(0);
  }
}

// otevře hru a počká na menu; storage = obsah localStorage před startem (klíč → řetězec)
export async function openGame({ storage = {}, hash = '', viewport = { width: 960, height: 540 }, quality = 'low' } = {}) {
  const server = await serve();
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const three = findThree();
  if (three) {
    await page.route(/cdn\.jsdelivr\.net\/npm\/three@[^/]+\/(.*)$/, async (route) => {
      const rel = /three@[^/]+\/(.*)$/.exec(route.request().url())[1];
      try {
        route.fulfill({ status: 200, contentType: 'text/javascript', body: await readFile(join(three, rel)) });
      } catch {
        route.fulfill({ status: 404 });
      }
    });
  }
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  // výchozí nízká kvalita, ať SwiftShader stíhá; zbytek uložení podle testu
  const init = { ...storage };
  if (quality && !init['turbo-okruh-v1']) init['turbo-okruh-v1'] = JSON.stringify({ settings: { quality, controlsSeen: true, racesStarted: 1 } });
  await page.addInitScript((data) => {
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
  }, init);
  const url = `http://127.0.0.1:${server.address().port}/index.html${hash}`;
  await page.goto(url);
  await page.waitForFunction(() => window.__game && window.__game.screen === 'menu', null, { timeout: 120000 });
  const close = async () => {
    await browser.close();
    server.close();
  };
  return { page, browser, errors, close, url };
}

// jednoduché vyhodnocení: vypíše OK/CHYBA a na konci nastaví návratový kód
export function checker(name) {
  const fails = [];
  return {
    ok(cond, msg) {
      console.log(`${cond ? 'OK   ' : 'CHYBA'} ${msg}`);
      if (!cond) fails.push(msg);
    },
    done() {
      console.log(fails.length ? `${name}: ${fails.length} chyb` : `${name}: vše v pořádku`);
      process.exitCode = fails.length ? 1 : 0;
    },
  };
}
