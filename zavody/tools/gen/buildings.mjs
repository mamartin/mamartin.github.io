// Budovy: obrysy z OSM, výšky z DMP 1G nebo podlaží z RÚIAN, barvy podle zón města,
// ořezání do silnice a ručně modelované dominanty (js/landmarks.js) změřené v DMP.
import { wgsToKrovak } from '../lib/geo.mjs';
import { ruianAt } from '../lib/ruian.mjs';
import { roofOf, peakOf } from '../lib/dmp.mjs';
import { cleanRing, signedArea, simplifyRing, minRect, joinOuter, pointInRing } from '../lib/poly.mjs';
import { dm, flat, pick, affineFrom } from './util.mjs';
import { clearRoad, shiftClear } from './space.mjs';

export const ROOF = { gabled: 0, hipped: 1, flat: 2, pyramidal: 3, skillion: 4, mansard: 1, half_hipped: 1, 'half-hipped': 1, gambrel: 0, round: 0, dome: 3 };
// tvar podle bodů DMP 1G; 5 = sedlová s hřebenem napříč delší strany (SHAPE.CROSS ve hře)
export const ROOF_CROSS = 5;
const MEASURED_SHAPE = { gable: ROOF.gabled, hip: ROOF.hipped, flat: ROOF.flat, cross: ROOF_CROSS };
const BASE_WALLS = {
  house: ['#efe7d6', '#f3efe6', '#e6d3a8', '#e8c9a6', '#d9d6cf', '#ddd3bd', '#cfd2c8'],
  centre: ['#e9c46a', '#e8b79a', '#f1e3c6', '#cfdcc0', '#f0d9a8', '#d9a98c', '#efece3', '#c7d3dc'],
  block: ['#d8d8d2', '#e6e2d6', '#c8d0d4', '#e3d3b5', '#cfd6c4'],
  plain: ['#b9b6ae', '#a9a79f', '#c4c0b6'],
};
const ROOFS = {
  tile: ['#9c4a32', '#8a3f2e', '#a85a3c', '#7d3a2c', '#6b5147'],
  grey: ['#565a60', '#6e7176', '#4d4a49'],
  flat: ['#77797c', '#6b6d70', '#85878a'],
};
const NAMED = { sand: '#d9c08e', burlywood: '#deb887', black: '#2a2a2c', white: '#f2f0ea', red: '#a33a2c', grey: '#808080', gray: '#808080', brown: '#6b4a3a' };

// Hmota domu. levels: počet podlaží z RÚIAN, jinak z OSM (import z RÚIAN bývá starší);
// measured: okap, střecha a plochost změřené v DMP 1G mají přednost před vším ostatním
export function massing(t, areaM2, short, levels = parseFloat(t['building:levels']), measured = null) {
  const kind = t.building;
  if (measured) {
    const shape = ROOF[t['roof:shape']] ?? MEASURED_SHAPE[measured.shape];
    const roof = shape === ROOF.flat ? 0 : Math.max(0.8, Math.min(9, shape === ROOF_CROSS ? 9 : short * 0.75, measured.roof));
    return { wall: Math.max(2.4, measured.wall), roof, shape };
  }
  let tagged = parseFloat(t.height);
  // věžák 49589262: 15 podlaží a height=60, přes 4 m na podlaží je výška v OSM chybná
  if (levels > 0 && tagged > levels * 3.6) tagged = NaN;
  let shape = ROOF[t['roof:shape']];
  if (shape === undefined) {
    const wide = areaM2 > 900;
    const low = ['garage', 'garages', 'shed', 'carport'].includes(kind);
    const hall = ['industrial', 'warehouse', 'retail', 'commercial', 'service'].includes(kind) && areaM2 > 250;
    shape = levels >= 4 || wide || low || hall ? ROOF.flat : ROOF.gabled;
  }
  const roof = shape === ROOF.flat ? 0 : Math.max(1.4, Math.min(5.5, short * 0.42));
  let wall;
  if (tagged > 0) wall = Math.max(2.4, tagged - roof);
  else if (levels > 0) wall = levels * 3;
  else if (['garage', 'garages', 'carport'].includes(kind)) wall = 2.6;
  else if (kind === 'shed' || areaM2 < 25) wall = 2.4;
  else if (kind === 'barn') wall = 4.5;
  else if (['industrial', 'warehouse', 'civic', 'commercial', 'retail', 'service'].includes(kind)) wall = 6.5;
  else if (kind === 'school') wall = 9;
  else if (areaM2 < 45) wall = 3;
  else wall = 4.5;
  return { wall, roof, shape };
}

export function buildBuildings(g) {
  const { city, area, ruian, roofPoints, dem, toGame, axisDist, inFar, alongCentre, REACH, bump } = g;
  const LANDMARKS = city.landmarks ?? {};
  // vlastní palety města (podle panoramat), které platí v zónách podle city.facadeZone
  const WALLS = { ...BASE_WALLS, ...city.walls };
  const wallPalette = [...new Set(Object.values(WALLS).flat())];
  const roofPalette = [...new Set(Object.values(ROOFS).flat())];
  const colourIndex = (palette, value) => {
    const hex = value.startsWith('#') ? value : NAMED[value.toLowerCase()];
    if (!hex) return null;
    if (!palette.includes(hex)) palette.push(hex);
    return palette.indexOf(hex);
  };
  // stavební objekt RÚIAN k budově: podle ref:ruian:building, jinak podle těžiště
  const ruianByCode = new Map(ruian.map((o) => [o.code, o]));
  function ruianOf(t, latlon) {
    const byRef = ruianByCode.get(+t['ref:ruian:building']);
    if (byRef) return byRef;
    const la = latlon.reduce((s, p) => s + p[0], 0) / latlon.length, lo = latlon.reduce((s, p) => s + p[1], 0) / latlon.length;
    return ruianAt(ruian, ...wgsToKrovak(la, lo));
  }
  const nearCentre = (x, z) => alongCentre(x, z).d < 120;
  const zoneOf = (x, z) => city.facadeZone?.(x, z, alongCentre(x, z)) ?? null;

  function styleOf(e, t, x, z, shape, wall) {
    const id = e.id;
    const blocks = wall >= 12;
    const plain = ['garage', 'garages', 'shed', 'industrial', 'warehouse', 'service'].includes(t.building);
    const zone = plain || blocks ? null : zoneOf(x, z);
    const wallSet = plain ? WALLS.plain : blocks ? WALLS.block : zone ? WALLS[zone] : nearCentre(x, z) ? WALLS.centre : WALLS.house;
    const roofSet = shape === ROOF.flat ? ROOFS.flat : (id % 7 === 0 ? ROOFS.grey : ROOFS.tile);
    const w = t['building:colour'] ? colourIndex(wallPalette, t['building:colour']) : null;
    const r = t['roof:colour'] ? colourIndex(roofPalette, t['roof:colour']) : null;
    if (w !== null) bump('facadeFromData');
    if (r !== null) bump('roofFromData');
    return { wall: w ?? wallPalette.indexOf(pick(wallSet, id)), roof: r ?? roofPalette.indexOf(pick(roofSet, id * 31 + 5)) };
  }

  const buildings = [];
  const levels = []; // [index budovy, podlaží, …] jen kde se liší od výšky stěny
  const landmarks = [];
  const landmarkRings = [];
  const pushback = [];
  const overlapsLandmark = (r) => landmarkRings.some((l) => r.some((p) => pointInRing(p[0], p[1], l)) || l.some((p) => pointInRing(p[0], p[1], r)));

  // dominanty napřed: domy, které by se s odsunutou dominantou překryly, se pak vynechají
  for (const e of area) {
    const id = LANDMARKS[e.id];
    if (!id || !e.tags?.building) continue;
    const t = e.tags;
    // relace (budova s nádvořím): vnější obrys a nádvoří zvlášť
    const outer = e.type === 'relation' ? joinOuter(e.members ?? [])[0] : e.geometry.map((p) => [p.lat, p.lon]);
    const holes = e.type === 'relation' ? joinOuter(e.members ?? [], true).map((h) => cleanRing(h.map(([la, lo]) => toGame(la, lo)))) : [];
    const r0 = cleanRing(outer.map(([la, lo]) => toGame(la, lo)));
    const { ring: r, moved } = shiftClear(g, r0);
    const m = massing(t, Math.abs(signedArea(r)), minRect(r)[0]);
    if (moved > 0) console.log(`dominanta ${id}: odsunuta o ${moved.toFixed(1)} m`);
    landmarkRings.push(r);
    // city.measureLandmarks: věž a loď změřené v DMP 1G ([x, z, vrchol, hranol věže, šířka věže, okap a hřeben lodi] v dm, výšky nad terénem);
    // poloha věže se z S-JTSK převede stejným posunem a natočením jako půdorys
    let peak;
    if (city.measureLandmarks && roofPoints) {
      const kr = outer.map(([la, lo]) => wgsToKrovak(la, lo));
      const pk = peakOf(roofPoints, kr, dem.krovak);
      if (pk) {
        const gm = outer.map(([la, lo]) => toGame(la, lo));
        const [x, z] = affineFrom(kr, gm)(pk.e, pk.n);
        const [dx, dz] = [r[0][0] - r0[0][0], r[0][1] - r0[0][1]]; // odsunutí od trati
        peak = [dm(x + dx), dm(z + dz), dm(pk.top), dm(pk.body), dm(pk.size), pk.nave ? dm(pk.nave.eave) : 0, pk.nave ? dm(pk.nave.ridge) : 0];
        console.log(`dominanta ${id}: věž ${pk.top.toFixed(1)} m (hranol ${pk.body.toFixed(1)} m)${pk.nave ? `, loď ${pk.nave.eave.toFixed(1)}–${pk.nave.ridge.toFixed(1)} m` : ', loď bez bodů'}`);
      }
    }
    landmarks.push({
      ...(peak ? { peak } : {}),
      id, name: t.name ?? null, wall: dm(m.wall), levels: parseFloat(t['building:levels']) || null,
      height: parseFloat(t.height) || null, facade: t['building:colour'] ?? null, roofColour: t['roof:colour'] ?? null, roofShape: t['roof:shape'] ?? null,
      moved: +moved.toFixed(1), p: flat(simplifyRing(r, 0.3)),
      ...(holes.length ? { holes: holes.map((h) => flat(simplifyRing(h, 0.3))) } : {}),
    });
  }

  for (const e of area) {
    const t = e.tags;
    if (!t?.building || t.building === 'roof' || t.building === 'carport') continue;
    const rings = e.type === 'relation' ? joinOuter(e.members ?? []) : [(e.geometry ?? []).map((p) => [p.lat, p.lon])];
    for (const latlon of rings) {
      let r = cleanRing(latlon.map(([la, lo]) => toGame(la, lo)));
      if (r.length < 3) continue;
      const d = r.reduce((m, p) => Math.min(m, axisDist(p[0], p[1])), Infinity);
      if (d > REACH && !r.some((p) => inFar(p[0], p[1]))) continue;
      const a0 = Math.abs(signedArea(r));
      if (LANDMARKS[e.id]) continue;
      if (a0 < 12) { bump('tinySkipped'); continue; }
      if (overlapsLandmark(r)) { bump('droppedForLandmark'); continue; }
      const c = clearRoad(g, r);
      if (c.conflict) { bump('droppedOnRoad'); continue; }
      if (c.moved > 0) {
        const a1 = Math.abs(signedArea(c.ring));
        if (a1 < 16 || a1 < a0 * 0.3) { bump('droppedTooSmall'); continue; }
        r = c.ring;
        pushback.push(c.moved);
      }
      r = cleanRing(simplifyRing(r, d < 150 ? 0.5 : 1.2));
      if (r.length < 3) continue;
      if (signedArea(r) < 0) r.reverse();
      const areaM2 = Math.abs(signedArea(r));
      const [short] = minRect(r);
      const so = ruianOf(t, latlon);
      const measured = roofPoints && roofOf(roofPoints, latlon.map(([la, lo]) => wgsToKrovak(la, lo)), dem.krovak);
      if (measured) bump('heightFromDmp');
      else if (so) bump('levelsFromRuian');
      const m = massing(t, areaM2, short, so?.levels, measured);
      const cx = r.reduce((s, p) => s + p[0], 0) / r.length, cz = r.reduce((s, p) => s + p[1], 0) / r.length;
      const st = styleOf(e, t, cx, cz, m.shape, m.wall);
      // city.parcels: počet podlaží z RÚIAN/OSM pro řady oken, když se liší od výšky stěny po 3 m
      const lv = so?.levels ?? (parseFloat(t['building:levels']) || null);
      if (city.parcels && lv && lv >= 1 && lv <= 30 && Math.round(m.wall / 3) !== Math.round(lv)) levels.push(buildings.length, Math.round(lv));
      buildings.push([dm(m.wall), dm(m.roof), m.shape, st.wall, st.roof, ...flat(r)]);
    }
  }
  g.stats.buildings = buildings.length;
  g.stats.landmarks = landmarks.length;
  g.stats.buildingsTrimmed = pushback.length;
  g.stats.maxTrim = +Math.max(0, ...pushback).toFixed(1);
  Object.assign(g.out, { buildings, levels, landmarks });
  g.palette = { wall: wallPalette, roof: roofPalette, plain: WALLS.plain.map((c) => wallPalette.indexOf(c)) };
}
