// Body a stromy: lampy, stromy a sochy z OSM, komíny, stromořadí a koruny stromů změřené v DMP 1G.
import { wgsToKrovak } from '../lib/geo.mjs';
import { treesOf } from '../lib/dmp.mjs';
import { pointInRing } from '../lib/poly.mjs';
import { dm, lineOf, ringOf } from './util.mjs';
import { FOREST_EDGE } from './inputs.mjs';

// lineární převod (e, n) -> hodnota nejmenšími čtverci, body [e, n, x, z]
function fitPlane(rows, col) {
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0];
  for (const r of rows) {
    const a = [r[0] - rows[0][0], r[1] - rows[0][1], 1];
    for (let p = 0; p < 3; p++) { v[p] += a[p] * r[col]; for (let q = 0; q < 3; q++) M[p][q] += a[p] * a[q]; }
  }
  // Cramerovo pravidlo pro 3×3
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const d = det(M);
  const k = [0, 1, 2].map((c) => det(M.map((row, p) => row.map((x, q) => (q === c ? v[p] : x)))) / d);
  return (e, n) => k[0] * (e - rows[0][0]) + k[1] * (n - rows[0][1]) + k[2];
}

export function buildNature(g) {
  const { city, area, poi, dmp, dem, proj, extent, toGame, near, axisDist, inFar, inBounds, REACH } = g;
  const pointsOf = (list) => list.map((e) => toGame(e.lat, e.lon)).filter(near).flatMap((p) => [dm(p[0]), dm(p[1])]);
  const lamps = pointsOf(area.filter((e) => e.type === 'node' && e.tags?.highway === 'street_lamp'));
  const trees = pointsOf(area.filter((e) => e.type === 'node' && e.tags?.natural === 'tree'));
  trees.push(...(city.extraTrees ?? [])); // ruční doplňky: v OSM nejsou, na fotkách ano
  const statues = pointsOf(poi.filter((e) => e.type === 'node' && (e.tags?.artwork_type === 'statue' || e.tags?.memorial === 'statue')));
  // komíny převyšují město, proto stačí, když leží na terénu; bez výšky v OSM 25 m
  const chimneys = poi.filter((e) => e.tags?.man_made === 'chimney' && e.type === 'node').flatMap((e) => {
    const p = toGame(e.lat, e.lon);
    return inBounds(p) ? [[dm(p[0]), dm(p[1]), dm(parseFloat(e.tags.height) || 25)]] : [];
  });
  const treeRows = area.filter((e) => e.tags?.natural === 'tree_row' && e.geometry).map((e) => lineOf(e.geometry.map((p) => toGame(p.lat, p.lon)), 1));

  // stromy podle DMP 1G: koruny ve městě a v pásu lesa u trati, dál v lese je rozmístí hra
  const canopy = [];
  if (dmp) {
    // S-JTSK → herní souřadnice: na pár kilometrech stačí afinní převod proložený mřížkou bodů
    const { minX, maxX, minZ, maxZ } = extent;
    const rows = [];
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
      const x = minX - REACH + ((maxX - minX + 2 * REACH) * i) / 4, z = minZ - REACH + ((maxZ - minZ + 2 * REACH) * j) / 4;
      rows.push([...wgsToKrovak(...proj.inverse(x, -z)), x, z]);
    }
    const gx = fitPlane(rows, 2), gz = fitPlane(rows, 3);
    const es = rows.map((r) => r[0]), ns = rows.map((r) => r[1]);
    const forests = g.out.areas.filter((a) => a[0] === 'forest').map((a) => ringOf(a, 1));
    for (const t of treesOf(dmp.trees, dem.krovak, [Math.min(...es), Math.min(...ns), Math.max(...es), Math.max(...ns)])) {
      const x = gx(t.e, t.n), z = gz(t.e, t.n);
      const d = axisDist(x, z);
      if ((d > REACH && !inFar(x, z)) || (d > FOREST_EDGE && forests.some((r) => pointInRing(x, z, r)))) continue;
      canopy.push(dm(x), dm(z), dm(t.h), dm(t.r));
    }
    g.stats.treesFromDmp = canopy.length / 4;
  }
  Object.assign(g.out, { lamps, trees, statues, chimneys, treeRows, canopy });
}
