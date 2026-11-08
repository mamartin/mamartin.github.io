// Postavy diváků a chodců: kvádrové tělo (asi 70 trojúhelníků) s jednou malou texturou pro všechny.
// Textura má 8 druhů oblečení vedle sebe (tričko, pruhy, mikina, bunda se zipem, dres s číslem, kostkovaná
// košile, kabát, šála), s obličejem, vlasy nebo kšiltovkou a kalhotami. Druh i pohyb si shader odvodí
// z polohy instance, takže instance nepotřebují žádná data navíc a výběr v lod.js zůstává stejný.
// Barva instance obarví jen to, co má v textuře masku (alfa), zbytek (kůže, kalhoty, potisk) zůstane.
// Fanoušci se pohupují a část z nich občas zvedne ruce; chodci a lidé u přechodů jen stojí.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const VARIANTS = 8;
const CW = 64, CH = 128; // buňka jednoho druhu v textuře (px)

// obdélníky v buňce [x0, y0, x1, y1] (y shora)
const R = {
  torsoF: [0, 0, 32, 40], torsoB: [32, 0, 64, 40], torsoS: [0, 40, 12, 80],
  arm: [12, 40, 28, 80], legsF: [28, 40, 46, 80], legsB: [46, 40, 64, 80],
  headF: [0, 80, 20, 104], headS: [20, 80, 40, 104], headB: [40, 80, 60, 104], hair: [0, 104, 64, 112],
};

const SKIN = ['#f0c8a8', '#d9a580', '#b98058', '#8a5a3c'];
const PANTS = ['#3c5a86', '#25272b', '#8a7a5a', '#4a4e55', '#2f4566'];
const HAIR = ['#3a2a1e', '#16130f', '#c9a25c', '#8f8f8f', '#6b3a1e'];

function atlas() {
  const W = CW * VARIANTS;
  const canvas = () => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = CH;
    return c.getContext('2d', { willReadFrequently: true });
  };
  // barvy a zvlášť maska oblečení (bílá = obarví se barvou instance); potisky masku mažou
  const g = canvas(), m = canvas();
  m.fillStyle = '#000000';
  m.fillRect(0, 0, W, CH);
  for (let v = 0; v < VARIANTS; v++) {
    const ox = v * CW;
    const skin = SKIN[v % 4], pants = PANTS[v % 5], hair = HAIR[(v * 3) % 5];
    const cap = v === 2 || v === 6;
    // shade: jen barva (na oblečení stínuje barvu instance), print: barva bez masky, cloth: maska
    const shade = ([x0, y0, x1, y1], col) => {
      g.fillStyle = col;
      g.fillRect(ox + x0, y0, x1 - x0, y1 - y0);
    };
    const print = (r, col) => {
      shade(r, col);
      m.fillStyle = '#000000';
      m.fillRect(ox + r[0], r[1], r[2] - r[0], r[3] - r[1]);
    };
    const cloth = (r) => {
      shade(r, '#ffffff');
      m.fillStyle = '#ffffff';
      m.fillRect(ox + r[0], r[1], r[2] - r[0], r[3] - r[1]);
    };
    for (const r of [R.torsoF, R.torsoB, R.torsoS, R.arm]) cloth(r);
    // kalhoty a boty
    for (const r of [R.legsF, R.legsB]) {
      shade(r, pants);
      shade([r[0] + 8, r[1], r[0] + 10, r[3] - 6], 'rgba(0,0,0,0.35)'); // mezera mezi nohama
      shade([r[0], r[3] - 6, r[2], r[3]], '#1c1c1e'); // boty
      if (v === 6) cloth([r[0], r[1], r[2], r[1] + 18]); // kabát přes stehna
    }
    // rukáv: krátký u triček, dlouhý jinak; dole ruka
    const short = v === 0 || v === 1 || v === 4 || v === 7;
    print([R.arm[0], R.arm[1] + (short ? 14 : 32), R.arm[2], R.arm[3]], skin);
    // vzory
    if (v === 1) for (let y = 4; y < 40; y += 8) { print([0, y, 64, y + 3], '#f4f2ec'); print([R.arm[0], 40 + y / 3, R.arm[2], 41 + y / 3], '#f4f2ec'); }
    if (v === 2) { shade([6, 24, 26, 34], 'rgba(0,0,0,0.2)'); shade([36, 0, 60, 12], 'rgba(0,0,0,0.25)'); } // kapsa, kapuce
    if (v === 3) { print([15, 4, 17, 40], '#cfd0d2'); shade([8, 0, 24, 5], 'rgba(0,0,0,0.3)'); } // zip, límec
    if (v === 4) {
      print([0, 0, 64, 3], '#f6f6f2'); // lem
      g.fillStyle = '#f6f6f2';
      m.fillStyle = '#000000';
      g.font = m.font = 'bold 22px sans-serif';
      g.textAlign = m.textAlign = 'center';
      g.fillText('17', ox + 48, 30);
      m.fillText('17', ox + 48, 30);
      g.font = m.font = 'bold 10px sans-serif';
      g.fillText('17', ox + 22, 15);
      m.fillText('17', ox + 22, 15);
    }
    if (v === 5) for (let k = 0; k < 64; k += 8) { shade([k, 0, k + 3, 40], 'rgba(0,0,0,0.22)'); shade([0, k * 0.6, 64, k * 0.6 + 3], 'rgba(0,0,0,0.22)'); }
    if (v === 6) { shade([14, 2, 18, 40], 'rgba(0,0,0,0.22)'); for (const y of [12, 22, 32]) print([18, y, 21, y + 3], '#2a2a2a'); } // knoflíky
    if (v === 7) for (let x = 0; x < 64; x += 8) { print([x, 0, x + 4, 7], '#c8242a'); print([x + 4, 0, x + 8, 7], '#f4f2ec'); } // šála
    // hlava: obličej, boky a týl, vlasy nebo kšiltovka
    const top = cap ? '#2a2c30' : hair;
    shade(R.headF, skin); shade(R.headS, skin); shade(R.headB, top);
    shade([R.headF[0], R.headF[1], R.headF[2], R.headF[1] + 5], top);
    shade([R.headS[0], R.headS[1], R.headS[2], R.headS[1] + 7], top);
    shade([R.headS[0] + 12, R.headS[1] + 7, R.headS[2], R.headS[1] + 14], cap ? skin : hair); // za uchem
    shade([4, 88, 7, 91], '#1e1a18'); shade([13, 88, 16, 91], '#1e1a18'); // oči
    shade([3, 86, 8, 87], 'rgba(40,25,15,0.6)'); shade([12, 86, 17, 87], 'rgba(40,25,15,0.6)'); // obočí
    shade([7, 97, 13, 98], 'rgba(120,50,40,0.7)'); // ústa
    shade(R.hair, top);
  }
  // RGBA přímo do dat (plátno by u průhledných pixelů barvu zahodilo); řádky obráceně, v = 1 je nahoře
  const col = g.getImageData(0, 0, W, CH).data, mask = m.getImageData(0, 0, W, CH).data;
  const data = new Uint8Array(W * CH * 4);
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, o = ((CH - 1 - y) * W + x) * 4;
      data[o] = col[i]; data[o + 1] = col[i + 1]; data[o + 2] = col[i + 2]; data[o + 3] = mask[i];
    }
  }
  const tex = new THREE.DataTexture(data, W, CH);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// UV kvádru: každá stěna dostane obdélník buňky 0 (shader posune na druh); pořadí stěn +x, −x, +y, −y, +z, −z
function boxUv(geo, faces) {
  const uv = geo.attributes.uv;
  for (let f = 0; f < 6; f++) {
    const [x0, y0, x1, y1] = faces[f];
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      const u = uv.getX(i), v = uv.getY(i);
      uv.setXY(i, (x0 + (x1 - x0) * u) / (CW * VARIANTS), 1 - (y1 - (y1 - y0) * v) / CH);
    }
  }
  return geo;
}

// díl s číslem části: 0 tělo, 1 levá ruka, 2 pravá ruka (shader je zvedá kolem ramene)
const tagged = (geo, part) => {
  const g = geo.toNonIndexed();
  g.setAttribute('part', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(part), 1));
  return g;
};

// postava čelem k +z, chodidla na y = 0
export function personGeometry() {
  const t = R;
  const torso = boxUv(new THREE.BoxGeometry(0.4, 0.6, 0.24), [t.torsoS, t.torsoS, t.torsoS, t.torsoS, t.torsoF, t.torsoB]).translate(0, 1.17, 0);
  const arm = (sx) => boxUv(new THREE.BoxGeometry(0.1, 0.62, 0.14), [t.arm, t.arm, t.arm, t.arm, t.arm, t.arm]).translate(sx * 0.26, 1.15, 0);
  const legs = boxUv(new THREE.BoxGeometry(0.34, 0.86, 0.18), [t.legsB, t.legsB, t.legsB, t.legsB, t.legsF, t.legsB]).translate(0, 0.43, 0);
  const head = boxUv(new THREE.BoxGeometry(0.22, 0.24, 0.22), [t.headS, t.headS, t.hair, t.headS, t.headF, t.headB]).translate(0, 1.6, 0);
  const hair = boxUv(new THREE.BoxGeometry(0.24, 0.06, 0.24), [t.hair, t.hair, t.hair, t.hair, t.hair, t.hair]).translate(0, 1.73, -0.01);
  const geo = mergeGeometries([tagged(torso, 0), tagged(legs, 0), tagged(head, 0), tagged(hair, 0), tagged(arm(1), 1), tagged(arm(-1), 2)]);
  geo.computeBoundingSphere();
  return geo;
}

const time = { value: 0 };

// fans: pohupování a zvedání rukou; jinak postavy stojí
export function personMaterial(fans) {
  const mat = new THREE.MeshLambertMaterial({ map: atlas() });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float part;
        uniform float uTime;
        varying float vVarU;
        float hash2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        // úhel zvednutí paže a poskok podle náhody instance
        vec2 cheer() {
          #if FANS
          vec2 at = instanceMatrix[3].xz;
          float h = hash2(at), ph = hash2(at + 7.31) * 6.2832;
          float wave = smoothstep(0.55, 0.9, sin(uTime * (0.45 + h * 0.5) + ph));
          float up = h > 0.55 ? wave : 0.0;
          float hop = h > 0.8 ? pow(max(0.0, sin(uTime * 7.0 + ph)), 6.0) * 0.09 * wave : 0.0;
          return vec2(up * 2.7, hop + sin(uTime * 1.3 + ph) * 0.012);
          #else
          return vec2(0.0);
          #endif
        }
        vec3 armTurn(vec3 p, float a, float side) {
          // otočení kolem ramene (x = ±0,26, y = 1,44) v rovině x-y
          vec2 q = p.xy - vec2(side * 0.26, 1.44);
          float c = cos(a * side), s = sin(a * side);
          return vec3(vec2(c * q.x - s * q.y, s * q.x + c * q.y) + vec2(side * 0.26, 1.44), p.z);
        }`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        vec2 ch = cheer();
        float armSide = part > 1.5 ? -1.0 : part > 0.5 ? 1.0 : 0.0;
        if (armSide != 0.0) {
          float c = cos(ch.x * armSide), s = sin(ch.x * armSide);
          objectNormal.xy = vec2(c * objectNormal.x - s * objectNormal.y, s * objectNormal.x + c * objectNormal.y);
        }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        if (armSide != 0.0) transformed = armTurn(transformed, ch.x, armSide);
        transformed.y += ch.y;
        vVarU = floor(hash2(instanceMatrix[3].xz + 3.17) * ${VARIANTS}.0) / ${VARIANTS}.0;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vVarU;')
      .replace('#include <map_fragment>', `
        vec4 personTex = texture2D(map, vMapUv + vec2(vVarU, 0.0));
        diffuseColor.rgb *= personTex.rgb;`)
      .replace('#include <color_fragment>', `
        #ifdef USE_COLOR
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vColor, personTex.a);
        #endif`);
    sh.defines = { ...sh.defines, FANS: fans ? 1 : 0 };
  };
  mat.customProgramCacheKey = () => `person|${fans}`;
  return mat;
}

// čas pohybu: volá se před vykreslením sítě
export const tickPeople = () => {
  time.value = (performance.now() / 1000) % 10000;
};
