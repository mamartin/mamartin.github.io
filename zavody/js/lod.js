// Levnější kreslení velkých scén: sítě se stejným materiálem se sloučí, dlouhé sítě se dělí na čtverce
// (mimo záběr se nekreslí) a vzdálené kusy se zjednoduší nebo schovají. Úrovně podrobnosti bloků přepíná
// sám three.js (THREE.LOD), instance (stromy, auta, lampy) vybírá updatePools před každým vykreslením.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Síť rozdělená po trojúhelnících do čtverců size × size podle těžiště. Vrací pole sítí se
// stejným materiálem a stíny, nebo null, když se dělit nevyplatí.
export function splitMesh(mesh, size) {
  const src = mesh.geometry;
  const pos = src.attributes.position;
  const index = src.index;
  const triCount = (index ? index.count : pos.count) / 3;
  if (mesh.isInstancedMesh) return splitInstanced(mesh, size);
  if (src.groups.length > 1 || mesh.isSkinnedMesh) return null;
  const vert = (t, c) => (index ? index.getX(t * 3 + c) : t * 3 + c);
  const buckets = new Map();
  for (let t = 0; t < triCount; t++) {
    let x = 0, z = 0;
    for (let c = 0; c < 3; c++) {
      const v = vert(t, c);
      x += pos.getX(v);
      z += pos.getZ(v);
    }
    const key = `${Math.floor(x / 3 / size)}:${Math.floor(z / 3 / size)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(t);
  }
  if (buckets.size < 2) return null;
  const names = Object.keys(src.attributes);
  const out = [];
  for (const tris of buckets.values()) {
    const g = new THREE.BufferGeometry();
    for (const name of names) {
      const a = src.attributes[name];
      const arr = new a.array.constructor(tris.length * 3 * a.itemSize);
      let o = 0;
      for (const t of tris) {
        for (let c = 0; c < 3; c++) {
          const v = vert(t, c);
          for (let k = 0; k < a.itemSize; k++) arr[o++] = a.array[v * a.itemSize + k];
        }
      }
      g.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
    }
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mesh.material);
    m.castShadow = mesh.castShadow;
    m.receiveShadow = mesh.receiveShadow;
    m.renderOrder = mesh.renderOrder;
    m.name = mesh.name;
    out.push(m);
  }
  return out;
}

// instance rozdělené podle polohy do čtverců (obal celé sítě by jinak zabral celou trať)
function splitInstanced(mesh, size) {
  const m = new THREE.Matrix4();
  const buckets = new Map();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    const key = `${Math.floor(m.elements[12] / size)}:${Math.floor(m.elements[14] / size)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(i);
  }
  if (buckets.size < 2) return null;
  const c = new THREE.Color();
  return [...buckets.values()].map((list) => {
    const part = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
    list.forEach((i, j) => {
      mesh.getMatrixAt(i, m);
      part.setMatrixAt(j, m);
      if (mesh.instanceColor) part.setColorAt(j, mesh.getColorAt(i, c));
    });
    part.castShadow = mesh.castShadow;
    part.receiveShadow = mesh.receiveShadow;
    part.renderOrder = mesh.renderOrder;
    part.name = mesh.name;
    part.computeBoundingSphere();
    return part;
  });
}

// Sloučí statické sítě ve stromu objektů, které se kreslí stejně (stejný druh a nastavení materiálu,
// stíny, pořadí a atributy geometrie), do jedné sítě na kořeni: obrubník, chodník, svodidla a zábradlí
// trati mají každý vlastní materiál se stejným nastavením. Sítě s vlastním onBeforeRender zůstanou.
export function mergeSimilar(root) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const groups = new Map();
  const noop = THREE.Object3D.prototype.onBeforeRender;
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material) || o.onBeforeRender !== noop) return;
    const g = o.geometry, m = o.material;
    if (g.groups.length > 1 || g.morphAttributes.position) return;
    const key = [
      m.type, m.vertexColors, m.side, m.transparent, m.opacity, m.alphaTest, m.flatShading, m.depthWrite, m.polygonOffset,
      m.color?.getHex(), m.emissive?.getHex(), m.map?.uuid, m.roughness, m.metalness, m.toneMapped, m.fog,
      o.castShadow, o.receiveShadow, o.renderOrder, !!g.index, Object.keys(g.attributes).sort().join(),
      m.onBeforeCompile === THREE.Material.prototype.onBeforeCompile ? '' : m.customProgramCacheKey(), // upravený shader se nesmí slít s obyčejným
    ].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  });
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const geos = list.map((o) => o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)));
    const merged = mergeGeometries(geos);
    if (!merged) continue;
    const first = list[0];
    const mesh = new THREE.Mesh(merged, first.material);
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    mesh.name = first.name;
    for (const o of list) {
      o.removeFromParent();
      o.geometry.dispose();
      if (o.material !== first.material) o.material.dispose();
    }
    for (const g of geos) g.dispose();
    root.add(mesh);
  }
  return root;
}

// Ve stromu objektů nahradí velké statické sítě (obal širší než size, víc než minTris
// trojúhelníků) jejich čtverci; malé sítě by jen přidaly volání kreslení.
export function splitLarge(root, size, minTris = 2000) {
  const list = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.parent || o.isSkinnedMesh) return;
    const g = o.geometry;
    if (o.isInstancedMesh) o.computeBoundingSphere();
    else if (!g.boundingSphere) g.computeBoundingSphere();
    const tris = ((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1);
    const radius = (o.isInstancedMesh ? o.boundingSphere : g.boundingSphere).radius;
    if (radius > size && tris > minTris) list.push(o);
  });
  for (const o of list) {
    const parts = splitMesh(o, size);
    if (!parts) continue;
    const group = new THREE.Group();
    group.name = o.name;
    group.add(...parts);
    // čtverce zdědí posun sítě i její místo mezi sourozenci
    group.position.copy(o.position);
    group.quaternion.copy(o.quaternion);
    group.scale.copy(o.scale);
    const parent = o.parent;
    parent.children[parent.children.indexOf(o)] = group;
    group.parent = parent;
    o.parent = null;
    // instance sdílejí geometrii s původní sítí, ta zůstává
    if (!o.isInstancedMesh) o.geometry.dispose();
  }
  return root;
}

// Úrovně podrobnosti kolem bodu center: levels = [[objekt nebo null, od vzdálenosti], ...].
// null znamená nic nekreslit (dál než mlha nebo tak daleko, že by kus nebyl vidět).
// Objekty jsou ve světových souřadnicích, LOD je jen posune zpět na své místo.
export function lodAt(center, levels) {
  const lod = new THREE.LOD();
  lod.position.set(center.x, center.y ?? 0, center.z);
  for (const [obj, dist] of levels) {
    const o = obj ?? new THREE.Object3D();
    o.position.set(-center.x, -(center.y ?? 0), -center.z);
    lod.addLevel(o, dist, dist > 0 ? 0.04 : 0);
  }
  lod.userData.base = lod.levels.map((l) => l.distance);
  return lod;
}

// dohled: násobí vzdálenosti všech úrovní (automatická kvalita ho zkracuje spolu s mlhou)
export function setViewScale(root, scale) {
  root.traverse((o) => {
    if (o.userData.pool) o.userData.pool.scale = scale;
    if (!o.isLOD || !o.userData.base) return;
    o.levels.forEach((l, i) => (l.distance = o.userData.base[i] * scale));
  });
}

// Objekt, který se dál než dist nekreslí (např. dav na tribuně: lidé jsou tam menší než pixel).
// Vlastní viditelnost objektu zůstává, LOD přepíná jen obal kolem něj.
export function hideBeyond(obj, dist) {
  const lod = new THREE.LOD();
  lod.position.copy(obj.position);
  lod.quaternion.copy(obj.quaternion);
  lod.scale.copy(obj.scale);
  obj.position.set(0, 0, 0);
  obj.quaternion.identity();
  obj.scale.set(1, 1, 1);
  const holder = new THREE.Group();
  holder.add(obj);
  lod.addLevel(holder, 0);
  lod.addLevel(new THREE.Object3D(), dist, 0.04);
  lod.userData.base = lod.levels.map((l) => l.distance);
  return lod;
}

// Instance (stromy, auta, lampy) s úrovněmi podrobnosti:
// levels = [[od vzdálenosti, [[geometrie, položky, vrhá stín], ...]], ...], za cull nic.
// Každá úroveň může kreslit jiné položky jinými tvary (zblízka třeba stromy u trati plně
// a se stínem, ostatní siluetou; dál všechny jednou siluetou).
// Každý tvar každé úrovně je jedna InstancedMesh přes celou trať (jedno volání kreslení). Které položky
// kreslí, vybere před každým vykreslením updatePools: vzdálenost od kamery a záběr. Tvary se stínem
// záběr nehlídají, stín stromu za kamerou může padat do obrazu.
export function instancedLevels(levels, mat, { cull = Infinity } = {}) {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const e = new THREE.Euler(), col = new THREE.Color();
  const group = new THREE.Group();
  const parts = [];
  levels.forEach(([from, list], li) => {
    const to = li + 1 < levels.length ? levels[li + 1][0] : cull;
    for (const [geo, items, castShadow] of list) {
      if (!items.length) continue;
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      const gs = geo.boundingSphere;
      const n = items.length;
      // všechny matice, barvy a obalové koule položek; do sítě se kopírují jen viditelné
      const mats = new Float32Array(n * 16), cols = items.some((it) => it.color !== undefined) ? new Float32Array(n * 3) : null;
      const spheres = new Float32Array(n * 4);
      items.forEach((it, i) => {
        e.set(it.rx ?? 0, it.ry ?? 0, it.rz ?? 0);
        q.setFromEuler(e);
        s.set(it.sx ?? it.s ?? 1, it.sy ?? it.s ?? 1, it.sz ?? it.s ?? 1);
        p.set(it.x, it.y, it.z);
        m.compose(p, q, s);
        m.toArray(mats, i * 16);
        if (cols) col.set(it.color ?? 0xffffff).toArray(cols, i * 3);
        const c = gs.center.clone().applyMatrix4(m);
        spheres.set([c.x, c.y, c.z, gs.radius * Math.max(s.x, s.y, s.z)], i * 4);
      });
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.count = 0;
      mesh.frustumCulled = false; // výběr dělá updatePools
      mesh.castShadow = !!castShadow;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (cols) {
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
        mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      }
      group.add(mesh);
      parts.push({ mesh, mats, cols, spheres, n, from, to, shadow: !!castShadow });
    }
  });
  group.userData.pool = { parts, scale: 1, key: '' };
  return group;
}

// pole instancí ve stromu objektů (jednou po postavení světa)
export function collectPools(root) {
  const out = [];
  root.traverse((o) => { if (o.userData.pool) out.push(o.userData.pool); });
  return out;
}

const frustum = new THREE.Frustum(), viewProj = new THREE.Matrix4();
// Výběr instancí pro kameru: volá se před vykreslením scény (scene.onBeforeRender), kamera má aktuální matice.
// Bez pohybu kamery se nic nepočítá ani nenahrává.
export function updatePools(pools, camera) {
  const me = camera.matrixWorld.elements, pe = camera.projectionMatrix.elements;
  const key = `${me.join()}|${pe[0]},${pe[5]}`;
  viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(viewProj);
  const planes = frustum.planes.map((pl) => [pl.normal.x, pl.normal.y, pl.normal.z, pl.constant]);
  const cx = me[12], cy = me[13], cz = me[14];
  for (const pool of pools) {
    const k = `${key}|${pool.scale}`;
    if (pool.key === k) continue;
    pool.key = k;
    for (const part of pool.parts) {
      const { mesh, mats, cols, spheres, n, shadow } = part;
      const lo = part.from * pool.scale, hi = part.to * pool.scale;
      const lo2 = lo * lo, hi2 = hi * hi;
      const dst = mesh.instanceMatrix.array, dcol = cols && mesh.instanceColor.array;
      let count = 0;
      for (let i = 0; i < n; i++) {
        const x = spheres[i * 4], y = spheres[i * 4 + 1], z = spheres[i * 4 + 2], r = spheres[i * 4 + 3];
        const d2 = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2;
        if (d2 < lo2 || d2 >= hi2) continue;
        if (!shadow) {
          let out = false;
          for (const pl of planes) if (pl[0] * x + pl[1] * y + pl[2] * z + pl[3] < -r) { out = true; break; }
          if (out) continue;
        }
        dst.set(mats.subarray(i * 16, i * 16 + 16), count * 16);
        if (dcol) dcol.set(cols.subarray(i * 3, i * 3 + 3), count * 3);
        count++;
      }
      if (count === 0 && mesh.count === 0) continue;
      mesh.count = count;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, count * 16);
      mesh.instanceMatrix.needsUpdate = true;
      if (dcol) {
        mesh.instanceColor.clearUpdateRanges();
        mesh.instanceColor.addUpdateRange(0, count * 3);
        mesh.instanceColor.needsUpdate = true;
      }
    }
  }
}
