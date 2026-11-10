// Struktura domů v shaderu (bez geometrie i volání navíc): zrno a skvrny omítky, tmavší sokl u země
// a na šikmých střechách řady tašek. Řady tašek běží po vrstevnicích střechy, v každé řadě je stín
// přesahu a svislé spáry posunuté o půl tašky; z dálky, kde by se vzor slil, se rozplyne do průměru.
// Ploché střechy dostanou jen zrno. Výška nad zemí je z atributu ao (ao.js), textura z grounddetail.js;
// materiál musí mít i facadeMaterial (sklo oken se omítkou nepokryje).
import { groundTexture } from './grounddetail.js';

export function buildingDetail(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    const { tex, mean } = groundTexture();
    sh.uniforms.bdTex = { value: tex };
    sh.uniforms.bdMean = { value: mean };
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
            diffuseColor.rgb *= k;
          } else {
            diffuseColor.rgb *= bdPlaster(vBdW.xz * 1.5);
          }
        }`);
  };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey()}|bd`;
  return mat;
}
