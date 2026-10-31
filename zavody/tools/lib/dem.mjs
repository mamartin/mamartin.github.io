// Čtení výškové mřížky z laz2grid.mjs.
import { readFileSync } from 'node:fs';
import { wgsToKrovak } from './geo.mjs';

export function loadDem(binPath) {
  const g = JSON.parse(readFileSync(binPath.replace(/\.bin$/, '') + '.json', 'utf8'));
  const raw = readFileSync(binPath);
  const d = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const at = (c, r) => d[Math.max(0, Math.min(g.ny - 1, r)) * g.nx + Math.max(0, Math.min(g.nx - 1, c))];
  return {
    // bilineárně; mimo mřížku vrací NaN
    height(lat, lon) {
      const [e, n] = wgsToKrovak(lat, lon);
      const c = (e - g.minX) / g.cell, r = (g.maxY - n) / g.cell;
      if (c < 0 || r < 0 || c > g.nx - 1 || r > g.ny - 1) return NaN;
      const c0 = Math.floor(c), r0 = Math.floor(r), u = c - c0, v = r - r0;
      return (at(c0, r0) * (1 - u) + at(c0 + 1, r0) * u) * (1 - v) + (at(c0, r0 + 1) * (1 - u) + at(c0 + 1, r0 + 1) * u) * v;
    },
  };
}
