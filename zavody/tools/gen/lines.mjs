// Čáry: ulice mimo trať, pěšiny, potoky, zdi a ploty z OSM.
import { subdivideRing } from '../lib/poly.mjs';
import { edgeKey } from '../lib/roads.mjs';
import { dm, lineOf } from './util.mjs';
import { STREET_W } from './inputs.mjs';
import { roadWidth } from './track.mjs';

export const BARRIER = { wall: 0, retaining_wall: 1, fence: 2, hedge: 3 };

export function buildLines(g) {
  const { roads, area, loop, toGame, near, nearAxis, clearance, inBounds, corridorOf, bump } = g;

  // ulice mimo trať: z cest vypadnou úseky, po kterých jede závod
  const streets = [];
  for (const w of roads) {
    const guess = STREET_W[w.tags.highway];
    if (!guess) continue;
    let run = [];
    const flush = () => {
      if (run.length > 1 && run.some(near)) {
        const width = roadWidth(w.tags, corridorOf(run.map(([x, z]) => [x, -z])));
        bump(width ? 'streetWidthMeasured' : 'streetWidthGuessed');
        streets.push([dm(width ?? guess), ...lineOf(run, 0.8)]);
      }
      run = [];
    };
    w.nodes.forEach((id, i) => {
      run.push(toGame(w.geometry[i].lat, w.geometry[i].lon));
      if (i + 1 < w.nodes.length && loop.used.has(edgeKey(id, w.nodes[i + 1]))) flush();
    });
    flush();
  }

  const paths = [];
  for (const e of area) {
    const h = e.tags?.highway;
    if (!['footway', 'path', 'steps', 'cycleway'].includes(h) || !e.geometry) continue;
    const r = e.geometry.map((p) => toGame(p.lat, p.lon));
    if (r.some(near)) paths.push(lineOf(r, 1));
  }

  const streams = [];
  for (const e of area) {
    if (!e.tags?.waterway || e.tags.tunnel || !e.geometry) continue;
    const r = e.geometry.map((p) => toGame(p.lat, p.lon));
    if (r.some(inBounds)) streams.push(lineOf(r, 2));
  }

  // zdi a ploty: kus, který by stál ve výběhu, se vynechá
  const barriers = [];
  for (const e of area) {
    const type = BARRIER[e.tags?.barrier];
    if (type === undefined || !e.geometry) continue;
    let run = [];
    const flush = () => {
      if (run.length > 1 && run.some(near)) barriers.push([type, ...lineOf(run, 0.7)]);
      run = [];
    };
    for (const p of subdivideRing(e.geometry.map((q) => toGame(q.lat, q.lon)), 3)) {
      const n = nearAxis(p[0], p[1]);
      if (n && n.d < clearance(n.k)) flush();
      else run.push(p);
    }
    flush();
  }
  Object.assign(g.out, { streets, paths, streams, barriers });
}
