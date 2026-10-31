// Fáze průzkumu: projde kandidátní okruhy po skutečných ulicích, změří je a ověří herní validací.
// Použití: node loops.mjs   (čte data/osm_roads.json a data/dmr/grid.bin, píše data/loops/)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localProjection } from './lib/geo.mjs';
import { buildGraph, routeLoop } from './lib/roads.mjs';
import { sampleAxis, fitTrack, countCorners } from './lib/axis.mjs';
import { loadDem } from './lib/dem.mjs';
import { buildCenterline, validateCenterline } from '../js/trackmath.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA = join(ROOT, 'data');
const WIDTH = 11, RUNOFF = 3;

const proj = localProjection(49.7815, 14.1745);
const ways = JSON.parse(readFileSync(join(DATA, 'osm_roads.json'), 'utf8')).elements.filter((e) => e.type === 'way');
const nodes = buildGraph(ways, proj.forward);
const dem = loadDem(join(DATA, 'dmr/grid.bin'));

const CANDIDATES = JSON.parse(readFileSync(join(ROOT, 'loops.json'), 'utf8'));

mkdirSync(join(DATA, 'loops'), { recursive: true });
const results = [];
for (const cand of CANDIDATES) {
  const { nodes: seq, streets, reused } = routeLoop(nodes, cand.via);
  const axis = sampleAxis(seq, dem, proj, { R: 12 });
  const hmin = Math.min(...axis.map((p) => p.hs));
  const points = fitTrack(axis, { width: WIDTH, runoff: RUNOFF }).map((p) => [p[0], p[1], +(p[2] - hmin).toFixed(1), p[3]]);
  const def = { id: cand.id, width: WIDTH, runoff: RUNOFF, maxBank: 0.015, smooth: 2, points };
  const cl = buildCenterline(def);
  const v = validateCenterline(cl, WIDTH / 2, RUNOFF);
  const c = countCorners(cl);
  let climb = 0;
  for (let i = 0; i < cl.N; i++) climb += Math.max(0, cl.py[(i + 1) % cl.N] - cl.py[i]);
  // stoupání přes 50 m: okamžitá hodnota je zkreslená interpolací mezi blízkými body
  const win = Math.round(50 / cl.step);
  let grade50 = 0;
  for (let k = 0; k < cl.N; k++) grade50 = Math.max(grade50, Math.abs(cl.py[(k + win) % cl.N] - cl.py[k]) / (win * cl.step));
  const edge = WIDTH / 2 + RUNOFF;
  const r = {
    id: cand.id, name: cand.name, note: cand.note,
    osmLength: seq.reduce((s, a, i) => s + Math.hypot(a.x - seq[(i + 1) % seq.length].x, a.y - seq[(i + 1) % seq.length].y), 0),
    length: v.length, climb, range: Math.max(...cl.py) - Math.min(...cl.py), hmin,
    maxGrade: v.maxGrade, grade50, minRadius: v.minRadius, minSeparation: v.minSeparation,
    corners: c.count, tight: c.tight, points: points.length, reused, ok: v.ok,
    fails: [
      v.minRadius <= edge + 2 ? `poloměr ${v.minRadius.toFixed(1)} m` : '',
      v.minSeparation <= edge * 2 + 6 ? `blízké úseky ${v.minSeparation.toFixed(1)} m (${v.worstPair.map((k) => `${cl.px[k].toFixed(0)},${(-cl.pz[k]).toFixed(0)}`).join(' / ')})` : '',
      v.maxGrade >= 0.16 ? `stoupání ${(v.maxGrade * 100).toFixed(1)} %` : '',
      reused > 1 ? `opakovaná ulice ${reused.toFixed(0)} m` : '',
    ].filter(Boolean),
    streets: streets.map((s) => ({ name: s.name, len: Math.round(s.len), highway: s.highway, surface: s.surface })),
    profile: Array.from({ length: 120 }, (_, i) => +cl.py[Math.floor((i / 120) * cl.N)].toFixed(1)),
    axis: Array.from({ length: Math.floor(cl.N / 3) }, (_, i) => [+cl.px[i * 3].toFixed(1), +(-cl.pz[i * 3]).toFixed(1)]),
    osmAxis: seq.map((s) => [+s.x.toFixed(1), +s.y.toFixed(1)]),
    def,
  };
  results.push(r);
  console.log(`\n${r.id} – ${r.name}: ${(r.length / 1000).toFixed(2)} km (OSM ${(r.osmLength / 1000).toFixed(2)}), rozpětí výšek ${r.range.toFixed(1)} m, nastoupáno ${r.climb.toFixed(0)} m, stoupání přes 50 m ${(r.grade50 * 100).toFixed(1)} %, zatáčky ${r.corners} (ostré ${r.tight}), min. R ${r.minRadius.toFixed(1)} m, min. odstup ${r.minSeparation.toFixed(0)} m, bodů ${r.points}, platná: ${r.ok}`);
  if (r.fails.length) console.log('  problémy:', r.fails.join('; '));
  console.log('  ulice:', r.streets.filter((s) => s.len >= 15).map((s) => `${s.name} ${s.len} m`).join(' → '));
}
writeFileSync(join(DATA, 'loops/loops.json'), JSON.stringify(results));
