// Osa trati: trasa po ulicích OSM, šířky podle katastru, definice trati pro hru a úseky podél ní
// (kostky, značení, mosty, městské okraje). Úseky jsou body ve světě, ať sedí i na obrácené trati.
import { localProjection, wgsToKrovak } from '../lib/geo.mjs';
import { corridorWidth } from '../lib/parcels.mjs';
import { buildGraph, routeLoop } from '../lib/roads.mjs';
import { sampleAxis, rotateAxis, fitTrack } from '../lib/axis.mjs';
import { buildCenterline, validateCenterline } from '../../js/trackmath.js';
import { RUNOFF, WIDTH_MIN, WIDTH_MAX, WIDTH_SCALE } from './inputs.mjs';

// Šířka vozovky: OSM ji u těchto ulic nemá. Měří se šířka silničního pozemku v katastru (RÚIAN)
// a vozovka je její podíl ROAD_SHARE, nastavený tak, aby silnice II. třídy měly v průměru 8 m
// (medián jejich pozemků v Dobříši je 15,5 m, stejný podíl platí pro všechna města). Bez měření zůstane odhad podle kategorie.
const ROAD_SHARE = 0.52;
const MEASURED = new Set(['secondary', 'tertiary', 'unclassified', 'residential', 'living_street']); // service vede často přes parkoviště
export function realWidth(tags) {
  if (tags.surface === 'sett' && tags.highway === 'secondary') return 8.5; // dlážděné náměstí (Mírové náměstí v Dobříši)
  if (tags.highway === 'secondary') return (+tags.lanes || 2) >= 3 ? 10 : 8;
  if (tags.highway === 'tertiary') return 7;
  if (tags.highway === 'unclassified') return 6;
  return 6;
}
export const roadWidth = (tags, corridor) => (corridor && MEASURED.has(tags.highway) ? Math.max(3, Math.min(10, corridor * ROAD_SHARE)) : null);

// počet pruhů pro čáry: 0 = bez čar (lane_markings=no, obytné ulice bez pruhů), 1 = jednopruhová (kruhový objezd),
// 2 = středová čára (výchozí), 3+ = čáry mezi pruhy
export function lanesOf(t) {
  if (t.lane_markings === 'no') return 0;
  const n = parseInt(t.lanes, 10);
  if (!n) return ['residential', 'living_street', 'service', 'unclassified'].includes(t.highway) ? 0 : 2;
  return Math.min(4, n);
}

// Souvislé úseky osy (vzorky cl), kde platí test, delší než minLen metrů, jako dvojice at(k).
// Hra úsek měří kratším směrem, proto se dlouhé dělí na třetiny kola, a úsek až do cíle končí na startu (bez mezery na švu).
export function spansOf(cl, test, minLen, at) {
  const out = [];
  const piece = Math.floor(cl.N / 3);
  for (let k = 0, run = -1; k <= cl.N; k++) {
    const on = k < cl.N && test(k);
    if (on && run < 0) run = k;
    if (on || run < 0) continue;
    if (cl.s[k - 1] - cl.s[run] > minLen) {
      const end = k === cl.N && test(0) ? 0 : k - 1;
      let a = run;
      for (; (end || cl.N) - a > piece; a += piece) out.push([at(a), at(a + piece)]);
      out.push([at(a), at(end)]);
    }
    run = -1;
  }
  return out;
}

// průměr okna ±R vzorků v kruhu (±30 m), ať se šířka nemění skokem
function smoothWidth(widths, i, R = 15) {
  let s = 0;
  for (let o = -R; o <= R; o++) s += widths[(i + o + widths.length) % widths.length];
  return s / (2 * R + 1);
}

// pro každý vzorek osy hry nejbližší vzorek osy z OSM (postupuje dopředu, osa se nevrací)
export function matchAxis(cl, axis) {
  const idx = new Int32Array(cl.N);
  let j = 0;
  for (let k = 0; k < cl.N; k++) {
    let best = j, bd = Infinity;
    for (let o = -60; o <= 200; o++) {
      const i = (j + o + axis.length) % axis.length;
      const d = (axis[i].x - cl.px[k]) ** 2 + (axis[i].y + cl.pz[k]) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    j = best;
    idx[k] = best;
  }
  return idx;
}

export function buildTrack(g) {
  const { city, dem, roads, candidate, roadParcels } = g;
  // počátek je start, proto se trasa hledá dvakrát: poprvé kvůli poloze startu
  const survey = localProjection(...city.survey);
  const first = routeLoop(buildGraph(roads, survey.forward), candidate.via);
  const startAt = rotateAxis(sampleAxis(first.nodes, dem, survey), ...city.start)[0];
  const [lat0, lon0] = survey.inverse(startAt.x, startAt.y);
  const proj = localProjection(lat0, lon0);
  const via = candidate.via.map(([x, y, street]) => [...proj.forward(...survey.inverse(x, y)), street]);
  const loop = routeLoop(buildGraph(roads, proj.forward), via);
  const axis = rotateAxis(sampleAxis(loop.nodes, dem, proj), 0, 0);
  const base = Math.min(...axis.map((p) => p.hs));
  const relAxis = axis.map((p) => ({ ...p, hs: p.hs - base }));

  // medián šířky silničního pozemku podél čáry (body [x, y] s y na sever); null bez dost měření
  function corridorOf(pts) {
    if (!roadParcels) return null;
    const ws = [];
    const kr = pts.map(([x, y]) => wgsToKrovak(...proj.inverse(x, y)));
    for (let k = 0; k + 1 < kr.length; k++) {
      const a = kr[k], b = kr[k + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l < 1) continue;
      for (let d = 0.5; d < l; d += 8) {
        const w = corridorWidth(roadParcels, a[0] + ((b[0] - a[0]) * d) / l, a[1] + ((b[1] - a[1]) * d) / l, (b[0] - a[0]) / l, (b[1] - a[1]) / l);
        if (w) ws.push(w);
      }
    }
    if (ws.length < 3) return null;
    ws.sort((a, b) => a - b);
    return ws[ws.length >> 1];
  }

  // šířka po úsecích osy (hrana grafu = kus ulice mezi křižovatkami)
  const segWidth = new Map();
  for (const seg of new Set(axis.map((p) => p.seg))) {
    const pts = axis.filter((p) => p.seg === seg).map((p) => [p.x, p.y]);
    const w = roadWidth(loop.edges[seg].way.tags, corridorOf(pts));
    if (w) segWidth.set(seg, w);
  }
  // šířka ve hře: skutečná krát scale v mezích; city.widths může dát skutečnější rovinky a rozšíření v zatáčkách
  const W = { scale: WIDTH_SCALE, min: WIDTH_MIN, max: WIDTH_MAX, corner: 0, ...city.widths };
  const widths = axis.map((p) => {
    const w = (segWidth.get(p.seg) ?? realWidth(loop.edges[p.seg].way.tags)) * W.scale;
    return Math.max(W.min, Math.min(W.max, w));
  });
  g.stats.trackWidthMeasured = `${segWidth.size}/${new Set(axis.map((p) => p.seg)).size} úseků`;

  // s rozšířením v zatáčkách se trať ověřuje s největší možnou šířkou
  const widest = W.corner ? W.max : Math.max(...widths);
  const points = fitTrack(relAxis, { width: widest, runoff: RUNOFF, startFlat: true, maxLen: 45 });
  const def = {
    id: city.id,
    name: city.name,
    subtitle: city.subtitle,
    biome: 'town',
    width: 12,
    runoff: RUNOFF,
    maxBank: 0.015,
    seed: city.seed,
    smooth: 2,
    scene: g.sceneUrl,
    credit: 'Mapová data © přispěvatelé OpenStreetMap (ODbL), výškopis, DMP a RÚIAN © ČÚZK (CC BY 4.0)',
    points,
  };
  const cl = buildCenterline(def);
  const check = validateCenterline(cl, widest / 2, RUNOFF);
  if (!check.ok) throw new Error(`Trať neprošla validací hry: ${JSON.stringify({ r: check.minRadius, sep: check.minSeparation, grade: check.maxGrade })}`);

  // profil šířky: pro každý vzorek osy hry nejbližší vzorek osy z OSM
  const clAxis = matchAxis(cl, axis);
  const clWidth = new Float32Array(cl.N);
  for (let k = 0; k < cl.N; k++) clWidth[k] = smoothWidth(widths, clAxis[k]);
  if (W.corner) {
    // rozšíření podle nejostřejšího místa ±25 m (začne před zatáčkou), pak vyhlazené, nejvýš do W.max
    const win = Math.round(25 / cl.step), sm = Math.round(10 / cl.step);
    const peak = Float32Array.from({ length: cl.N }, (_, k) => {
      let m = 0;
      for (let o = -win; o <= win; o++) m = Math.max(m, Math.abs(cl.kappa[(k + o + cl.N) % cl.N]));
      return Math.min(W.cornerMax ?? 3.5, W.corner * m);
    });
    const base = Float32Array.from(clWidth);
    for (let k = 0; k < cl.N; k++) {
      let s = 0;
      for (let o = -sm; o <= sm; o++) s += peak[(k + o + cl.N) % cl.N];
      clWidth[k] = Math.min(W.max, base[k] + s / (2 * sm + 1));
    }
  }
  def.widths = [];
  for (let k = 0; k < cl.N; k += 10) {
    const w = Math.round(clWidth[k] * 2) / 2;
    const s = Math.round(cl.s[k]);
    if (!def.widths.length || def.widths[def.widths.length - 1][1] !== w) def.widths.push([s, w]);
  }

  const at = (k, lat = 0) => [+(cl.px[k] + cl.rx[k] * lat).toFixed(1), +(cl.pz[k] + cl.rz[k] * lat).toFixed(1)];
  // tribuna vpravo za výběhem
  def.stand = at(Math.round(city.stand / cl.step), widest / 2 + RUNOFF + 13);

  Object.assign(g, {
    proj, lat0, lon0, loop, axis, relAxis, base, def, cl, check, clAxis, clWidth, widest, corridorOf, at,
    spansWhere: (test, minLen = 20) => spansOf(cl, test, minLen, at),
    tagsAt: (k) => loop.edges[axis[clAxis[k]].seg].way.tags,
  });
}

// kostky, vodorovné značení a mosty podle OSM
export function trackSpans(g) {
  const { city, def, spansWhere, tagsAt } = g;
  // city.markings: dlažba i z dalších druhů kostek a vodorovné značení podle OSM
  const SETT = city.markings ? new Set(['sett', 'cobblestone', 'cobbles', 'unhewn_cobblestone']) : new Set(['sett']);
  def.sett = spansWhere((k) => SETT.has(tagsAt(k).surface));
  if (city.markings) {
    def.markings = [];
    for (const n of [0, 1, 3, 4]) for (const span of spansWhere((k) => lanesOf(tagsAt(k)) === n, 15)) def.markings.push([...span, n]);
  }
  // mosty: DMR je holý terén, pod mostem má údolí nebo zářez, kontrola scény je proto vynechá
  const bridges = spansWhere((k) => tagsAt(k).bridge === 'yes', 0);
  if (bridges.length) def.bridges = bridges;
}

// Okraj chodníku po stranách ([od, do, bod na té straně, druh]); jinde chodník bez zábradlí:
//   'rail'  zábradlí na mostě a tam, kde terén za chodníkem padá (DMR o víc než 1,5 m pod vozovkou),
//   'grass' travnatý pás místo chodníku, kde do 30 m od okraje nestojí žádný dům (okraj města, parky).
// skip: vzorky se svodidlem nebo v centru (sloupky), tam se nic nemění
const EDGE_MIN = 30; // nejkratší úsek jednoho druhu (m)
function edgeKinds(g, skip) {
  const { cl, clWidth, dem, proj, base, out, tagsAt } = g;
  // domy v mřížce po 20 m podle bodů obrysu
  const CELL = 20, cells = new Map();
  for (const b of [...out.buildings, ...out.landmarks.map((l) => [0, 0, 0, 0, 0, ...l.p])]) {
    for (let i = 5; i + 1 < b.length; i += 2) {
      const key = `${Math.floor(b[i] / 10 / CELL)},${Math.floor(b[i + 1] / 10 / CELL)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(b[i] / 10, b[i + 1] / 10);
    }
  }
  const houseNear = (x, z, r) => {
    for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) {
      for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) {
        const pts = cells.get(`${i},${j}`);
        if (pts) for (let q = 0; q < pts.length; q += 2) if (Math.hypot(pts[q] - x, pts[q + 1] - z) < r) return true;
      }
    }
    return false;
  };
  const ground = (x, z) => dem.height(...proj.inverse(x, -z)) - base;
  const edges = [];
  for (const side of [-1, 1]) {
    const kind = new Array(cl.N).fill(null);
    for (let k = 0; k < cl.N; k++) {
      if (skip(k)) continue;
      const e = clWidth[k] / 2 + RUNOFF;
      const px = (lat) => cl.px[k] + cl.rx[k] * side * lat, pz = (lat) => cl.pz[k] + cl.rz[k] * side * lat;
      if (tagsAt(k).bridge === 'yes') { kind[k] = 'rail'; continue; }
      const drop = cl.py[k] - Math.max(ground(px(e + 3), pz(e + 3)), ground(px(e + 6), pz(e + 6)));
      if (drop > 1.5) kind[k] = 'rail';
      else if (!houseNear(px(e + 15), pz(e + 15), 16)) kind[k] = 'grass';
    }
    // vyhlazení: krátké úseky zmizí, krátké mezery mezi stejnými se zacelí
    const minN = Math.round(EDGE_MIN / cl.step);
    for (const fill of [true, false]) {
      for (let k = 0; k < cl.N;) {
        let n = k;
        while (n < cl.N && kind[n] === kind[k]) n++;
        const short = n - k < minN;
        if (fill && short && kind[k] === null && k > 0 && n < cl.N && kind[k - 1] === kind[n] && kind[n] !== 'rail') kind.fill(kind[n], k, n);
        else if (!fill && short && kind[k] !== null) kind.fill(null, k, n);
        k = n;
      }
    }
    for (const type of ['rail', 'grass']) {
      for (const [a, b] of spansOf(cl, (k) => kind[k] === type, EDGE_MIN - 1, (k) => [+cl.px[k].toFixed(1), +cl.pz[k].toFixed(1)])) {
        const ka = cl.px.findIndex((x, i) => +x.toFixed(1) === a[0] && +cl.pz[i].toFixed(1) === a[1]);
        const kb = cl.px.findIndex((x, i) => +x.toFixed(1) === b[0] && +cl.pz[i].toFixed(1) === b[1]);
        const km = kb >= ka ? (ka + kb) >> 1 : ((ka + kb + cl.N) >> 1) % cl.N;
        const lat = side * (clWidth[km] / 2 + RUNOFF + 2);
        edges.push([a, b, [+(cl.px[km] + cl.rx[km] * lat).toFixed(1), +(cl.pz[km] + cl.rz[km] * lat).toFixed(1)], type]);
      }
    }
  }
  g.stats.edges = edges.reduce((o, e) => ({ ...o, [e[3]]: (o[e[3]] ?? 0) + 1 }), {});
  return edges;
}

// Okraje: centrum (náměstí a okolí startu) má místo svodidel obrubník a sloupky, jízda se nemění.
// urban.all: obrubník a chodník po celé trati (ve městě nejsou svodidla), sloupky jen v centru, jinde zábradlí;
// kde OSM zná svodidlo (barrier=guard_rail) podél trati, zůstane svodidlo
export function edgeSpans(g) {
  const { city, def, cl, clWidth, spansWhere, alongCentre, nearAxis, toGame, extra, FAR } = g;
  const URBAN = city.urban ?? { start: 0, centre: 0 };
  const inCentre = (k) => alongCentre(cl.px[k], cl.pz[k]).d < URBAN.centre || Math.hypot(cl.px[k], cl.pz[k]) < URBAN.start;
  if (URBAN.all) {
    const rails = extra.filter((e) => e.tags?.barrier === 'guard_rail' && e.geometry).map((e) => e.geometry.map((p) => toGame(p.lat, p.lon)));
    const railNear = new Uint8Array(cl.N);
    for (const line of rails) {
      // čára, ne obrys: každá hrana zvlášť po 2 m
      const pts = line.slice(1).flatMap((b, i) => {
        const a = line[i], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2);
        return Array.from({ length: n }, (_, j) => [a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
      });
      for (const p of pts) {
        const n = nearAxis(p[0], p[1]);
        if (n && n.d < clWidth[n.k] / 2 + RUNOFF + 4) railNear[n.k] = 1;
      }
    }
    def.urban = spansWhere((k) => !railNear[k]);
    def.bollards = spansWhere(inCentre);
    def.edges = edgeKinds(g, (k) => railNear[k] || inCentre(k));
    g.stats.guardRails = `${rails.length} v OSM, u trati ${railNear.reduce((a, b) => a + b, 0)} vzorků`;
  } else def.urban = spansWhere(inCentre);
  // vzdálená místa pro terén hry: mřížka je pokryje a nepřidá kolem nich umělé kopce z okraje
  if (FAR.length) def.far = FAR.map((f) => [Math.round(f.xz[0]), Math.round(f.xz[1]), f.r]);
}
