// Síť ulic pro auta, která jezdí městem mimo trať (jen kulisa). Z lomených čar ulic vznikne graf:
// uzel je bod, kde se ulice stýkají nebo končí, hrana úsek ulice mezi dvěma uzly. Hrany, které vedou
// přes zakázané místo (trať a její okolí, mimo dohled), vypadnou a potom se opakovaně odstraní slepé
// konce. Zbydou jen okruhy, takže auto může jet pořád dál a nikde se nemusí otáčet ani mizet.
// Bez závislostí, ať jde zkoušet i mimo prohlížeč.

const key = (p) => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`;

// streets = [{ width, line: [[x, z], ...] }], allowed(x, z) = smí tudy auto jet
// vrací { edges: [{ a, b, pts, cum, len, width }], nodes: Map(uzel -> [čísla hran]) }
export function streetGraph(streets, allowed, { minWidth = 4.5, step = 4, minLen = 6 } = {}) {
  const lines = streets.filter((s) => s.width >= minWidth && s.line.length >= 2);
  // kolikrát se bod vyskytuje (konec ulice se počítá dvakrát: je to vždy uzel)
  const uses = new Map();
  for (const { line } of lines) {
    line.forEach((p, i) => {
      const k = key(p);
      uses.set(k, (uses.get(k) ?? 0) + (i === 0 || i === line.length - 1 ? 2 : 1));
    });
  }
  const free = (pts) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
      for (let k = 0; k <= n; k++) if (!allowed(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n)) return false;
    }
    return true;
  };
  let edges = [];
  for (const { line, width } of lines) {
    let from = 0;
    for (let i = 1; i < line.length; i++) {
      if (uses.get(key(line[i])) < 2 && i < line.length - 1) continue;
      const pts = line.slice(from, i + 1);
      from = i;
      const cum = [0];
      for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
      const len = cum[cum.length - 1];
      if (len < 0.5 || !free(pts)) continue;
      edges.push({ a: key(pts[0]), b: key(pts[pts.length - 1]), pts, cum, len, width });
    }
  }
  // slepé konce pryč, dokud nějaké jsou
  for (;;) {
    const deg = new Map();
    for (const e of edges) {
      deg.set(e.a, (deg.get(e.a) ?? 0) + 1);
      deg.set(e.b, (deg.get(e.b) ?? 0) + 1);
    }
    const keep = edges.filter((e) => deg.get(e.a) > 1 && deg.get(e.b) > 1);
    if (keep.length === edges.length) break;
    edges = keep;
  }
  // okruh z jediné krátké hrany (smyčka u domu) za auto nestojí
  edges = edges.filter((e) => !(e.a === e.b && e.len < minLen * 4));
  const nodes = new Map();
  edges.forEach((e, i) => {
    for (const n of [e.a, e.b]) {
      if (!nodes.has(n)) nodes.set(n, []);
      nodes.get(n).push(i);
    }
  });
  return { edges, nodes };
}

// poloha na hraně: d metrů od jejího začátku (dir = 1) nebo konce (dir = -1); vrací [x, z, směr x, směr z]
export function alongEdge(e, d, dir, out = []) {
  const t = Math.min(e.len, Math.max(0, dir > 0 ? d : e.len - d));
  let i = 1;
  while (i < e.cum.length - 1 && e.cum[i] < t) i++;
  const a = e.pts[i - 1], b = e.pts[i], seg = e.cum[i] - e.cum[i - 1] || 1;
  const u = (t - e.cum[i - 1]) / seg;
  out[0] = a[0] + (b[0] - a[0]) * u;
  out[1] = a[1] + (b[1] - a[1]) * u;
  out[2] = ((b[0] - a[0]) / seg) * dir;
  out[3] = ((b[1] - a[1]) / seg) * dir;
  return out;
}

// další hrana v uzlu: jiná než ta, po které auto přijelo (když jiná není, vrátí se po ní); pick = náhoda 0–1
// vrací [číslo hrany, směr]
export function nextEdge(graph, edge, dir, pick) {
  const e = graph.edges[edge];
  const node = dir > 0 ? e.b : e.a;
  const list = graph.nodes.get(node);
  const options = [];
  for (const i of list) {
    const o = graph.edges[i];
    if (i === edge && o.a !== o.b) continue;
    if (o.a === node) options.push([i, 1]);
    if (o.b === node && (o.a !== o.b || i !== edge)) options.push([i, -1]);
  }
  if (!options.length) return [edge, -dir];
  return options[Math.min(options.length - 1, Math.floor(pick * options.length))];
}
