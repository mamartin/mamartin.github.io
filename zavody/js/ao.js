// Předpočítané stínění (ambient occlusion) domů: jednou při stavbě města, ve hře nic nestojí.
// Domy u trati se vykreslí do rastru výšek (1 m) a každý vrchol stěny nebo střechy se podívá několika
// směry, jak vysoko nad ním okolní domy zakrývají oblohu (horizont, jako SSAO, jen ve 2,5D a na CPU).
// Výsledek jde do atributu `ao` = [zakrytí oblohy 0..1, výška nad terénem]; materiál (aoMaterial) jím
// ztlumí hlavně rozptýlené světlo oblohy, přímé slunce jen málo, a u země přidá tmavší pás (kontakt).
import { clamp } from './rng.js';

const CELL = 1; // m
const REACH = 300; // jak daleko od trati se počítá (dál stačí kontaktní pás u země)
const STEPS = [1.1, 2, 3.2, 4.8, 7, 10, 14, 20, 28];
const WALL_DIRS = [-1.2, -0.6, 0, 0.6, 1.2]; // úhly od normály stěny (rad)
const ROOF_DIRS = 8;

// rastr výšek: horní hrana (absolutní výška) a číslo domu v každé buňce; buildings = [{ ring, wall, roof }]
export function skyline(buildings, track, terrain) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let k = 0; k < track.N; k++) {
    x0 = Math.min(x0, track.px[k]); x1 = Math.max(x1, track.px[k]);
    z0 = Math.min(z0, track.pz[k]); z1 = Math.max(z1, track.pz[k]);
  }
  x0 -= REACH; z0 -= REACH; x1 += REACH; z1 += REACH;
  const nx = Math.ceil((x1 - x0) / CELL), nz = Math.ceil((z1 - z0) / CELL);
  const top = new Float32Array(nx * nz).fill(-1e4);
  const id = new Int32Array(nx * nz).fill(-1);
  buildings.forEach((b, i) => {
    const r = b.ring;
    let bz0 = Infinity, bz1 = -Infinity;
    for (const p of r) { bz0 = Math.min(bz0, p[1]); bz1 = Math.max(bz1, p[1]); }
    const j0 = Math.max(0, Math.floor((bz0 - z0) / CELL)), j1 = Math.min(nz - 1, Math.floor((bz1 - z0) / CELL));
    if (j0 > j1) return;
    // střecha jako polovina své výšky nad římsou (sedlo zakrývá v průměru tolik)
    let g = 0;
    for (const p of r) g += terrain.heightAt(p[0], p[1]);
    const h = g / r.length + b.wall + b.roof * 0.5;
    for (let j = j0; j <= j1; j++) {
      const z = z0 + (j + 0.5) * CELL;
      const xs = [];
      for (let a = 0, c = r.length - 1; a < r.length; c = a++) {
        const p = r[a], q = r[c];
        if ((p[1] > z) !== (q[1] > z)) xs.push(p[0] + ((z - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
      }
      xs.sort((u, v) => u - v);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.round((xs[k] - x0) / CELL)), i1 = Math.min(nx - 1, Math.round((xs[k + 1] - x0) / CELL) - 1);
        for (let c = i0; c <= i1; c++) {
          const at = j * nx + c;
          if (h > top[at]) { top[at] = h; id[at] = i; }
        }
      }
    }
  });
  const near = (x, z) => terrain.distAt(x, z) < REACH - 40;
  return { x0, z0, nx, nz, top, id, near };
}

// zakrytí oblohy ve vrcholu (x, y, z) s normálou n; self = číslo domu, jehož střechu nestíní on sám
function occlusion(sk, x, y, z, n, self) {
  const wall = Math.abs(n[1]) < 0.5;
  let sum = 0, weight = 0;
  const dirs = wall ? WALL_DIRS.length : ROOF_DIRS;
  const base = wall ? Math.atan2(n[2], n[0]) : 0;
  for (let d = 0; d < dirs; d++) {
    const a = wall ? base + WALL_DIRS[d] : (d / ROOF_DIRS) * Math.PI * 2;
    const dx = Math.cos(a), dz = Math.sin(a);
    const w = wall ? Math.cos(WALL_DIRS[d]) : 1;
    let best = 0;
    for (const s of STEPS) {
      const i = Math.floor((x + dx * s - sk.x0) / CELL), j = Math.floor((z + dz * s - sk.z0) / CELL);
      if (i < 0 || j < 0 || i >= sk.nx || j >= sk.nz) break;
      const at = j * sk.nx + i;
      if (!wall && sk.id[at] === self) continue;
      const t = (sk.top[at] - y) / s;
      if (t > best) best = t;
    }
    // sinus úhlu horizontu: tolik oblohy v tomto směru chybí
    sum += (best / Math.sqrt(1 + best * best)) * w;
    weight += w;
  }
  return sum / weight;
}

// atribut ao pro vrcholy části od indexu `from` (po vrcholech); self = číslo domu nebo -1
export function bakeAO(o, sk, terrain, from = 0, self = -1) {
  if (!o.ao) o.ao = [];
  const cache = new Map();
  for (let v = from; v < o.pos.length / 3; v++) {
    const x = o.pos[v * 3], y = o.pos[v * 3 + 1], z = o.pos[v * 3 + 2];
    const n = [o.nor[v * 3], o.nor[v * 3 + 1], o.nor[v * 3 + 2]];
    const ground = y - terrain.heightAt(x, z);
    let open = 1;
    if (sk && sk.near(x, z)) {
      const key = `${Math.round(x * 20)},${Math.round(y * 20)},${Math.round(z * 20)},${Math.round(n[0] * 4)},${Math.round(n[1] * 4)},${Math.round(n[2] * 4)}`;
      if (!cache.has(key)) cache.set(key, 1 - occlusion(sk, x, y, z, n, self) * (Math.abs(n[1]) < 0.5 ? 1 : 0.7));
      open = cache.get(key);
    }
    o.ao[v * 2] = clamp(open, 0.3, 1);
    o.ao[v * 2 + 1] = ground;
  }
}

// Lambertův materiál se stíněním z atributu ao (ostatní sítě atribut nemají, materiál proto jen pro ně)
export function aoMaterial(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.(sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 ao;\nvarying vec2 vAO;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAO = ao;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vAO;')
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        // kontakt: posledních pár decimetrů u země tmavne nejvíc, do 2,5 m odezní
        float contactAO = mix(0.42, 1.0, smoothstep(-0.5, 2.8, vAO.y));
        float skyAO = vAO.x * contactAO;
        reflectedLight.indirectDiffuse *= skyAO;
        reflectedLight.directDiffuse *= mix(1.0, skyAO, 0.3);`);
  };
  const key = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `${key ? key() : ''}|ao`;
  return mat;
}

// vodorovné plochy trati (chodník, obrubník, tráva u domů): stínění rovnou do barev vrcholů
export function shadeGround(root, sk, strength = 0.75) {
  if (!sk) return;
  root.traverse((m) => {
    const g = m.geometry;
    if (!m.isMesh || m.isInstancedMesh || !g?.attributes.color || !g.attributes.normal || !m.material?.vertexColors) return;
    const p = g.attributes.position, n = g.attributes.normal, c = g.attributes.color;
    const cache = new Map();
    for (let v = 0; v < p.count; v++) {
      if (n.getY(v) < 0.7) continue;
      const x = p.getX(v), y = p.getY(v), z = p.getZ(v);
      if (!sk.near(x, z)) continue;
      const key = `${Math.round(x * 10)},${Math.round(z * 10)}`;
      if (!cache.has(key)) cache.set(key, 1 - occlusion(sk, x, y + 0.2, z, [0, 1, 0], -1) * strength);
      const f = cache.get(key);
      if (f < 0.999) c.setXYZ(v, c.getX(v) * f, c.getY(v) * f, c.getZ(v) * f);
    }
    c.needsUpdate = true;
  });
}
