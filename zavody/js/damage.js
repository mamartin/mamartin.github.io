// Viditelné poškození: po nárazu se karoserie v místě dotyku promáčkne a lak ztratí lesk
// a trochu zešedne. Jen vzhled, na jízdu to vliv nemá. Každé auto dostane při prvním nárazu
// vlastní kopii tvaru karoserie (jinak je sdílený všemi auty).
import * as THREE from 'three';

const RADIUS = 0.6; // jak velké okolí místa nárazu se promáčkne (m)
const MAX_DENT = 0.2; // nejhlubší promáčknutí (m)
const GREY = new THREE.Color(0x6d6a66);
const v = new THREE.Vector3();
const box = new THREE.Box3();

// díly karoserie: přímí potomci náklonu vozu (kola jsou ve vlastních skupinách a nemačkají se)
function panels(mesh) {
  if (mesh.dentPanels) return mesh.dentPanels;
  const list = mesh.tilt.children.filter((o) => o.isMesh && !o.material.transparent);
  const body = list.find((o) => o.material === mesh.mats.paint) || list[0];
  mesh.dentPanels = { list, body };
  return mesh.dentPanels;
}

function ownGeometry(o) {
  if (o.userData.dented) return o.geometry;
  o.geometry = o.geometry.clone();
  o.userData.dented = true;
  o.userData.orig = Float32Array.from(o.geometry.attributes.position.array);
  return o.geometry;
}

const hit = new THREE.Vector3(), dir = new THREE.Vector3(), lp = new THREE.Vector3(), ld = new THREE.Vector3();
const inv = new THREE.Matrix4();

// promáčknutí jednoho dílu: bod p a směr d jsou v souřadnicích náklonu vozu
function dent(o, p, d, depth) {
  inv.copy(o.matrix).invert();
  lp.copy(p).applyMatrix4(inv);
  ld.copy(d).transformDirection(inv);
  const geo = ownGeometry(o);
  const pos = geo.attributes.position;
  const a = pos.array, orig = o.userData.orig;
  let moved = false;
  for (let i = 0; i < a.length; i += 3) {
    const ex = a[i] - lp.x, ey = (a[i + 1] - lp.y) * 0.7, ez = a[i + 2] - lp.z;
    const dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (dist > RADIUS) continue;
    const f = (1 - dist / RADIUS) ** 2 * depth;
    // dovnitř (proti směru nárazu) a trochu dolů, ale ne víc než MAX_DENT od původního tvaru
    const nx = a[i] - ld.x * f, ny = a[i + 1] - f * 0.3, nz = a[i + 2] - ld.z * f;
    const ox = orig[i], oy = orig[i + 1], oz = orig[i + 2];
    const off = Math.hypot(nx - ox, ny - oy, nz - oz);
    const k = off > MAX_DENT ? MAX_DENT / off : 1;
    a[i] = ox + (nx - ox) * k;
    a[i + 1] = oy + (ny - oy) * k;
    a[i + 2] = oz + (nz - oz) * k;
    moved = true;
  }
  if (moved) {
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }
}

// náraz do auta v bodě světa (x, z) se silou strength (m/s rozdílu rychlostí)
export function addDamage(car, x, z, strength) {
  const mesh = car.mesh;
  if (!mesh?.mats?.paint || mesh.mats.paint.transparent || strength < 2.5) return;
  const now = performance.now();
  if (now - (car.lastDent || 0) < 250) return;
  car.lastDent = now;
  const depth = Math.min(0.09, strength * 0.007);
  const { list, body } = panels(mesh);
  if (!body) return;
  mesh.root.updateMatrixWorld(true);
  const g = body.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  box.copy(g.boundingBox).applyMatrix4(body.matrix);
  // místo dotyku v souřadnicích náklonu vozu, posunuté na okraj karoserie
  v.set(x, 0, z);
  mesh.tilt.worldToLocal(v);
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  let dx = v.x - cx, dz = v.z - cz;
  const len = Math.hypot(dx, dz) || 1;
  dx /= len;
  dz /= len;
  const hx = (box.max.x - box.min.x) / 2, hz = (box.max.z - box.min.z) / 2;
  const t = Math.min(hx / Math.max(Math.abs(dx), 1e-3), hz / Math.max(Math.abs(dz), 1e-3));
  hit.set(cx + dx * t, (box.min.y + box.max.y) / 2, cz + dz * t);
  dir.set(dx, 0, dz);
  for (const o of list) dent(o, hit, dir, depth);

  // lak: méně lesku, odřený do šeda
  car.wear = Math.min(1, (car.wear || 0) + strength * 0.012);
  for (const m of new Set([mesh.mats.paint, mesh.mats.wing])) {
    if (!m.userData.baseColor) m.userData.baseColor = { color: m.color.clone(), roughness: m.roughness, clearcoat: m.clearcoat ?? 0 };
    const b = m.userData.baseColor;
    m.color.copy(b.color).lerp(GREY, car.wear * 0.28);
    m.roughness = Math.min(1, b.roughness + car.wear * 0.35);
    if (m.clearcoat !== undefined) m.clearcoat = b.clearcoat * (1 - car.wear * 0.7);
  }
}

// vlastní kopie tvarů po promáčknutí uvolnit spolu s autem
export function disposeDamage(mesh) {
  mesh.root.traverse((o) => {
    if (o.userData?.dented) o.geometry.dispose();
  });
}
