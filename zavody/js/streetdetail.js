// Drobnosti ulic u trati (jen vzhled): poklopy, kanálové vpusti u obrubníku, záplaty a zalité praskliny
// v asfaltu jako obtisky z jedné malé textury (jedno volání kreslení) a koše s lavičkami na chodníku
// (instance se stupni podrobnosti). Rozmístění je náhodné, ale stálé (seed trati).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG } from './rng.js';
import { StripBuilder } from './track.js';
import { colored } from './scenery.js';
import { instancedLevels } from './lod.js';
import { blobGeometry, blobMaterial } from './people.js';

const CELL = 128; // buňka atlasu: 0 poklop, 1 vpusť, 2 záplata, 3 praskliny
const START_GAP = 18; // u startu a cíle nic (šachovnice, rošt)

function atlas() {
  const c = document.createElement('canvas');
  c.width = c.height = CELL * 2;
  const g = c.getContext('2d');
  // poklop: litinový kruh s obručí a mřížkou žeber
  g.save();
  g.translate(CELL / 2, CELL / 2);
  g.fillStyle = '#3a3b3d';
  g.beginPath(); g.arc(0, 0, 58, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#55575a'; g.lineWidth = 6;
  g.beginPath(); g.arc(0, 0, 54, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(0, 0, 47, 0, Math.PI * 2); g.clip();
  g.strokeStyle = '#4b4d50'; g.lineWidth = 4;
  for (let d = -48; d <= 48; d += 12) {
    g.beginPath(); g.moveTo(d, -48); g.lineTo(d, 48); g.stroke();
    g.beginPath(); g.moveTo(-48, d); g.lineTo(48, d); g.stroke();
  }
  g.restore();
  // vpusť: rám a příčné mezery
  g.fillStyle = '#4a4b4e';
  g.fillRect(CELL + 14, 30, CELL - 28, 68);
  g.fillStyle = '#121314';
  for (let x = CELL + 22; x < 2 * CELL - 24; x += 11) g.fillRect(x, 38, 6, 52);
  // záplata: tmavší asfalt s měkkým okrajem
  const grd = g.createRadialGradient(CELL / 2, CELL * 1.5, 30, CELL / 2, CELL * 1.5, 64);
  grd.addColorStop(0, 'rgba(34,35,38,0.62)');
  grd.addColorStop(0.85, 'rgba(34,35,38,0.55)');
  grd.addColorStop(1, 'rgba(34,35,38,0)');
  g.fillStyle = grd;
  g.fillRect(4, CELL + 4, CELL - 8, CELL - 8);
  // zalité praskliny: klikaté tmavé čáry
  const rng = new RNG(5);
  g.strokeStyle = 'rgba(20,20,22,0.85)';
  g.lineWidth = 3;
  g.lineJoin = 'round';
  for (let k = 0; k < 3; k++) {
    g.beginPath();
    let x = CELL + 10, y = CELL + 30 + k * 32;
    g.moveTo(x, y);
    while (x < 2 * CELL - 10) {
      x += rng.range(6, 14);
      y += rng.range(-7, 7);
      g.lineTo(x, Math.max(CELL + 6, Math.min(2 * CELL - 6, y)));
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// uv buňky atlasu (canvas má y dolů, textura flipY)
const cellUv = (i) => {
  const u0 = (i % 2) / 2, v1 = 1 - Math.floor(i / 2) / 2;
  return [u0, v1 - 0.5, u0 + 0.5, v1];
};

export function buildStreetDetail(track, terrain, seed, view) {
  const rng = new RNG(seed);
  const L = track.L;
  const crossing = (s) => track.crossings.some((c) => Math.abs(((s - c + L / 2) % L + L) % L - L / 2) < 4);
  const nearStart = (s) => Math.min(s, L - s) < START_GAP;
  const free = (s) => !nearStart(s) && !crossing(s) && !track.inTunnel?.(s);
  const decals = new StripBuilder();
  // obtisk přes s0..s1 a lat0..lat1 s buňkou atlasu i (výška 2 cm nad silnicí)
  const decal = (s0, s1, lat0, lat1, i, flip = false) => {
    const [u0, v0, u1, v1] = cellUv(i);
    const uv = flip ? [u1, v0, u1, v1, u0, v1, u0, v0] : [u0, v0, u0, v1, u1, v1, u1, v0];
    decals.quad(track.pointS(s0, lat0, 0.02), track.pointS(s0, lat1, 0.02), track.pointS(s1, lat1, 0.02), track.pointS(s1, lat0, 0.02), null, uv);
  };
  const hw = (s) => track.hwAt(track.indexAt(s));
  // poklopy po celé městské trati, mimo přechody
  for (let s = rng.range(10, 40); s < L; s += rng.range(30, 75)) {
    if (!track.onUrban(s) || !free(s)) continue;
    const lat = rng.range(-1, 1) * Math.max(0, hw(s) - 1.4);
    decal(s - 0.4, s + 0.4, lat - 0.4, lat + 0.4, 0);
  }
  // vpusti u obrubníku na obou stranách
  for (const side of [-1, 1]) {
    for (let s = rng.range(5, 25); s < L; s += rng.range(22, 38)) {
      if (!track.onUrban(s) || !free(s)) continue;
      const e = side * hw(s);
      decal(s - 0.45, s + 0.45, e - side * 0.55, e - side * 0.05, 1);
    }
  }
  // záplaty a praskliny jen na asfaltu (na kostkách ne)
  for (let s = rng.range(10, 60); s < L; s += rng.range(35, 110)) {
    if (track.onSett(s) || !free(s)) continue;
    const h = hw(s) - 0.6;
    if (rng.next() < 0.65) {
      const len = rng.range(1.6, 4.5), w = rng.range(1.0, 2.6);
      const lat = rng.range(-h + w / 2, h - w / 2);
      decal(s, s + len, lat - w / 2, lat + w / 2, 2);
    } else {
      const len = rng.range(2.5, 6), lat = rng.range(-h + 1, h - 1);
      decal(s, s + len, lat - 0.5, lat + 0.5, 3, rng.next() < 0.5);
    }
  }
  const group = new THREE.Group();
  group.name = 'streetDetail';
  if (decals.count) {
    const mat = new THREE.MeshLambertMaterial({
      map: atlas(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(decals.build(), mat);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    group.add(mesh);
  }

  // koše a lavičky na chodníku (ne na trávě, ne u otevřeného okraje), čelem do ulice
  const bins = [], benches = [];
  const a = {};
  for (let s = rng.range(15, 45), side = 1; s < L; s += rng.range(45, 85), side = -side) {
    if (!track.onUrban(s) || !free(s)) continue;
    const k = track.indexAt(s);
    const walk = track.edgeAt(k) - track.hwAt(k);
    if (walk < 2.2 || (track.edges && track.edgeKind(s, side) !== 'walk')) continue;
    const lat = side * (track.edgeAt(k) - 0.55);
    track.sampleAt(s, lat, a);
    if (track.openEdge(s, side, [a.x, 0, a.z]) || terrain.keepOut(a.x, a.z)) continue;
    const item = { x: a.x, y: a.y + 0.13, z: a.z, ry: a.hd + (side > 0 ? Math.PI / 2 : -Math.PI / 2) }; // čelem k trati jako diváci (townlife.js)
    (walk >= 3.2 && rng.next() < 0.35 ? benches : bins).push(item);
  }
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const bin = mergeGeometries([
    colored(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 5).translate(0, 0.5, -0.24).toNonIndexed(), '#3d4a3f'),
    colored(new THREE.CylinderGeometry(0.22, 0.2, 0.6, 8, 1, true).translate(0, 0.62, 0).toNonIndexed(), '#4f6b52'),
    colored(new THREE.CylinderGeometry(0.23, 0.23, 0.04, 8).translate(0, 0.93, 0).toNonIndexed(), '#3d4a3f'),
  ]);
  const bench = mergeGeometries([
    colored(new THREE.BoxGeometry(1.7, 0.05, 0.42).translate(0, 0.45, 0).toNonIndexed(), '#8a5d36'),
    colored(new THREE.BoxGeometry(1.7, 0.36, 0.05).translate(0, 0.7, -0.22).rotateX(-0.12).toNonIndexed(), '#8a5d36'),
    ...[-0.72, 0.72].map((x) => colored(new THREE.BoxGeometry(0.06, 0.45, 0.4).translate(x, 0.22, -0.02).toNonIndexed(), '#2d3033')),
  ]);
  const opts = { cull: Math.min(view.cull, 220 * view.reach) };
  if (bins.length || benches.length) {
    group.add(instancedLevels([[0, [[bin, bins], [bench, benches]]]], mat, opts));
    // měkký stín pod nimi (people.js), jen zblízka
    const blob = instancedLevels([[0, [[blobGeometry(0.85, 0.85, 0.01), bins], [blobGeometry(2.1, 0.8, 0.01), benches]]]], blobMaterial(), { cull: Math.min(opts.cull, 90) });
    blob.traverse((o) => { if (o.isMesh) o.renderOrder = 1; });
    group.add(blob);
  }
  group.userData.count = { decals: decals.count, bins: bins.length, benches: benches.length };
  return group;
}
