// Silniční síť z OSM jako graf a hledání tras po skutečných ulicích.

const COST = {
  primary: 1, primary_link: 1,
  secondary: 1, secondary_link: 1,
  tertiary: 1.05, tertiary_link: 1.05,
  unclassified: 1.3,
  residential: 1.4,
  living_street: 3,
  pedestrian: 4,
  service: 3,
};

export function buildGraph(ways, project) {
  const nodes = new Map(); // id -> { id, x, y, lat, lon, edges: [] }
  for (const w of ways) {
    const cost = COST[w.tags.highway];
    if (!cost) continue;
    if (w.tags.access === 'private' || w.tags.access === 'no') continue;
    for (let i = 0; i < w.nodes.length; i++) {
      const id = w.nodes[i];
      if (!nodes.has(id)) {
        const { lat, lon } = w.geometry[i];
        const [x, y] = project(lat, lon);
        nodes.set(id, { id, x, y, lat, lon, edges: [] });
      }
    }
    for (let i = 1; i < w.nodes.length; i++) {
      const a = nodes.get(w.nodes[i - 1]), b = nodes.get(w.nodes[i]);
      const len = Math.hypot(a.x - b.x, a.y - b.y);
      a.edges.push({ to: b.id, len, cost, way: w });
      b.edges.push({ to: a.id, len, cost, way: w });
    }
  }
  return nodes;
}

export function nearestNode(nodes, x, y, street) {
  let best = null, bestD = Infinity;
  for (const n of nodes.values()) {
    if (street && !n.edges.some((e) => e.way.tags.name === street)) continue;
    const d = Math.hypot(n.x - x, n.y - y);
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

export const edgeKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);

// Dijkstra; hrany už použité v okruhu jsou prakticky zakázané, aby se trasa nevracela stejnou ulicí
function route(nodes, from, to, used) {
  const dist = new Map([[from, 0]]);
  const prev = new Map();
  const open = new Set([from]);
  const done = new Set();
  while (open.size) {
    let cur = null, curD = Infinity;
    for (const id of open) {
      const d = dist.get(id);
      if (d < curD) { curD = d; cur = id; }
    }
    if (cur === to) break;
    open.delete(cur);
    done.add(cur);
    for (const e of nodes.get(cur).edges) {
      if (done.has(e.to)) continue;
      const pen = used.has(edgeKey(cur, e.to)) ? 60 : 1;
      const d = curD + e.len * e.cost * pen;
      if (d < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, d);
        prev.set(e.to, { id: cur, edge: e });
        open.add(e.to);
      }
    }
  }
  if (!dist.has(to)) throw new Error(`Trasa nenalezena: ${from} -> ${to}`);
  const path = [];
  for (let id = to; id !== from; id = prev.get(id).id) path.unshift(prev.get(id));
  return path;
}

// via: [[x, y, 'ulice'?], ...] se projde dokola; vrací uzly smyčky a ulice po pořadí
export function routeLoop(nodes, via) {
  const stops = via.map(([x, y, street]) => nearestNode(nodes, x, y, street));
  const used = new Set();
  const seq = [];
  const edges = []; // edges[i] vede ze seq[i] do seq[i + 1]
  const streets = [];
  let reused = 0;
  for (let i = 0; i < stops.length; i++) {
    const from = stops[i].id, to = stops[(i + 1) % stops.length].id;
    const path = route(nodes, from, to, used);
    for (let k = 0; k < path.length; k++) {
      const a = path[k].id, b = k + 1 < path.length ? path[k + 1].id : to;
      const key = edgeKey(a, b);
      if (used.has(key)) reused += path[k].edge.len;
      used.add(key);
      seq.push(nodes.get(a));
      edges.push(path[k].edge);
      const name = path[k].edge.way.tags.name || `(${path[k].edge.way.tags.ref || path[k].edge.way.tags.highway})`;
      const last = streets[streets.length - 1];
      if (last && last.name === name) last.len += path[k].edge.len;
      else streets.push({ name, len: path[k].edge.len, highway: path[k].edge.way.tags.highway, surface: path[k].edge.way.tags.surface });
    }
  }
  return { nodes: seq, edges, streets, reused, used };
}

export function douglasPeucker(pts, eps) {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = pts[a][0], ay = pts[a][1];
    const dx = pts[b][0] - ax, dy = pts[b][1] - ay;
    const l = Math.hypot(dx, dy) || 1;
    let m = 0, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / l;
      if (d > m) { m = d; mi = i; }
    }
    if (m > eps) {
      keep[mi] = 1;
      stack.push([a, mi], [mi, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}
