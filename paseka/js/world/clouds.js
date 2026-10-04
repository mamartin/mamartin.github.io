// Low-poly oblaka, mezi kterými ostrov plave. Pomalu krouží kolem a přebírají barvu oblohy.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG } from '../core/rng.js';

function cloudGeometry(rng) {
  const puffs = [];
  const n = rng.int(4, 7);
  for (let i = 0; i < n; i++) {
    const r = rng.range(0.9, 1.8) * (i === 0 ? 1.3 : 1);
    const g = new THREE.IcosahedronGeometry(r, 1);
    g.translate((i - n / 2) * rng.range(0.9, 1.3), rng.range(-0.2, 0.5), rng.range(-0.8, 0.8));
    puffs.push(g);
  }
  let g = mergeGeometries(puffs.map((p) => {
    p.deleteAttribute('uv');
    p.deleteAttribute('normal');
    return mergeVertices(p);
  }));
  // Zploštělý spodek jako u skutečných kup.
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setY(i, y < -0.3 ? -0.3 - (y + 0.3) * 0.15 : y);
    p.setX(i, p.getX(i) + rng.range(-0.08, 0.08));
  }
  g = g.toNonIndexed();
  g.computeVertexNormals();
  return g;
}

export class Clouds {
  constructor(scene, seed = 17) {
    const rng = new RNG(seed);
    this.group = new THREE.Group();
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true, emissive: 0x000000 });
    this.items = [];
    for (let i = 0; i < 16; i++) {
      const mesh = new THREE.Mesh(cloudGeometry(rng), this.material);
      const a = (i / 16) * Math.PI * 2 + rng.range(-0.2, 0.2);
      const d = rng.range(19, 38);
      const y = rng.chance(0.6) ? rng.range(-7, -2.5) : rng.range(3, 9);
      mesh.position.set(Math.cos(a) * d, y, Math.sin(a) * d);
      mesh.rotation.y = -a + Math.PI / 2;
      mesh.scale.setScalar(rng.range(0.8, 1.6));
      this.group.add(mesh);
      this.items.push({ mesh, bob: rng.next() * 6.28, y });
    }
    scene.add(this.group);
  }

  update(dt, time, sky) {
    this.group.rotation.y += dt * 0.006;
    for (const c of this.items) c.mesh.position.y = c.y + Math.sin(time * 0.2 + c.bob) * 0.25;
    // Stinná strana mraků svítí barvou obzoru, v noci mraky ztmavnou.
    const light = 1 - sky.darkness * 0.72;
    this.material.color.setScalar(light);
    this.material.emissive.copy(sky.horizon).multiplyScalar(0.35);
  }
}
