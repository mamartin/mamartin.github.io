// Zkušební realistický vzhled (nastavení „Realistická grafika“): místo barev a kreslených vzorů
// skutečné textury s hrbolky a hrubostí (Poly Haven, CC0), zem z ortofota ČÚZK (CC BY 4.0) na
// zkušebních úsecích, stromy s větvemi a listy (ez-tree, MIT), auta ve městě tvarem závodního vozu
// a nebe z HDR snímku. Podklady jsou v assets/real/ (stahují je tools/fetch-real.mjs a fetch-ortho.mjs).
// Vypnuté se nic z toho nenačte a hra vypadá jako dřív.
import * as THREE from 'three';

export const real = { on: false };

const BASE = 'assets/real/';
const loader = new THREE.TextureLoader();
const cache = new Map();

// textura z assets/real; repeat = kolikrát se zopakuje na jednotku UV; onMean dostane průměrnou barvu (lineární)
export function rtex(file, { srgb = false, repeat = [1, 1], aniso = 8, onMean = null } = {}) {
  const key = `${file}|${srgb}|${repeat}`;
  if (!cache.has(key)) {
    const tex = loader.load(BASE + file, (t) => {
      for (const fn of t.userData.onMean ?? []) fn(meanColor(t.image));
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
    tex.anisotropy = aniso;
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    tex.userData.onMean = [];
    cache.set(key, tex);
  }
  const tex = cache.get(key);
  if (onMean) {
    if (tex.image?.width) onMean(meanColor(tex.image));
    else tex.userData.onMean.push(onMean);
  }
  return tex;
}

// průměrná barva obrázku převedená ze sRGB do lineárních hodnot
function meanColor(image) {
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(image, 0, 0, 8, 8);
  const d = g.getImageData(0, 0, 8, 8).data;
  const sum = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += (d[i + k] / 255) ** 2.2;
  return new THREE.Vector3(sum[0] / 64, sum[1] / 64, sum[2] / 64);
}

// materiál s texturami jedné sady (barva, normála, hrubost); tile = metrů na jedno opakování při UV v metrech
// gray = o kolik barvu odbarvit (0–1), gain = zesvětlení
export function pbr(id, { tile = 2, color = 0xffffff, vertexColors = false, normalScale = 1, envMapIntensity = 0.35, gray = 0, gain = 1 } = {}) {
  const repeat = [1 / tile, 1 / tile];
  const mat = new THREE.MeshStandardMaterial({
    map: rtex(`${id}_diff.jpg`, { srgb: true, repeat }),
    normalMap: rtex(`${id}_nor.jpg`, { repeat }),
    roughnessMap: rtex(`${id}_rough.jpg`, { repeat }),
    color, vertexColors, roughness: 1, metalness: 0, envMapIntensity,
  });
  mat.normalScale.set(normalScale, normalScale);
  if (gray || gain !== 1) {
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.3, 0.6, 0.1))), ${gray.toFixed(2)}) * ${gain.toFixed(2)};`);
    };
    mat.customProgramCacheKey = () => `pbr|${gray}|${gain}`;
  }
  return mat;
}

// silnice: velké skvrny a čáry nechává původní textura, zblízka přibude zrno, hrbolky a hrubost asfaltu
export function realRoad(mat, repeat) {
  mat.normalMap = rtex('asphalt_track_nor.jpg', { repeat });
  mat.normalScale.set(0.9, 0.9);
  mat.roughnessMap = rtex('asphalt_track_rough.jpg', { repeat });
  mat.bumpMap = null;
  mat.roughness = 1;
  const mean = new THREE.Vector3(0.2, 0.2, 0.2);
  const detail = rtex('asphalt_track_diff.jpg', { srgb: true, repeat, onMean: (m) => mean.copy(m) });
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.uniforms.realDetail = { value: detail };
    sh.uniforms.realMean = { value: mean };
    sh.uniforms.realRepeat = { value: new THREE.Vector2(repeat[0], repeat[1]) };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D realDetail;\nuniform vec3 realMean;\nuniform vec2 realRepeat;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 d = texture2D(realDetail, vMapUv * realRepeat).rgb;
          diffuseColor.rgb *= mix(vec3(1.0), d / max(realMean, vec3(0.02)), 0.85);
        }`);
  };
  const key = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${key()}|realRoad`;
  return mat;
}

// --- zem z ortofota --------------------------------------------------------------------------------
const MAX_PATCH = 2;
// města, pro která je ortofoto stažené (tools/fetch-ortho.mjs); jinde se o soubor ani nežádá
const ORTO_CITIES = new Set(['pribram']);

// do materiálu terénu přidá až dva výřezy ortofota (assets/real/<město>-orto.json); načítá se na pozadí
// edge = polovina šířky trati s krajnicí: pod tratí zůstává kreslená zem (jinak by v mezeře u obrubníku
// prosvítal snímek); vzdálenost od osy trati je ve vrcholech terénu (atribut tdist)
export function orthoGround(mat, city, edge) {
  const uniforms = {
    ortoMap: { value: [null, null] },
    ortoM: { value: [new THREE.Matrix3(), new THREE.Matrix3()] },
    ortoOn: { value: [0, 0] },
    ortoEdge: { value: edge },
  };
  (ORTO_CITIES.has(city) ? fetch(`${BASE}${city}-orto.json`).then((r) => (r.ok ? r.json() : null)) : Promise.resolve(null)).then((info) => {
    if (!info) return;
    info.patches.slice(0, MAX_PATCH).forEach((p, i) => {
      loader.load(BASE + p.file, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 16;
        const [a, b, c, d, e, f] = p.m;
        uniforms.ortoM.value[i].set(a, b, c, d, e, f, 0, 0, 1);
        uniforms.ortoMap.value[i] = tex;
        uniforms.ortoOn.value[i] = 1;
      });
    });
  }).catch(() => {});
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    Object.assign(sh.uniforms, uniforms);
    const hasXZ = sh.vertexShader.includes('vGroundXZ');
    if (!hasXZ) {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vGroundXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundXZ = position.xz;');
    }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float tdist;\nvarying float vTdist;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTdist = tdist;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        ${hasXZ ? '' : 'varying vec2 vGroundXZ;'}
        varying float vTdist;
        uniform float ortoEdge;
        uniform sampler2D ortoMap[${MAX_PATCH}];
        uniform mat3 ortoM[${MAX_PATCH}];
        uniform float ortoOn[${MAX_PATCH}];
        // snímek je zamlžený: víc kontrastu a sytosti; na okraji výřezu se 25 m prolíná s kreslenou zemí
        vec4 ortoAt(sampler2D map, mat3 m, float on, vec2 xz) {
          vec2 uv = (m * vec3(xz, 1.0)).xy;
          vec2 inner = min(uv, 1.0 - uv) * 512.0;
          float w = on * smoothstep(0.0, 25.0, min(inner.x, inner.y));
          if (w <= 0.0) return vec4(0.0);
          vec3 c = texture2D(map, uv).rgb;
          c = pow(c, vec3(0.95)) * 1.3;
          float l = dot(c, vec3(0.3, 0.6, 0.1));
          // tmavá místa snímku (stíny a koruny stromů shora) jsou do modra: méně sytá
          c = mix(vec3(l), c, mix(0.5, 1.35, smoothstep(0.03, 0.2, l)));
          return vec4(c, w * mix(0.25, 1.0, smoothstep(0.02, 0.16, l)));
        }`)
      .replace('#include <color_fragment>', `
        {
          vec4 o0 = ortoAt(ortoMap[0], ortoM[0], ortoOn[0], vGroundXZ);
          vec4 o1 = ortoAt(ortoMap[1], ortoM[1], ortoOn[1], vGroundXZ);
          float off = smoothstep(ortoEdge - 1.0, ortoEdge + 2.5, vTdist);
          diffuseColor.rgb = mix(diffuseColor.rgb, o0.rgb, o0.a * off);
          diffuseColor.rgb = mix(diffuseColor.rgb, o1.rgb, o1.a * off);
        }
        #include <color_fragment>`);
  };
  const key = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${key()}|orto`;
  return mat;
}

// --- nebe z HDR snímku -----------------------------------------------------------------------------
let skyReady = null;

// nebe (assets/real/sky.hdr): tex = pozadí, env = totéž s přitlumeným sluncem pro odrazy a rozptýlené
// světlo (slunce svítí zvlášť jako směrové světlo, dvakrát by přesvítilo), sunAz = azimut slunce ve snímku,
// gain = násobek jasu, při kterém má obloha jas jako kreslená, horizon = barva u obzoru (mlha)
export function loadRealSky() {
  skyReady ??= import('three/addons/loaders/RGBELoader.js').then(({ RGBELoader }) => new Promise((resolve, reject) => {
    new RGBELoader().load(`${BASE}sky.hdr`, (tex) => {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      const { data, width, height } = tex.image;
      const f = THREE.DataUtils.fromHalfFloat;
      const lum = (i) => 0.2126 * f(data[i]) + 0.7152 * f(data[i + 1]) + 0.0722 * f(data[i + 2]);
      let best = 0, bu = 0, sum = 0, n = 0;
      const hz = [0, 0, 0];
      const rowH = Math.floor(height * 0.47);
      for (let y = 0; y < height / 2; y += 2) {
        for (let x = 0; x < width; x += 2) {
          const i = (y * width + x) * 4, l = lum(i);
          if (l > best) { best = l; bu = x / width; }
          sum += Math.min(l, 4);
          n++;
        }
      }
      for (let x = 0; x < width; x += 2) for (let k = 0; k < 3; k++) hz[k] += Math.min(4, f(data[(rowH * width + x) * 4 + k])) / (width / 2);
      const mean = sum / n;
      // pro odrazy: slunce a jeho okolí nejvýš čtyřnásobek průměrného jasu oblohy
      const cap = mean * 4, soft = new Uint16Array(data.length);
      const h = THREE.DataUtils.toHalfFloat;
      for (let i = 0; i < data.length; i += 4) {
        const l = lum(i), k = l > cap ? cap / l : 1;
        soft[i] = k === 1 ? data[i] : h(f(data[i]) * k);
        soft[i + 1] = k === 1 ? data[i + 1] : h(f(data[i + 1]) * k);
        soft[i + 2] = k === 1 ? data[i + 2] : h(f(data[i + 2]) * k);
        soft[i + 3] = data[i + 3];
      }
      const env = new THREE.DataTexture(soft, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
      env.mapping = THREE.EquirectangularReflectionMapping;
      env.colorSpace = THREE.LinearSRGBColorSpace;
      env.minFilter = env.magFilter = THREE.LinearFilter;
      env.flipY = tex.flipY;
      env.needsUpdate = true;
      const gain = 0.62 / mean;
      resolve({ tex, env, sunAz: (bu - 0.5) * Math.PI * 2, gain, horizon: new THREE.Color().setRGB(hz[0] * gain, hz[1] * gain, hz[2] * gain) });
    }, undefined, reject);
  }));
  return skyReady;
}
