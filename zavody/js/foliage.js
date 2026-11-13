// Materiál stromů: k barvě stěn (nízkopolygonové koruny a kmeny) přidá malou dlaždicovou texturu
// promítnutou ze tří os v souřadnicích stromu (bez UV, bez nových trojúhelníků i volání kreslení).
// Kanály textury: R shluky listí (světlé chomáče, tmavé mezery), G podélné rýhy kůry, B tmavé
// příčné znaky březové kůry. Kmen pozná shader podle barvy vrcholu (hnědá nebo bílá s r > g),
// koruna je pod sebou a uvnitř tmavší. Textura má v průměru jas jako dřív, takže z dálky
// (mipmapy) vypadají stromy stejně a zblízka mají strukturu.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG } from './rng.js';

const SIZE = 256;

function channel(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d', { willReadFrequently: true });
  draw(g);
  return g.getImageData(0, 0, SIZE, SIZE).data;
}

// kreslí tvar devětkrát posunutý o velikost dlaždice, aby textura navazovala
const wrapped = (fn) => {
  for (const dx of [-SIZE, 0, SIZE]) for (const dy of [-SIZE, 0, SIZE]) fn(dx, dy);
};

function texture() {
  const rng = new RNG(71);
  const leaves = channel((g) => {
    g.fillStyle = 'rgb(70,70,70)';
    g.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 150; i++) {
      const x = rng.range(0, SIZE), y = rng.range(0, SIZE), r = rng.range(11, 26);
      const top = rng.range(205, 255), edge = rng.range(95, 135);
      wrapped((dx, dy) => {
        // chomáč osvětlený shora: nejsvětlejší nad středem, k okraji tmavne
        const grd = g.createRadialGradient(x + dx, y + dy - r * 0.35, r * 0.1, x + dx, y + dy, r);
        grd.addColorStop(0, `rgb(${top},${top},${top})`);
        grd.addColorStop(0.8, `rgb(${edge},${edge},${edge})`);
        grd.addColorStop(1, `rgba(${edge},${edge},${edge},0)`);
        g.fillStyle = grd;
        g.beginPath();
        g.arc(x + dx, y + dy, r, 0, Math.PI * 2);
        g.fill();
      });
    }
  });
  const bark = channel((g) => {
    g.fillStyle = 'rgb(205,205,205)';
    g.fillRect(0, 0, SIZE, SIZE);
    g.lineCap = 'round';
    for (let i = 0; i < 46; i++) {
      let x = rng.range(0, SIZE), y = rng.range(0, SIZE);
      const len = rng.range(40, 140), v = Math.round(rng.range(60, 120));
      g.strokeStyle = `rgb(${v},${v},${v})`;
      g.lineWidth = rng.range(2, 5);
      const pts = [[x, y]];
      for (let d = 0; d < len; d += 10) pts.push([x += rng.range(-3, 3), y += 10]);
      wrapped((dx, dy) => {
        g.beginPath();
        pts.forEach(([px, py], k) => (k ? g.lineTo(px + dx, py + dy) : g.moveTo(px + dx, py + dy)));
        g.stroke();
      });
    }
  });
  const birch = channel((g) => {
    g.fillStyle = 'rgb(255,255,255)';
    g.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 70; i++) {
      const x = rng.range(0, SIZE), y = rng.range(0, SIZE), w = rng.range(8, 34), h = rng.range(2, 6);
      const v = Math.round(rng.range(20, 90));
      g.fillStyle = `rgb(${v},${v},${v})`;
      wrapped((dx, dy) => g.fillRect(x + dx, y + dy, w, h));
    }
  });
  const data = new Uint8Array(SIZE * SIZE * 4);
  const mean = new THREE.Vector3();
  for (let i = 0; i < SIZE * SIZE; i++) {
    mean.x += leaves[i * 4];
    mean.y += bark[i * 4];
    mean.z += birch[i * 4];
    data[i * 4] = leaves[i * 4];
    data[i * 4 + 1] = bark[i * 4];
    data[i * 4 + 2] = birch[i * 4];
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, SIZE, SIZE);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return { tex, mean: mean.divideScalar(SIZE * SIZE * 255) };
}

let shared = null;

// vítr (vertex shader, potřebuje treeTime a vBark): koruna se pohupuje, kmen stojí; poryvy běží krajinou
// jako vlna, každý strom má svou fázi
const WIND = /* glsl */ `
  #ifdef USE_INSTANCING
  {
    vec2 at = instanceMatrix[3].xz;
    float ph = fract(sin(dot(at, vec2(12.9898, 78.233))) * 43758.5453) * 6.2832;
    float gust = 0.55 + 0.45 * sin(treeTime * 0.37 + dot(at, vec2(0.021, 0.013)));
    float bend = smoothstep(1.5, 8.0, position.y) * (1.0 - vBark) * gust;
    transformed.x += (sin(treeTime * 1.3 + ph) * 0.06 + sin(treeTime * 3.1 + ph * 2.0 + position.y) * 0.015) * bend;
    transformed.z += sin(treeTime * 1.1 + ph * 1.7) * 0.04 * bend;
  }
  #endif`;
// čas větru: hodnota se čte při každém nahrání uniformů (bez háčků na sítích); stín se nehýbe, výchylka je malá
const TREE_TIME = { get value() { return (performance.now() / 1000) % 3600; } };

// stejný materiál jako dřív (barvy vrcholů a instancí, ploché stínování) s texturou navíc
export function treeMaterial() {
  shared ??= texture();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.treeTex = { value: shared.tex };
    sh.uniforms.treeMean = { value: shared.mean };
    sh.uniforms.treeTime = TREE_TIME;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float treeTime;
        varying vec3 vTreePos;
        varying vec3 vTreeN;
        varying float vBark;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vTreePos = position;
        vTreeN = normal;
        vBark = color.r > color.g + 0.02 ? 1.0 : 0.0;
        ${WIND}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D treeTex;
        uniform vec3 treeMean; // průměr kanálů: vzor se dělí svým průměrem, jas z dálky zůstane
        varying vec3 vTreePos;
        varying vec3 vTreeN;
        varying float vBark;
        // promítnutí ze tří os s váhami podle normály stěny
        vec4 treeSample(vec3 p, vec3 n, vec2 scale) {
          vec3 w = pow(abs(n), vec3(4.0));
          w /= w.x + w.y + w.z;
          return texture2D(treeTex, p.zy * scale) * w.x + texture2D(treeTex, p.xz * scale) * w.y + texture2D(treeTex, p.xy * scale) * w.z;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 tn = normalize(vTreeN);
        if (vBark > 0.5) {
          // kůra: jen svislé plochy, rýhy podél kmene; světlý kmen (bříza) má tmavé znaky
          vec4 t = treeSample(vTreePos, vec3(tn.x, 0.0, tn.z) + 1e-4, vec2(1.6, 0.55));
          float light = step(0.55, dot(vColor.rgb, vec3(0.333)));
          float barkK = mix(0.55, 1.15, t.g) / mix(0.55, 1.15, treeMean.y);
          float birchK = mix(0.3, 1.0, t.b) / mix(0.3, 1.0, treeMean.z);
          diffuseColor.rgb *= mix(barkK, birchK, light);
        } else {
          vec4 t = treeSample(vTreePos, tn, vec2(0.24));
          // chomáče listí: světlé a do žluta, mezery tmavé; pod korunou a dole stín
          float leaf = t.r;
          diffuseColor.rgb *= mix(0.45, 1.35, leaf) / mix(0.45, 1.35, treeMean.x);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.07, 1.05, 0.8), smoothstep(0.6, 0.95, leaf) * 0.6);
          diffuseColor.rgb *= mix(0.78, 1.06, smoothstep(-0.7, 0.4, tn.y));
        }`);
  };
  mat.customProgramCacheKey = () => 'tree';
  return mat;
}

// Roztřepený obrys listnaté koruny zblízka: tři svislé plošky přes střed koruny (6 trojúhelníků na strom)
// s průhlednou texturou lístků jen v pásu kolem okraje koruny: ven trčí jen ten okraj, takže hranatý dvacetistěn nemá rovný obrys. Normály míří od středu koruny (stínují se jako ona),
// vítr je stejný jako u koruny. Bez stínu (stín vrhá koruna).
let cardTex = null;
function leafCardTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const rng = new RNG(29);
  // lístky: malé nepravidelné skvrny s jemným rozdílem jasu (ne koule)
  const leaf = (x, y, r) => {
    const v = Math.round(rng.range(140, 230));
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.beginPath();
    g.ellipse(x, y, r, r * rng.range(0.5, 0.9), rng.range(0, Math.PI), 0, Math.PI * 2);
    g.fill();
  };
  // jen lístky po obvodu (uvnitř je koruna; plné jádro by prosvítalo stěnami nerovného dvacetistěnu), dole řidší
  for (let i = 0; i < 700; i++) {
    const a = rng.range(0, Math.PI * 2);
    if (Math.sin(a) < -0.4 && rng.next() < 0.6) continue;
    const d = S * (0.29 + Math.pow(rng.next(), 1.6) * 0.14);
    leaf(S / 2 + Math.cos(a) * d, S / 2 - Math.sin(a) * d, rng.range(2.5, 5.5));
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// plošky kolem koruny se středem (cx, cy, cz), šířka w, výška h; barva vrcholů = barva koruny
export function leafCardGeometry(cx, cy, cz, w, h, hex) {
  const parts = [];
  for (let k = 0; k < 3; k++) {
    const g = new THREE.PlaneGeometry(w, h).rotateY((k * Math.PI) / 3).translate(cx, cy, cz);
    parts.push(g);
  }
  const geo = mergeGeometries(parts);
  const p = geo.attributes.position, n = geo.attributes.normal;
  const col = new Float32Array(p.count * 3), c = new THREE.Color(hex);
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3(p.getX(i) - cx, (p.getY(i) - cy) * 0.8, p.getZ(i) - cz).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
    c.toArray(col, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

export function leafCardMaterial() {
  cardTex ??= leafCardTexture();
  const mat = new THREE.MeshLambertMaterial({ map: cardTex, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.treeTime = TREE_TIME;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float treeTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float vBark = 0.0;
        ${WIND}`);
  };
  mat.customProgramCacheKey = () => 'leafCard';
  return mat;
}

// vítr pro cizí materiál stromu (větve a listy z realtrees.js): stejné kývání jako koruny tady
export function windMaterial(mat, key) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.uniforms.treeTime = TREE_TIME;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float treeTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float vBark = 0.0;
        ${WIND}`);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}
