// Jemná struktura povrchů u trati: jedna malá dlaždicová textura čtená v shaderu, bez trojúhelníků
// a volání navíc. Kanály: R betonové dlaždice chodníku (0,5 m se spárami, každá trochu jiná),
// G tráva (drobné světlé a tmavé skvrnky a chomáčky), B zrno štěrku, betonu a písku.
// Každý vzor se dělí svým průměrem, takže z dálky (mipmapy) zůstává jas stejný a zblízka je vidět struktura.
//  - krajnice podél trati (track.js): uv = [metry podél trati, druh * 1000 + metry od vnitřního okraje],
//    druh 0 nic (zástěra), 1 dlaždice, 2 tráva, 3 zrno
//  - zem (terrain.js): poloha ve světě; druh podle barvy (zelená tráva, šedá a béžová zrno, modrá voda nic)
import * as THREE from 'three';
import { RNG } from './rng.js';

const SIZE = 256;
export const SLAB = 0.5; // m, hrana dlaždice chodníku
const TILE = 2; // m na jedno opakování textury (4 × 4 dlaždice)

function texture() {
  const rng = new RNG(913);
  const data = new Uint8Array(SIZE * SIZE * 4);
  const px = SIZE / (TILE / SLAB); // pixelů na dlaždici
  // dlaždice: náhodný jas každé, tmavší spára, lehce zaoblené hrany a zrno
  const tone = Array.from({ length: (TILE / SLAB) ** 2 }, () => rng.range(0.84, 1.0));
  // tráva: skvrnky několika velikostí (sčítané šumy s náhodnými body)
  const grass = new Float32Array(SIZE * SIZE).fill(0.62);
  const dab = (cx, cy, r, v) => {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const d = Math.hypot(x - cx, y - cy) / r;
        if (d > 1) continue;
        const i = ((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE);
        grass[i] += v * (1 - d * d);
      }
    }
  };
  for (let i = 0; i < 1400; i++) dab(rng.range(0, SIZE), rng.range(0, SIZE), rng.range(1.5, 4.5), rng.range(-0.3, 0.32));
  for (let i = 0; i < 110; i++) dab(rng.range(0, SIZE), rng.range(0, SIZE), rng.range(8, 26), rng.range(-0.16, 0.16));
  let seed = 777;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) >>> 8) / 16777216;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const lx = x % px, ly = y % px;
      const edge = Math.min(lx, ly, px - 1 - lx, px - 1 - ly);
      const slab = tone[Math.floor(y / px) * (TILE / SLAB) + Math.floor(x / px)];
      let r = edge < 1.5 ? 0.42 : edge < 3 ? slab * 0.86 : slab;
      r *= 0.94 + rnd() * 0.1;
      const g = grass[i] + (rnd() - 0.5) * 0.18;
      // zrno: většinou jemné, občas větší kamínek
      const k = rnd();
      const b = k > 0.985 ? 0.45 + rnd() * 0.6 : 0.72 + (rnd() - 0.5) * 0.3;
      data[i * 4] = Math.round(Math.min(1, r) * 255);
      data[i * 4 + 1] = Math.round(Math.max(0, Math.min(1, g)) * 255);
      data[i * 4 + 2] = Math.round(Math.max(0, Math.min(1, b)) * 255);
      data[i * 4 + 3] = 255;
    }
  }
  const mean = new THREE.Vector3();
  for (let i = 0; i < SIZE * SIZE; i++) mean.add(new THREE.Vector3(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]));
  mean.divideScalar(SIZE * SIZE * 255);
  const tex = new THREE.DataTexture(data, SIZE, SIZE);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return { tex, mean };
}

let shared = null;
const get = () => (shared ??= texture());

// společné funkce shaderu: vzor podle druhu a souřadnic v metrech
const COMMON = /* glsl */ `
  uniform sampler2D groundTex;
  uniform vec3 groundMean;
  // tráva: dvě měřítka, aby se vzor neopakoval; zrno: jemné
  float grassK(vec2 m) {
    float a = texture2D(groundTex, m / 3.7).g, b = texture2D(groundTex, m / 23.0 + 0.37).g;
    return mix(0.5, 1.4, a) / mix(0.5, 1.4, groundMean.y) * mix(0.72, 1.25, b) / mix(0.72, 1.25, groundMean.y);
  }
  float grainK(vec2 m) {
    float a = texture2D(groundTex, m / 0.9).b, b = texture2D(groundTex, m / 6.1 + 0.61).g;
    return mix(0.7, 1.22, a) / mix(0.7, 1.22, groundMean.z) * mix(0.9, 1.08, b) / mix(0.9, 1.08, groundMean.y);
  }
  float slabK(vec2 m) {
    float a = texture2D(groundTex, m / ${TILE.toFixed(1)}).r;
    return mix(0.55, 1.12, a) / mix(0.55, 1.12, groundMean.x) * grainK(m * 1.7);
  }`;

function patch(mat, key, inject) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    const { tex, mean } = get();
    sh.uniforms.groundTex = { value: tex };
    sh.uniforms.groundMean = { value: mean };
    inject(sh);
  };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey()}|${key}`;
  return mat;
}

// krajnice podél trati (uv viz nahoře)
export function vergeMaterial(mat) {
  return patch(mat, 'verge', (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vVerge;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvVerge = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vVerge;\n${COMMON}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float kind = floor((vVerge.y + 100.0) / 1000.0);
          vec2 m = vec2(vVerge.x, vVerge.y - kind * 1000.0);
          if (kind == 1.0) diffuseColor.rgb *= slabK(m);
          else if (kind == 2.0) diffuseColor.rgb *= grassK(m);
          else if (kind == 3.0) diffuseColor.rgb *= grainK(m);
        }`);
  });
}

// uv krajnice: druh a metry
export const vergeUv = (kind, u0, v0, u1, v1, u2, v2, u3, v3) => [
  u0, kind * 1000 + v0, u1, kind * 1000 + v1, u2, kind * 1000 + v2, u3, kind * 1000 + v3,
];

// zem: poloha ve světě, druh podle barvy
export function groundMaterial(mat) {
  return patch(mat, 'ground', (sh) => {
    const hasXZ = sh.vertexShader.includes('vGroundXZ');
    if (!hasXZ) {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vGroundXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundXZ = position.xz;');
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${hasXZ ? '' : 'varying vec2 vGroundXZ;'}\n${COMMON}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 c = diffuseColor.rgb;
          float green = smoothstep(0.02, 0.08, c.g - max(c.r, c.b) * 0.9);
          float water = smoothstep(0.02, 0.06, c.b - c.g);
          float k = mix(grainK(vGroundXZ), grassK(vGroundXZ), green);
          diffuseColor.rgb *= mix(k, 1.0, water);
        }`);
  });
}

// textura a průměry kanálů pro jiné materiály (omítka a střechy v buildingdetail.js)
export const groundTexture = () => get();
