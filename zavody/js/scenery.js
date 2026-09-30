// Obloha, světla a rekvizity kolem trati podle biomu.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG, smoothstep } from './rng.js';

// --- obloha -----------------------------------------------------------------

export function buildSky(biome) {
  const sunDir = new THREE.Vector3(...biome.sunDir).normalize();
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color(biome.sky.top) },
      horizon: { value: new THREE.Color(biome.sky.horizon) },
      bottom: { value: new THREE.Color(biome.sky.bottom) },
      sunDir: { value: sunDir },
      sunColor: { value: new THREE.Color(biome.sun.color) },
      glow: { value: biome.sky.glow },
      night: { value: biome.night ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom;
      uniform vec3 sunDir; uniform vec3 sunColor; uniform float glow; uniform float night;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = h > 0.0 ? mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(horizon, bottom, pow(clamp(-h, 0.0, 1.0), 0.4));
        float s = max(dot(d, sunDir), 0.0);
        float disc = smoothstep(0.9993, 0.9997, s);
        col += sunColor * (disc * (night > 0.5 ? 1.2 : 8.0) + pow(s, 7.0) * glow * 0.35 + pow(s, 48.0) * glow * 0.6);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1900, 32, 16), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  sky.name = 'sky';
  const group = new THREE.Group();
  group.add(sky);
  if (biome.clouds) {
    const rng = new RNG(17);
    const tex = cloudTexture(rng);
    const mat = new THREE.SpriteMaterial({ map: tex, color: biome.clouds, transparent: true, depthWrite: false, fog: false, opacity: 0.9 });
    for (let i = 0; i < 26; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(700, 1500);
      const sp = new THREE.Sprite(mat);
      sp.position.set(Math.cos(a) * d, rng.range(160, 420), Math.sin(a) * d);
      const w = rng.range(260, 520);
      sp.scale.set(w, w * rng.range(0.32, 0.45), 1);
      sp.renderOrder = -9;
      group.add(sp);
    }
  }
  if (biome.night) {
    const rng = new RNG(5);
    const n = 650;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = rng.next(), v = rng.range(0.12, 1);
      const th = u * Math.PI * 2, y = v * v;
      const r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(th) * r * 1800;
      pos[i * 3 + 1] = y * 1800;
      pos[i * 3 + 2] = Math.sin(th) * r * 1800;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xdfe6ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.7 }));
    stars.frustumCulled = false;
    group.add(stars);
  }
  return group;
}

function cloudTexture(rng) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 16; i++) {
    const x = rng.range(50, 206), y = rng.range(52, 86), r = rng.range(22, 46);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.8)');
    grd.addColorStop(0.6, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 128);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// --- instancované rekvizity rozdělené do dlaždic kvůli ořezu mimo záběr -----------

function instancedChunks(geo, mat, items, { chunk = 240, castShadow = true, receiveShadow = false } = {}) {
  const buckets = new Map();
  for (const it of items) {
    const key = Math.floor(it.x / chunk) + ':' + Math.floor(it.z / chunk);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(it);
  }
  const group = new THREE.Group();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const e = new THREE.Euler();
  const c = new THREE.Color();
  for (const list of buckets.values()) {
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, i) => {
      e.set(it.rx ?? 0, it.ry ?? 0, it.rz ?? 0);
      q.setFromEuler(e);
      s.set(it.sx ?? it.s ?? 1, it.sy ?? it.s ?? 1, it.sz ?? it.s ?? 1);
      p.set(it.x, it.y, it.z);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      if (it.color !== undefined) mesh.setColorAt(i, c.set(it.color));
    });
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}

const ni = (g) => (g.index ? g.toNonIndexed() : g);

function colored(geo, hex) {
  const g = geo;
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function jitter(geo, amount, seed) {
  const rng = new RNG(seed);
  const pos = geo.attributes.position;
  const map = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!map.has(key)) map.set(key, [rng.range(-amount, amount), rng.range(-amount, amount), rng.range(-amount, amount)]);
    const o = map.get(key);
    pos.setXYZ(i, pos.getX(i) + o[0], pos.getY(i) + o[1], pos.getZ(i) + o[2]);
  }
  geo.computeVertexNormals();
  return geo;
}

function spruceGeometry() {
  const parts = [
    colored(new THREE.CylinderGeometry(0.2, 0.32, 2.4, 6).translate(0, 1.2, 0), '#5a3d26'),
    colored(new THREE.ConeGeometry(2.4, 3.8, 7).translate(0, 3.3, 0), '#2d5a2e'),
    colored(new THREE.ConeGeometry(1.85, 3.2, 7).translate(0, 5.2, 0), '#326434'),
    colored(new THREE.ConeGeometry(1.2, 2.7, 7).translate(0, 6.9, 0), '#3a6e3a'),
  ];
  return mergeGeometries(parts.map(ni));
}

function broadleafGeometry() {
  const parts = [
    colored(new THREE.CylinderGeometry(0.16, 0.24, 3.2, 6).translate(0, 1.6, 0), '#d8d2c4'),
    colored(jitter(new THREE.IcosahedronGeometry(2.3, 0), 0.35, 3).translate(0, 4.6, 0), '#6c9a3d'),
    colored(jitter(new THREE.IcosahedronGeometry(1.5, 0), 0.25, 4).translate(0.9, 5.8, 0.4), '#7eab47'),
  ];
  return mergeGeometries(parts.map(ni));
}

function cactusGeometry() {
  const parts = [
    colored(new THREE.CylinderGeometry(0.34, 0.4, 5.2, 7).translate(0, 2.6, 0), '#4f7c3c'),
    colored(new THREE.SphereGeometry(0.34, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 5.2, 0), '#4f7c3c'),
    colored(new THREE.CylinderGeometry(0.24, 0.24, 1.0, 6).rotateZ(Math.PI / 2).translate(0.7, 2.2, 0), '#4a7538'),
    colored(new THREE.CylinderGeometry(0.24, 0.24, 1.9, 6).translate(1.15, 3.1, 0), '#4a7538'),
    colored(new THREE.CylinderGeometry(0.22, 0.22, 0.8, 6).rotateZ(Math.PI / 2).translate(-0.6, 3.0, 0), '#4a7538'),
    colored(new THREE.CylinderGeometry(0.22, 0.22, 1.4, 6).translate(-0.95, 3.6, 0), '#4a7538'),
  ];
  return mergeGeometries(parts.map(ni));
}

function hoodooGeometry(seed) {
  const rng = new RNG(seed);
  const parts = [];
  let y = 0;
  let r = rng.range(3.2, 4.2);
  const cols = ['#a4492a', '#c0673a', '#8d3b24', '#b85c34'];
  for (let i = 0; i < 4; i++) {
    const h = rng.range(2.5, 5);
    const r2 = r * rng.range(0.72, 1.05);
    parts.push(colored(jitter(new THREE.CylinderGeometry(r2, r, h, 7, 1), 0.35, seed + i).translate(0, y + h / 2, 0), cols[i % cols.length]));
    y += h;
    r = r2;
  }
  parts.push(colored(jitter(new THREE.CylinderGeometry(r * 1.3, r * 1.1, 1.4, 7, 1), 0.3, seed + 9).translate(0, y + 0.7, 0), '#6f2e1c'));
  return mergeGeometries(parts.map(ni));
}

// Rozmístění bodů daleko od trati.
function scatter(rng, terrain, count, { minD, maxD, tries = count * 8, accept }) {
  const out = [];
  const b = terrain.trackBounds;
  const pad = maxD;
  for (let t = 0; t < tries && out.length < count; t++) {
    const x = rng.range(b.minX - pad, b.maxX + pad);
    const z = rng.range(b.minZ - pad, b.maxZ + pad);
    const d = terrain.distAt(x, z);
    if (d < minD || d > maxD) continue;
    if (accept && !accept(x, z, d)) continue;
    out.push({ x, z, d, y: terrain.heightAt(x, z) });
  }
  return out;
}

// --- reklamní tabule a tribuna -------------------------------------------------

const SPONSORS = [
  ['PNEU BOBR', '#f2c230', '#1b1b1b'],
  ['KNEDLÍK ENERGY', '#d7263d', '#ffffff'],
  ['HOSPODA U CÍLE', '#1f5130', '#f3e6c4'],
  ['OLEJ BROUK', '#111111', '#f2c230'],
  ['RYCHLÝ ŠNEK', '#2c6fd1', '#ffffff'],
  ['BUCHTY OD BÁBY', '#f4efe3', '#b3261e'],
  ['SVÍČKOVÁ RACING', '#6b2d86', '#ffffff'],
  ['TURBO OKRUH', '#10223f', '#ffffff'],
];

function sponsorAtlas() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1024;
  const g = c.getContext('2d');
  SPONSORS.forEach(([text, bg, fg], i) => {
    const y = i * 128;
    g.fillStyle = bg;
    g.fillRect(0, y, 1024, 128);
    g.fillStyle = fg;
    g.fillRect(0, y + 8, 1024, 6);
    g.fillRect(0, y + 114, 1024, 6);
    g.font = 'italic 700 78px "Chakra Petch", "Arial Narrow", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 512, y + 68);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function buildAdBoards(track, rng, night) {
  const pos = [], uv = [], nrm = [];
  const N = track.N;
  const add = (k, side, idx) => {
    const lat = side * (track.edge + 0.9);
    const len = 9;
    const kk = (k + Math.round(len / track.step)) % N;
    const a = track.point(k, lat, 0.3), b = track.point(kk, lat, 0.3);
    const h = 1.5;
    const v0 = 1 - (idx + 1) / 8, v1 = 1 - idx / 8;
    // lícem k trati
    const quad = side > 0
      ? [[b[0], b[1], b[2]], [a[0], a[1], a[2]], [a[0], a[1] + h, a[2]], [b[0], b[1] + h, b[2]]]
      : [[a[0], a[1], a[2]], [b[0], b[1], b[2]], [b[0], b[1] + h, b[2]], [a[0], a[1] + h, a[2]]];
    const uvs = [[0, v0], [1, v0], [1, v1], [0, v1]];
    for (const t of [0, 1, 2, 0, 2, 3]) {
      pos.push(...quad[t]);
      uv.push(...uvs[t]);
    }
  };
  let idx = 0;
  // start/cíl rovinka + náhodná místa u zatáček
  for (let k = 8; k < N; k += 7) {
    const nearStart = track.s[k] < 120 || track.s[k] > track.L - 140;
    const inCorner = track.curbMask[k] && rng.chance(0.08);
    if (!nearStart && !inCorner) continue;
    const side = track.kappaS[k] > 0 ? 1 : -1; // vnější strana zatáčky
    add(k, nearStart ? (k % 14 < 7 ? 1 : -1) : side, idx++ % SPONSORS.length);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const mat = night
    ? new THREE.MeshBasicMaterial({ map: sponsorAtlas(), color: 0xb0b0b0 })
    : new THREE.MeshLambertMaterial({ map: sponsorAtlas() });
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  return mesh;
}

function buildGrandstand(track, terrain, rng) {
  // strana s víc místem
  const probe = (side) => {
    const p = track.pointS(0, side * (track.edge + 30));
    return terrain.distAt(p[0], p[2]);
  };
  const side = probe(1) >= probe(-1) ? 1 : -1;
  const group = new THREE.Group();
  const base = track.pointS(-10, side * (track.edge + 3));
  group.position.set(base[0], base[1] - 0.3, base[2]);
  // lokální +z = směr trati, lokální -x = pravá strana trati; řady stoupají do -x
  group.rotation.y = track.hd[0];
  const len = 70;
  const concrete = new THREE.MeshLambertMaterial({ color: 0x9aa0a6 });
  const seatsMat = new THREE.MeshLambertMaterial({ color: 0x2f5fa8 });
  const rows = 7;
  const parts = [];
  for (let r = 0; r < rows; r++) {
    const g = new THREE.BoxGeometry(1.6, 0.9 + r * 0.9, len);
    g.translate(-(1.2 + r * 1.6), (0.9 + r * 0.9) / 2, 0);
    parts.push(g);
  }
  const stand = new THREE.Mesh(mergeGeometries(parts), concrete);
  stand.castShadow = stand.receiveShadow = true;
  // pro levou stranu tribunu zrcadlíme
  const flip = new THREE.Group();
  flip.scale.x = side > 0 ? 1 : -1;
  flip.add(stand);
  // sedačky (tenké pruhy)
  const seatParts = [];
  for (let r = 0; r < rows; r++) {
    const g = new THREE.BoxGeometry(0.5, 0.35, len - 1);
    g.translate(-(1.2 + r * 1.6) + 0.35, 0.9 + r * 0.9 + 0.15, 0);
    seatParts.push(g);
  }
  const seats = new THREE.Mesh(mergeGeometries(seatParts), seatsMat);
  flip.add(seats);
  // divácí
  const crowdGeo = new THREE.BoxGeometry(0.45, 0.8, 0.45);
  crowdGeo.translate(0, 0.4, 0);
  const crowd = new THREE.InstancedMesh(crowdGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), rows * 60);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  const shirt = ['#d7263d', '#f2c230', '#2c6fd1', '#ffffff', '#1f9d55', '#f07b2c', '#222222', '#b14fc5'];
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let j = 0; j < 60; j++) {
      if (rng.chance(0.25)) continue;
      m.makeTranslation(-(1.2 + r * 1.6) + 0.05, 0.9 + r * 0.9 + 0.3, -len / 2 + 1 + j * ((len - 2) / 60) + rng.range(-0.2, 0.2));
      crowd.setMatrixAt(i, m);
      crowd.setColorAt(i, c.set(rng.pick(shirt)));
      i++;
    }
  }
  crowd.count = i;
  crowd.computeBoundingSphere();
  flip.add(crowd);
  // střecha
  const roofH = 0.9 + rows * 0.9 + 3.2;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(rows * 1.6 + 2.5, 0.35, len + 2), new THREE.MeshLambertMaterial({ color: 0xe8e8e8 }));
  roof.position.set(-(rows * 1.6) / 2 - 0.4, roofH, 0);
  roof.castShadow = true;
  flip.add(roof);
  const postGeo = new THREE.BoxGeometry(0.3, roofH, 0.3);
  for (let z = -len / 2; z <= len / 2; z += len / 5) {
    const post = new THREE.Mesh(postGeo, concrete);
    post.position.set(-0.4, roofH / 2, z);
    flip.add(post);
  }
  group.add(flip);
  return { group, crowd };
}

// --- město -------------------------------------------------------------------

function windowTexture(rng) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 256, 256);
  const lit = ['#ffd58a', '#ffe9b8', '#bfe0ff', '#ffc36b', '#fff4d6'];
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      if (!rng.chance(0.38)) continue;
      g.fillStyle = rng.pick(lit);
      g.globalAlpha = rng.range(0.55, 1);
      g.fillRect(x * 32 + 7, y * 32 + 8, 18, 16);
    }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function facadeTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#8a8d94';
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      g.fillStyle = '#1b1f28';
      g.fillRect(x * 32 + 6, y * 32 + 7, 20, 18);
    }
  g.fillStyle = 'rgba(0,0,0,0.25)';
  for (let y = 0; y < 8; y++) g.fillRect(0, y * 32 + 28, 256, 3);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildCity(track, terrain, rng, quality) {
  const group = new THREE.Group();
  const b = terrain.trackBounds;
  const cellSize = 36;
  const pos = [], uv = [], col = [];
  const roofPos = [];
  const tint = new THREE.Color();
  const tints = ['#b7b2a8', '#9aa3ad', '#c2b59b', '#8e949c', '#a7a09a', '#b9aea2', '#7f8a96'];
  const signs = [];
  const box = (x0, z0, w, d, h, u0, v0, tintHex) => {
    tint.set(tintHex);
    const x1 = x0 + w, z1 = z0 + d, y0 = -0.3, y1 = h;
    const faces = [
      // [roh a, roh b] – stěna z a do b, lícem ven
      [[x0, z1], [x1, z1]],
      [[x1, z1], [x1, z0]],
      [[x1, z0], [x0, z0]],
      [[x0, z0], [x0, z1]],
    ];
    for (const [a, bb] of faces) {
      const len = Math.hypot(bb[0] - a[0], bb[1] - a[1]);
      const uw = len / 4 / 8, vh = (y1 - y0) / 3.6 / 8;
      const q = [[a[0], y0, a[1]], [bb[0], y0, bb[1]], [bb[0], y1, bb[1]], [a[0], y1, a[1]]];
      const quv = [[u0, v0], [u0 + uw, v0], [u0 + uw, v0 + vh], [u0, v0 + vh]];
      for (const t of [0, 1, 2, 0, 2, 3]) {
        pos.push(...q[t]);
        uv.push(...quv[t]);
        col.push(tint.r, tint.g, tint.b);
      }
    }
    const r = [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]];
    for (const t of [0, 1, 2, 0, 2, 3]) roofPos.push(...r[t]);
  };
  const edge = track.edge;
  for (let gx = b.minX - 260; gx < b.maxX + 260; gx += cellSize) {
    for (let gz = b.minZ - 260; gz < b.maxZ + 260; gz += cellSize) {
      if (rng.chance(0.12)) continue;
      const w = rng.range(14, cellSize - 8), d = rng.range(14, cellSize - 8);
      const x0 = gx + rng.range(0, cellSize - 4 - w), z0 = gz + rng.range(0, cellSize - 4 - d);
      let minD = Infinity;
      for (let i = 0; i <= 2; i++)
        for (let j = 0; j <= 2; j++) minD = Math.min(minD, terrain.distAt(x0 + (w * i) / 2, z0 + (d * j) / 2));
      if (minD < edge + 7) continue;
      const far = smoothstep(20, 200, minD);
      const h = rng.range(9, 26) + rng.next() * rng.next() * 60 * (0.4 + far);
      box(x0, z0, w, d, h, rng.int(0, 7) / 8, rng.int(0, 7) / 8, rng.pick(tints));
      if (minD < edge + 26 && rng.chance(0.3)) signs.push({ x0, z0, w, d, h });
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({
    map: facadeTexture(),
    emissiveMap: windowTexture(rng),
    emissive: 0xffffff,
    emissiveIntensity: 1.25,
    vertexColors: true,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(roofPos, 3));
  rg.computeVertexNormals();
  group.add(new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ color: 0x3a3d44 })));

  // neonové nápisy na fasádách přivrácených k trati
  const words = [['BISTRO', '#ff4fa3'], ['HOTEL', '#4fd8ff'], ['KINO', '#ffcf3f'], ['NONSTOP', '#7dff6a'],
    ['BAR', '#ff5a4f'], ['PEKÁRNA', '#ffb84f'], ['TRAFIKA', '#b98cff'], ['HERNA', '#4fffd2']];
  const atlas = document.createElement('canvas');
  atlas.width = 512;
  atlas.height = 512;
  const ag = atlas.getContext('2d');
  ag.fillStyle = '#05060a';
  ag.fillRect(0, 0, 512, 512);
  words.forEach(([w, color], i) => {
    const y = i * 64 + 32;
    ag.font = '700 44px "Chakra Petch", "Arial Narrow", sans-serif';
    ag.textAlign = 'center';
    ag.textBaseline = 'middle';
    ag.shadowColor = color;
    ag.shadowBlur = 14;
    ag.fillStyle = color;
    ag.fillText(w, 256, y);
    ag.shadowBlur = 0;
    ag.fillStyle = '#fff';
    ag.globalAlpha = 0.55;
    ag.fillText(w, 256, y);
    ag.globalAlpha = 1;
  });
  const atex = new THREE.CanvasTexture(atlas);
  atex.colorSpace = THREE.SRGBColorSpace;
  const sp = [], suv = [];
  for (const s of signs) {
    const idx = rng.int(0, words.length - 1);
    // stěna nejblíž trati
    const cx = s.x0 + s.w / 2, cz = s.z0 + s.d / 2;
    const cands = [
      [cx, s.z0 + s.d + 0.2, 0], [s.x0 + s.w + 0.2, cz, 1], [cx, s.z0 - 0.2, 2], [s.x0 - 0.2, cz, 3],
    ];
    let best = cands[0], bd = Infinity;
    for (const cnd of cands) {
      const d = terrain.distAt(cnd[0], cnd[1]);
      if (d < bd) { bd = d; best = cnd; }
    }
    const sw = 7, sh = 1.75, y = Math.min(s.h - 2, rng.range(6, 12));
    const [x, z, face] = best;
    let q;
    if (face === 0) q = [[x - sw / 2, y, z], [x + sw / 2, y, z], [x + sw / 2, y + sh, z], [x - sw / 2, y + sh, z]];
    else if (face === 2) q = [[x + sw / 2, y, z], [x - sw / 2, y, z], [x - sw / 2, y + sh, z], [x + sw / 2, y + sh, z]];
    else if (face === 1) q = [[x, y, z + sw / 2], [x, y, z - sw / 2], [x, y + sh, z - sw / 2], [x, y + sh, z + sw / 2]];
    else q = [[x, y, z - sw / 2], [x, y, z + sw / 2], [x, y + sh, z + sw / 2], [x, y + sh, z - sw / 2]];
    const v0 = 1 - (idx + 1) / 8, v1 = 1 - idx / 8;
    const quv = [[0, v0], [1, v0], [1, v1], [0, v1]];
    for (const t of [0, 1, 2, 0, 2, 3]) {
      sp.push(...q[t]);
      suv.push(...quv[t]);
    }
  }
  if (sp.length) {
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    sg.setAttribute('uv', new THREE.Float32BufferAttribute(suv, 2));
    const signMesh = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ map: atex, toneMapped: false, side: THREE.DoubleSide }));
    group.add(signMesh);
  }
  return group;
}

function glowTexture(inner = 'rgba(255,220,160,1)', outer = 'rgba(255,200,120,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.35, inner.replace(/[\d.]+\)$/, '0.45)'));
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildStreetLamps(track, spacing = 34) {
  const group = new THREE.Group();
  const N = track.N;
  const poles = [], heads = [], pools = [], halos = [];
  const every = Math.round(spacing / track.step);
  let flip = 1;
  for (let k = 0; k < N; k += every) {
    flip = -flip;
    const side = flip;
    const p = track.point(k, side * (track.edge + 0.8));
    poles.push({ x: p[0], y: p[1], z: p[2], ry: track.hd[k] });
    const hp = track.point(k, side * (track.edge - 0.5), 7.75);
    heads.push({ x: hp[0], y: hp[1], z: hp[2], ry: track.hd[k] });
    const gp = track.point(k, side * (track.edge - 1.6), 7.5);
    halos.push(gp);
    const lp = track.point(k, side * Math.max(0, track.hw - 4), 0.06);
    pools.push({ x: lp[0], y: lp[1], z: lp[2], rx: -Math.PI / 2, rz: 0 });
  }
  const poleGeo = new THREE.CylinderGeometry(0.1, 0.16, 8, 6).translate(0, 4, 0);
  group.add(instancedChunks(poleGeo, new THREE.MeshLambertMaterial({ color: 0x3a3f48 }), poles, { castShadow: false }));
  const headGeo = new THREE.BoxGeometry(2.8, 0.18, 0.5);
  group.add(instancedChunks(headGeo, new THREE.MeshBasicMaterial({ color: 0xffe2a8, toneMapped: false }), heads, { castShadow: false }));
  const poolMat = new THREE.MeshBasicMaterial({
    map: glowTexture('rgba(255,214,150,0.5)', 'rgba(255,200,120,0)'),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -4,
  });
  const poolGeo = new THREE.PlaneGeometry(17, 17);
  group.add(instancedChunks(poolGeo, poolMat, pools, { castShadow: false }));
  // záře kolem lamp
  const haloMat = new THREE.SpriteMaterial({ map: glowTexture('rgba(255,225,170,0.9)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  for (const h of halos) {
    const sp = new THREE.Sprite(haloMat);
    sp.position.set(h[0], h[1], h[2]);
    sp.scale.set(3.4, 3.4, 1);
    group.add(sp);
  }
  return group;
}

// --- hlavní vstup ---------------------------------------------------------------

export function buildScenery(track, terrain, biomeKey, biome, quality, seed) {
  const rng = new RNG(seed);
  const group = new THREE.Group();
  group.name = 'scenery';
  const density = quality === 'low' ? 0.45 : quality === 'medium' ? 0.75 : 1;
  const edge = track.edge;
  const extra = {};

  if (biomeKey === 'forest') {
    const lake = terrain.lake;
    const notLake = (x, z) => !lake || Math.hypot(x - lake.x, z - lake.z) > lake.r * 1.2;
    const forestMask = (x, z, d) => terrain.noise.noise(x / 110 + 40, z / 110) > -0.25 || d < edge + 30;
    const near = scatter(rng, terrain, Math.round(650 * density), { minD: edge + 4, maxD: edge + 60, accept: (x, z, d) => notLake(x, z) && forestMask(x, z, d) });
    const far = scatter(rng, terrain, Math.round(900 * density), { minD: edge + 60, maxD: 420, accept: (x, z, d) => notLake(x, z) && forestMask(x, z, d) });
    const trees = near.concat(far);
    const spruce = [], broad = [];
    for (const t of trees) {
      const sc = rng.range(0.8, 1.6);
      const item = { x: t.x, y: t.y - 0.2, z: t.z, s: sc, sy: sc * rng.range(0.9, 1.25), ry: rng.range(0, 6.28) };
      if (rng.chance(0.8)) {
        item.color = new THREE.Color().setHSL(0.3 + rng.range(-0.03, 0.03), 0.35, rng.range(0.75, 1.0)).getHex();
        spruce.push(item);
      } else {
        item.color = new THREE.Color().setHSL(0.22 + rng.range(-0.04, 0.05), 0.5, rng.range(0.7, 1.0)).getHex();
        broad.push(item);
      }
    }
    const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    group.add(instancedChunks(spruceGeometry(), treeMat, spruce, { castShadow: quality !== 'low' }));
    group.add(instancedChunks(broadleafGeometry(), treeMat, broad, { castShadow: quality !== 'low' }));
    const rocks = scatter(rng, terrain, Math.round(160 * density), { minD: edge + 3, maxD: 250 }).map((r) => ({
      x: r.x, y: r.y, z: r.z, s: rng.range(0.6, 2.4), ry: rng.range(0, 6.28), rx: rng.range(-0.3, 0.3), color: 0xffffff,
    }));
    const rockGeo = colored(jitter(new THREE.DodecahedronGeometry(1, 0), 0.25, 8), '#8b8a82');
    group.add(instancedChunks(rockGeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), rocks));
    if (lake) {
      const water = new THREE.Mesh(
        new THREE.CircleGeometry(lake.r * 1.06, 64),
        new THREE.MeshStandardMaterial({ color: 0x2b5670, roughness: 0.06, metalness: 0.2, transparent: true, opacity: 0.92 }),
      );
      water.rotation.x = -Math.PI / 2;
      water.position.set(lake.x, terrain.waterY, lake.z);
      water.receiveShadow = true;
      group.add(water);
    }
  } else if (biomeKey === 'canyon') {
    const cacti = scatter(rng, terrain, Math.round(320 * density), { minD: edge + 4, maxD: 200 }).map((c) => ({
      x: c.x, y: c.y - 0.2, z: c.z, s: rng.range(0.7, 1.4), ry: rng.range(0, 6.28), color: 0xffffff,
    }));
    const vmat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    group.add(instancedChunks(cactusGeometry(), vmat, cacti));
    for (let v = 0; v < 3; v++) {
      const hoodoos = scatter(rng, terrain, Math.round(28 * density), { minD: edge + 16, maxD: 320 }).map((c) => ({
        x: c.x, y: c.y - 1, z: c.z, s: rng.range(0.8, 1.8), sy: rng.range(0.9, 2.2), ry: rng.range(0, 6.28), color: 0xffffff,
      }));
      group.add(instancedChunks(hoodooGeometry(100 + v * 17), vmat, hoodoos));
    }
    const boulders = scatter(rng, terrain, Math.round(220 * density), { minD: edge + 3, maxD: 260 }).map((r) => ({
      x: r.x, y: r.y, z: r.z, s: rng.range(0.5, 2.2), ry: rng.range(0, 6.28), color: 0xffffff,
    }));
    group.add(instancedChunks(colored(jitter(new THREE.DodecahedronGeometry(1, 0), 0.3, 12), '#9c4a2c'), vmat, boulders));
    const bushes = scatter(rng, terrain, Math.round(300 * density), { minD: edge + 2, maxD: 180 }).map((r) => ({
      x: r.x, y: r.y + 0.2, z: r.z, s: rng.range(0.4, 1.0), ry: rng.range(0, 6.28), color: 0xffffff,
    }));
    group.add(instancedChunks(colored(jitter(new THREE.IcosahedronGeometry(1, 0), 0.25, 13), '#8a8a45'), vmat, bushes, { castShadow: false }));
  } else if (biomeKey === 'city') {
    group.add(buildCity(track, terrain, rng, quality));
    group.add(buildStreetLamps(track));
  }

  const stand = buildGrandstand(track, terrain, rng);
  group.add(stand.group);
  extra.crowd = stand.crowd;
  group.add(buildAdBoards(track, rng, biome.night));
  return { group, extra };
}

// Světla scény pro daný biom.
export function buildLights(biome, quality) {
  const group = new THREE.Group();
  const hemi = new THREE.HemisphereLight(biome.hemi.sky, biome.hemi.ground, biome.hemi.intensity);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(biome.sun.color, biome.sun.intensity);
  const sunDir = new THREE.Vector3(...biome.sunDir).normalize();
  sun.userData.dir = sunDir;
  if (quality !== 'low') {
    sun.castShadow = true;
    const size = quality === 'high' ? 2048 : 1024;
    sun.shadow.mapSize.set(size, size);
    const r = 75;
    Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 600 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
  }
  group.add(sun);
  group.add(sun.target);
  return { group, sun, hemi };
}
