// Výšková mřížka hry z DMR 5G: průměr pěti bodů kolem každého uzlu, výšky v dm nad nejnižším bodem trati.
import { dm } from './util.mjs';
import { DEM_CELL } from './inputs.mjs';

export function buildTerrain(g) {
  const { dem, proj, base, bounds } = g;
  const nx = Math.ceil((bounds.maxX - bounds.minX) / DEM_CELL) + 1;
  const nz = Math.ceil((bounds.maxZ - bounds.minZ) / DEM_CELL) + 1;
  const h = new Array(nx * nz);
  let holes = 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = bounds.minX + i * DEM_CELL, z = bounds.minZ + j * DEM_CELL;
      let s = 0, n = 0;
      for (const [dx, dz] of [[0, 0], [-4, -4], [4, -4], [-4, 4], [4, 4]]) {
        const v = dem.height(...proj.inverse(x + dx, -(z + dz)));
        if (!Number.isNaN(v)) { s += v; n++; }
      }
      if (!n) holes++;
      h[j * nx + i] = n ? dm(s / n - base) : null;
    }
  }
  if (holes) throw new Error(`Výšková mřížka nemá data v ${holes} bodech, doplň listy DMR v fetch-data.mjs.`);
  g.out.dem = { x0: Math.round(bounds.minX), z0: Math.round(bounds.minZ), cell: DEM_CELL, nx, nz, h };
}
