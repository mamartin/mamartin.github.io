// Hloubka fasád bez další geometrie: okna, výlohy a lodžie jsou zapuštěné do zdi (parallax v shaderu,
// jen do 90 m od kamery, dál se nic nepočítá) a sklo odráží oblohu podle úhlu pohledu (Fresnel).
// Maska k textuře oken: R = sklo, G = hloubka 0..1 (násobek `depth` metrů). Stěny jsou svislé, takže
// tečna je vodorovně podél stěny (směr rostoucího u) a bitečna svisle nahoru (v roste nahoru).
import * as THREE from 'three';

// holes: [[x, y, w, h, hloubka 0..1, sklo]] v pixelech textury (y shora, jako na plátně)
export function maskTexture(holes, size = 256, wrapT = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);
  for (const [x, y, w, h, d, glass] of holes) {
    ctx.fillStyle = `rgb(${glass ? 255 : 0}, ${Math.round(d * 255)}, 0)`;
    ctx.fillRect(x, y, w, h);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  if (wrapT) tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// sdílené barvy odrazu oblohy (nastaví setFacadeSky podle biomu)
const sky = {
  facTop: { value: new THREE.Color('#5d8fd0') },
  facHorizon: { value: new THREE.Color('#d3e3ec') },
  facGround: { value: new THREE.Color('#4a4a46') },
};
export function setFacadeSky(biome) {
  sky.facTop.value.set(biome.sky.top);
  sky.facHorizon.value.set(biome.sky.horizon);
  sky.facGround.value.set(biome.night ? '#0b0c10' : '#55524a');
}

// mat: Lambert s mapou oken; mask: maskTexture; depth: hloubka v jednotkách UV (metry × UV na metr)
export function facadeMaterial(mat, mask, depth) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.(sh, r);
    Object.assign(sh.uniforms, sky, { facMask: { value: mask }, facDepth: { value: depth } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vParT;\nvarying vec3 vParB;\nvarying vec3 vParN;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 parNw = normalize(mat3(modelMatrix) * objectNormal);
        vec3 parTw = vec3(-parNw.z, 0.0, parNw.x);
        if (dot(parTw, parTw) < 1e-4) parTw = vec3(1.0, 0.0, 0.0);
        vParT = normalize((viewMatrix * vec4(normalize(parTw), 0.0)).xyz);
        vParB = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        vParN = normalize((viewMatrix * vec4(parNw, 0.0)).xyz);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vParT;
        varying vec3 vParB;
        varying vec3 vParN;
        uniform sampler2D facMask;
        uniform float facDepth;
        uniform vec3 facTop;
        uniform vec3 facHorizon;
        uniform vec3 facGround;`)
      .replace('#include <map_fragment>', `
        // paprsek od oka do zdi: hledá se místo, kde protne zapuštěný povrch (8 vrstev)
        vec2 parUv = vMapUv;
        float parHit = 0.0;
        vec2 parDx = dFdx(vMapUv), parDy = dFdy(vMapUv);
        float parDist = length(vViewPosition);
        if (parDist < 90.0 && abs(vParN.y) < 0.9) {
          vec3 V = normalize(vViewPosition);
          float vz = max(dot(V, vParN), 0.12);
          vec2 shift = -vec2(dot(V, vParT), dot(V, vParB)) / vz * facDepth * (1.0 - smoothstep(60.0, 90.0, parDist));
          const int LAYERS = 8;
          vec2 parStep = shift / float(LAYERS);
          float layer = 0.0;
          vec2 uv = vMapUv;
          float d = textureGrad(facMask, uv, parDx, parDy).g, dPrev = d;
          for (int i = 0; i < LAYERS; i++) {
            if (layer >= d) break;
            layer += 1.0 / float(LAYERS);
            uv += parStep;
            dPrev = d;
            d = textureGrad(facMask, uv, parDx, parDy).g;
          }
          // mezi posledními dvěma vrstvami se průsečík dopočítá, ať ostění nemá schody
          if (layer > 0.0) {
            float after = d - layer, before = dPrev - (layer - 1.0 / float(LAYERS));
            float w = clamp(after / (after - before), 0.0, 1.0);
            uv -= parStep * w;
            layer -= w / float(LAYERS);
          }
          parUv = uv;
          parHit = layer;
        }
        vec4 parMask = textureGrad(facMask, parUv, parDx, parDy);
        #ifdef USE_MAP
          vec4 sampledDiffuseColor = textureGrad(map, parUv, parDx, parDy);
          diffuseColor *= sampledDiffuseColor;
        #endif
        // ostění a hloubka otvoru jsou ve stínu (čím hlouběji, tím tmavší)
        diffuseColor.rgb *= 1.0 - 0.45 * parHit;`)
      .replace('#include <emissivemap_fragment>', `
        #ifdef USE_EMISSIVEMAP
          totalEmissiveRadiance *= textureGrad(emissiveMap, parUv, parDx, parDy).rgb;
        #endif`)
      .replace('#include <envmap_fragment>', `#include <envmap_fragment>
        // sklo odráží oblohu, při pohledu podél ulice skoro celou (Fresnel); zakrytá obloha (ao) odráží méně
        {
          vec3 V = normalize(vViewPosition);
          vec3 Rw = inverseTransformDirection(reflect(-V, vParN), viewMatrix);
          vec3 skyRefl = Rw.y > 0.0 ? mix(facHorizon, facTop, pow(Rw.y, 0.6)) : mix(facHorizon, facGround, min(1.0, -Rw.y * 4.0));
          float fres = 0.06 + 0.94 * pow(1.0 - clamp(dot(V, vParN), 0.0, 1.0), 5.0);
          #ifdef FAC_AO
            skyRefl *= mix(0.35, 1.0, vAO.x);
          #endif
          outgoingLight = mix(outgoingLight, skyRefl * 0.85, parMask.r * clamp(0.06 + fres, 0.0, 0.75));
        }`);
    sh.defines = { ...sh.defines, FAC_AO: 1 };
  };
  const key = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `${key ? key() : ''}|facade`;
  return mat;
}
