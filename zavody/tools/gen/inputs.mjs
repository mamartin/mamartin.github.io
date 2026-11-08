// Vstupy generátoru: stažená data města (fetch-data.mjs) a pevné konstanty trati.
import { readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { loadRuian } from '../lib/ruian.mjs';
import { loadDmp } from '../lib/dmp.mjs';
import { loadRoadParcels } from '../lib/parcels.mjs';
import { loadDem } from '../lib/dem.mjs';
import { GAME } from '../lib/city.mjs';

export const WIDTH_MIN = 10, WIDTH_MAX = 13, WIDTH_SCALE = 1.5;
export const RUNOFF = 3;
export const MARGIN = 560;      // výšková mřížka a plochy kolem obdélníku trati
export const DEM_CELL = 12;
export const FACADE_GAP = 1.2;  // kolik volného místa zůstane mezi výběhem a fasádou
export const FOREST_EDGE = 60;  // pás lesa u trati, kde jsou stromy z DMP i v lese

// odhad šířky ulic mimo trať podle kategorie, když ji katastr nezměří
export const STREET_W = { secondary: 8, secondary_link: 6, tertiary: 7, tertiary_link: 6, unclassified: 6, residential: 5.5, living_street: 4.5, pedestrian: 5, service: 3.5 };

// Stav generátoru: vstupy, osa trati, dotazy na prostor a postupně plněné kulisy.
// Kroky v gen/*.mjs do něj zapisují a čtou z něj, pořadí kroků je v osm2track.mjs.
export async function loadInputs(ctx) {
  const { city } = ctx;
  const DATA = ctx.data;
  const read = (name) => JSON.parse(readFileSync(join(DATA, name), 'utf8')).elements;
  const optional = (name) => (existsSync(join(DATA, name)) ? read(name) : null);
  const candidate = JSON.parse(readFileSync(ctx.loops, 'utf8')).find((c) => c.id === city.loop);
  if (!candidate) throw new Error(`Okruh ${city.loop} není v ${relative(GAME, ctx.loops)}`);
  const dmp = await loadDmp(join(DATA, 'dmp')); // DMP 1G, bez něj se výšky budov odhadnou a stromy rozmístí hra
  const stats = {};
  return {
    ctx, city, DATA,
    REACH: city.reach ?? 400, // budovy a další kulisy do této vzdálenosti od osy
    dem: loadDem(join(DATA, 'dmr/grid.bin')),
    roadParcels: loadRoadParcels(join(DATA, 'ruian')),
    ruian: loadRuian(join(DATA, 'ruian')),
    dmp,
    roofPoints: dmp?.roofs,
    roads: read('osm_roads.json').filter((e) => e.type === 'way'),
    area: read('osm_area.json'),
    extra: read('osm_extra.json'),
    poi: read('osm_poi.json'),
    poiShops: optional('osm_shops.json') ?? [],
    osmSigns: optional('osm_signs.json'),
    candidate,
    stats,
    bump: (key, n = 1) => { stats[key] = (stats[key] ?? 0) + n; },
    // kulisy (scéna) a definice trati, plní je kroky
    out: {},
    def: null,
  };
}
