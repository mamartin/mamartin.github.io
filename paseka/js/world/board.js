// Ostrov z šestiúhelníkových políček: generování dat a stavba jedné sloučené geometrie.
// Políčko je zároveň jednotkou budoucí simulace (typ, výška, vlhkost, sloty pro stromy).
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG, Noise2D, clamp, smoothstep } from '../core/rng.js';
import { EDGE_DIRS, hexKey, hexToWorld, worldToHex, hexDistance, hexCorner, hexesInRadius } from './hex.js';

export const TILE_TYPES = {
  louka: { name: 'Louka', top: 'meadow', grass: 1 },
  les: { name: 'Lesní půda', top: 'forest', grass: 0.4 },
  paseka: { name: 'Paseka', top: 'clearing', grass: 0.65 },
  skala: { name: 'Skalka', top: 'rock', grass: 0.12 },
  voda: { name: 'Tůň', top: 'bed', grass: 0 },
};

export const WATER_LEVEL = 0.42;
const STEP = 0.2;          // výškové terasy
const BASE = -1.3;         // spodek okrajových políček
const BEVEL = 0.07;        // zkosení horní hrany
const INNER = 0.88;        // poloměr rovné plochy
const LIP = 0.09;          // pruh drnu pod hranou

// Volná místa pro stromy uvnitř políčka (střed + šest kolem).
const SLOTS = [[0, 0], ...Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 3) * i + Math.PI / 6;
  return [Math.cos(a) * 0.5, Math.sin(a) * 0.5];
})];

// Klíče barev pro barvení vrcholů podle palety.
const COLOR_KEYS = ['meadow', 'forest', 'clearing', 'rock', 'bed', 'soil', 'clay', 'stone'];
const KEY_INDEX = Object.fromEntries(COLOR_KEYS.map((k, i) => [k, i]));

export class Board {
  constructor({ radius = 7, seed = 7 } = {}) {
    this.radius = radius;
    this.tiles = [];
    this.map = new Map();
    this.generate(seed);
  }

  get(q, r) {
    return this.map.get(hexKey(q, r));
  }

  tileAt(x, z) {
    const { q, r } = worldToHex(x, z);
    return this.get(q, r);
  }

  generate(seed) {
    const rng = new RNG(seed);
    const nH = new Noise2D(seed), nF = new Noise2D(seed + 11), nW = new Noise2D(seed + 23), nM = new Noise2D(seed + 31);
    const R = this.radius;
    const hill = hexToWorld(3, -4);
    const pond = hexToWorld(-3, 2);

    for (const { q, r } of hexesInRadius(R)) {
      const { x, z } = hexToWorld(q, r);
      const d = hexDistance(q, r) / R;
      const hillD = Math.hypot(x - hill.x, z - hill.z);
      const e = 0.75 + nH.fbm(x * 0.11, z * 0.11, 3) * 0.9 + Math.exp(-(hillD * hillD) / 14) * 1.5 - d * d * 0.35;
      let h = Math.max(0.6, Math.round(e / STEP) * STEP);

      const pondD = Math.hypot(x - pond.x, z - pond.z) + nW.fbm(x * 0.3, z * 0.3, 2) * 1.6;
      let type;
      if (pondD < 2.1 && hexDistance(q, r) < R - 1) {
        type = 'voda';
        h = 0.2;
      } else if (h >= 2.0) {
        type = 'skala';
      } else {
        const f = nF.fbm(x * 0.13, z * 0.13, 3) + x * 0.045 - z * 0.02;
        type = f > 0.3 ? 'les' : f > 0.06 ? 'paseka' : 'louka';
      }
      const tile = {
        q, r, x, z, h, type,
        moisture: 0,
        shade: 0.93 + rng.next() * 0.12,
        slots: SLOTS.map(() => false),
        small: 0,
      };
      this.tiles.push(tile);
      this.map.set(hexKey(q, r), tile);
    }

    // Vlhkost: blízkost vody + šum. Základ pro budoucí simulaci.
    const water = this.tiles.filter((t) => t.type === 'voda');
    for (const t of this.tiles) {
      let wd = 99;
      for (const w of water) wd = Math.min(wd, Math.hypot(t.x - w.x, t.z - w.z));
      const base = t.type === 'voda' ? 1 : 0.25 + (1 - smoothstep(0, 6, wd)) * 0.55 - (t.h - 0.6) * 0.12;
      t.moisture = clamp(base + nM.fbm(t.x * 0.2, t.z * 0.2, 2) * 0.25, 0, 1);
    }
  }

  // Nejbližší volný slot pro strom v políčku vzhledem k bodu (x, z); vrací index nebo -1.
  freeSlot(tile, x = tile.x, z = tile.z) {
    let best = -1, bestD = Infinity;
    tile.slots.forEach((used, i) => {
      if (used) return;
      const d = Math.hypot(tile.x + SLOTS[i][0] - x, tile.z + SLOTS[i][1] - z);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  slotPosition(tile, i) {
    return { x: tile.x + SLOTS[i][0], z: tile.z + SLOTS[i][1] };
  }

  // --- geometrie -------------------------------------------------------------

  buildMesh(material) {
    const pos = [];
    const keys = [];
    const shades = [];
    const vert = (x, y, z, key, shade) => {
      pos.push(x, y, z);
      keys.push(KEY_INDEX[key]);
      shades.push(shade);
    };
    const tri = (a, b, c, key, sa, sb = sa, sc = sa) => {
      vert(...a, key, sa);
      vert(...b, key, sb);
      vert(...c, key, sc);
    };

    for (const t of this.tiles) {
      const top = TILE_TYPES[t.type].top;
      const s = t.shade * (0.95 + t.h * 0.03);
      const inner = [], outer = [];
      for (let i = 0; i < 6; i++) {
        const [ix, iz] = hexCorner(i, INNER);
        const [ox, oz] = hexCorner(i, 1);
        inner.push([t.x + ix, t.h, t.z + iz]);
        outer.push([t.x + ox, t.h - BEVEL, t.z + oz]);
      }
      const center = [t.x, t.h, t.z];
      for (let i = 0; i < 6; i++) {
        const j = (i + 1) % 6;
        tri(center, inner[j], inner[i], top, s);
        tri(inner[i], inner[j], outer[i], top, s * 0.97);
        tri(inner[j], outer[j], outer[i], top, s * 0.97);
      }

      // Boky jen tam, kde je soused nižší nebo chybí – s vrstvami půdy.
      const topY = t.h - BEVEL;
      for (let i = 0; i < 6; i++) {
        const n = this.get(t.q + EDGE_DIRS[i][0], t.r + EDGE_DIRS[i][1]);
        const bottomY = n ? n.h - BEVEL : BASE;
        if (bottomY >= topY - 1e-4) continue;
        const a = outer[i], b = outer[(i + 1) % 6];
        for (const band of sideBands(topY, bottomY, top)) {
          const A = [a[0], band.y0, a[2]], B = [b[0], band.y0, b[2]];
          const C = [a[0], band.y1, a[2]], D = [b[0], band.y1, b[2]];
          tri(A, B, C, band.key, band.s0, band.s0, band.s1);
          tri(B, D, C, band.key, band.s0, band.s1, band.s1);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3));
    geo.computeVertexNormals();
    this.colorKeys = Uint8Array.from(keys);
    this.colorShades = Float32Array.from(shades);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    return this.mesh;
  }

  // Přebarví vrcholy podle palety ročního období.
  applyColors(palette) {
    const attr = this.mesh.geometry.getAttribute('color');
    const arr = attr.array;
    const cols = COLOR_KEYS.map((k) => palette.colors[k]);
    for (let i = 0, n = this.colorKeys.length; i < n; i++) {
      const c = cols[this.colorKeys[i]], s = this.colorShades[i];
      arr[i * 3] = c.r * s;
      arr[i * 3 + 1] = c.g * s;
      arr[i * 3 + 2] = c.b * s;
    }
    attr.needsUpdate = true;
  }

  // Spodní skála, na které ostrov "visí" v oblacích.
  buildUnderside(material) {
    const rng = new RNG(99);
    const R = this.radius * 1.5;
    let geo = new THREE.CylinderGeometry(R, 0.6, 7.5, 18, 6, true);
    geo.translate(0, BASE + 0.15 - 3.75, 0);
    // Šev válce musí zůstat spojený, proto vrcholy nejdřív sloučíme a až pak křivíme.
    geo.deleteAttribute('uv');
    geo.deleteAttribute('normal');
    geo = mergeVertices(geo);
    const p = geo.attributes.position;
    const cols = [];
    const stone = new THREE.Color('#6d6862'), dark = new THREE.Color('#3f3a36'), clay = new THREE.Color('#8a6a4e');
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y < BASE - 0.2) {
        const k = 1 + (rng.next() - 0.5) * 0.35;
        p.setX(i, p.getX(i) * k + (rng.next() - 0.5) * 0.6);
        p.setZ(i, p.getZ(i) * k + (rng.next() - 0.5) * 0.6);
        p.setY(i, y + (rng.next() - 0.5) * 0.5);
      }
    }
    const flat = geo.toNonIndexed();
    const fp = flat.attributes.position;
    for (let i = 0; i < fp.count; i++) {
      const t = clamp((fp.getY(i) - (BASE - 7.5)) / 7.5, 0, 1);
      const c = new THREE.Color().lerpColors(dark, t > 0.82 ? clay : stone, t > 0.82 ? 1 : t);
      cols.push(c.r, c.g, c.b);
    }
    flat.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    flat.computeVertexNormals();
    const mesh = new THREE.Mesh(flat, material);
    mesh.receiveShadow = true;
    return mesh;
  }
}

// Pruhy boční stěny: drn pod hranou, hlína, jíl, kámen.
function sideBands(topY, bottomY, topKey) {
  const cuts = [
    { y: topY - LIP, key: topKey },
    { y: 0.15, key: 'soil' },
    { y: -0.55, key: 'clay' },
    { y: -Infinity, key: 'stone' },
  ];
  const bands = [];
  let y0 = topY;
  for (const c of cuts) {
    const y1 = Math.max(c.y, bottomY);
    if (y1 < y0 - 1e-4) {
      const shade = (y) => (c.key === topKey ? 0.78 : 0.95 - clamp((topY - y) * 0.08, 0, 0.3));
      bands.push({ y0, y1, key: c.key, s0: shade(y0), s1: shade(y1) * (c.key === topKey ? 1 : 0.92) });
      y0 = y1;
    }
    if (y0 <= bottomY + 1e-4) break;
  }
  return bands;
}
