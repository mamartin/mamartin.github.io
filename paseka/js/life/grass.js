// Tráva: tisíce instancovaných stébel, která se vlní ve sdíleném větru.
// Normály míří vzhůru, takže se tráva osvětluje jako souvislý porost a ne jako jednotlivé plošky.
import * as THREE from 'three';
import { natureMaterial } from '../render/nature.js';
import { TILE_TYPES } from '../world/board.js';
import { RNG } from '../core/rng.js';

const PER_TILE = 150;

// Tint stébel podle typu políčka: paseka sušší, les tmavší.
const TINTS = {
  louka: [1, 1, 1],
  les: [0.72, 0.8, 0.7],
  paseka: [1.12, 1.0, 0.68],
  skala: [0.9, 0.92, 0.85],
};

function bladeGeometry() {
  const w = 0.045, h = 0.26;
  const pos = [
    -w, 0, 0, w, 0, 0, -w * 0.65, h * 0.5, 0.02,
    w, 0, 0, w * 0.65, h * 0.5, 0.02, -w * 0.65, h * 0.5, 0.02,
    -w * 0.65, h * 0.5, 0.02, w * 0.65, h * 0.5, 0.02, 0, h, 0.07,
  ];
  const shade = [0.78, 0.78, 0.92, 0.78, 0.92, 0.92, 0.92, 0.92, 1.08];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(27).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(shade.flatMap((s) => [s, s, s]), 3));
  return g;
}

export class Grass {
  constructor(board, seed = 5) {
    const rng = new RNG(seed);
    const spots = [];
    for (const t of board.tiles) {
      const n = Math.round(PER_TILE * TILE_TYPES[t.type].grass);
      for (let i = 0; i < n; i++) {
        const a = rng.next() * Math.PI * 2, d = Math.sqrt(rng.next()) * 0.84;
        spots.push({ t, x: t.x + Math.cos(a) * d, z: t.z + Math.sin(a) * d });
      }
    }
    this.material = natureMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: false }, { sway: 1.1, noFlip: true });
    const mesh = new THREE.InstancedMesh(bladeGeometry(), this.material, spots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();
    const c = new THREE.Color();
    spots.forEach((p, i) => {
      const k = rng.range(0.55, 1.35);
      e.set(rng.range(-0.18, 0.18), rng.next() * Math.PI * 2, rng.range(-0.18, 0.18));
      m.compose(v.set(p.x, p.t.h - 0.01, p.z), q.setFromEuler(e), s.set(k, k * rng.range(0.8, 1.25), k));
      mesh.setMatrixAt(i, m);
      const [r, g, b] = TINTS[p.t.type];
      const l = rng.range(0.82, 1.12);
      c.setRGB(r * l * rng.range(0.95, 1.05), g * l, b * l * rng.range(0.9, 1.1));
      mesh.setColorAt(i, c);
    });
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.mesh = mesh;
  }

  applySeason(palette) {
    this.material.color.copy(palette.colors.grass);
    this.material.userData.uHeight.value = palette.amounts.grass;
  }
}
