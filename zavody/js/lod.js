// Levnější kreslení velkých scén: dlouhé sítě se dělí na čtverce (mimo záběr se nekreslí)
// a vzdálené kusy se zjednoduší nebo schovají. Úrovně podrobnosti přepíná sám three.js
// (THREE.LOD) při každém vykreslení podle vzdálenosti kamery.
import * as THREE from 'three';

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

// Instance (stromy, auta, lampy) po čtvercích s úrovněmi podrobnosti:
// levels = [[od vzdálenosti, [[geometrie, položky, vrhá stín], ...]], ...], za cull nic.
// Každá úroveň může kreslit jiné položky jinými tvary (zblízka třeba stromy u trati plně
// a se stínem, ostatní siluetou; dál všechny jednou siluetou, tedy menším počtem volání).
// Sítě se stejnými položkami sdílejí matice i barvy instancí.
export function instancedLevels(levels, mat, { chunk = 160, cull = Infinity } = {}) {
  const keyOf = (it) => Math.floor(it.x / chunk) + ':' + Math.floor(it.z / chunk);
  const split = new Map();
  const bucketsOf = (items) => {
    if (!split.has(items)) {
      const m = new Map();
      for (const it of items) {
        const k = keyOf(it);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(it);
      }
      split.set(items, m);
    }
    return split.get(items);
  };
  const chunks = new Map();
  levels.forEach(([, parts], li) => {
    for (const [geo, items, castShadow] of parts) {
      for (const [k, list] of bucketsOf(items)) {
        if (!chunks.has(k)) chunks.set(k, { parts: levels.map(() => []), items: new Set() });
        const c = chunks.get(k);
        c.parts[li].push([geo, list, castShadow]);
        for (const it of list) c.items.add(it);
      }
    }
  });
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const e = new THREE.Euler(), col = new THREE.Color();
  const shared = new Map();
  const instanced = (geo, list, castShadow) => {
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    if (shared.has(list)) {
      const a = shared.get(list);
      mesh.instanceMatrix = a.instanceMatrix;
      mesh.instanceColor = a.instanceColor;
    } else {
      list.forEach((it, i) => {
        e.set(it.rx ?? 0, it.ry ?? 0, it.rz ?? 0);
        q.setFromEuler(e);
        s.set(it.sx ?? it.s ?? 1, it.sy ?? it.s ?? 1, it.sz ?? it.s ?? 1);
        p.set(it.x, it.y, it.z);
        m.compose(p, q, s);
        mesh.setMatrixAt(i, m);
        if (it.color !== undefined) mesh.setColorAt(i, col.set(it.color));
      });
      shared.set(list, mesh);
    }
    mesh.castShadow = !!castShadow;
    mesh.computeBoundingSphere();
    return mesh;
  };
  const group = new THREE.Group();
  for (const c of chunks.values()) {
    let cx = 0, cy = 0, cz = 0;
    for (const it of c.items) {
      cx += it.x; cy += it.y; cz += it.z;
    }
    const n = c.items.size;
    const lv = levels.map(([dist], li) => {
      const g = new THREE.Group();
      for (const [geo, list, castShadow] of c.parts[li]) g.add(instanced(geo, list, castShadow));
      return [g, dist];
    });
    if (cull < Infinity) lv.push([null, cull]);
    group.add(lodAt({ x: cx / n, y: cy / n, z: cz / n }, lv));
  }
  return group;
}
