// Předpočítané stíny domů od slunce i tam, kam stínová mapa nesahá (ta je jen kolem auta, 75–105 m).
// Jednou při stavbě: z rastru výšek domů (ao.js, skyline) se pro každou buňku 2 × 2 m spočítá „výška stínu“:
// bod v ní je ve stínu, když leží níž. Stačí tedy jedna textura pro zem, krajnici, silnici, stěny domů,
// stromy i lidi (bod se porovná se svou výškou). Shader pak ztlumí jen přímé světlo slunce, a to jen dál,
// než sahá skutečná stínová mapa (u auta platí ta, ať nejsou stíny dvakrát). Bez stínové mapy (nízká
// kvalita) platí předpočítaný stín všude. Střechy se nestíní (rastr zná jen jednu výšku domu).
import * as THREE from 'three';

const STEP = 2; // m, buňka mapy (rastr výšek má 1 m)
const REACH = 40; // m za nejvyšším domem: dál stín nesahá ani při nízkém slunci (a ořízne se výškou)

// výšky stínu: sk = skyline z ao.js, dir = směr ke slunci
export function bakeSunShadow(sk, dir, terrain) {
  const h = Math.hypot(dir.x, dir.z);
  if (h < 1e-3 || dir.y <= 0.05) return null;
  const dx = dir.x / h, dz = dir.z / h, tanE = dir.y / h;
  const nx = Math.ceil(sk.nx / STEP), nz = Math.ceil(sk.nz / STEP);
  const data = new Float32Array(nx * nz);
  let maxTop = -1e4;
  for (const t of sk.top) if (t > maxTop) maxTop = t;
  const reach = Math.min(REACH / tanE, 120);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = sk.x0 + (i + 0.5) * STEP, z = sk.z0 + (j + 0.5) * STEP;
      const ground = terrain.heightAt(x, z);
      let s = ground - 3; // „žádný stín“, ale blízko země, ať lineární filtr na okraji stínu nedělá nesmysly
      if (sk.near(x, z)) {
        // pochod po 1 m ke slunci: nejvyšší (výška domu − pokles paprsku)
        for (let t = 1; t <= reach; t += 1) {
          if (maxTop - t * tanE <= s) break;
          const ci = Math.floor((x + dx * t - sk.x0)), cj = Math.floor((z + dz * t - sk.z0));
          if (ci < 0 || cj < 0 || ci >= sk.nx || cj >= sk.nz) break;
          const v = sk.top[cj * sk.nx + ci] - t * tanE;
          if (v > s) s = v;
        }
      }
      data[j * nx + i] = s;
    }
  }
  const half = new Uint16Array(data.length);
  for (let k = 0; k < data.length; k++) half[k] = THREE.DataUtils.toHalfFloat(data[k]);
  const tex = new THREE.DataTexture(half, nx, nz, THREE.RedFormat, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return { tex, rect: new THREE.Vector4(sk.x0, sk.z0, nx * STEP, nz * STEP) };
}

// sdílené uniformy: střed a poloměr skutečné stínové mapy nastavuje main.js (aimSun)
export const SUN_SHADOW = {
  map: { value: null },
  rect: { value: new THREE.Vector4(0, 0, 1, 1) },
  center: { value: new THREE.Vector2() },
  radius: { value: 0 }, // 0 = stínová mapa není, předpočítaný stín všude
  strength: { value: 0.72 }, // kolik přímého světla stín ubere
};

const VERT_PARS = 'varying vec3 vSunW;\nvarying vec3 vSunN;';
const VERT = /* glsl */ `
  {
    vec4 sw = vec4(transformed, 1.0);
    vec3 sn = objectNormal;
    #ifdef USE_INSTANCING
      sw = instanceMatrix * sw;
      sn = mat3(instanceMatrix) * sn;
    #endif
    vSunW = (modelMatrix * sw).xyz;
    vSunN = normalize(mat3(modelMatrix) * sn);
  }`;
const FRAG_PARS = /* glsl */ `
  varying vec3 vSunW;
  varying vec3 vSunN;
  uniform sampler2D sunShadowMap;
  uniform vec4 sunShadowRect;
  uniform vec2 sunShadowCenter;
  uniform float sunShadowRadius;
  uniform float sunShadowStrength;
  float bakedSun() {
    vec3 n = normalize(vSunN);
    #ifdef SUN_WALLS
      if (n.y > 0.35) return 1.0; // střecha
    #endif
    // od svislé plochy kousek ven, ať stěna nestíní sama sebe
    vec3 p = vSunW + vec3(n.x, 0.0, n.z) * 1.3;
    vec2 uv = (p.xz - sunShadowRect.xy) / sunShadowRect.zw;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 1.0;
    float far = sunShadowRadius > 0.0 ? smoothstep(sunShadowRadius * 0.72, sunShadowRadius * 0.92, distance(vSunW.xz, sunShadowCenter)) : 1.0;
    if (far <= 0.0) return 1.0;
    float s = texture2D(sunShadowMap, uv).r;
    return 1.0 - smoothstep(-0.3, 0.6, s - vSunW.y) * far * sunShadowStrength;
  }`;

// přidá předpočítaný stín do materiálu (Lambert, Phong, Standard); walls = materiál domů (střechy bez stínu)
export function sunShadowMaterial(mat, walls = false) {
  if (mat.userData.sunShadow) return mat;
  mat.userData.sunShadow = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.uniforms.sunShadowMap = SUN_SHADOW.map;
    sh.uniforms.sunShadowRect = SUN_SHADOW.rect;
    sh.uniforms.sunShadowCenter = SUN_SHADOW.center;
    sh.uniforms.sunShadowRadius = SUN_SHADOW.radius;
    sh.uniforms.sunShadowStrength = SUN_SHADOW.strength;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <project_vertex>', `${VERT}\n#include <project_vertex>`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${walls ? '#define SUN_WALLS' : ''}\n${FRAG_PARS}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          float sunK = bakedSun();
          reflectedLight.directDiffuse *= sunK;
          reflectedLight.directSpecular *= sunK;
        }`);
  };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey()}|sun${walls ? 'W' : ''}`;
  mat.needsUpdate = true;
  return mat;
}

// všechny osvětlené materiály ve stromu objektů; wallMats = materiály domů
export function applySunShadow(root, wallMats = new Set()) {
  const done = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || done.has(m)) continue;
      done.add(m);
      if (m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshStandardMaterial) sunShadowMaterial(m, wallMats.has(m));
    }
  });
}
