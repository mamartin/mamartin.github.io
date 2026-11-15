// Stromy pro zkušební realistický vzhled: tvar (větve a listy na ploškách) i textury kůry a listí
// dává knihovna ez-tree (vendor/ez-tree.es.js, MIT), která strom vypěstuje z předvolby druhu.
// Z každého druhu vznikne jednou při načtení pár tvarů; materiály jsou vlastní (pole instancí,
// vítr a předpočítané stíny jako u ostatních stromů). Knihovna se stahuje, jen když je vzhled zapnutý.
import * as THREE from 'three';
import { windMaterial } from './foliage.js';

// druh -> předvolby knihovny; výška a poloměr koruny odpovídají původním tvarům (měřítko instancí zůstává)
const KINDS = {
  broad: { presets: ['Oak Medium', 'Ash Medium', 'Oak Small'], height: 7.6, radius: 3.0 },
  spruce: { presets: ['Pine Medium'], height: 8.4, radius: 2.5 },
};

let ready = null;
export const realTrees = { broad: [], spruce: [] };

export function loadRealTrees() {
  ready ??= import('../vendor/ez-tree.es.js').then(({ Tree, Billboard }) => {
    for (const [kind, { presets, height, radius }] of Object.entries(KINDS)) {
      presets.forEach((name, i) => {
        const tree = new Tree();
        tree.loadPreset(name);
        tree.options.seed = 1000 + i * 37;
        // méně dílků ve větvích: strom je vidět z auta, ne zblízka
        const b = tree.options.branch;
        for (const k of Object.keys(b.sections)) b.sections[k] = Math.max(3, Math.round(b.sections[k] * 0.5));
        for (const k of Object.keys(b.segments)) b.segments[k] = Math.max(3, Math.round(b.segments[k] * 0.6));
        // méně větších listů na jedné plošce (dvě zkřížené plošky na list by zdvojnásobily trojúhelníky)
        const l = tree.options.leaves;
        l.billboard = Billboard.Single;
        l.count = Math.max(1, Math.round(l.count * 0.7));
        l.size *= 1.35;
        tree.generate();
        const wood = tree.branchesMesh.geometry, leaves = tree.leavesMesh.geometry;
        // velikost: výška podle listí, šířka koruny zvlášť (stromy z předvoleb jsou různě štíhlé)
        leaves.computeBoundingBox();
        const box = leaves.boundingBox;
        const sy = height / box.max.y, sr = radius / Math.max(box.max.x, -box.min.x, box.max.z, -box.min.z);
        for (const g of [wood, leaves]) g.scale(sr, sy, sr);
        // listy se stínují jako koule koruny (plošky natočené náhodně by blikaly světlem a stínem)
        const p = leaves.attributes.position, n = leaves.attributes.normal;
        const cy = (box.min.y + box.max.y) * 0.5 * sy - 1;
        const v = new THREE.Vector3();
        for (let k = 0; k < p.count; k++) {
          v.set(p.getX(k), p.getY(k) - cy, p.getZ(k)).normalize();
          n.setXYZ(k, v.x, v.y, v.z);
        }
        for (const g of [wood, leaves]) {
          g.computeBoundingSphere();
          const white = new Float32Array(g.attributes.position.count * 3).fill(1);
          g.setAttribute('color', new THREE.BufferAttribute(white, 3));
        }
        const src = { wood: tree.branchesMesh.material, leaves: tree.leavesMesh.material };
        // lehčí tvar pro střední vzdálenost: stejný kmen bez větví a každý druhý list, o to větší
        // (silueta zůstane, při přepnutí z plného tvaru strom neposkočí)
        const bare = new Tree();
        bare.loadPreset(name);
        bare.options.seed = tree.options.seed;
        bare.options.branch.levels = 0;
        for (const k of Object.keys(bare.options.branch.sections)) bare.options.branch.sections[k] = 3;
        for (const k of Object.keys(bare.options.branch.segments)) bare.options.branch.segments[k] = 4;
        bare.generate();
        const woodLite = bare.branchesMesh.geometry;
        woodLite.scale(sr, sy, sr);
        woodLite.computeBoundingSphere();
        woodLite.setAttribute('color', new THREE.BufferAttribute(new Float32Array(woodLite.attributes.position.count * 3).fill(1), 3));
        const leavesLite = thinLeaves(leaves, 2, 1.45);
        realTrees[kind].push({
          wood, leaves, woodLite, leavesLite, bark: src.wood.map, barkNormal: src.wood.normalMap, leaf: src.leaves.map,
          tris: (wood.index.count + leaves.index.count) / 3, trisLite: (woodLite.index.count + leavesLite.index.count) / 3,
        });
      });
    }
  });
  return ready;
}

// každý n-tý list (čtyři vrcholy na list), zvětšený kolem svého středu
function thinLeaves(geo, n, grow) {
  const quads = Math.floor(geo.attributes.position.count / 4);
  const keep = [];
  for (let q = 0; q < quads; q += n) keep.push(q);
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) {
    const size = attr.itemSize, arr = new Float32Array(keep.length * 4 * size);
    keep.forEach((q, k) => { for (let v = 0; v < 4 * size; v++) arr[k * 4 * size + v] = attr.array[q * 4 * size + v]; });
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  const p = out.attributes.position;
  for (let k = 0; k < keep.length; k++) {
    let cx = 0, cy = 0, cz = 0;
    for (let v = 0; v < 4; v++) { cx += p.getX(k * 4 + v) / 4; cy += p.getY(k * 4 + v) / 4; cz += p.getZ(k * 4 + v) / 4; }
    for (let v = 0; v < 4; v++) {
      const i = k * 4 + v;
      p.setXYZ(i, cx + (p.getX(i) - cx) * grow, cy + (p.getY(i) - cy) * grow, cz + (p.getZ(i) - cz) * grow);
    }
  }
  // pořadí vrcholů listu podle prvního listu původní sítě
  const src = geo.index.array, first = Math.min(...src.slice(0, 6));
  const pattern = Array.from(src.slice(0, 6), (v) => v - first);
  const idx = new Uint32Array(keep.length * 6);
  for (let k = 0; k < keep.length; k++) for (let v = 0; v < 6; v++) idx[k * 6 + v] = k * 4 + pattern[v];
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

const mats = new Map();
// materiály jednoho tvaru: kůra a listí (průhledné okraje, oboustranné, vítr)
export function realTreeMaterials(t) {
  if (!mats.has(t)) {
    const wood = windMaterial(new THREE.MeshLambertMaterial({ map: t.bark, normalMap: t.barkNormal, vertexColors: true }), 'realWood');
    const leaves = windMaterial(new THREE.MeshLambertMaterial({ map: t.leaf, alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true }), 'realLeaves');
    const prev = leaves.onBeforeCompile;
    leaves.onBeforeCompile = (sh, r) => {
      prev(sh, r);
      // zadní strana plošky se stínuje stejně jako přední (normála koruny se neotáčí) a listí trochu prosvítá
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        #ifdef DOUBLE_SIDED
          normal *= faceDirection;
        #endif`);
    };
    // stín s průhlednými okraji listů
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: t.leaf, alphaTest: 0.45 });
    mats.set(t, { wood, leaves, depth });
  }
  return mats.get(t);
}
