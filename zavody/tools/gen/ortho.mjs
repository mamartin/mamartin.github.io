// Barvy střech z ortofota ČÚZK (tools/data/<město>/orto, stáhne fetch-data.mjs orto).
// Dlaždice jsou v S-JTSK (EPSG:5514), 1 m na pixel, řádek 0 je na severu. Barva střechy je medián pixelů uvnitř
// půdorysu aspoň 1 m od okraje (bez stínů a okapů), bez zeleně (koruny stromů přes střechu) a bez nejtmavších
// a nejsvětlejších pixelů (stín komína, odlesk). Výsledné barvy se seskupí do malé palety.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng } from '../lib/png.mjs';

export function loadOrtho(dir) {
  const file = join(dir, 'index.json');
  if (!existsSync(file)) return null;
  const idx = JSON.parse(readFileSync(file, 'utf8'));
  const have = new Set(idx.tiles);
  const cache = new Map();
  const tileOf = (key) => {
    if (!have.has(key)) return null;
    if (!cache.has(key)) cache.set(key, decodePng(readFileSync(join(dir, `${key}.png`))));
    return cache.get(key);
  };
  const T = idx.tile, mpp = idx.tile / idx.px;
  // pixel na souřadnici S-JTSK [e, n], nebo null mimo stažené dlaždice
  const at = (e, n) => {
    const i = Math.floor(e / T), j = Math.floor(n / T);
    const t = tileOf(`${i}_${j}`);
    if (!t) return null;
    const x = Math.min(t.w - 1, Math.floor((e - i * T) / mpp)), y = Math.min(t.h - 1, Math.floor(((j + 1) * T - n) / mpp));
    const k = (y * t.w + x) * 3;
    return [t.rgb[k], t.rgb[k + 1], t.rgb[k + 2]];
  };
  return { at, mpp };
}

const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
  const u = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - ax - dx * u, py - ay - dy * u);
};

// půdorys v S-JTSK [[e, n], …] -> [r, g, b] nebo null (málo použitelných pixelů)
export function roofColour(ortho, ring, inset = 1) {
  let e0 = Infinity, e1 = -Infinity, n0 = Infinity, n1 = -Infinity;
  for (const [e, n] of ring) { e0 = Math.min(e0, e); e1 = Math.max(e1, e); n0 = Math.min(n0, n); n1 = Math.max(n1, n); }
  const step = ortho.mpp;
  const px = [];
  let total = 0;
  for (let e = e0 + step / 2; e < e1; e += step) for (let n = n0 + step / 2; n < n1; n += step) {
    let inside = false, edge = Infinity;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ae, an] = ring[i], [be, bn] = ring[j];
      if ((an > n) !== (bn > n) && e < ((be - ae) * (n - an)) / (bn - an) + ae) inside = !inside;
      edge = Math.min(edge, segDist(e, n, ae, an, be, bn));
    }
    if (!inside || edge < inset) continue;
    const c = ortho.at(e, n);
    if (!c) return null;
    total++;
    const [r, g, b] = c;
    if (g > r + 6 && g > b + 6) continue; // zeleň
    px.push(c);
  }
  if (px.length < 6 || px.length < total * 0.35) return null;
  const lum = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
  px.sort((a, b) => lum(a) - lum(b));
  const mid = px.slice(Math.floor(px.length * 0.15), Math.ceil(px.length * 0.85));
  const med = (k) => { const v = mid.map((c) => c[k]).sort((a, b) => a - b); return v[v.length >> 1]; };
  return [med(0), med(1), med(2)];
}

// k-means v RGB s pevným začátkem (kvantily jasu), aby byl výstup stálý
export function quantize(colours, k) {
  if (!colours.length) return { centres: [], label: [] };
  const lum = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
  const sorted = [...colours].sort((a, b) => lum(a) - lum(b));
  k = Math.min(k, colours.length);
  let centres = Array.from({ length: k }, (_, i) => [...sorted[Math.floor(((i + 0.5) / k) * sorted.length)]]);
  const label = new Array(colours.length).fill(0);
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  for (let it = 0; it < 25; it++) {
    for (let i = 0; i < colours.length; i++) {
      let best = 0;
      for (let c = 1; c < k; c++) if (d2(colours[i], centres[c]) < d2(colours[i], centres[best])) best = c;
      label[i] = best;
    }
    const sum = centres.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < colours.length; i++) {
      const s = sum[label[i]];
      s[0] += colours[i][0]; s[1] += colours[i][1]; s[2] += colours[i][2]; s[3]++;
    }
    centres = centres.map((c, i) => (sum[i][3] ? [sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]] : c));
  }
  return { centres: centres.map((c) => c.map(Math.round)), label };
}

// letecký snímek je zamlžený a zesvětlený: sytost, gama a jas zpět k herní paletě (pálená taška z ortofota
// 201,158,146 vyjde kolem #b25d48, šedá 150 kolem #616161)
export function vivid([r, g, b], sat = 1.8, gamma = 1.4, gain = 0.82) {
  const m = r * 0.3 + g * 0.59 + b * 0.11;
  return [r, g, b].map((v) => {
    const c = Math.max(0, Math.min(255, m + (v - m) * sat)) / 255;
    return Math.round(255 * Math.pow(c, gamma) * gain);
  });
}

export const hexOf = ([r, g, b]) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
