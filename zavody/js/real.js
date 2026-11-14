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
// Pás kolem celé trati po dlaždicích 260 × 260 m v mřížce hry (tools/fetch-ortho.mjs). Terén se v tomto
// vzhledu dělí na čtverce po stejné mřížce, každý čtverec s dlaždicí má vlastní materiál s jednou fotkou.
// Fotky se nahrávají, až když je kamera blízko, a vzdálené se zase uvolní (všechny naráz by zabraly
// stovky MB paměti grafiky).
const ORTO_CITIES = new Set(['pribram', 'dobris']); // města se staženým ortofotem
const ORTO_LOAD = 430, ORTO_DROP = 680; // m od středu dlaždice: kdy fotku nahrát a kdy uvolnit
const ORTO_REACH = 95; // m od osy trati, kam fotka sahá (dál plynule přechází v kreslenou zem)
const ortoIndex = new Map();

// seznam dlaždic města (jednou), z něj pro každý svět nový správce: tileAt, update, dispose
export async function loadOrtho(city) {
  if (!ORTO_CITIES.has(city)) return null;
  if (!ortoIndex.has(city)) {
    const res = await fetch(`${BASE}orto/${city}.json`);
    ortoIndex.set(city, res.ok ? await res.json() : null);
  }
  const info = ortoIndex.get(city);
  if (!info) return null;
  const T = info.tile, tiles = new Map();
  for (const key of info.tiles) {
    const [i, j] = key.split('_').map(Number);
    tiles.set(key, {
      x: (i + 0.5) * T, z: (j + 0.5) * T, url: `${BASE}orto/${city}/${key}.jpg`, tex: null, loading: false, used: false,
      uniforms: { ortoMap: { value: null }, ortoRect: { value: new THREE.Vector3(i * T, j * T, T) }, ortoOn: { value: 0 } },
    });
  }
  let alive = true;
  return {
    tile: T,
    // dlaždice pod bodem (jen ty, které terén opravdu použije, se pak nahrávají)
    tileAt(x, z) {
      const t = tiles.get(`${Math.floor(x / T)}_${Math.floor(z / T)}`);
      if (t) t.used = true;
      return t ?? null;
    },
    // každý snímek: nahrát blízké, uvolnit vzdálené, nahrané plynule rozsvítit
    update(pos) {
      for (const t of tiles.values()) {
        if (!t.used) continue;
        const d = Math.hypot(t.x - pos.x, t.z - pos.z);
        if (t.tex) {
          if (d > ORTO_DROP) {
            t.tex.dispose();
            t.tex = null;
            t.uniforms.ortoMap.value = null;
            t.uniforms.ortoOn.value = 0;
          } else if (t.uniforms.ortoOn.value < 1) t.uniforms.ortoOn.value = Math.min(1, t.uniforms.ortoOn.value + 0.06);
        } else if (d < ORTO_LOAD && !t.loading) {
          t.loading = true;
          loader.load(t.url, (tex) => {
            t.loading = false;
            if (!alive) return tex.dispose();
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.anisotropy = 16;
            t.tex = tex;
            t.uniforms.ortoMap.value = tex;
          }, undefined, () => { t.loading = false; });
        }
      }
    },
    dispose() {
      alive = false;
      for (const t of tiles.values()) t.tex?.dispose();
    },
  };
}

// materiál jednoho čtverce terénu s dlaždicí ortofota; edge = polovina šířky trati s krajnicí: pod tratí
// zůstává kreslená zem (jinak by v mezeře u obrubníku prosvítal snímek). Vzdálenost od osy trati je ve
// vrcholech terénu (atribut tdist).
export function orthoGround(mat, tile, edge) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    Object.assign(sh.uniforms, tile.uniforms, { ortoEdge: { value: new THREE.Vector2(edge, ORTO_REACH) } });
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
        uniform vec2 ortoEdge;
        uniform sampler2D ortoMap;
        uniform vec3 ortoRect;
        uniform float ortoOn;`)
      .replace('#include <color_fragment>', `
        if (ortoOn > 0.0) {
          // řádek 0 obrázku je sever (nejmenší z)
          vec2 uv = (vGroundXZ - ortoRect.xy) / ortoRect.z;
          vec3 c = texture2D(ortoMap, vec2(uv.x, 1.0 - uv.y)).rgb;
          // snímek je zamlžený: víc jasu a sytosti; tmavá místa (stíny a koruny stromů shora) jsou do modra,
          // ta se odbarví a přimíchají méně
          c = pow(c, vec3(0.95)) * 1.3;
          float l = dot(c, vec3(0.3, 0.6, 0.1));
          c = mix(vec3(l), c, mix(0.5, 1.35, smoothstep(0.03, 0.2, l)));
          float w = ortoOn * mix(0.25, 1.0, smoothstep(0.02, 0.16, l));
          w *= smoothstep(ortoEdge.x - 1.0, ortoEdge.x + 2.5, vTdist) * (1.0 - smoothstep(ortoEdge.y - 15.0, ortoEdge.y, vTdist));
          diffuseColor.rgb = mix(diffuseColor.rgb, c, w);
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

// kov drobností (stožáry, zábradlí, svodidla, sloupky značek): pozink nebo nátěr, odráží oblohu
export const metal = ({ color = 0xffffff, vertexColors = false, roughness = 0.45, metalness = 0.7, side = THREE.FrontSide } = {}) =>
  new THREE.MeshStandardMaterial({ color, vertexColors, roughness, metalness, envMapIntensity: 0.9, side });
