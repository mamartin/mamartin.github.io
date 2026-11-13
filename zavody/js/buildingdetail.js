// Struktura domů v shaderu (bez geometrie i volání navíc): zrno a skvrny omítky, tmavší sokl u země
// a na šikmých střechách řady tašek. Řady tašek běží po vrstevnicích střechy, v každé řadě je stín
// přesahu a svislé spáry posunuté o půl tašky; z dálky, kde by se vzor slil, se rozplyne do průměru.
// Ploché střechy dostanou jen zrno. Výška nad zemí je z atributu ao (ao.js), textura z grounddetail.js;
// materiál musí mít i facadeMaterial (sklo oken se omítkou nepokryje).
import * as THREE from 'three';
import { groundTexture } from './grounddetail.js';
import { rtex } from './real.js';

// realOn = zkušební realistický vzhled (real.js): omítka a tašky ze skutečných textur včetně hrbolků
// (normálová mapa se na stěnu a střechu pokládá podle jejich směru ve světě, UV domů k tomu nejsou)
export function buildingDetail(mat, realOn = false) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    const { tex, mean } = groundTexture();
    sh.uniforms.bdTex = { value: tex };
    sh.uniforms.bdMean = { value: mean };
    if (realOn) {
      const wallMean = new THREE.Vector3(0.6, 0.6, 0.6), roofMean = new THREE.Vector3(0.3, 0.15, 0.1);
      sh.uniforms.bdWall = { value: rtex('white_stucco_diff.jpg', { srgb: true, onMean: (m) => wallMean.copy(m) }) };
      sh.uniforms.bdWallN = { value: rtex('white_stucco_nor.jpg') };
      sh.uniforms.bdRoof = { value: rtex('clay_roof_tiles_02_diff.jpg', { srgb: true, onMean: (m) => roofMean.copy(m) }) };
      sh.uniforms.bdRoofN = { value: rtex('clay_roof_tiles_02_nor.jpg') };
      sh.uniforms.bdWallMean = { value: wallMean };
      sh.uniforms.bdRoofMean = { value: roofMean };
      sh.defines = { ...sh.defines, BD_REAL: 1 };
    }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBdW;\nvarying vec3 vBdN;')
      .replace('#include <project_vertex>', `vBdW = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vBdN = normalize(mat3(modelMatrix) * objectNormal);
        #include <project_vertex>`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vBdW;
        varying vec3 vBdN;
        uniform sampler2D bdTex;
        uniform vec3 bdMean;
        #ifdef BD_REAL
          uniform sampler2D bdWall, bdWallN, bdRoof, bdRoofN;
          uniform vec3 bdWallMean, bdRoofMean;
          vec3 bdNormalW = vec3(0.0); // normála ve světě po hrbolcích (0 = beze změny)
        #endif
        // zrno a velké skvrny (kanály B a G, děleno průměrem), u = vodorovně po ploše
        float bdPlaster(vec2 m) {
          float a = texture2D(bdTex, m / 1.1).b, b = texture2D(bdTex, m / 11.0 + 0.3).g;
          return mix(0.86, 1.1, a) / mix(0.86, 1.1, bdMean.z) * mix(0.88, 1.08, b) / mix(0.88, 1.08, bdMean.y);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 n = normalize(vBdN);
          float side = length(n.xz);
          if (n.y < 0.5) {
            // stěna: omítka po ploše stěny, sokl do 0,6 m nad zemí (vAO.y z ao.js)
            vec2 m = vec2(dot(vBdW.xz, vec2(-n.z, n.x) / max(side, 1e-3)), vBdW.y);
            float k = bdPlaster(m);
            #ifdef BD_REAL
            {
              // omítka: 2,5 m na opakování; hrbolky podél stěny (tečna vodorovně, bitečna nahoru)
              vec3 t = texture2D(bdWall, m / 2.5).rgb;
              k *= dot(t, vec3(0.333)) / dot(bdWallMean, vec3(0.333));
              vec3 nm = texture2D(bdWallN, m / 2.5).xyz * 2.0 - 1.0;
              vec3 T = vec3(-n.z, 0.0, n.x) / max(side, 1e-3);
              bdNormalW = normalize(T * nm.x * 1.4 + vec3(0.0, 1.0, 0.0) * nm.y * 1.4 + n * nm.z) * (1.0 - max(parMask.r, step(0.02, parHit)));
            }
            #endif
            k *= mix(0.8, 1.0, smoothstep(0.55, 0.62, vAO.y));
            // sklo a ostění oken bez omítky (parMask a parHit z facade.js)
            diffuseColor.rgb *= mix(k, 1.0, max(parMask.r, step(0.02, parHit)));
          } else if (n.y < 0.97) {
            // šikmá střecha: řady tašek po 0,3 m podél spádu, tašky 0,25 m napříč, posun o půl v každé řadě
            vec2 along = vec2(-n.z, n.x) / side;
            float row = vBdW.y / side / 0.3; // vzdálenost po spádu (výška / sinus sklonu) v řadách
            float col = dot(vBdW.xz, along) / 0.25 + floor(row) * 0.5;
            float fr = fract(row), fc = fract(col);
            float tile = mix(0.72, 1.0, smoothstep(0.0, 0.28, fr)) * mix(0.86, 1.0, smoothstep(0.0, 0.06, fc) * smoothstep(1.0, 0.94, fc));
            float tileMean = 0.89;
            // rozplynutí, když je řada menší než asi 2 pixely
            float blur = smoothstep(0.25, 0.5, fwidth(row));
            float k = mix(tile / tileMean, 1.0, blur) * bdPlaster(vec2(dot(vBdW.xz, along), row * 0.3) * 1.7);
            #ifdef BD_REAL
            {
              // tašky ze skutečné textury (1,8 m na opakování): jas násobí barvu střechy, hrbolky podél spádu
              vec2 m = vec2(dot(vBdW.xz, along), row * 0.3) / 1.8;
              vec3 t = texture2D(bdRoof, m).rgb;
              k = dot(t, vec3(0.333)) / dot(bdRoofMean, vec3(0.333)) * bdPlaster(m * 3.0);
              vec3 nm = texture2D(bdRoofN, m).xyz * 2.0 - 1.0;
              vec3 T = vec3(along.x, 0.0, along.y);
              vec3 B = normalize(cross(n, T));
              bdNormalW = normalize(T * nm.x + B * nm.y + n * nm.z);
            }
            #endif
            diffuseColor.rgb *= k;
          } else {
            diffuseColor.rgb *= bdPlaster(vBdW.xz * 1.5);
          }
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        #ifdef BD_REAL
          if (dot(bdNormalW, bdNormalW) > 0.5) normal = normalize((viewMatrix * vec4(bdNormalW, 0.0)).xyz);
        #endif`);
  };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey()}|bd${realOn ? 'R' : ''}`;
  return mat;
}
