// Hladina tůně: šestiúhelníky na úrovni vody s vlnkami v normálách. V zimě zamrzne.
import * as THREE from 'three';
import { hexCorner } from './hex.js';
import { WATER_LEVEL } from './board.js';
import { shared } from '../render/nature.js';

export class Water {
  constructor(board) {
    const pos = [];
    for (const t of board.tiles) {
      if (t.type !== 'voda') continue;
      for (let i = 0; i < 6; i++) {
        const [ax, az] = hexCorner(i, 1.001), [bx, bz] = hexCorner((i + 1) % 6, 1.001);
        pos.push(t.x, WATER_LEVEL, t.z, t.x + bx, WATER_LEVEL, t.z + bz, t.x + ax, WATER_LEVEL, t.z + az);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));

    this.ice = { value: 0 };
    const mat = new THREE.MeshStandardMaterial({ color: '#3f93a8', roughness: 0.12, metalness: 0.05, transparent: true, opacity: 0.8 });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = shared.uTime;
      shader.uniforms.uIce = this.ice;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uIce;\nvarying vec3 vWPos;')
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec2 p = vWPos.xz;
  float t = uTime;
  vec3 bump = vec3(
    sin(p.x * 3.1 + t * 1.3) * 0.5 + sin((p.x + p.y) * 5.3 - t * 1.7) * 0.35,
    0.0,
    cos(p.y * 2.7 - t * 1.1) * 0.5 + sin((p.x - p.y) * 4.1 + t * 1.9) * 0.35);
  normal = normalize(normal + (viewMatrix * vec4(bump * 0.14 * (1.0 - uIce), 0.0)).xyz);
}`);
    };
    this.material = mat;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
  }

  applySeason(palette) {
    const ice = palette.amounts.ice;
    this.ice.value = ice;
    this.material.color.copy(palette.colors.water);
    this.material.roughness = 0.12 + ice * 0.4;
    this.material.opacity = 0.8 + ice * 0.16;
  }
}
