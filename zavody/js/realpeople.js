// Postavy pro zkušební realistický vzhled: modely lidí s kostrou (Quaternius, CC0, assets/real/people)
// místo kvádrů. Každý model se jednou při načtení postaví do klidové pózy (první snímek animace Idle),
// kostra se zahodí a z vah kostí zbude u každého vrcholu jen to, ke které končetině patří a jak moc.
// Pohyb pak dělá stejný shader jako u kvádrů (people.js): fanoušci zvedají ruce kolem ramene, chodci
// kývou nohama kolem kyčle; váha dává v rameni a kyčli plynulý ohyb. Stovky postav tak zůstávají
// pole instancí bez kostí. Barva instance obarví jen svršek (tričko, bundu), zbytek má barvy modelu.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cheerClock, walkClock } from './people.js';

const BASE = 'assets/real/people/';
const MODELS = ['casual', 'woman_casual', 'man', 'worker', 'woman', 'woman_top'];
// kosti končetin (dvě různé kostry; načítání z názvů vypouští tečku: UpperArm.L -> UpperArmL); klíční kost
// (Shoulder) k paži nepatří, hýbala by hrudníkem
const ARM = '(UpperArm|LowerArm|Wrist|Palm|Fingers|Index|Middle|Ring|Pinky|Thumb)\\d*', LEG = '(UpperLeg|LowerLeg|Foot)';
const LIMBS = [`${ARM}\\.?L`, `${ARM}\\.?R`, `${LEG}\\.?L`, `${LEG}\\.?R`].map((re) => new RegExp(`^${re}$`));
const TOP = /^(Shirt|Jacket|LightJacket)$/; // svršek, který obarví barva instance

export const realPeople = []; // { geo, shoulder: [x, y], hip: y }
let ready = null;

function bake(gltf, name) {
  const root = gltf.scene;
  // klidová póza: první snímek animace Idle (bez ní póza, ve které je model uložený)
  const clip = gltf.animations.find((a) => /Idle$/.test(a.name)) ?? gltf.animations.find((a) => /Idle/.test(a.name));
  if (clip) {
    const mixer = new THREE.AnimationMixer(root);
    mixer.clipAction(clip).play();
    mixer.update(0);
  }
  root.updateMatrixWorld(true);
  const parts = [];
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  let eyeZ = 0, eyes = 0;
  root.traverse((m) => {
    if (!m.isSkinnedMesh) return;
    m.skeleton.update();
    const g = m.geometry, pos = g.attributes.position, nor = g.attributes.normal, ji = g.attributes.skinIndex, jw = g.attributes.skinWeight;
    // končetina kosti: podle jména, jinak podle předka (kosti dlaně a prstů se v každé kostře jmenují jinak)
    const limbOf = (b) => {
      for (let o = b; o?.isBone; o = o.parent) {
        const k = LIMBS.findIndex((re) => re.test(o.name));
        if (k >= 0) return k;
      }
      return -1;
    };
    const bones = m.skeleton.bones.map(limbOf);
    const count = pos.count;
    const P = new Float32Array(count * 3), N = new Float32Array(count * 3), C = new Float32Array(count * 3), part = new Float32Array(count), limb = new Float32Array(count), tint = new Float32Array(count);
    const col = m.material.color;
    // svršek: díl těla, který není kůže (obarví ho barva instance)
    const top = TOP.test(m.material.name) || (/Body/i.test(`${m.name} ${m.parent?.name}`) && m.material.name === 'LightBrown') ? 1 : 0;
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(pos, i);
      n.fromBufferAttribute(nor, i).multiplyScalar(0.01).add(v);
      m.applyBoneTransform(i, v).applyMatrix4(m.matrixWorld);
      m.applyBoneTransform(i, n).applyMatrix4(m.matrixWorld);
      n.sub(v).normalize();
      v.toArray(P, i * 3);
      n.toArray(N, i * 3);
      col.toArray(C, i * 3);
      // součet vah kostí každé končetiny; vrchol patří k té nejsilnější
      const w = [0, 0, 0, 0];
      for (let k = 0; k < 4; k++) {
        const b = bones[ji.getComponent(i, k)];
        if (b >= 0) w[b] += jw.getComponent(i, k);
      }
      const best = w.indexOf(Math.max(...w));
      // slabé váhy (bok trupu pod paží, hýždě) se nehýbou vůbec, jinak by se při zvednutí ruky trup vyboulil
      const t = Math.min(1, Math.max(0, (w[best] - 0.35) / 0.4));
      if (t > 0) { part[i] = best + 1; limb[i] = t * t * (3 - 2 * t); }
      tint[i] = top;
      if (/^Eyes?$/.test(m.material.name)) { eyeZ += v.z; eyes++; }
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(P, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    out.setAttribute('base', new THREE.BufferAttribute(C, 3));
    out.setAttribute('part', new THREE.BufferAttribute(part, 1));
    out.setAttribute('limb', new THREE.BufferAttribute(limb, 1));
    out.setAttribute('tint', new THREE.BufferAttribute(tint, 1));
    out.setIndex(g.index.clone());
    parts.push(out);
  });
  const geo = mergeGeometries(parts);
  // chodidla na zem, střed do osy, výška 1,78 m (ženy 1,66 m), čelem k +z
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  const s = (/woman/.test(name) ? 1.66 : 1.78) / (b.max.y - b.min.y);
  const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
  const flip = eyes && eyeZ / eyes < cz;
  const fix = new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(-cx, -b.min.y, -cz));
  if (flip) fix.premultiply(new THREE.Matrix4().makeRotationY(Math.PI));
  geo.applyMatrix4(fix);
  geo.computeBoundingSphere();
  // rameno a kyčel v upravených souřadnicích
  const at = (re) => {
    let p = null;
    root.traverse((o) => { if (!p && o.isBone && re.test(o.name)) p = o.getWorldPosition(new THREE.Vector3()).applyMatrix4(fix); });
    return p ?? new THREE.Vector3(0.2, 1.4, 0);
  };
  const arm = at(/^UpperArm\.?L$/), leg = at(/^UpperLeg\.?L$/);
  // shader čeká levou ruku a nohu (části 1 a 3) na straně +x; model otočený čelem vzad je má obráceně
  if (arm.x < 0) {
    const part = geo.attributes.part;
    for (let i = 0; i < part.count; i++) {
      const k = part.getX(i);
      if (k > 0) part.setX(i, k % 2 ? k + 1 : k - 1);
    }
  }
  return { geo, shoulder: [Math.abs(arm.x), arm.y], hip: leg.y, tris: geo.index.count / 3 };
}

export function loadRealPeople() {
  ready ??= import('three/addons/loaders/GLTFLoader.js').then(async ({ GLTFLoader }) => {
    const loader = new GLTFLoader();
    for (const name of MODELS) realPeople.push(bake(await loader.loadAsync(`${BASE}${name}.glb`), name));
  });
  return ready;
}

const mats = new Map();
// mode: 'fans' | 'still' | 'walk' (jako personMaterial v people.js)
export function realPersonMaterial(who, mode) {
  const key = `${realPeople.indexOf(who)}|${mode}`;
  if (mats.has(key)) return mats.get(key);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = cheerClock;
    sh.uniforms.uWalk = walkClock;
    sh.uniforms.uShoulder = { value: new THREE.Vector2(who.shoulder[0], who.shoulder[1]) };
    sh.uniforms.uHip = { value: who.hip };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float part;
        attribute float limb;
        attribute float tint;
        attribute vec3 base;
        uniform float uTime;
        uniform float uWalk;
        uniform vec2 uShoulder;
        uniform float uHip;
        varying vec3 vBase;
        varying float vTint;
        float hash2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        vec2 personId() {
          #if WALK
          float sc = length(instanceMatrix[0].xyz);
          return vec2(sc * 917.3, sc * 131.7);
          #else
          return instanceMatrix[3].xz;
          #endif
        }
        // otočení bodu nebo směru: kolem osy z (zvednutí paže) a kolem osy x (krok)
        vec3 turnZ(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z); }
        vec3 turnX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z); }`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        // 1 levá ruka (+x), 2 pravá ruka, 3 levá noha, 4 pravá noha; limb = jak moc vrchol ke končetině patří
        float raise = 0.0, swing = 0.0, hop = 0.0;
        vec3 pivot = vec3(0.0, uHip, 0.0);
        float armSide = part > 2.5 ? 0.0 : part > 1.5 ? -1.0 : part > 0.5 ? 1.0 : 0.0;
        if (armSide != 0.0) pivot = vec3(armSide * uShoulder.x, uShoulder.y, 0.0);
        #if FANS
        {
          vec2 at = personId();
          float h = hash2(at), ph = hash2(at + 7.31) * 6.2832;
          float wave = smoothstep(0.55, 0.9, sin(uTime * (0.45 + h * 0.5) + ph));
          if (h > 0.55) raise = wave * 2.6 * armSide * limb;
          hop = (h > 0.8 ? pow(max(0.0, sin(uTime * 7.0 + ph)), 6.0) * 0.09 * wave : 0.0) + sin(uTime * 1.3 + ph) * 0.006;
        }
        #endif
        #if WALK
        {
          float w = sin(uWalk * 5.8 + hash2(personId()) * 6.2832);
          if (part > 3.5) swing = w * 0.5;
          else if (part > 2.5) swing = -w * 0.5;
          else if (part > 1.5) swing = -w * 0.35;
          else if (part > 0.5) swing = w * 0.35;
          swing *= limb;
        }
        #endif
        if (raise != 0.0) objectNormal = turnZ(objectNormal, raise);
        if (swing != 0.0) objectNormal = turnX(objectNormal, swing);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        if (raise != 0.0) transformed = turnZ(transformed - pivot, raise) + pivot;
        if (swing != 0.0) transformed = turnX(transformed - pivot, swing) + pivot;
        transformed.y += hop;
        vBase = base;
        vTint = tint;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBase;\nvarying float vTint;')
      .replace('#include <color_fragment>', `
        // barvy modelu; svršek dostane barvu instance (ztmavenou, ať neplave nad ostatními díly)
        #ifdef USE_COLOR
          diffuseColor.rgb = mix(vBase, vColor * 0.55, vTint);
        #else
          diffuseColor.rgb = vBase;
        #endif`);
    sh.defines = { ...sh.defines, FANS: mode === 'fans' ? 1 : 0, WALK: mode === 'walk' ? 1 : 0 };
  };
  mat.customProgramCacheKey = () => `realPerson|${mode}`;
  mats.set(key, mat);
  return mat;
}
