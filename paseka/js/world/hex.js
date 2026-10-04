// Šestiúhelníková mřížka s plochým vrškem v axiálních souřadnicích (q, r).
// Hrana i leží mezi rohy i a i+1 a sousedí s políčkem ve směru EDGE_DIRS[i].

export const SQRT3 = Math.sqrt(3);
export const EDGE_DIRS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];

export const hexKey = (q, r) => `${q},${r}`;

export function hexToWorld(q, r, size = 1) {
  return { x: size * 1.5 * q, z: size * SQRT3 * (r + q / 2) };
}

export function worldToHex(x, z, size = 1) {
  return hexRound((2 / 3) * x / size, (-x / 3 + (SQRT3 / 3) * z) / size);
}

function hexRound(q, r) {
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

export const hexDistance = (q, r) => (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;

export function hexCorner(i, size = 1) {
  const a = (Math.PI / 3) * i;
  return [Math.cos(a) * size, Math.sin(a) * size];
}

// Všechna políčka do vzdálenosti `radius` od středu.
export function hexesInRadius(radius) {
  const out = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) out.push({ q, r });
  }
  return out;
}
