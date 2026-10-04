// Flóra: všechny rostliny jednoho druhu sdílejí instancované meshe (jeden na část modelu).
// Každý snímek se přepočítají matice podle růstu a „množství“ z palety (listí, květy…).
import * as THREE from 'three';
import { SPECIES, SMALL_PER_TILE } from '../data/species.js';
import { MODELS } from './models.js';
import { natureMaterial } from '../render/nature.js';
import { RNG, hashString } from '../core/rng.js';

const CAPACITY = { tree: 600, small: 1400 };

const _m = new THREE.Matrix4(), _p = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
// Množství 0..1 → měřítko části; už od ~60 % je část v plné velikosti.
const amountScale = (a) => {
  const t = Math.min(1, Math.max(0, a / 0.6));
  return t * t * (3 - 2 * t);
};

export class Flora {
  constructor(scene, seed = 1) {
    this.scene = scene;
    this.groups = {};
    this.plants = [];
    this.rng = new RNG(seed);
  }

  group(id) {
    if (this.groups[id]) return this.groups[id];
    const def = SPECIES[id];
    const parts = MODELS[def.model](new RNG(hashString(id)));
    const cap = CAPACITY[def.kind];
    const meshes = parts.map((part) => {
      const mat = natureMaterial(
        { vertexColors: true, side: part.doubleSide ? THREE.DoubleSide : THREE.FrontSide },
        { sway: part.sway || 0 },
      );
      const mesh = new THREE.InstancedMesh(part.geo, mat, cap);
      mesh.count = 0;
      mesh.castShadow = def.kind === 'tree' || def.model === 'rock';
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(mesh);
      return { ...part, mesh, mat };
    });
    this.groups[id] = { id, def, meshes, count: 0, cap };
    return this.groups[id];
  }

  // Ověří, zda jde druh zasadit na políčko; vrací null nebo důvod (pro tooltip).
  canPlant(board, tile, id) {
    const def = SPECIES[id];
    if (def.tiles && !def.tiles.includes(tile.type)) return 'Sem se nehodí';
    if (def.kind === 'tree' && board.freeSlot(tile) < 0) return 'Na stromy už tu není místo';
    if (def.kind === 'small' && tile.small >= SMALL_PER_TILE) return 'Políčko je zarostlé';
    return null;
  }

  /**
   * Zasadí rostlinu na políčko. Stromy dostanou nejbližší volný slot k bodu (x, z),
   * drobnosti se posadí přímo na bod (nebo náhodně).
   */
  place(board, tile, id, { x, z, grown = false, scale } = {}) {
    const def = SPECIES[id];
    const g = this.group(id);
    if (g.count >= g.cap) return null;
    const rng = this.rng;
    let px, pz;
    if (def.kind === 'tree') {
      const slot = board.freeSlot(tile, x ?? tile.x, z ?? tile.z);
      if (slot < 0) return null;
      tile.slots[slot] = true;
      ({ x: px, z: pz } = board.slotPosition(tile, slot));
      px += rng.range(-0.08, 0.08);
      pz += rng.range(-0.08, 0.08);
    } else {
      if (tile.small >= SMALL_PER_TILE) return null;
      tile.small++;
      if (x === undefined) {
        const a = rng.next() * Math.PI * 2, d = Math.sqrt(rng.next()) * 0.72;
        px = tile.x + Math.cos(a) * d;
        pz = tile.z + Math.sin(a) * d;
      } else {
        const dx = x - tile.x, dz = z - tile.z, d = Math.hypot(dx, dz), k = d > 0.74 ? 0.74 / d : 1;
        px = tile.x + dx * k;
        pz = tile.z + dz * k;
      }
    }

    const idx = g.count++;
    const plant = {
      id, g, idx, tile,
      x: px, y: tile.h - 0.01, z: pz,
      rot: rng.next() * Math.PI * 2,
      scale: scale ?? rng.range(def.scale[0], def.scale[1]),
      age: grown ? 1 : 0,
      growTime: def.grow * rng.range(0.85, 1.2),
    };
    const tint = new THREE.Color(rng.range(0.88, 1.08), rng.range(0.9, 1.08), rng.range(0.86, 1.04));
    for (const part of g.meshes) {
      part.mesh.setColorAt(idx, tint);
      part.mesh.instanceColor.needsUpdate = true;
      part.mesh.count = g.count;
    }
    this.plants.push(plant);
    return plant;
  }

  applySeason(palette) {
    for (const id in this.groups) {
      for (const part of this.groups[id].meshes) {
        if (part.colorKey) part.mat.color.copy(palette.colors[part.colorKey]);
      }
    }
  }

  update(dt, palette) {
    for (const p of this.plants) {
      if (p.age < 1) p.age = Math.min(1, p.age + dt / p.growTime);
      const s = p.scale * (p.age < 1 ? Math.max(0.001, easeOutBack(p.age)) : 1);
      _q.setFromAxisAngle(_up, p.rot);
      _m.compose(_v.set(p.x, p.y, p.z), _q, _s.set(s, s, s));
      for (const part of p.g.meshes) {
        const a = part.amountKey ? amountScale(palette.amounts[part.amountKey]) : 1;
        // Část se smršťuje ke svému pivotu (koruna ke středu, květ ke stonku).
        _p.makeScale(a, a, a);
        _p.elements[13] = (part.pivot || 0) * (1 - a);
        part.mesh.setMatrixAt(p.idx, _p.premultiply(_m));
      }
    }
    for (const id in this.groups) {
      for (const part of this.groups[id].meshes) part.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
