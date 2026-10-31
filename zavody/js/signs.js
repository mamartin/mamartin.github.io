// Značení trati z její křivosti (funguje i na náhodných, obrácených a vlastních tratích):
// šipky v zatáčkách, brzdné tabule, tyče u silnice a v noci odrazky na okrajích.
import * as THREE from 'three';
import { StripBuilder } from './track.js';

const CORNER_K = 0.0125; // křivost, od které je úsek zatáčka (poloměr pod 80 m)
const MERGE = 20; // mezera mezi úseky, která ještě patří do stejné zatáčky (m)
const MIN_LEN = 12;
const BOARD_LAT = 0.7; // tabule stojí kousek za svodidlem
const BOARD_LOW = 1.2, BOARD_SIZE = 1.5;
const BRAKE_DROP = 9; // brzdné tabule jen před zatáčkou, kde rychlost klesne aspoň o tolik m/s

// zatáčky: { a, b (m, b může přesáhnout délku kola), side (vnější strana: 1 vpravo, −1 vlevo), vMin }
export function findCorners(track) {
  const { N, step, kappaS, speedProfile } = track;
  const inside = (k) => Math.abs(kappaS[k % N]) > CORNER_K;
  let start = 0;
  while (start < N && inside(start)) start++;
  if (start === N) return [];
  const parts = [];
  for (let k = start; k < start + N; k++) {
    if (!inside(k)) continue;
    let e = k, sum = 0;
    while (e < start + N && inside(e)) sum += kappaS[e++ % N];
    parts.push({ i0: k, i1: e, sign: Math.sign(sum) });
    k = e;
  }
  const merged = [];
  for (const p of parts) {
    const last = merged[merged.length - 1];
    if (last && last.sign === p.sign && (p.i0 - last.i1) * step < MERGE) last.i1 = p.i1;
    else merged.push({ ...p });
  }
  return merged
    .filter((c) => (c.i1 - c.i0) * step >= MIN_LEN)
    .map((c) => {
      let vMin = Infinity;
      for (let k = c.i0; k < c.i1; k++) vMin = Math.min(vMin, speedProfile[k % N]);
      return { a: c.i0 * step, b: c.i1 * step, side: c.sign, vMin };
    });
}

// atlas čtyř dílků: šipka, 100, 50
function signAtlas() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S * 4;
  c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#ffc21a';
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#14161b';
  g.beginPath();
  g.moveTo(84, 10);
  g.lineTo(118, 10);
  g.lineTo(70, 64);
  g.lineTo(118, 118);
  g.lineTo(84, 118);
  g.lineTo(36, 64);
  g.closePath();
  g.fill();
  [['100', 1], ['50', 2]].forEach(([text, i]) => {
    const x = i * S;
    g.fillStyle = '#d7263d';
    g.fillRect(x, 0, S, S);
    g.fillStyle = '#f6f6f2';
    g.fillRect(x + 10, 10, S - 20, S - 20);
    g.fillStyle = '#14161b';
    g.font = `700 ${text.length > 2 ? 58 : 72}px "Chakra Petch", "Arial Narrow", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, x + S / 2, S / 2 + 4);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function buildCornerSigns(track) {
  const faces = new StripBuilder(), backs = new StripBuilder();
  const dark = new THREE.Color(0x2a2d33);
  const L = track.L;
  const lat = track.edge + BOARD_LAT;
  // cell = dílek atlasu, flip = šipka do druhé strany; lícem k autům, která k tabuli přijíždějí
  const board = (s, side, cell, flip = false) => {
    if (track.cutAt(s, side)) return;
    const p = track.pointS(s, side * lat);
    const q = track.pointS(s - 34, 0);
    const nx = q[0] - p[0], nz = q[2] - p[2];
    const d = Math.hypot(nx, nz) || 1;
    const rx = (nz / d) * (BOARD_SIZE / 2), rz = (-nx / d) * (BOARD_SIZE / 2);
    const y0 = p[1] + BOARD_LOW, y1 = y0 + BOARD_SIZE;
    const a = [p[0] - rx, y0, p[2] - rz], b = [p[0] + rx, y0, p[2] + rz];
    const c = [b[0], y1, b[2]], e = [a[0], y1, a[2]];
    const u0 = cell / 4, u1 = (cell + 1) / 4;
    const [ua, ub] = flip ? [u1, u0] : [u0, u1];
    faces.quad(a, b, c, e, null, [ua, 0, ub, 0, ub, 1, ua, 1]);
    backs.quad(b, a, e, c, dark);
    // noha
    const fx = rx * 0.05, fz = rz * 0.05;
    const low = p[1] - 3;
    backs.quad([p[0] - fx, low, p[2] - fz], [p[0] + fx, low, p[2] + fz], [p[0] + fx, y0, p[2] + fz], [p[0] - fx, y0, p[2] - fz], dark);
    backs.quad([p[0] + fx, low, p[2] + fz], [p[0] - fx, low, p[2] - fz], [p[0] - fx, y0, p[2] - fz], [p[0] + fx, y0, p[2] + fz], dark);
  };

  const corners = findCorners(track);
  corners.forEach((c, i) => {
    const len = c.b - c.a;
    const gap = Math.max(12, Math.min(24, len / 5));
    for (let s = c.a + 4; s < c.b; s += gap) board(s, c.side, 0, c.side < 0);
    // brzdné tabule: jen když je před zatáčkou dost dlouhá rovinka
    const prev = corners[(i - 1 + corners.length) % corners.length];
    const free = ((c.a - prev.b) % L + L) % L;
    const before = track.speedProfile[track.indexAt(c.a - 100)];
    if (corners.length < 2 || before - c.vMin < BRAKE_DROP) return;
    if (free > 115) board(c.a - 100, c.side, 1);
    if (free > 65) board(c.a - 50, c.side, 2);
  });

  const group = new THREE.Group();
  group.name = 'signs';
  if (!faces.count) return group;
  group.add(new THREE.Mesh(faces.build(), new THREE.MeshBasicMaterial({ map: signAtlas() })));
  group.add(new THREE.Mesh(backs.build(), new THREE.MeshLambertMaterial({ vertexColors: true })));
  return group;
}

// tyče těsně za svodidlem: rytmus, který ubíhá kolem auta a dává pocit rychlosti
export function buildRoadPoles(track, spacing = 16) {
  const N = track.N;
  const every = Math.max(1, Math.round(spacing / track.step));
  const count = Math.ceil(N / every) * 2;
  const poleGeo = new THREE.BoxGeometry(0.12, 2.3, 0.12).translate(0, 1.15, 0);
  const bandGeo = new THREE.BoxGeometry(0.17, 0.42, 0.17).translate(0, 1.95, 0);
  const band = new THREE.Color(0xff5a2c);
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ color: 0xe6e8ea }), count);
  const bands = new THREE.InstancedMesh(bandGeo, new THREE.MeshBasicMaterial({ color: band }), count);
  const m = new THREE.Matrix4();
  const p = [0, 0, 0];
  let i = 0;
  for (let k = 0; k < N; k += every) {
    for (const side of [-1, 1]) {
      if (track.cutAt(track.s[k], side)) continue;
      track.point(k, side * (track.edge + BOARD_LAT), 0, p);
      m.makeRotationY(track.hd[k]);
      m.setPosition(p[0], p[1], p[2]);
      poles.setMatrixAt(i, m);
      bands.setMatrixAt(i++, m);
    }
  }
  poles.count = bands.count = i;
  poles.computeBoundingSphere();
  bands.computeBoundingSphere();
  const group = new THREE.Group();
  group.add(poles, bands);
  return group;
}

// noční odrazky na okrajích silnice: v zatáčkách oranžové, jinde světlé
export function buildReflectors(track) {
  const b = new StripBuilder();
  const plain = new THREE.Color(0xcfd8e6).multiplyScalar(1.3);
  const corner = new THREE.Color(0xffa030).multiplyScalar(1.6);
  const lat = track.hw - 0.14, w = 0.09;
  for (let s = 0; s < track.L; s += 4) {
    const col = track.curbMask[track.indexAt(s)] ? corner : plain;
    for (const side of [-1, 1]) {
      const l = side * lat;
      b.quad(track.pointS(s, l - w, 0.05), track.pointS(s, l + w, 0.05), track.pointS(s + 1.6, l + w, 0.05), track.pointS(s + 1.6, l - w, 0.05), col);
    }
  }
  return new THREE.Mesh(b.build(), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
}
