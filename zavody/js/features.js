// Stavby na trati: zkratka (polní cesta s valy, balvany a značením) a tunel.
import * as THREE from 'three';
import { StripBuilder } from './track.js';

const BERM = 1.1; // výška valu podél zkratky
const TUNNEL_H = 6.8;

function textBoard(text) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#ffc21a';
  g.fillRect(0, 0, 256, 96);
  g.fillStyle = '#14161b';
  g.font = '700 46px "Chakra Petch", "Arial Narrow", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildCuts(track, style) {
  const group = new THREE.Group();
  group.name = 'cuts';
  for (const cut of track.cuts) {
    const dirt = new StripBuilder(), berm = new StripBuilder();
    const dA = new THREE.Color(cut.spec.dirtA ?? style.shoulderA).multiplyScalar(0.72);
    const dB = new THREE.Color(cut.spec.dirtB ?? style.shoulderB).multiplyScalar(0.62);
    const bA = new THREE.Color(style.shoulderA).multiplyScalar(0.5);
    const top = new THREE.Color(style.shoulderA).multiplyScalar(0.6);
    const at = (k, lat, dy) => {
      const rx = -Math.cos(cut.hd[k]), rz = Math.sin(cut.hd[k]);
      return [cut.px[k] + rx * lat, cut.py[k] + dy, cut.pz[k] + rz * lat];
    };
    for (let k = 0; k < cut.n - 1; k++) {
      const col = Math.floor(k / 3) % 2 ? dA : dB;
      const hw = cut.hw;
      dirt.quad(at(k, -hw, 0.06), at(k, hw, 0.06), at(k + 1, hw, 0.06), at(k + 1, -hw, 0.06), col);
      for (const side of [-1, 1]) {
        // na straně k trati val začíná až za mezerou ve svodidle
        if (side === -cut.side && (k < cut.k0 || k >= cut.k1)) continue;
        const a = side * hw, b = side * (hw + 1.2), l = 1.0;
        const q1 = [at(k, a, 0), at(k, a + side * 0.3, BERM), at(k + 1, a + side * 0.3, BERM), at(k + 1, a, 0)];
        const q2 = [at(k, a + side * 0.3, BERM), at(k, b, l), at(k + 1, b, l), at(k + 1, a + side * 0.3, BERM)];
        if (side > 0) {
          berm.quad(q1[0], q1[1], q1[2], q1[3], bA);
          berm.quad(q2[0], q2[1], q2[2], q2[3], top);
        } else {
          berm.quad(q1[3], q1[2], q1[1], q1[0], bA);
          berm.quad(q2[3], q2[2], q2[1], q2[0], top);
        }
      }
    }
    const road = new THREE.Mesh(dirt.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    road.receiveShadow = true;
    const wall = new THREE.Mesh(berm.build(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    wall.receiveShadow = true;
    group.add(road, wall);
    // balvany
    const rock = new THREE.DodecahedronGeometry(1, 0);
    const rocks = new THREE.InstancedMesh(rock, new THREE.MeshLambertMaterial({ color: new THREE.Color(style.shoulderA).multiplyScalar(0.55) }), cut.rocks.length);
    const m = new THREE.Matrix4();
    cut.rocks.forEach((r, i) => {
      m.makeScale(r.r * 1.15, r.r * 1.3, r.r * 1.15);
      m.setPosition(r.x, r.y + r.r * 0.7, r.z);
      rocks.setMatrixAt(i, m);
    });
    rocks.castShadow = true;
    group.add(rocks);
    // značka u vjezdu: stojí na konci svodidla a míří proti jízdě
    const entry = track.sampleAt(cut.s0 + cut.gapIn, cut.side * (track.edge + 0.6), {});
    const before = track.sampleAt(cut.s0 + cut.gapIn - 30, 0, {});
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.6), new THREE.MeshBasicMaterial({ map: textBoard('ZKRATKA') }));
    sign.position.set(entry.x, entry.y + 2.6, entry.z);
    sign.rotation.y = Math.atan2(before.x - entry.x, before.z - entry.z);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2, 0.2), new THREE.MeshLambertMaterial({ color: 0x2a2d33 }));
    leg.position.set(entry.x, entry.y + 0.9, entry.z);
    group.add(sign, leg);
  }
  return group;
}

// profil tunelu: bok, oblouk a strop (lat jako podíl šířky, výška v metrech)
const ARCH = [[-1, 0], [-1, 4.3], [-0.82, 5.7], [-0.45, 6.5], [0, TUNNEL_H], [0.45, 6.5], [0.82, 5.7], [1, 4.3], [1, 0]];

export function buildTunnels(track) {
  const group = new THREE.Group();
  group.name = 'tunnels';
  for (const t of track.tunnels) {
    const inner = new StripBuilder(), outer = new StripBuilder(), lamps = new StripBuilder(), dark = new StripBuilder();
    const w = track.edge + 0.6, wo = w + 1.1;
    const cIn = new THREE.Color(0x565a60), cBand = new THREE.Color(0xd9b13a), cOut = new THREE.Color(0x8d939b);
    const glow = new THREE.Color(0xffe9b8);
    const n = Math.ceil(t.len / 4);
    const pt = (s, u, y, width, extra = 0) => track.pointS(s, u * width, y + extra);
    for (let i = 0; i < n; i++) {
      const s0 = t.s0 + (i / n) * t.len, s1 = t.s0 + ((i + 1) / n) * t.len;
      for (let j = 0; j < ARCH.length - 1; j++) {
        const [u0, y0] = ARCH[j], [u1, y1] = ARCH[j + 1];
        // zevnitř tmavý beton, ve spodní části pruh, ať je znát rychlost
        const col = (j === 0 || j === ARCH.length - 2) && i % 2 ? cBand : cIn;
        inner.quad(pt(s0, u1, y1, w), pt(s0, u0, y0, w), pt(s1, u0, y0, w), pt(s1, u1, y1, w), col);
        outer.quad(pt(s0, u0, y0, wo, 0.9), pt(s0, u1, y1, wo, 0.9), pt(s1, u1, y1, wo, 0.9), pt(s1, u0, y0, wo, 0.9), cOut);
      }
      if (i % 3 === 0) {
        const a = s0 + 1, b = s0 + 3;
        lamps.quad(pt(a, -0.1, TUNNEL_H - 0.08, w), pt(a, 0.1, TUNNEL_H - 0.08, w), pt(b, 0.1, TUNNEL_H - 0.08, w), pt(b, -0.1, TUNNEL_H - 0.08, w), glow);
      }
      dark.quad(pt(s0, -1, 0.05, w), pt(s0, 1, 0.05, w), pt(s1, 1, 0.05, w), pt(s1, -1, 0.05, w), new THREE.Color(0));
    }
    // portály: pás mezi vnitřním a vnějším profilem
    for (const s of [t.s0, t.s0 + t.len]) {
      for (let j = 0; j < ARCH.length - 1; j++) {
        const [u0, y0] = ARCH[j], [u1, y1] = ARCH[j + 1];
        const q = [pt(s, u0, y0, w), pt(s, u1, y1, w), pt(s, u1, y1, wo, 0.9), pt(s, u0, y0, wo, 0.9)];
        if (s === t.s0) outer.quad(q[1], q[0], q[3], q[2], cOut);
        else outer.quad(q[0], q[1], q[2], q[3], cOut);
      }
    }
    const shell = new THREE.Mesh(outer.build(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    shell.castShadow = true;
    const lining = new THREE.Mesh(inner.build(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    const light = new THREE.Mesh(lamps.build(), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide }));
    const shade = new THREE.Mesh(dark.build(), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.2, depthWrite: false }));
    shade.renderOrder = 1;
    group.add(shell, lining, light, shade);
  }
  return group;
}
