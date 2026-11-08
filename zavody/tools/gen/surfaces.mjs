// Plochy: zeleň a les, voda s hladinou z DMR, zpevněná náměstí a parkoviště.
import { cleanRing, signedArea, simplifyRing, clipRing, pointInRing } from '../lib/poly.mjs';
import { dm, flat, closed } from './util.mjs';
import { clearRoad } from './space.mjs';

export function areaKind(t, gardens = new Set()) {
  if (t.landuse === 'forest' || t.natural === 'wood') return 'forest';
  if (t.natural === 'scrub') return 'forest';
  if (gardens.has(t.name)) return 'garden';
  if (t.leisure === 'park' || t.leisure === 'garden') return 'park';
  if (t.landuse === 'cemetery') return 'cemetery';
  if (t.landuse === 'meadow' || t.landuse === 'grass') return 'grass';
  if (t.landuse === 'farmland') return 'field';
  if (t.landuse === 'allotments') return 'allotments';
  if (t.leisure === 'pitch' || t.leisure === 'stadium' || t.leisure === 'track') return 'pitch';
  return null;
}

// obal bodů ze dvou polovin (monotónní řetězec), body seřazené podle x
export function hullOf(pts) {
  const sorted = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (list) => {
    const h = [];
    for (const p of list) {
      while (h.length > 1) {
        const a = h[h.length - 2], b = h[h.length - 1];
        if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) > 0) break;
        h.pop();
      }
      h.push(p);
    }
    return h.slice(0, -1);
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

export function buildSurfaces(g) {
  const { city, area, extra, roads, dem, proj, base, bounds, toGame, ringsOf, minAxisDist, REACH, bump } = g;
  // trávníky se stromy (u radnice v Dobříši): stromy v OSM nejsou, na fotkách ano
  const lawns = new Set(city.lawns ?? []);
  const gardens = new Set(city.gardens ?? []);

  const areas = [];
  for (const e of area) {
    const kind = e.tags && (lawns.has(e.id) ? 'lawn' : areaKind(e.tags, gardens));
    if (!kind || !closed(e)) continue;
    for (const raw of ringsOf(e)) {
      const r = clipRing(cleanRing(raw), bounds);
      if (r.length < 3 || Math.abs(signedArea(r)) < 60) continue;
      areas.push([kind, ...flat(simplifyRing(r, kind === 'forest' || kind === 'field' ? 4 : 1.5))]);
    }
  }

  const water = [];
  for (const e of area) {
    if (e.tags?.natural !== 'water' || !closed(e)) continue;
    for (const raw of ringsOf(e)) {
      const whole = cleanRing(raw);
      // břeh ustoupí silnici stejně jako fasády, voda nesmí do výběhu
      const shore = clearRoad(g, whole);
      if (shore.moved > 0) bump('shoresMoved');
      const r = clipRing(shore.ring, bounds);
      if (r.length < 3 || Math.abs(signedArea(r)) < 80) continue;
      // hladina: medián DMR uvnitř, DMR má na vodě skoro rovinu
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const p of whole) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
      const hs = [];
      const step = Math.max(4, Math.min(x1 - x0, z1 - z0) / 12);
      for (let x = x0; x <= x1; x += step) for (let z = z0; z <= z1; z += step) {
        if (!pointInRing(x, z, whole)) continue;
        const h = dem.height(...proj.inverse(x, -z));
        if (!Number.isNaN(h)) hs.push(h);
      }
      hs.sort((a, b) => a - b);
      const level = hs.length ? hs[Math.floor(hs.length / 2)] - base : null;
      water.push({ name: e.tags.name ?? null, level: level === null ? null : dm(level), p: flat(simplifyRing(r, 1.5)) });
    }
  }

  const paved = [];
  // Náměstí bez plochy v OSM (Mírové náměstí v Dobříši): obrys dá obal jeho ulic včetně pruhů kolem;
  // musí zůstat první plochou 'square', podle toho hra pozná, kam patří historické lampy
  if (city.squareStreet) {
    const pts = [];
    for (const w of roads) if (w.tags.name === city.squareStreet) for (const p of w.geometry) pts.push(toGame(p.lat, p.lon));
    paved.push(['square', ...flat(hullOf(pts))]);
  }
  for (const e of extra) {
    const t = e.tags;
    if (!t || !closed(e)) continue;
    const kind = t.place === 'square' ? 'square' : t.amenity === 'parking' ? 'parking' : null;
    if (!kind) continue;
    for (const raw of ringsOf(e)) {
      const r = cleanRing(raw);
      if (r.length < 3 || minAxisDist(r) > REACH) continue;
      paved.push([kind, ...flat(simplifyRing(r, 0.8))]);
    }
  }
  Object.assign(g.out, { areas, water, paved });
}
