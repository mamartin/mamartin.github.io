// Měření AI: celé závody samotných AI aut bez vykreslování v headless Chromiu (Playwright).
// Vypisuje nejlepší a průměrné kolo, nárazy do zdí, čas na obrubníku a mimo asfalt, zaseknutí,
// couvání, respawny, ťuky mezi auty a kolik aut dojelo.
//
//   node test/ai-bench.mjs [volby]
//   --tracks dobris,dobris~r,random-123,...  tratě (~r = obráceně, random-<seed> = vygenerovaná)
//   --diffs easy,medium,hard,expert          obtížnosti
//   --laps 2 --seeds 2                       kol v závodě a opakování s jinými starty
//   --scenario race|block|solo|wall|medal    race = šest AI; block = první dvě auta na roštu jedou
//                                            lehkou obtížností (předjíždění pomalejších); solo = jedno
//                                            auto bez provozu; wall = auta stojí nosem ke zdi
//                                            (vyproštění); medal = letmé kolo pro medaile (medals.js)
//   --kind car|formula|gt|rally --wet        typ vozu soupeřů, mokrá trať
//   --where                                  nejčastější místa a příčiny nárazů do zdí
//   --json out.json --compare before.json    uložit výsledky / tabulka (markdown) proti dřívějšímu běhu
//   --three node_modules/three               three z disku místo CDN (sandbox bez sítě)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => {
  if (v.startsWith('--')) a.push([v.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return a;
}, []));
const TRACKS = (args.tracks || 'dobris,dobris~r,mesto,mesto~r,sumava,sumava~r,kanon,kanon~r,serpentiny,serpentiny~r').split(',');
const DIFFS = (args.diffs || 'easy,medium,hard,expert').split(',');
const LAPS = +(args.laps || 2);
const SEEDS = +(args.seeds || 2);
const SCENARIO = args.scenario || 'race';
const WHERE = !!args.where;
const KIND = args.kind || 'car';
const WET = !!args.wet;

const MIME = { '.js': 'text/javascript', '.json': 'application/json', '.html': 'text/html', '.css': 'text/css' };
const PAGE = `<!doctype html><meta charset="utf-8"><script type="importmap">{"imports":{
"three":"https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.min.js",
"three/addons/":"https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/"}}</script><body>bench</body>`;
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/__bench.html') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(PAGE);
  }
  const file = path.join(ROOT, url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
// three z disku, když je k dispozici (v sandboxu bez přístupu na CDN)
let threeDir = args.three;
if (!threeDir) {
  try {
    threeDir = path.dirname(createRequire(ROOT + '/').resolve('three/package.json'));
  } catch {
    /* zůstane CDN */
  }
}
if (threeDir) {
  await page.route('https://cdn.jsdelivr.net/npm/three@0.169.0/**', (route) => {
    const rel = new URL(route.request().url()).pathname.replace('/npm/three@0.169.0/', '');
    route.fulfill({ path: path.join(threeDir, rel), contentType: 'text/javascript' });
  });
}
await page.goto(base + '/__bench.html');

// jedna simulace závodu v prohlížeči
async function simulate(trackId, difficulty, seed) {
  return page.evaluate(async ({ trackId, difficulty, seed, laps, scenario, kind, wet }) => {
    const [{ Race }, { Track, SURF_CURB, SURF_OFF }, { TRACKS }, { BIOMES, wetBiome }, { DIFFICULTY }] = await Promise.all([
      import('/js/race.js'), import('/js/track.js'), import('/js/tracks.js'), import('/js/biomes.js'), import('/js/ai.js'),
    ]);
    // stejné náhodné starty pro stejný seed
    let st = seed * 2654435761 >>> 0;
    Math.random = () => ((st = (st * 1664525 + 1013904223) >>> 0) / 4294967296);
    const rev = trackId.endsWith('~r');
    let raw = TRACKS.find((t) => t.id === trackId.replace('~r', ''));
    if (!raw && trackId.startsWith('random-')) {
      // stejně jako randomDef v trackdefs.js (bez jezera), aby šlo měřit i vygenerované tratě
      const [{ randomTrackDef, buildCenterline, validateCenterline }, { RNG }] = await Promise.all([import('/js/trackmath.js'), import('/js/rng.js')]);
      const rs = +trackId.replace('~r', '').slice(7);
      const biome = new RNG(rs).pick(['forest', 'canyon', 'winter', 'city']);
      const city = biome === 'city';
      const base = { width: city ? 14 : biome === 'winter' ? 15 : 16, runoff: city ? 3 : biome === 'winter' ? 6 : 7 };
      let points = randomTrackDef(rs);
      for (let t = 0; t < 8; t++) {
        if (validateCenterline(buildCenterline({ points }), base.width / 2, base.runoff).ok) break;
        points = randomTrackDef(rs + (t + 1) * 7919);
      }
      raw = { id: 'random-' + rs, biome, ...base, maxBank: city ? 0.015 : 0.07, seed: rs % 100000, points };
    }
    let def = rev ? { ...raw, id: raw.id + '~r', cut: null, reversed: true, points: [raw.points[0], ...raw.points.slice(1).reverse()] } : raw;
    if (wet) def = { ...def, wet: true };
    const track = (window.__tracks ??= {})[trackId + (wet ? '|wet' : '')] ??= new Track(def);
    const biome = wet ? wetBiome(BIOMES[def.biome]) : BIOMES[def.biome];
    if (scenario === 'medal') {
      const race = new Race({ track, biome, mode: 'time', laps: 2, playerKinds: [kind] });
      race.setAutopilot(true, race.player, 'reference');
      race.autopilot.diff = { ...race.autopilot.diff, mistakes: 0 };
      const idle = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
      for (let n = 0; race.player.lapTimes.length < 2 && n < 300 * 120; n++) {
        race.step(1 / 120, [idle]);
        race.events.length = 0;
      }
      return { trackId, difficulty, seed, medal: race.player.lapTimes[1] ?? null, cars: [] };
    }
    const race = new Race({ track, biome, mode: 'race', laps, difficulty, humans: 0, opponents: scenario === 'solo' ? 1 : 6, opponentKind: kind });
    const STEP = 1 / 120;
    if (scenario === 'block') for (const c of race.cars.slice(0, 2)) race.ais.get(c).diff = DIFFICULTY.easy;
    const wallStart = new Map();
    const stats = new Map(race.cars.map((c) => [c, { name: c.name, walls: 0, hardWalls: 0, curbIn: 0, offIn: 0, curbTime: 0, offTime: 0, stuck: 0, respawns: 0, reverse: 0, bumps: 0, wallCool: 0, lastSurf: 0, lastRecover: 0, lastBump: -99 }]));
    const limit = 60 * 30;
    let t = 0;
    const t0 = performance.now();
    while (t < limit) {
      if (scenario === 'wall' && race.state === 'running' && !wallStart.size) {
        // každé auto jinde, nosem ke zdi (kolmo, šikmo vpřed nebo šikmo vzad), těsně u ní
        race.cars.forEach((c, i) => {
          const s0 = (track.L * (i + 0.37 * seed)) / race.cars.length;
          const side = (i + seed) % 2 ? 1 : -1;
          c.reset(s0, side * (track.edgeAt(track.indexAt(s0)) - c.spec.halfWidth - 0.6));
          c.hd -= side * [Math.PI / 2, Math.PI / 3, (2 * Math.PI) / 3][(i + seed) % 3];
          c.proj.hd = c.hd;
          race.initRaceData(c, s0);
          wallStart.set(c, { p0: c.progress, t: null });
        });
      }
      race.step(STEP, null);
      t += STEP;
      for (const ev of race.events) {
        if (ev.type === 'respawn') stats.get(ev.car).respawns++;
        if (ev.type === 'bump') for (const c of [ev.a, ev.b]) { stats.get(c).bumps++; stats.get(c).lastBump = t; }
      }
      race.events.length = 0;
      if (race.state !== 'running') continue;
      for (const c of race.cars) {
        if (c.finished) continue;
        const s = stats.get(c), ai = race.ais.get(c);
        const w = wallStart.get(c);
        if (w && w.t == null && c.progress - w.p0 > 40) w.t = race.time;
        s.wallCool -= STEP;
        if (c.impact > 1 && s.wallCool <= 0) {
          s.walls++;
          if (c.impact > 6) s.hardWalls++;
          s.wallCool = 0.6;
          (window.__hits ??= []).push([trackId, difficulty, Math.round(c.proj.s / 20) * 20, Math.sign(c.proj.lat), c.impact, c.speed,
            ai.mistake > 0 ? ai.mistakeKind : t - s.lastBump < 2 ? 'ťuk' : '']);
        }
        const surf = c.surface;
        if (surf === SURF_CURB) s.curbTime += STEP;
        if (surf === SURF_OFF) s.offTime += STEP;
        if (surf === SURF_CURB && s.lastSurf === 0) s.curbIn++;
        if (surf === SURF_OFF && s.lastSurf !== SURF_OFF) s.offIn++;
        s.lastSurf = surf;
        if (c.vLong < -0.5) s.reverse += STEP;
        const rec = ai.recover > 0 ? 1 : 0;
        if (rec && !s.lastRecover) s.stuck++;
        s.lastRecover = rec;
      }
      if (race.cars.every((c) => c.finished)) break;
      if (scenario === 'wall' && race.time > 40) break;
    }
    return {
      trackId, difficulty, seed, L: track.L, simTime: t, ms: performance.now() - t0,
      cars: race.cars.map((c) => {
        const { wallCool, lastSurf, lastRecover, lastBump, ...s } = stats.get(c);
        return { ...s, finished: c.finished, finishTime: c.finishTime, laps: c.lapTimes, best: c.bestLap, escape: wallStart.get(c)?.t ?? null };
      }),
    };
  }, { trackId, difficulty, seed, laps: LAPS, scenario: SCENARIO, kind: KIND, wet: WET });
}

const results = [];
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '—');
const rows = [];
for (const trackId of TRACKS) {
  for (const difficulty of DIFFS) {
    const runs = [];
    if (SCENARIO === 'medal') {
      const r = await simulate(trackId, difficulty, 1);
      results.push(r);
      console.log(`${trackId.padEnd(12)} referenční kolo pro medaile ${f1(r.medal ?? NaN)} s`);
      break;
    }
    for (let seed = 1; seed <= SEEDS; seed++) runs.push(await simulate(trackId, difficulty, seed));
    results.push(...runs);
    const cars = runs.flatMap((r) => r.cars);
    const laps = cars.flatMap((c) => c.laps.slice(1)); // první kolo je z roštu
    const allLaps = cars.flatMap((c) => c.laps);
    const sum = (k) => cars.reduce((a, c) => a + c[k], 0);
    const n = cars.length;
    const row = {
      track: trackId, diff: difficulty,
      best: Math.min(...allLaps), avg: laps.reduce((a, v) => a + v, 0) / Math.max(1, laps.length),
      lap1: cars.reduce((a, c) => a + (c.laps[0] ?? NaN), 0) / n,
      walls: sum('walls') / n, hard: sum('hardWalls') / n, curb: sum('curbTime') / n, off: sum('offTime') / n, offIn: sum('offIn') / n,
      stuck: sum('stuck') / n, resp: sum('respawns') / n, rev: sum('reverse') / n, bumps: sum('bumps') / n,
      fin: `${cars.filter((c) => c.finished).length}/${n}`,
    };
    rows.push(row);
    if (SCENARIO === 'wall') {
      const esc = cars.map((c) => c.escape);
      const ok = esc.filter((v) => v != null);
      console.log(`${trackId.padEnd(12)} ${difficulty.padEnd(7)} vyproštění (40 m za 40 s): ${ok.length}/${esc.length}, průměr ${f1(ok.reduce((a, v) => a + v, 0) / ok.length)} s, nejhorší ${f1(Math.max(...ok))} s | zasek ${row.stuck.toFixed(2)} resp ${row.resp.toFixed(2)} couv ${row.rev.toFixed(1)}s zdi ${row.walls.toFixed(2)}`);
      continue;
    }
    console.log(`${trackId.padEnd(12)} ${difficulty.padEnd(7)} best ${f1(row.best)} avg ${f1(row.avg)} lap1 ${f1(row.lap1)} | zdi ${row.walls.toFixed(2)} (tvrdé ${row.hard.toFixed(2)}) obrub ${row.curb.toFixed(1)}s mimo ${row.off.toFixed(1)}s/${row.offIn.toFixed(1)}× | zasek ${row.stuck.toFixed(2)} resp ${row.resp.toFixed(2)} couv ${row.rev.toFixed(1)}s | ťuky ${row.bumps.toFixed(1)} | dojelo ${row.fin} (${(runs.reduce((a, r) => a + r.ms, 0) / 1000).toFixed(1)} s)`);
  }
}
if (WHERE) {
  const hits = await page.evaluate(() => window.__hits || []);
  const by = new Map();
  const why = {};
  for (const [tr, d, s, side, imp, v, cause] of hits) {
    const key = `${tr} ${d} s=${s} ${side > 0 ? '+' : '−'} ${cause}`;
    const b = by.get(key) || { n: 0, imp: 0 };
    b.n++;
    b.imp += imp;
    why[cause || 'jízda'] = (why[cause || 'jízda'] || 0) + 1;
    by.set(key, b);
  }
  console.log('Příčiny nárazů:', JSON.stringify(why));
  console.log('Nejčastější místa nárazů:');
  for (const [k, b] of [...by].sort((a, b) => b[1].n - a[1].n).slice(0, 25)) console.log(`  ${k}: ${b.n}× (průměrně ${(b.imp / b.n).toFixed(1)} m/s)`);
}
if (args.json) fs.writeFileSync(args.json, JSON.stringify({ rows, results }, null, 1));
if (args.compare && SCENARIO !== 'medal') {
  // tabulka před → po (průměrné kolo bez prvního kola z roštu, nárazy a ťuky na auto a závod)
  const before = new Map(JSON.parse(fs.readFileSync(args.compare, 'utf8')).rows.map((r) => [`${r.track}|${r.diff}`, r]));
  console.log('\n| Trať | Obtížnost | Nejlepší kolo | Průměrné kolo | Δ | Nárazy do zdí | Mimo asfalt (s) | Ťuky auto–auto | Dojelo |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const a of rows) {
    const b = before.get(`${a.track}|${a.diff}`);
    if (!b) continue;
    const d = ((a.avg / b.avg - 1) * 100).toFixed(1);
    console.log(`| ${a.track} | ${a.diff} | ${f1(b.best)} → ${f1(a.best)} | ${f1(b.avg)} → ${f1(a.avg)} | ${d > 0 ? '+' : ''}${d} % | ${b.walls.toFixed(2)} → ${a.walls.toFixed(2)} | ${b.off.toFixed(1)} → ${a.off.toFixed(1)} | ${b.bumps.toFixed(1)} → ${a.bumps.toFixed(1)} | ${b.fin} → ${a.fin} |`);
  }
}
if (errors.length) console.log('Chyby v konzoli:\n' + errors.join('\n'));
await browser.close();
server.close();
process.exitCode = errors.length ? 1 : 0;
