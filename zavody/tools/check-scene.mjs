// Nezávislá kontrola vygenerovaných souborů: čte jen js/tracks-<město>.js a data/<město>.json.
// Použití: node check-scene.mjs [město | vse]   (bez města Dobříš, „vse“ všechna vygenerovaná města)
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildCenterline, validateCenterline } from '../js/trackmath.js';
import { localProjection } from './lib/geo.mjs';
import { loadDem } from './lib/dem.mjs';
import { loadCity, loadTrack, cityIds } from './lib/city.mjs';

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'CHYBA'} ${msg}`); if (!cond) fails.push(msg); };

const argv = process.argv.slice(2);
const ids = argv.includes('vse') ? cityIds() : [null];
for (const want of ids) {
  const ctx = await loadCity(want ? [want] : argv);
  const TRACK = await loadTrack(ctx);
  if (!TRACK || !existsSync(ctx.scene)) {
    if (want) { console.log(`--- ${ctx.city.name}: ještě není vygenerovaná, přeskočeno`); continue; }
    ok(false, `trať ${ctx.city.name} je vygenerovaná (node osm2track.mjs ${ctx.city.id})`);
    break;
  }
  if (want) console.log(`--- ${ctx.city.name}`);
  check(ctx, TRACK);
}

console.log(fails.length ? `\n${fails.length} chyb` : '\nvše v pořádku');
process.exit(fails.length ? 1 : 0);

function check(ctx, TRACK) {
  const { city } = ctx;
  const scene = JSON.parse(readFileSync(ctx.scene, 'utf8'));
  const cl = buildCenterline(TRACK);

  // 1) tvar: stejné podmínky jako hra, při nominální i největší šířce
  const widest = Math.max(...TRACK.widths.map((w) => w[1]));
  for (const w of [TRACK.width, widest]) {
    const v = validateCenterline(cl, w / 2, TRACK.runoff);
    ok(v.ok && v.length > 700 && v.length < 6000, `validace pro šířku ${w} m: ${(v.length / 1000).toFixed(2)} km, R ${v.minRadius.toFixed(1)} m, odstup ${v.minSeparation.toFixed(0)} m, stoupání ${(v.maxGrade * 100).toFixed(1)} %`);
  }

  // 2) start: první bod v počátku, poloměr 0, rovně a na východ
  const p0 = TRACK.points[0];
  ok(p0[0] === 0 && p0[1] === 0 && p0[3] === 0, `první bod trati ${JSON.stringify(p0)}`);
  const span = Math.round(60 / cl.step);
  let kMax = 0;
  for (let o = -span; o <= span; o++) kMax = Math.max(kMax, Math.abs(cl.kappa[(o + cl.N) % cl.N]));
  ok(kMax < 1 / 300, `start je na rovině: ±60 m nejmenší poloměr ${(1 / kMax).toFixed(0)} m`);

  // 3) orientace: světové strany podle známých míst města (cities/<město>.mjs, check)
  const proj = localProjection(scene.origin.lat, scene.origin.lon);
  const game = (lat, lon) => { const [x, y] = proj.forward(lat, lon); return [x, -y]; };
  city.check?.({ ok, game, scene, cl, track: TRACK });

  // 4) výšková mřížka: souhlas s tratí a dekódování
  const d = scene.dem;
  const demAt = (x, z) => {
    const fx = (x - d.x0) / d.cell, fz = (z - d.z0) / d.cell;
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const h = (a, b) => d.h[b * d.nx + a] / 10;
    return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v;
  };
  ok(d.h.length === d.nx * d.nz && d.h.every(Number.isFinite), `mřížka ${d.nx}×${d.nz} po ${d.cell} m je úplná`);
  // trať proti plnému DMR; mřížka může být na úzkých náspech dál od trati, hra tam terén dorovná k silnici
  const rawDem = existsSync(join(ctx.data, 'dmr/grid.bin')) ? loadDem(join(ctx.data, 'dmr/grid.bin')) : null;
  // úseky na mostech (a 10 m kolem): terén pod nimi je níž než silnice
  const near = (x, z) => { let b = 0, bd = Infinity; for (let k = 0; k < cl.N; k++) { const d = (cl.px[k] - x) ** 2 + (cl.pz[k] - z) ** 2; if (d < bd) { bd = d; b = k; } } return cl.s[b]; };
  const bridgeSpans = (TRACK.bridges ?? []).map(([a, b]) => [near(...a) - 10, near(...b) + 10]);
  const onBridge = (s) => bridgeSpans.some(([a, b]) => (a <= b ? s >= a && s <= b : s >= a || s <= b));
  let maxD = 0, sumD = 0, maxRaw = 0;
  for (let k = 0; k < cl.N; k++) {
    if (onBridge(cl.s[k])) continue;
    const e = Math.abs(demAt(cl.px[k], cl.pz[k]) - cl.py[k]);
    maxD = Math.max(maxD, e);
    sumD += e;
    if (rawDem) maxRaw = Math.max(maxRaw, Math.abs(rawDem.height(...proj.inverse(cl.px[k], -cl.pz[k])) - scene.origin.base - cl.py[k]));
  }
  // DMR je holý terén bez mostů, proto na propustcích a potocích pod silnicí klesne o pár metrů
  if (rawDem) ok(maxRaw < 2.5, `trať drží DMR: největší rozdíl ${maxRaw.toFixed(2)} m${bridgeSpans.length ? ` (mimo ${bridgeSpans.length} most${bridgeSpans.length > 1 ? 'y' : ''})` : ''}`);
  ok(sumD / cl.N < 0.5 && maxD < 3, `mřížka pod osou trati: průměrný rozdíl ${(sumD / cl.N).toFixed(2)} m, největší ${maxD.toFixed(2)} m`);

  // 5) domy nesmí stát v silnici ani ve výběhu
  const widthAt = (s) => {
    let w = TRACK.widths[0][1];
    for (const [from, v] of TRACK.widths) if (s >= from) w = v;
    return w;
  };
  const CELL = 24, hash = new Map();
  for (let k = 0; k < cl.N; k++) {
    const key = `${Math.floor(cl.px[k] / CELL)},${Math.floor(cl.pz[k] / CELL)}`;
    if (!hash.has(key)) hash.set(key, []);
    hash.get(key).push(k);
  }
  const gap = (x, z) => {
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
    let m = Infinity;
    for (let j = cj - 2; j <= cj + 2; j++) for (let i = ci - 2; i <= ci + 2; i++) {
      for (const k of hash.get(`${i},${j}`) ?? []) {
        const dist = Math.hypot(cl.px[k] - x, cl.pz[k] - z);
        m = Math.min(m, dist - widthAt(cl.s[k]) / 2 - TRACK.runoff);
      }
    }
    return m;
  };
  let worst = Infinity, inside = 0, bad = 0, ccw = 0;
  for (const b of scene.buildings) {
    const p = b.slice(5);
    let w = Infinity, a = 0;
    const n = p.length / 2;
    for (let i = 0; i < n; i++) {
      const x0 = p[i * 2] / 10, z0 = p[i * 2 + 1] / 10, x1 = p[((i + 1) % n) * 2] / 10, z1 = p[((i + 1) % n) * 2 + 1] / 10;
      a += x0 * z1 - x1 * z0;
      const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 2);
      for (let t = 0; t < steps; t++) w = Math.min(w, gap(x0 + ((x1 - x0) * t) / steps, z0 + ((z1 - z0) * t) / steps));
    }
    if (a > 0) ccw++;
    if (w < 0) inside++;
    worst = Math.min(worst, w);
    if (b[0] <= 0 || b[1] < 0 || b[2] < 0 || b[2] > 5 || !scene.palette.wall[b[3]] || !scene.palette.roof[b[4]]) bad++;
  }
  ok(inside === 0, `žádná fasáda v silnici ani výběhu: nejmenší odstup za výběhem ${worst.toFixed(2)} m, domů v zákazu ${inside}`);
  ok(bad === 0, `budovy mají platnou výšku, střechu a barvy (${scene.buildings.length} ks)`);
  ok(ccw === scene.buildings.length, `všechny půdorysy mají stejnou orientaci (${ccw}/${scene.buildings.length})`);

  // dominanty a voda mají stejné pravidlo: silnice a výběh mají přednost
  const ringGap = (p) => {
    let w = Infinity;
    const n = p.length / 2;
    for (let i = 0; i < n; i++) {
      const x0 = p[i * 2] / 10, z0 = p[i * 2 + 1] / 10, x1 = p[((i + 1) % n) * 2] / 10, z1 = p[((i + 1) % n) * 2 + 1] / 10;
      const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 2);
      for (let t = 0; t < steps; t++) w = Math.min(w, gap(x0 + ((x1 - x0) * t) / steps, z0 + ((z1 - z0) * t) / steps));
    }
    return w;
  };
  for (const l of scene.landmarks) ok(ringGap(l.p) >= 0, `dominanta ${l.id}: odstup za výběhem ${ringGap(l.p).toFixed(1)} m`);
  for (const w of scene.water) if (ringGap(w.p) < 25) ok(ringGap(w.p) >= 0, `voda ${w.name ?? '(bez jména)'}: odstup za výběhem ${ringGap(w.p).toFixed(1)} m`);

  // stromy z DMP: čtveřice x, z, výška, poloměr koruny; značky: druh, hodnota, x, z, natočení
  const canopy = scene.canopy ?? [];
  let badTree = canopy.length % 4;
  for (let i = 0; i + 3 < canopy.length; i += 4) if (!(canopy[i + 2] >= 40 && canopy[i + 2] <= 450 && canopy[i + 3] >= 10 && canopy[i + 3] <= 70)) badTree++;
  ok(badTree === 0, `stromy z DMP mají výšku 4–45 m a korunu 1–7 m (${canopy.length / 4} ks)`);
  const signs = scene.signs ?? [];
  let badSign = signs.length % 5;
  for (let i = 0; i + 4 < signs.length; i += 5) {
    const [kind, value] = [signs[i], signs[i + 1]];
    if (kind < 0 || kind > 6 || ((kind === 3 || kind === 4) && !scene.signNames[value]) || (kind === 2 && !(value >= 10 && value <= 130))) badSign++;
    if (gap(signs[i + 2] / 10, signs[i + 3] / 10) < -0.1) badSign++;
  }
  ok(badSign === 0, `značky mají platný druh, hodnotu a stojí za výběhem (${signs.length / 5} ks)`);
  const buses = scene.buses ?? [];
  let badBus = buses.length % 3;
  for (let i = 0; i + 2 < buses.length; i += 3) if (gap(buses[i] / 10, buses[i + 1] / 10) < 1.2) badBus++;
  ok(badBus === 0, `autobusy stojí mimo silnici a výběh (${buses.length / 3} ks)`);

  // 6) povinné náležitosti
  const size = readFileSync(ctx.scene).length;
  const maxKb = city.maxSceneKb ?? 500;
  ok(size < maxKb * 1024, `velikost souboru ${(size / 1024).toFixed(0)} kB (limit ${maxKb} kB)`);
  ok(scene.license === 'ODbL-1.0' && /OpenStreetMap/.test(scene.credit) && /ČÚZK/.test(scene.credit), 'data jsou označená ODbL a uvádějí zdroje');
  const need = city.requiredLandmarks ?? [];
  if (need.length) ok(need.every((id) => scene.landmarks.some((l) => l.id === id)), `všech ${need.length} dominant má půdorys`);
}
