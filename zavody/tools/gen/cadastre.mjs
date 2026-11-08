// city.parcels: povrch a ploty podle katastru (RÚIAN). Nádvoří, dvory, komunikace a manipulační plochy jsou
// zpevněné ('yard', jinak by tam byl trávník), zahrady mají k ulici plot. Do 250 m od trati, dál není poznat.
import { join } from 'node:path';
import { wgsToKrovak } from '../lib/geo.mjs';
import { loadParcels } from '../lib/parcels.mjs';
import { cleanRing, signedArea, simplifyRing, pointInRing } from '../lib/poly.mjs';
import { flat, lineOf, affineFrom } from './util.mjs';
import { BARRIER } from './lines.mjs';

// druh pozemku: 5 zahrada, 13 zastavěná plocha a nádvoří; způsob využití: 12 společný dvůr,
// 16 silnice, 17 ostatní komunikace, 18 ostatní dopravní plocha, 23 manipulační plocha
const GARDEN = 5, BUILT = 13;
const PAVED_USE = new Set([12, 16, 17, 18, 23]);
const ROAD_USE = new Set([16, 17]);
const CELL = 30;

export function buildCadastre(g) {
  const { DATA, proj, toGame, axisDist, nearAxis, clearance, inHouse } = g;
  const { paved, barriers } = g.out;
  const all = loadParcels(join(DATA, 'ruian')) ?? [];
  // S-JTSK -> hra: afinní převod z mřížky bodů kolem trati
  const samples = [];
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) samples.push(proj.inverse(i * 600, j * 600));
  const toG = affineFrom(samples.map(([la, lo]) => wgsToKrovak(la, lo)), samples.map(([la, lo]) => toGame(la, lo)));
  const inReach = (r, d) => r.some((p) => axisDist(p[0], p[1]) < d);
  const roadsP = [];
  let yards = 0;
  for (const pc of all) {
    const hard = pc.druh === BUILT || PAVED_USE.has(pc.use);
    if (!hard && pc.druh !== GARDEN) continue;
    const r = cleanRing(pc.ring.map((p) => toG(p[0], p[1])));
    if (r.length < 3 || !inReach(r, 300)) continue;
    if (ROAD_USE.has(pc.use)) roadsP.push(r);
    if (hard) {
      const a = Math.abs(signedArea(r));
      if (a < 40 || !inReach(r, 250)) continue;
      // parcela, kterou skoro celou zabírá dům, nádvoří nemá (a dům ji překryje)
      if (pc.druh === BUILT && !PAVED_USE.has(pc.use)) {
        const xs = r.map((q) => q[0]), zs = r.map((q) => q[1]);
        let inside = 0, built = 0;
        for (let x = Math.min(...xs) + 1.5; x < Math.max(...xs); x += 3) {
          for (let z = Math.min(...zs) + 1.5; z < Math.max(...zs); z += 3) {
            if (!pointInRing(x, z, r)) continue;
            inside++;
            if (inHouse(x, z)) built++;
          }
        }
        if (!inside || built / inside > 0.6 || (inside - built) * 9 < 40) continue;
      }
      paved.push(['yard', ...flat(simplifyRing(r, ROAD_USE.has(pc.use) && !inReach(r, 120) ? 2.5 : 1.2))]);
      yards++;
    } else pc.game = r;
  }
  // plot zahrady: hrana, za kterou (1,5 m ven) leží silniční pozemek; ne v pásu trati
  const grid = new Map();
  roadsP.forEach((r, i) => {
    const xs = r.map((p) => p[0]), zs = r.map((p) => p[1]);
    for (let gx = Math.floor(Math.min(...xs) / CELL); gx <= Math.floor(Math.max(...xs) / CELL); gx++) {
      for (let gz = Math.floor(Math.min(...zs) / CELL); gz <= Math.floor(Math.max(...zs) / CELL); gz++) {
        const key = `${gx},${gz}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(i);
      }
    }
  });
  const onRoadP = (x, z) => (grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? []).some((i) => pointInRing(x, z, roadsP[i]));
  let fences = 0;
  for (const pc of all) {
    if (!pc.game || !inReach(pc.game, 250)) continue;
    const r = signedArea(pc.game) > 0 ? pc.game : [...pc.game].reverse();
    let run = [];
    const flush = () => {
      if (run.length > 1) { barriers.push([BARRIER.fence, ...lineOf(run, 0.4)]); fences++; }
      run = [];
    };
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l < 0.5) continue;
      // vnější normála: strana, kde střed hrany posunutý o kus neleží v zahradě
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, nx = (b[1] - a[1]) / l, nz = -(b[0] - a[0]) / l;
      const outside = pointInRing(mx + nx * 0.5, mz + nz * 0.5, r) ? -1 : 1;
      const street = onRoadP(mx + nx * outside * 1.5, mz + nz * outside * 1.5);
      const n = nearAxis(mx, mz);
      if (street && !(n && n.d < clearance(n.k) + 0.5)) {
        if (!run.length) run.push(a);
        run.push(b);
      } else flush();
    }
    flush();
  }
  g.stats.parcels = `${yards} zpevněných, ${fences} plotů zahrad`;
}
