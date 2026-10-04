// Společný materiál pro všechno přírodní: low-poly stínování, vítr a sníh.
// Nové efekty (mokro, námraza…) stačí přidat sem a projeví se v celé scéně.
import * as THREE from 'three';

// Sdílené uniformy: jeden vítr a jeden sníh pro celý svět.
export const shared = {
  uTime: { value: 0 },
  uWind: { value: 1 },
  uSnow: { value: 0 },
};

/**
 * @param {object} params    parametry MeshStandardMaterial
 * @param {object} opts
 * @param {number} opts.sway  jak moc se vrchol ohýbá ve větru (na jednotku výšky na druhou)
 * @param {boolean} opts.snow zda se na horní plochy usazuje sníh
 * @param {boolean} opts.noFlip zadní strana plochy si nechá normálu přední (tráva svítí z obou stran stejně)
 */
export function natureMaterial(params = {}, { sway = 0, snow = true, noFlip = false } = {}) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, flatShading: true, ...params });
  // Škálování výšky (např. tráva v zimě), dostupné přes mat.userData.uHeight.
  const heightU = { value: 1 };
  mat.userData.uHeight = heightU;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, { uSway: { value: sway }, uHeight: heightU });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
uniform float uWind;
uniform float uSway;
uniform float uHeight;
varying float vUpN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  vec3 origin = vec3(0.0);
  vec3 wn = objectNormal;
  #ifdef USE_INSTANCING
    origin = instanceMatrix[3].xyz;
    wn = mat3(instanceMatrix) * wn;
  #endif
  origin = (modelMatrix * vec4(origin, 1.0)).xyz;
  vUpN = normalize(mat3(modelMatrix) * wn).y;
  transformed.y *= uHeight;
  float h = max(transformed.y, 0.0);
  float ph = origin.x * 0.31 + origin.z * 0.23;
  float gust = 0.55 + 0.45 * sin(uTime * 0.35 + origin.x * 0.05);
  float w = sin(uTime * 1.6 + ph) * 0.6 + sin(uTime * 2.9 + ph * 1.7) * 0.25 + 0.4;
  float bend = uSway * h * h * uWind * gust;
  transformed.x += bend * w;
  transformed.z += bend * 0.5 * sin(uTime * 1.25 + ph * 1.3);
}`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uSnow;
varying float vUpN;`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
${noFlip ? 'normal *= faceDirection;' : ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
${snow ? `diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 1.0), uSnow * smoothstep(0.42, 0.82, vUpN));` : ''}`);
  };
  mat.customProgramCacheKey = () => `nature-${sway}-${snow}-${noFlip}`;
  return mat;
}
