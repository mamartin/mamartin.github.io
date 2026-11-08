// Výstup generátoru: scéna (data/<město>.bin), definice trati (js/tracks-<město>.js) a souhrn do konzole.
import { writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { encodeScene } from '../../js/scenecodec.js';
import { dirname } from 'node:path';
import { countCorners } from '../lib/axis.mjs';
import { dm } from './util.mjs';
import { matchAxis } from './track.mjs';

export const CREDIT = 'Mapová data © přispěvatelé OpenStreetMap, licence ODbL 1.0. Výškopis DMR 5G © ČÚZK, CC BY 4.0, převzorkováno a vyhlazeno. Výšky budov a stromy z DMP 1G, počty podlaží a silniční pozemky z RÚIAN © ČÚZK, CC BY 4.0.';

export function sceneOf(g) {
  const o = g.out;
  return {
    v: 1,
    license: 'ODbL-1.0',
    credit: CREDIT,
    origin: { lat: +g.lat0.toFixed(6), lon: +g.lon0.toFixed(6), base: +g.base.toFixed(2) },
    dem: o.dem,
    palette: g.palette,
    buildings: o.buildings, ...(o.levels.length ? { levels: o.levels } : {}), landmarks: o.landmarks,
    areas: o.areas, water: o.water, paved: o.paved, streets: o.streets, paths: o.paths, streams: o.streams, barriers: o.barriers,
    lamps: o.lamps, trees: o.trees, treeRows: o.treeRows, canopy: o.canopy, statues: o.statues, chimneys: o.chimneys,
    cars: o.cars, shops: o.shops, signs: o.signs, signNames: o.signNames,
    buses: o.buses.flatMap(([x, z, hd]) => [dm(x), dm(z), Math.round(hd * 100)]),
  };
}

// zápis ve formátu js/scenecodec.js zabalený gzipem; vrací velikost rozbalených dat a souboru
export function writeScene(path, scene) {
  mkdirSync(dirname(path), { recursive: true });
  const raw = encodeScene(scene);
  const file = gzipSync(raw, { level: 9 });
  writeFileSync(path, file);
  return { raw: raw.length, file: file.length };
}

export function trackSource(def, exportName) {
  const lines = def.points.map((p) => `    [${p.join(', ')}],`).join('\n');
  const { points: _p, widths: _w, ...head } = def;
  const fields = Object.entries(head).map(([k, v]) => `  ${k}: ${JSON.stringify(v).replace(/"/g, "'")},`).join('\n');
  return `// Vygenerováno nástrojem tools/osm2track.mjs, ručně neupravovat.
// Osa podle OpenStreetMap (ODbL), výšky z DMR 5G © ČÚZK (CC BY 4.0).
export const ${exportName} = {
${fields}
  // poměr šířek mezi úseky: [metr od startu, šířka silnice]
  widths: ${JSON.stringify(def.widths)},
  points: [
${lines}
  ],
};
`;
}

export function report(g, scene, size) {
  const { cl, check, def, axis, relAxis, base, stats, out: o } = g;
  const idx = matchAxis(cl, axis);
  let maxDiff = 0;
  for (let k = 0; k < cl.N; k++) maxDiff = Math.max(maxDiff, Math.abs(cl.py[k] - relAxis[idx[k]].hs));
  const win = Math.round(50 / cl.step);
  let grade50 = 0;
  for (let k = 0; k < cl.N; k++) grade50 = Math.max(grade50, Math.abs(cl.py[(k + win) % cl.N] - cl.py[k]) / (win * cl.step));
  const c = countCorners(cl);
  // kolik která část zabírá v rozbaleném formátu
  const kb = (key) => (encodeScene({ [key]: scene[key] }).length / 1024).toFixed(0);
  console.log(`trať: ${(cl.L / 1000).toFixed(2)} km, bodů ${def.points.length}, min. R ${check.minRadius.toFixed(1)} m, min. odstup ${check.minSeparation.toFixed(0)} m, stoupání okamžité ${(check.maxGrade * 100).toFixed(1)} % / přes 50 m ${(grade50 * 100).toFixed(1)} %, zatáčky ${c.count} (ostré ${c.tight}), odchylka výšky od DMR max. ${maxDiff.toFixed(2)} m`);
  console.log(`šířky: ${[...new Set(def.widths.map((w) => w[1]))].sort((a, b) => a - b).join(', ')} m, úseků ${def.widths.length}, start ${g.lat0.toFixed(5)}, ${g.lon0.toFixed(5)}`);
  console.log('statistika:', JSON.stringify(stats));
  console.log(`počty: areas ${o.areas.length}, water ${o.water.length}, paved ${o.paved.length}, streets ${o.streets.length}, paths ${o.paths.length}, streams ${o.streams.length}, barriers ${o.barriers.length}, lamps ${o.lamps.length / 2}, trees ${o.trees.length / 2}, treeRows ${o.treeRows.length}, cars ${o.cars.length / 3}, autobusy ${o.buses.length}, shops ${o.shops.length}, přechody ${def.crossings.length}, značky ${o.signs.length / 5}, stromy z DMP ${o.canopy.length / 4}`);
  console.log('hladiny:', o.water.filter((w) => w.name).map((w) => `${w.name} ${w.level === null ? '?' : ((w.level / 10 + base).toFixed(1) + ' m')}`).join(', '));
  console.log(`velikost: soubor ${(size.file / 1024).toFixed(0)} kB, rozbaleno ${(size.raw / 1024).toFixed(0)} kB (dem ${kb('dem')}, budovy ${kb('buildings')}, dominanty ${kb('landmarks')}, plochy ${kb('areas')}, voda ${kb('water')}, zpevněné ${kb('paved')}, ulice ${kb('streets')}, cesty ${kb('paths')}, potoky ${kb('streams')}, zdi ${kb('barriers')}, auta ${kb('cars')}, stromy ${kb('canopy')})`);
}
