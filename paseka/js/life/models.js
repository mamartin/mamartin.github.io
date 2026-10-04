// Procedurální low-poly modely rostlin a dalších prvků krajiny.
// Každý model vrací seznam částí; část je jedna instancovaná geometrie:
//   geo       BufferGeometry s barvami vrcholů (počátek = pata rostliny)
//   colorKey  klíč barvy z palety ročního období (jinak drží barvu geometrie)
//   amountKey klíč „množství“ z palety (listí, květy…) – škáluje část kolem pivotu
//   pivot     výška, ke které se část smršťuje (koruna ke svému středu)
//   sway      síla ohybu ve větru
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const _c = new THREE.Color();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();

// Sloučí vrcholy, zkřiví je a převede na neindexovanou geometrii s barvou po plochách.
function prep(geo, { color = '#ffffff', jitter = 0, rng, face } = {}) {
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  let g = mergeVertices(geo);
  if (jitter && rng) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      p.setXYZ(i, p.getX(i) + rng.range(-jitter, jitter), p.getY(i) + rng.range(-jitter, jitter), p.getZ(i) + rng.range(-jitter, jitter));
    }
  }
  g = g.toNonIndexed();
  const p = g.attributes.position;
  const cols = new Float32Array(p.count * 3);
  const base = new THREE.Color(color);
  for (let i = 0; i < p.count; i += 3) {
    _c.copy(base);
    if (face) {
      _a.fromBufferAttribute(p, i);
      _b.fromBufferAttribute(p, i + 1);
      _d.fromBufferAttribute(p, i + 2);
      const cy = (_a.y + _b.y + _d.y) / 3;
      const ny = _b.clone().sub(_a).cross(_d.clone().sub(_a)).normalize().y;
      face(_c, cy, ny);
    }
    for (let k = 0; k < 3; k++) cols.set([_c.r, _c.g, _c.b], (i + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}

function merge(list) {
  const g = mergeGeometries(list);
  g.computeVertexNormals();
  return g;
}

// Válec od počátku podél osy Y o délce `len`, natočený (sklon, otočení) a posunutý.
function limb(r0, r1, len, seg, tilt, yaw, y0, out) {
  const g = new THREE.CylinderGeometry(r1, r0, len, seg);
  g.translate(0, len / 2, 0);
  g.rotateZ(tilt);
  g.rotateY(yaw);
  g.translate(0, y0, 0);
  if (out) {
    const end = new THREE.Vector3(0, len, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), tilt)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    end.y += y0;
    out.push(end);
  }
  return g;
}

const shadeBy = (rng, a, b) => (c) => c.multiplyScalar(rng.range(a, b));

// --- stromy ---------------------------------------------------------------------

function spruce(rng) {
  const trunk = prep(new THREE.CylinderGeometry(0.05, 0.08, 0.5, 5).translate(0, 0.25, 0), { color: '#5a3d28' });
  const tiers = [];
  for (let k = 0; k < 4; k++) {
    const r = 0.5 - k * 0.1, h = 0.62 - k * 0.04, y0 = 0.28 + k * 0.36;
    const cone = new THREE.ConeGeometry(r, h, 7, 1).rotateY(rng.next() * 6).translate(0, y0 + h / 2, 0);
    const s = 0.82 + k * 0.06;
    tiers.push(prep(cone, { jitter: 0.03, rng, face: (c) => c.multiplyScalar(s * rng.range(0.94, 1.06)) }));
  }
  return [
    { geo: merge([trunk]) },
    { geo: merge(tiers), colorKey: 'spruce', sway: 0.012 },
  ];
}

function beech(rng) {
  const ends = [];
  const wood = [new THREE.CylinderGeometry(0.055, 0.09, 1.0, 6).translate(0, 0.5, 0)];
  for (let i = 0; i < 4; i++) {
    wood.push(limb(0.032, 0.016, rng.range(0.45, 0.6), 4, rng.range(0.6, 0.95), i * 1.57 + rng.range(-0.4, 0.4), rng.range(0.55, 0.8), ends));
  }
  const bark = wood.map((g) => prep(g, { color: '#77706a', jitter: 0.008, rng }));
  const blobs = [[0, 1.3, 0, 0.48]];
  for (const e of ends) blobs.push([e.x * 0.9, e.y + 0.05, e.z * 0.9, rng.range(0.3, 0.4)]);
  const crown = blobs.map(([x, y, z, r]) => prep(new THREE.IcosahedronGeometry(r, 1).translate(x, y, z), {
    jitter: 0.05, rng, face: shadeBy(rng, 0.84, 1.05),
  }));
  return [
    { geo: merge(bark) },
    { geo: merge(crown), colorKey: 'beech', amountKey: 'leaves', pivot: 1.2, sway: 0.01 },
  ];
}

function birch(rng) {
  const bands = Array.from({ length: 20 }, () => rng.chance(0.3));
  const ends = [];
  const wood = [
    prep(new THREE.CylinderGeometry(0.028, 0.05, 1.35, 5, 10).translate(0, 0.675, 0), {
      face: (c, y) => c.set(y < 0.12 ? '#3b3532' : bands[Math.floor(y * 14) % 20] ? '#2e2a28' : '#eeebe4'),
    }),
  ];
  for (let i = 0; i < 3; i++) {
    wood.push(prep(limb(0.016, 0.008, rng.range(0.3, 0.42), 3, rng.range(0.5, 0.8), i * 2.1 + rng.next(), rng.range(0.75, 1.05), ends), { color: '#d8d4cc' }));
  }
  const crown = [];
  const spots = [[0, 1.45, 0, 0.27], ...ends.map((e) => [e.x, e.y, e.z, rng.range(0.2, 0.26)]), [rng.range(-0.1, 0.1), 1.15, rng.range(-0.1, 0.1), 0.25]];
  for (const [x, y, z, r] of spots) {
    crown.push(prep(new THREE.IcosahedronGeometry(r, 1).scale(1, 1.45, 1).translate(x, y, z), {
      jitter: 0.04, rng, face: shadeBy(rng, 0.86, 1.06),
    }));
  }
  return [
    { geo: merge(wood) },
    { geo: merge(crown), colorKey: 'birch', amountKey: 'leaves', pivot: 1.3, sway: 0.016 },
  ];
}

function rowan(rng) {
  const ends = [];
  const wood = [new THREE.CylinderGeometry(0.04, 0.065, 0.75, 5).translate(0, 0.375, 0)];
  for (let i = 0; i < 4; i++) {
    wood.push(limb(0.025, 0.012, rng.range(0.35, 0.48), 4, rng.range(0.55, 0.9), i * 1.57 + rng.range(-0.3, 0.3), rng.range(0.5, 0.65), ends));
  }
  const bark = wood.map((g) => prep(g, { color: '#5f544c', jitter: 0.006, rng }));
  const crown = [[0, 1.05, 0, 0.36], ...ends.map((e) => [e.x * 0.85, e.y + 0.02, e.z * 0.85, rng.range(0.24, 0.3)])]
    .map(([x, y, z, r]) => prep(new THREE.IcosahedronGeometry(r, 1).scale(1.1, 0.85, 1.1).translate(x, y, z), {
      jitter: 0.04, rng, face: shadeBy(rng, 0.85, 1.05),
    }));
  // Trsy bobulí visí na koncích větví, takže zůstanou vidět i na holém stromě.
  const berries = [];
  for (const e of ends) {
    for (let k = 0; k < 4; k++) {
      berries.push(prep(new THREE.IcosahedronGeometry(0.04, 0).translate(e.x * 1.05 + rng.range(-0.06, 0.06), e.y - 0.08 + rng.range(-0.04, 0.04), e.z * 1.05 + rng.range(-0.06, 0.06))));
    }
  }
  return [
    { geo: merge(bark) },
    { geo: merge(crown), colorKey: 'rowan', amountKey: 'leaves', pivot: 1.0, sway: 0.012 },
    { geo: merge(berries), colorKey: 'berry', amountKey: 'berries', pivot: 0.8, sway: 0.012 },
  ];
}

function snag(rng) {
  const parts = [new THREE.CylinderGeometry(0.035, 0.085, 1.55, 5, 3).translate(0, 0.775, 0)];
  for (let i = 0; i < 7; i++) {
    parts.push(limb(0.02, 0.008, rng.range(0.14, 0.26), 3, rng.range(1.7, 2.1), rng.next() * 6.28, rng.range(0.55, 1.4)));
  }
  return [{ geo: merge(parts.map((g) => prep(g, { color: '#8e877c', jitter: 0.012, rng, face: shadeBy(rng, 0.85, 1.08) }))), sway: 0.003 }];
}

// --- drobnosti ------------------------------------------------------------------

function stump(rng) {
  const g = prep(new THREE.CylinderGeometry(0.12, 0.16, 0.18, 7).translate(0, 0.09, 0), {
    jitter: 0.012, rng, face: (c, y, ny) => c.set(ny > 0.9 ? '#c9a674' : '#5e4a36'),
  });
  return [{ geo: merge([g]) }];
}

function rock(rng) {
  const a = new THREE.DodecahedronGeometry(0.28, 0).scale(1, 0.62, 1).translate(0, 0.08, 0);
  const b = new THREE.DodecahedronGeometry(0.15, 0).scale(1, 0.7, 1).translate(rng.range(0.2, 0.28), 0.04, rng.range(-0.15, 0.15));
  return [{ geo: merge([a, b].map((g) => prep(g, { color: '#8c8a84', jitter: 0.04, rng, face: shadeBy(rng, 0.82, 1.06) }))) }];
}

function fireweed(rng) {
  const stems = [], flowers = [];
  for (let i = 0; i < 5; i++) {
    const a = rng.next() * 6.28, d = Math.sqrt(rng.next()) * 0.13;
    const x = Math.cos(a) * d, z = Math.sin(a) * d, h = rng.range(0.32, 0.55);
    stems.push(prep(new THREE.CylinderGeometry(0.008, 0.013, h, 3).translate(x, h / 2, z)));
    for (let k = 0; k < 3; k++) {
      const ly = h * rng.range(0.25, 0.7), la = rng.next() * 6.28;
      stems.push(prep(new THREE.ConeGeometry(0.018, 0.12, 3).rotateZ(-1.1).rotateY(la).translate(x + Math.cos(la) * 0.04, ly, z - Math.sin(la) * 0.04), {
        face: (c) => c.multiplyScalar(0.85),
      }));
    }
    flowers.push(prep(new THREE.ConeGeometry(0.038, 0.2, 5).translate(x, h + 0.07, z), { face: shadeBy(rng, 0.88, 1.08) }));
  }
  return [
    { geo: merge(stems), colorKey: 'herb', amountKey: 'herbs', pivot: 0, sway: 0.5 },
    { geo: merge(flowers), colorKey: 'fireweed', amountKey: 'flowers', pivot: 0.5, sway: 0.5 },
  ];
}

function fern(rng) {
  const fronds = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const len = rng.range(0.32, 0.42), lift = rng.range(0.22, 0.3);
    const dir = new THREE.Vector2(Math.cos(a), Math.sin(a)), side = new THREE.Vector2(-dir.y, dir.x);
    const pos = [];
    const S = 5;
    const pts = [];
    for (let j = 0; j <= S; j++) {
      const t = j / S;
      const w = 0.075 * Math.sin(Math.PI * Math.min(1, t * 1.1)) + 0.006;
      const y = Math.sin(t * Math.PI * 0.85) * lift + 0.01;
      const cx = dir.x * len * t, cz = dir.y * len * t;
      pts.push([[cx + side.x * w, y - w * 0.3, cz + side.y * w], [cx, y, cz], [cx - side.x * w, y - w * 0.3, cz - side.y * w]]);
    }
    for (let j = 0; j < S; j++) {
      const [l0, c0, r0] = pts[j], [l1, c1, r1] = pts[j + 1];
      pos.push(...l0, ...c0, ...l1, ...c0, ...c1, ...l1, ...c0, ...r0, ...c1, ...r0, ...r1, ...c1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const shade = rng.range(0.85, 1.05);
    const cols = new Float32Array(pos.length).fill(shade);
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    fronds.push(g);
  }
  return [{ geo: merge(fronds), colorKey: 'fern', amountKey: 'fern', pivot: 0, sway: 2.2, doubleSide: true }];
}

function mushroom(rng) {
  const white = [], caps = [];
  const n = rng.int(2, 3);
  for (let i = 0; i < n; i++) {
    const x = rng.range(-0.1, 0.1), z = rng.range(-0.1, 0.1), s = rng.range(0.7, 1.15), h = 0.07 * s;
    white.push(prep(new THREE.CylinderGeometry(0.016 * s, 0.024 * s, h, 5).translate(x, h / 2, z), { color: '#efe8da' }));
    const cap = new THREE.SphereGeometry(0.058 * s, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.72, 1).translate(x, h - 0.005, z);
    caps.push(prep(cap, { face: shadeBy(rng, 0.9, 1.05) }));
    for (let k = 0; k < 5; k++) {
      const a = rng.next() * 6.28, el = rng.range(0.35, 1.1);
      const r = 0.058 * s;
      white.push(prep(new THREE.IcosahedronGeometry(0.008 * s, 0).translate(
        x + Math.cos(a) * Math.sin(el) * r, h - 0.005 + Math.cos(el) * r * 0.72 + 0.003, z + Math.sin(a) * Math.sin(el) * r,
      ), { color: '#f6f1e6' }));
    }
  }
  return [
    { geo: merge(white), amountKey: 'mushrooms', pivot: 0 },
    { geo: merge(caps), colorKey: 'mushroom', amountKey: 'mushrooms', pivot: 0 },
  ];
}

export const MODELS = { spruce, beech, birch, rowan, snag, stump, rock, fireweed, fern, mushroom };
