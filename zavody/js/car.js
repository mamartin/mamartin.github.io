// Auto: 3D model z primitiv + arkádová fyzika.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, angleDiff, lerp } from './rng.js';
import { SURF_ROAD, SURF_OFF } from './track.js';
import { S } from './state.js';

export const CAR = {
  wheelbase: 2.65,
  accel: 13.5,
  vmax: 64,
  nitroAccel: 34,
  nitroVmax: 1.24,
  brake: 26,
  reverseAccel: 9,
  reverseMax: 13,
  roll: 0.8,
  drag: 0.0011,
  grip: 24,
  steerMax: 0.62,
  steerSpeedK: 15,
  halfWidth: 1.0,
  halfLength: 2.25,
  offDragMul: 1,
  offSafe: 26, // mimo trať: rychlost, nad kterou povrch rychle brzdí
  offSlow: 0.5, // a jak silně (1/s)
  turboAccel: 8,
  powerLoss: 0.27, // o kolik plný plyn ve vysoké rychlosti ubere boční přilnavost
  rearZ: 1.3,
  rearX: 0.86,
  wallLoss: 1, // násobek ztráty rychlosti po nárazu
  wetGrip: 1, // násobek přilnavosti na mokru
};

// typy vozů: auto je vyvážené, formule drží a zrychluje, ale náraz, tráva a déšť ji stojí nejvíc,
// GT je nejrychlejší na rovince a klouže v zatáčkách, rally je obratná, i mimo asfalt, a pomalejší
export const VEHICLES = {
  car: CAR,
  formula: {
    ...CAR,
    wheelbase: 3.0,
    accel: 14.2,
    vmax: 61,
    grip: 24.4,
    steerMax: 0.6,
    halfWidth: 1.05,
    halfLength: 2.35,
    offDragMul: 1.6,
    rearZ: 1.45,
    rearX: 0.88,
    wallLoss: 1.6,
    wetGrip: 0.92,
  },
  gt: {
    ...CAR,
    wheelbase: 2.8,
    accel: 14,
    vmax: 72,
    brake: 24,
    grip: 22.3,
    steerMax: 0.58,
    halfLength: 2.35,
    offDragMul: 1.2,
  },
  rally: {
    ...CAR,
    wheelbase: 2.45,
    accel: 14.6,
    vmax: 56,
    grip: 25.5,
    steerMax: 0.68,
    halfLength: 2.1,
    halfWidth: 0.97,
    offDragMul: 0.65,
    offSafe: 31,
    wetGrip: 1.05,
  },
};

// mini-turbo: délka driftu (s) pro úrovně 1–3 a jak dlouho pak výstřel trvá
export const DRIFT_LEVELS = [0.4, 0.8, 1.3];
const TURBO_TIME = [0.5, 0.85, 1.25];

const TWO_PI = Math.PI * 2;

// --- model ----------------------------------------------------------------
// Díly se stejným materiálem jsou sloučené do jedné geometrie (méně draw callů).

const ni = (g) => (g.index ? g.toNonIndexed() : g);
function placed(geo, x, y, z, rx = 0) {
  const g = geo.clone();
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return ni(g);
}

// lineární průběh hodnoty podle z: tab([[z, v], ...])(z)
function tab(points) {
  return (z) => {
    if (z <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) {
      const [z1, v1] = points[i];
      if (z <= z1) {
        const [z0, v0] = points[i - 1];
        return v0 + ((v1 - v0) * (z - z0)) / (z1 - z0);
      }
    }
    return points[points.length - 1][1];
  };
}

const range = (z0, z1, step) => {
  const n = Math.max(1, Math.round((z1 - z0) / step));
  return Array.from({ length: n + 1 }, (_, i) => z0 + ((z1 - z0) * i) / n);
};

// výšky bodů řezu nesmí klesat (jinak by se plocha překroutila)
function rising(pts) {
  for (let i = 1; i < pts.length; i++) if (pts[i][1] < pts[i - 1][1]) pts[i][1] = pts[i - 1][1];
  return pts;
}

// těleso z příčných řezů: half(z) vrací pravou polovinu řezu (x ≥ 0) od spodního středu
// k hornímu; levá polovina se zrcadlí, konce se zavřou víčky. Hladké normály.
function loft(zs, half, caps = true) {
  const rings = zs.map((z) => {
    const h = half(z);
    return [...h, ...h.slice(1, -1).reverse().map(([x, y]) => [-x, y])].map(([x, y]) => [x, y, z]);
  });
  const n = rings[0].length;
  const pos = [];
  const idx = [];
  for (const r of rings) for (const p of r) pos.push(...p);
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < n; k++) {
      const a = i * n + k, b = i * n + ((k + 1) % n), a2 = a + n, b2 = b + n;
      idx.push(a, b, a2, b, b2, a2);
    }
  }
  if (caps) {
    for (const [r, front] of [[rings[rings.length - 1], true], [rings[0], false]]) {
      const base = pos.length / 3;
      let cx = 0, cy = 0;
      for (const p of r) {
        pos.push(...p);
        cx += p[0] / n;
        cy += p[1] / n;
      }
      pos.push(cx, cy, r[0][2]);
      const c = base + n;
      for (let k = 0; k < n; k++) {
        const a = base + k, b = base + ((k + 1) % n);
        if (front) idx.push(c, a, b);
        else idx.push(c, b, a);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return ni(g);
}

// tenký pás po povrchu (pruhy): mezi |x0| a |x1| na obou stranách, ve výšce yOf(z), lícem nahoru
function ribbon(zs, x0, x1, yOf) {
  const pos = [];
  const idx = [];
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (const z of zs) {
      const y = yOf(z);
      pos.push(side * x0, y, z, side * x1, y, z);
    }
    for (let i = 0; i < zs.length - 1; i++) {
      const a = base + i * 2, b = a + 1, a2 = a + 2, b2 = a + 3;
      if (side > 0) idx.push(a, a2, b, b, a2, b2);
      else idx.push(a, b, a2, b, b2, a2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return ni(g);
}

// trámek mezi dvěma body (sloupky, ramena zavěšení, držáky)
const _up = new THREE.Vector3(0, 0, 1);
function beam(p0, p1, w, h) {
  const a = new THREE.Vector3(...p0), b = new THREE.Vector3(...p1);
  const dir = b.clone().sub(a);
  const g = new THREE.BoxGeometry(w, h, dir.length());
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_up, dir.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return ni(g);
}

const box = (w, h, d, x, y, z, rx = 0) => placed(new THREE.BoxGeometry(w, h, d), x, y, z, rx);
const mirrorX = (fn) => [fn(1), fn(-1)];

// kolo: zaoblená pneumatika (s tmavou zadní deskou disku a brzdovým kotoučem), paprskový disk
// s límcem a třmen (tire/rim se točí, accent – třmen a proužek na boku pneumatiky – jen zatáčí)
function wheelParts(r, w, { sideRing = false } = {}) {
  const prof = [
    [r * 0.68, -w / 2], [r * 0.9, -w / 2], [r * 0.98, -w / 2 + 0.03], [r, -w / 2 + 0.07],
    [r, w / 2 - 0.07], [r * 0.98, w / 2 - 0.03], [r * 0.9, w / 2], [r * 0.68, w / 2],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const lathe = ni(new THREE.LatheGeometry(prof, 20).rotateZ(Math.PI / 2));
  lathe.deleteAttribute('uv');
  lathe.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(lathe.attributes.position.count * 2), 2));
  const tire = mergeGeometries([
    lathe,
    ni(new THREE.CylinderGeometry(r * 0.66, r * 0.66, 0.02, 16).rotateZ(Math.PI / 2)),
    ni(new THREE.CylinderGeometry(r * 0.5, r * 0.5, w * 0.55, 14).rotateZ(Math.PI / 2)),
  ]);
  const face = (sx) => {
    const x = sx * (w / 2 - 0.035);
    const out = [];
    for (let k = 0; k < 5; k++) {
      const g = new THREE.BoxGeometry(0.035, 0.07, r * 0.52).translate(0, 0, r * 0.36);
      g.rotateX((k * Math.PI * 2) / 5).translate(x, 0, 0);
      out.push(ni(g));
    }
    out.push(ni(new THREE.TorusGeometry(r * 0.645, 0.02, 3, 16).rotateY(Math.PI / 2).translate(sx * (w / 2 - 0.02), 0, 0)));
    return out;
  };
  const rim = mergeGeometries([
    ...face(1), ...face(-1),
    ni(new THREE.CylinderGeometry(r * 0.14, r * 0.14, w - 0.04, 8).rotateZ(Math.PI / 2)),
  ]);
  const accent = mergeGeometries([
    ...mirrorX((sx) => box(0.07, r * 0.3, r * 0.24, sx * (w / 2 - 0.09), r * 0.33, -r * 0.2)),
    ...(sideRing ? mirrorX((sx) => ni(new THREE.TorusGeometry(r * 0.82, 0.013, 3, 22).rotateY(Math.PI / 2).translate(sx * (w / 2 + 0.002), 0, 0))) : []),
  ]);
  return { tire, rim, accent, r };
}

// auto: profil a půdorys karoserie podle z (předek je +z)
const CAR_TOP = tab([[-2.28, 0.74], [-2.2, 0.84], [-2.0, 0.9], [-1.5, 0.93], [0.9, 0.91], [1.6, 0.82], [2.1, 0.7], [2.32, 0.56]]);
const CAR_BOTTOM = tab([[-2.28, 0.36], [-2.12, 0.26], [2.1, 0.24], [2.32, 0.3]]);
const CAR_WIDTH = tab([[-2.28, 0.78], [-2.18, 0.88], [-1.9, 0.92], [1.9, 0.92], [2.2, 0.86], [2.32, 0.74]]);
const CAR_ROOF = tab([[-1.5, 0.9], [-0.88, 1.29], [-0.6, 1.33], [0.1, 1.33], [0.95, 0.9]]);
const CAR_WHEELS = [1.35, -1.3];

function carBodyHalf(z) {
  const yb = CAR_BOTTOM(z), yt = CAR_TOP(z), h = yt - yb;
  let ws = CAR_WIDTH(z);
  // vyboulené blatníky a vykrojené podběhy kol
  let yn = yb;
  for (const zw of CAR_WHEELS) {
    const dz = z - zw;
    ws += 0.035 * Math.max(0, 1 - (dz / 0.75) ** 2);
    if (Math.abs(dz) < 0.44) yn = Math.max(yn, 0.33 + Math.sqrt(0.44 * 0.44 - dz * dz));
  }
  const notch = yn > yb;
  const wl = notch ? 0.6 : ws - 0.06;
  return rising([
    [0, yb], [wl, yb], [wl, yn],
    [ws - 0.06, Math.max(yb, yn)],
    [ws, Math.max(yb + 0.28 * h, yn)],
    [ws + 0.012, Math.max(yb + 0.5 * h, yn)],
    [ws - 0.03, Math.max(yb + 0.82 * h, yn)],
    [ws - 0.17, yt - 0.012],
    [ws - 0.36, yt],
    [0, yt + 0.012],
  ]);
}

let shared = null;
function sharedParts() {
  if (shared) return shared;
  // kolem kol husté řezy (oblouk podběhu), jinde řidší
  const nearWheel = (z) => CAR_WHEELS.some((zw) => Math.abs(z - zw) < 0.5);
  const zs = [...range(-2.28, 2.32, 0.08).filter((z) => !nearWheel(z)), ...CAR_WHEELS.flatMap((zw) => range(zw - 0.48, zw + 0.48, 0.045))]
    .sort((p, q) => p - q);
  const bodyGeo = loft(zs, carBodyHalf);
  // prosklená kabina se zužuje nahoru, střecha a sloupky jsou v barvě karoserie
  const WB = 0.78, WT = 0.6;
  const cabinGeo = loft(range(-1.5, 0.95, 0.07), (z) => {
    const yr = CAR_ROOF(z);
    return rising([[0, 0.86], [WB, 0.86], [WB - 0.02, 0.93], [WT + 0.05, yr - 0.07], [WT, yr - 0.01], [WT - 0.15, yr], [0, yr + 0.01]]);
  }, false);
  const roof = loft(range(-0.8, 0.05, 0.05), (z) => {
    const yr = CAR_ROOF(z);
    return [[0, yr - 0.02], [WT - 0.04, yr - 0.02], [WT + 0.012, yr - 0.005], [WT - 0.1, yr + 0.016], [0, yr + 0.024]];
  });
  const pillars = mirrorX((sx) => [
    beam([sx * (WB - 0.01), 0.92, 0.9], [sx * (WT + 0.02), CAR_ROOF(0.05) - 0.01, 0.05], 0.07, 0.05),
    beam([sx * (WB - 0.005), 0.93, -0.36], [sx * (WT + 0.025), CAR_ROOF(-0.36) - 0.02, -0.36], 0.06, 0.1),
    beam([sx * (WB - 0.01), 0.92, -1.42], [sx * (WT + 0.02), CAR_ROOF(-0.8) - 0.01, -0.8], 0.14, 0.05),
  ]).flat();
  const mirrors = mirrorX((sx) => box(0.16, 0.1, 0.12, sx * 0.92, 1.0, 0.72));
  const paintGeo = mergeGeometries([bodyGeo, roof, ...pillars, ...mirrors]);

  const hoodSlope = Math.atan2(CAR_TOP(0.9) - CAR_TOP(1.6), 0.7);
  const noseSlope = Math.atan2(CAR_TOP(2.1) - CAR_TOP(2.32), 0.22);
  const wingGeo = mergeGeometries([box(1.86, 0.05, 0.4, 0, 1.13, -1.98, 0.06), box(1.7, 0.035, 0.16, 0, 1.17, -2.17, 0.35)]);
  const darkGeo = mergeGeometries([
    ...mirrorX((sx) => box(0.06, 0.26, 0.18, sx * 0.56, 0.99, -1.95)), // držáky křídla
    ...mirrorX((sx) => box(0.03, 0.16, 0.38, sx * 0.94, 1.13, -2.03)), // bočnice křídla
    ...mirrorX((sx) => box(0.12, 0.03, 0.04, sx * 0.82, 0.97, 0.74)), // ramena zrcátek
    ...mirrorX((sx) => box(0.08, 0.08, 1.5, sx * 0.9, 0.29, 0.02)), // prahy
    ...mirrorX((sx) => box(0.2, 0.02, 0.3, sx * 0.3, CAR_TOP(1.45) + 0.004, 1.45, hoodSlope)), // větráky v kapotě
    box(1.66, 0.04, 0.26, 0, 0.25, 2.2), // spoiler pod nárazníkem
    box(0.92, 0.12, 0.06, 0, 0.41, 2.31), // mřížka
    box(1.6, 0.16, 0.2, 0, 0.42, -2.2), // zadní nárazník
    box(1.3, 0.1, 0.28, 0, 0.31, -2.2), // difuzor
    ...[-0.36, 0, 0.36].map((x) => box(0.03, 0.14, 0.3, x, 0.3, -2.2)),
  ]);
  // spáry dveří, kapoty a kufru, stěrače a víčko nádrže
  const seam = (z, y0, y1) => mirrorX((sx) => box(0.012, y1 - y0, 0.014, sx * (CAR_WIDTH(z) + 0.012), (y0 + y1) / 2, z));
  const panelGeo = mergeGeometries([
    ...seam(0.8, 0.42, 0.84),
    ...seam(-0.72, 0.42, 0.84),
    ...mirrorX((sx) => box(0.012, 0.012, 1.5, sx * (CAR_WIDTH(0) + 0.012), 0.42, 0.04)),
    box(1.34, 0.012, 0.016, 0, CAR_TOP(2.0) + 0.012, 2.0, noseSlope),
    box(1.5, 0.012, 0.016, 0, CAR_TOP(-1.62) + 0.012, -1.62),
    ...[0.32, -0.12].map((x) => beam([x, 0.965, 1.0], [x - 0.42, 0.97, 0.98], 0.02, 0.012)),
    ni(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 12).rotateZ(Math.PI / 2).translate(-(CAR_WIDTH(-1) + 0.012), 0.76, -1.0)),
  ]);
  const handleGeo = mergeGeometries(mirrorX((sx) => box(0.022, 0.03, 0.16, sx * (CAR_WIDTH(-0.5) + 0.018), 0.78, -0.48)));
  const chromeGeo = mergeGeometries([
    ...mirrorX((sx) => ni(new THREE.CylinderGeometry(0.055, 0.055, 0.2, 12).rotateX(Math.PI / 2).translate(sx * 0.42, 0.33, -2.3))),
    handleGeo,
  ]);
  // rampa světel na střeše rally
  const barY = CAR_ROOF(0.2) + 0.09;
  const rallyBarGeo = new THREE.BoxGeometry(1.0, 0.05, 0.1).translate(0, barY - 0.07, 0.2);
  const rallyLampGeo = mergeGeometries([0.13, 0.4].flatMap((x) => mirrorX((sx) => ni(new THREE.CylinderGeometry(0.075, 0.075, 0.06, 12).rotateX(Math.PI / 2).translate(sx * x, barY, 0.24)))));
  const headGeo = mergeGeometries(mirrorX((sx) => box(0.36, 0.05, 0.16, sx * 0.55, CAR_TOP(2.21) + 0.01, 2.21, noseSlope)));
  const tailGeo = mergeGeometries([
    ...mirrorX((sx) => box(0.5, 0.1, 0.05, sx * 0.52, 0.64, -2.29)),
    box(0.56, 0.03, 0.04, 0, 0.64, -2.295),
  ]);
  // dvojitý pruh přes kapotu, střechu a kufr
  const stripeGeo = mergeGeometries([
    ribbon(range(0.92, 2.27, 0.05), 0.05, 0.2, (z) => CAR_TOP(z) + 0.016),
    ribbon(range(-0.78, 0.03, 0.05), 0.05, 0.2, (z) => CAR_ROOF(z) + 0.03),
    ribbon(range(-2.22, -1.52, 0.05), 0.05, 0.2, (z) => CAR_TOP(z) + 0.016),
  ]);
  const wheel = wheelParts(0.36, 0.3);

  const blobTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    grd.addColorStop(0, 'rgba(0,0,0,0.62)');
    grd.addColorStop(0.6, 'rgba(0,0,0,0.35)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const beamTex = (() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 128;
    const g = c.getContext('2d');
    for (let y = 0; y < 128; y++) {
      const t = y / 127; // 0 = daleko, 1 = u auta
      const w = 10 + (1 - t) * 54;
      const a = Math.pow(t, 0.8) * 0.55 * (1 - Math.pow(t, 12));
      const grd = g.createLinearGradient(32 - w / 2, 0, 32 + w / 2, 0);
      grd.addColorStop(0, 'rgba(255,240,210,0)');
      grd.addColorStop(0.5, `rgba(255,240,210,${a})`);
      grd.addColorStop(1, 'rgba(255,240,210,0)');
      g.fillStyle = grd;
      g.fillRect(0, y, 64, 1);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();

  shared = {
    paintGeo, wingGeo, cabinGeo, darkGeo, panelGeo, chromeGeo, rallyBarGeo, rallyLampGeo, headGeo, tailGeo, wheel, stripeGeo,
    plate: { y: CAR_ROOF(-0.36) + 0.032, z: -0.36, rx: 0, scale: 1 },
    numberGeo: new THREE.PlaneGeometry(0.62, 0.62).rotateX(-Math.PI / 2),
    blob: new THREE.PlaneGeometry(2.7, 5.4).rotateX(-Math.PI / 2),
    beam: new THREE.PlaneGeometry(9, 26).rotateX(-Math.PI / 2),
    tireMat: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.92, metalness: 0 }),
    rimMat: new THREE.MeshStandardMaterial({ color: 0xc9ccd1, roughness: 0.3, metalness: 0.85 }),
    darkMat: new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.6, metalness: 0.2 }),
    chromeMat: new THREE.MeshStandardMaterial({ color: 0xd9dce0, roughness: 0.22, metalness: 0.95 }),
    glassMat: new THREE.MeshStandardMaterial({ color: 0x0c131c, roughness: 0.08, metalness: 0.9 }),
    headMat: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff4dd).multiplyScalar(2.4), toneMapped: false }),
    stripeLight: new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.35, metalness: 0.3 }),
    stripeDark: new THREE.MeshStandardMaterial({ color: 0x16181d, roughness: 0.35, metalness: 0.3 }),
    blobMat: new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6 }),
    beamMat: new THREE.MeshBasicMaterial({
      map: beamTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -5,
    }),
    numberMats: new Map(),
  };
  return shared;
}

// formule: monokok s bočnicemi zúženými dozadu, tvarovaný nos, vícedílná křídla,
// ploutev na krytu motoru, haló a jezdec v helmě; průběhy rozměrů podle z (předek je +z)
const F_SIDE_W = tab([[-2.05, 0.14], [-1.6, 0.2], [-1.15, 0.36], [-0.75, 0.6], [0.15, 0.62], [0.42, 0.58], [0.5, 0.33], [0.8, 0.3]]);
const F_SIDE_TOP = tab([[-2.05, 0.36], [-1.2, 0.42], [-0.6, 0.5], [0.42, 0.5], [0.5, 0.53], [0.8, 0.55]]);
const F_SPINE_W = tab([[-2.05, 0.12], [-1.2, 0.17], [-0.6, 0.21], [0.0, 0.29], [0.8, 0.28]]);
const F_SPINE_TOP = tab([[-2.05, 0.42], [-1.6, 0.6], [-1.0, 0.8], [-0.78, 0.95], [-0.52, 0.95], [-0.44, 0.7], [-0.3, 0.64], [0.8, 0.6]]);
const F_NOSE_Y = tab([[0.75, 0.42], [1.6, 0.36], [2.32, 0.3]]);
const F_NOSE_W = tab([[0.75, 0.27], [1.5, 0.2], [2.2, 0.13], [2.32, 0.06]]);
const F_NOSE_H = tab([[0.75, 0.19], [1.5, 0.13], [2.2, 0.09], [2.32, 0.04]]);
const noseTop = (z) => F_NOSE_Y(z) + F_NOSE_H(z);

let formula = null;
function formulaParts() {
  if (formula) return formula;
  const yb = 0.16;
  const body = loft(range(-2.05, 0.8, 0.06), (z) => {
    const sw = F_SIDE_W(z), st = F_SIDE_TOP(z), cw = F_SPINE_W(z), ct = F_SPINE_TOP(z);
    return rising([
      [0, yb], [sw * 0.85, yb], [sw, yb + 0.08], [sw, st - 0.05], [sw - 0.06, st],
      [cw + 0.02, st + 0.01], [cw, ct - 0.06], [cw * 0.6, ct], [0, ct + 0.01],
    ]);
  });
  const nose = loft(range(0.75, 2.32, 0.07), (z) => {
    const yc = F_NOSE_Y(z), w = F_NOSE_W(z), h = F_NOSE_H(z);
    const pts = [];
    for (let k = 0; k <= 8; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 8;
      const c = Math.cos(a);
      pts.push([k === 0 || k === 8 ? 0 : w * Math.pow(Math.abs(c), 0.7), yc + h * Math.sin(a)]);
    }
    return pts;
  });
  // ploutev na krytu motoru
  const fin = new THREE.Shape();
  fin.moveTo(-0.8, 0.85);
  fin.lineTo(-0.82, 0.96);
  fin.lineTo(-1.98, 0.8);
  fin.lineTo(-1.98, 0.42);
  fin.lineTo(-1.2, 0.66);
  fin.lineTo(-0.8, 0.85);
  const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.024, bevelEnabled: false });
  finGeo.rotateY(-Math.PI / 2);
  finGeo.translate(0.012, 0, 0);
  const mirrors = mirrorX((sx) => box(0.15, 0.075, 0.1, sx * 0.5, 0.73, 0.3));
  const paintGeo = mergeGeometries([body, nose, ni(finGeo), ...mirrors]);

  const wingGeo = mergeGeometries([
    box(1.86, 0.035, 0.36, 0, 0.13, 2.12, -0.05), // přední křídlo: hlavní plocha
    ...mirrorX((sx) => box(0.63, 0.03, 0.2, sx * 0.62, 0.19, 1.98, 0.35)), // klapky
    ...mirrorX((sx) => box(0.6, 0.03, 0.16, sx * 0.63, 0.25, 1.88, 0.62)),
    box(1.2, 0.05, 0.36, 0, 0.94, -2.12, 0.12), // zadní křídlo
    box(1.2, 0.035, 0.22, 0, 1.06, -2.27, 0.48), // klapka DRS
    box(0.9, 0.03, 0.2, 0, 0.5, -2.12, 0.15), // spodní křídlo
  ]);
  const accentGeo = mergeGeometries([
    ...mirrorX((sx) => box(0.03, 0.26, 0.56, sx * 0.94, 0.22, 2.06)), // bočnice předního křídla
    ...mirrorX((sx) => box(0.035, 0.52, 0.62, sx * 0.62, 0.84, -2.15)), // bočnice zadního křídla
    box(0.3, 0.09, 0.05, 0, 0.88, -0.5), // sání airboxu
  ]);
  // haló: oblouk nad hlavou jezdce, nohy do monokoku a středový sloupek
  const halo = new THREE.TorusGeometry(0.29, 0.032, 6, 16, Math.PI).rotateX(Math.PI / 2).translate(0, 0.9, -0.34);
  const darkGeo = mergeGeometries([
    box(0.44, 0.04, 0.72, 0, 0.635, -0.08), // okraj kokpitu
    box(1.5, 0.04, 3.0, 0, 0.13, -0.3), // podlaha
    ...mirrorX((sx) => box(0.26, 0.2, 0.04, sx * 0.47, 0.38, 0.47)), // sání bočnic
    box(0.05, 0.44, 0.12, 0, 0.72, -2.04), // držák zadního křídla
    box(0.12, 0.04, 0.08, 0, 0.975, -0.64), // kamera na airboxu
    box(1.0, 0.16, 0.3, 0, 0.23, -2.08, -0.35), // difuzor
    ...[-0.3, 0, 0.3].map((x) => box(0.025, 0.2, 0.3, x, 0.24, -2.08, -0.35)),
    ...mirrorX((sx) => box(0.03, 0.14, 0.2, sx * 0.1, 0.22, 2.0)), // držáky předního křídla
    ni(halo),
    ...mirrorX((sx) => beam([sx * 0.29, 0.9, -0.34], [sx * 0.26, 0.64, -0.44], 0.05, 0.05)),
    beam([0, 0.9, -0.05], [0, 0.62, 0.08], 0.05, 0.04),
    ...mirrorX((sx) => beam([sx * 0.3, 0.63, 0.25], [sx * 0.46, 0.72, 0.3], 0.03, 0.03)), // ramena zrcátek
    // zavěšení: horní a spodní ramena, táhla
    ...mirrorX((sx) => [
      beam([sx * 0.24, 0.48, 1.42], [sx * 0.76, 0.44, 1.55], 0.04, 0.03),
      beam([sx * 0.24, 0.46, 1.7], [sx * 0.76, 0.44, 1.55], 0.04, 0.03),
      beam([sx * 0.22, 0.3, 1.45], [sx * 0.76, 0.28, 1.55], 0.04, 0.03),
      beam([sx * 0.22, 0.3, 1.72], [sx * 0.76, 0.28, 1.55], 0.04, 0.03),
      beam([sx * 0.18, 0.5, -1.3], [sx * 0.7, 0.5, -1.45], 0.04, 0.03),
      beam([sx * 0.16, 0.48, -1.62], [sx * 0.7, 0.5, -1.45], 0.04, 0.03),
      beam([sx * 0.16, 0.3, -1.3], [sx * 0.7, 0.3, -1.45], 0.04, 0.03),
      beam([sx * 0.15, 0.3, -1.62], [sx * 0.7, 0.3, -1.45], 0.04, 0.03),
    ]).flat(),
  ]);
  const helmetGeo = new THREE.SphereGeometry(0.17, 18, 12);
  helmetGeo.translate(0, 0.78, -0.32);
  const visorGeo = box(0.26, 0.07, 0.1, 0, 0.8, -0.18);
  const headGeo = mergeGeometries(mirrorX((sx) => box(0.05, 0.025, 0.1, sx * 0.115, F_NOSE_Y(2.1), 2.1)));
  const tailGeo = box(0.14, 0.1, 0.04, 0, 0.34, -2.08);
  formula = {
    paintGeo, wingGeo, accentGeo, darkGeo, helmetGeo, visorGeo, headGeo, tailGeo,
    front: wheelParts(0.36, 0.34, { sideRing: true }), rear: wheelParts(0.42, 0.46, { sideRing: true }),
    plate: { y: noseTop(1.25) + 0.012, z: 1.25, rx: Math.atan2(noseTop(0.75) - noseTop(2.0), 1.25), scale: 0.45 },
    helmetMat: new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 0.25, metalness: 0.3 }),
  };
  return formula;
}

const luminance = (hex) => {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};

function numberMaterial(n, bg = 0xf4f4f0) {
  const P = sharedParts();
  const key = `${n}|${bg}`;
  if (P.numberMats.has(key)) return P.numberMats.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#' + bg.toString(16).padStart(6, '0');
  g.beginPath();
  g.arc(64, 64, 60, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = luminance(bg) > 0.45 ? '#111317' : '#f4f4f0';
  g.font = 'italic 700 74px "Chakra Petch", "Arial Narrow", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(n), 62, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map: t, transparent: true, polygonOffset: true, polygonOffsetFactor: -2 });
  P.numberMats.set(key, mat);
  return mat;
}

// typ laku karoserie a křídel
export const FINISHES = {
  gloss: { roughness: 0.3, metalness: 0.45 },
  metal: { roughness: 0.2, metalness: 0.85 },
  matte: { roughness: 0.78, metalness: 0.05 },
  pearl: { roughness: 0.14, metalness: 0.6 },
  chrome: { roughness: 0.06, metalness: 1 },
};

// na vysoké kvalitě má lesklý lak bezbarvou vrchní vrstvu s vlastním odleskem
function paintMaterial(color, finish) {
  const coat = (S.quality === 'high' || S.quality === 'ultra') && finish.roughness < 0.5;
  return coat
    ? new THREE.MeshPhysicalMaterial({ color, ...finish, envMapIntensity: 1.2, clearcoat: 1, clearcoatRoughness: 0.05 })
    : new THREE.MeshStandardMaterial({ color, ...finish, envMapIntensity: 1.2 });
}

// livery: vlastní barvy dílů (wings, trim, rims, tires, cockpit, plate) a lak (finish); null = výchozí
export function createCarMesh(color, {
  ghost = false, night = false, number = null, kind = 'car', accent = null, livery = {},
} = {}) {
  const P = sharedParts();
  const F = kind === 'formula' ? formulaParts() : null;
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  root.add(tilt);

  const L = ghost ? {} : livery;
  const finish = FINISHES[L.finish] ?? FINISHES.gloss;
  // vlastní barva dílu dostane vlastní materiál, jinak sdílený výchozí
  const own = (hex, fallback, roughness, metalness) => (hex == null ? fallback : new THREE.MeshStandardMaterial({ color: hex, roughness, metalness }));
  const paint = paintMaterial(color, finish);
  const tail = new THREE.MeshBasicMaterial({ color: 0x6a0a08, toneMapped: false });
  let mats = {
    paint,
    tail,
    wing: L.wings == null ? paint : paintMaterial(L.wings, finish),
    glass: F ? P.glassMat : own(L.cockpit, P.glassMat, 0.08, 0.9),
    helmet: F ? own(L.cockpit, F.helmetMat, 0.25, 0.3) : null,
    dark: own(L.trim, P.darkMat, 0.6, 0.2),
    tire: own(L.tires, P.tireMat, 0.92, 0),
    rim: own(L.rims, P.rimMat, 0.3, 0.85),
    head: P.headMat,
  };
  if (ghost) {
    const g = (c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.32, depthWrite: false });
    mats = { paint: g(color), tail: g(0xff3322), glass: g(0x9fd8ff), dark: g(0x333333), tire: g(0x222222), rim: g(0xaaaaaa), head: g(0xffffff) };
    mats.wing = mats.paint;
    mats.helmet = mats.head;
  }
  let stripeMat = ghost ? mats.dark : luminance(color) > 0.45 ? P.stripeDark : P.stripeLight;
  if (accent != null && !ghost) stripeMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.35, metalness: 0.3 });

  const bodyMesh = new THREE.Mesh(F ? F.paintGeo : P.paintGeo, mats.paint);
  const cabinMesh = F ? new THREE.Mesh(F.helmetGeo, mats.helmet) : new THREE.Mesh(P.cabinGeo, mats.glass);
  const wingMesh = new THREE.Mesh(F ? F.wingGeo : P.wingGeo, mats.wing);
  tilt.add(
    bodyMesh,
    cabinMesh,
    wingMesh,
    new THREE.Mesh(F ? F.darkGeo : P.darkGeo, mats.dark),
    new THREE.Mesh(F ? F.headGeo : P.headGeo, mats.head),
    new THREE.Mesh(F ? F.tailGeo : P.tailGeo, mats.tail),
  );
  if (F) tilt.add(new THREE.Mesh(F.accentGeo, stripeMat), new THREE.Mesh(F.visorGeo, ghost ? mats.glass : P.glassMat));
  else tilt.add(new THREE.Mesh(P.chromeGeo, ghost ? mats.rim : P.chromeMat), new THREE.Mesh(P.panelGeo, mats.dark));
  // GT a rally vycházejí z auta: nižší a širší s větším křídlem, nebo vyšší a kratší s rampou světel
  if (kind === 'gt') {
    tilt.scale.set(1.05, 0.9, 1.08);
    wingMesh.scale.set(1.08, 1.22, 1);
  } else if (kind === 'rally') {
    tilt.scale.set(0.98, 1.1, 0.93);
    tilt.add(new THREE.Mesh(P.rallyBarGeo, mats.dark), new THREE.Mesh(P.rallyLampGeo, mats.head));
  }

  const wheels = [];
  const wheelPos = F
    ? [[0.88, 1.55, true], [-0.88, 1.55, true], [0.9, -1.45, false], [-0.9, -1.45, false]]
    : [[0.86, 1.35, true], [-0.86, 1.35, true], [0.86, -1.3, false], [-0.86, -1.3, false]];
  for (const [x, z, front] of wheelPos) {
    const geo = F ? (front ? F.front : F.rear) : P.wheel;
    const pivot = new THREE.Group();
    pivot.position.set(x, geo.r, z);
    const spin = new THREE.Group();
    const tireMesh = new THREE.Mesh(geo.tire, mats.tire);
    spin.add(tireMesh, new THREE.Mesh(geo.rim, mats.rim));
    pivot.add(spin, new THREE.Mesh(geo.accent, stripeMat));
    tilt.add(pivot);
    wheels.push({ pivot, spin, front });
    if (!ghost) tireMesh.castShadow = true;
  }

  if (!ghost) {
    if (!F) tilt.add(new THREE.Mesh(P.stripeGeo, stripeMat));
    if (number != null) {
      const plate = new THREE.Mesh(P.numberGeo, numberMaterial(number, L.plate ?? undefined));
      const at = (F || P).plate;
      plate.position.set(0, at.y, at.z);
      plate.rotation.x = at.rx;
      plate.scale.setScalar(at.scale);
      tilt.add(plate);
    }
    const blob = new THREE.Mesh(P.blob, P.blobMat);
    blob.position.y = 0.04;
    blob.renderOrder = 1;
    root.add(blob);
    bodyMesh.castShadow = cabinMesh.castShadow = wingMesh.castShadow = true;
  }
  let lightBeam = null;
  if (night && !ghost) {
    lightBeam = new THREE.Mesh(P.beam, P.beamMat);
    lightBeam.position.set(0, 0.06, 15);
    root.add(lightBeam);
  }
  return { root, tilt, wheels, mats, beam: lightBeam };
}

// mastný flek od bábiny buchty (druhý kus je nahoře, aby byl vidět i z kamery za autem)
let stain = null;
function stainParts() {
  if (stain) return stain;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const blot = (x, y, r, color) => {
    const grad = g.createRadialGradient(x, y, r * 0.2, x, y, r);
    grad.addColorStop(0, color);
    grad.addColorStop(0.7, color);
    grad.addColorStop(1, 'rgba(120, 72, 20, 0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  blot(128, 128, 78, 'rgba(120, 72, 20, 0.72)');
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + Math.random(), d = 50 + Math.random() * 45;
    blot(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 12 + Math.random() * 24, 'rgba(120, 72, 20, 0.6)');
  }
  // drobky a cukr
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * Math.PI * 2, d = Math.random() * 100;
    g.fillStyle = ['#e0a452', '#7a4316', '#fbf1dc'][i % 3];
    g.fillRect(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 2 + Math.random() * 4, 2 + Math.random() * 4);
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  stain = {
    geo: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    mat: new THREE.MeshStandardMaterial({
      map, transparent: true, roughness: 0.14, metalness: 0.1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }),
  };
  return stain;
}

export function addBunStain(mesh, kind) {
  const { geo, mat } = stainParts();
  const hood = Math.atan2(CAR_TOP(0.9) - CAR_TOP(1.6), 0.7);
  const spots = kind === 'formula'
    ? [[0.03, noseTop(1.1) + 0.012, 1.1, Math.atan2(noseTop(0.75) - noseTop(2.0), 1.25), 0.3], [0.4, F_SIDE_TOP(-0.6) + 0.02, -0.6, 0, 0.42]]
    : [[0.2, CAR_TOP(1.25) + 0.016, 1.25, hood, 0.95], [-0.34, CAR_ROOF(-0.2) + 0.03, -0.2, 0, 0.5]];
  for (const [x, y, z, rx, size] of spots) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    m.scale.setScalar(size);
    mesh.tilt.add(m);
  }
}

// uvolní materiály patřící jen tomuto autu (sdílené geometrie a materiály zůstávají)
export function disposeCarMesh(mesh) {
  const P = sharedParts();
  const sharedMats = new Set([
    P.tireMat, P.rimMat, P.darkMat, P.chromeMat, P.glassMat, P.headMat, P.stripeLight, P.stripeDark, P.blobMat, P.beamMat, ...P.numberMats.values(),
  ]);
  if (formula) sharedMats.add(formula.helmetMat);
  if (stain) sharedMats.add(stain.mat);
  mesh.root.traverse((o) => {
    if (o.material && !sharedMats.has(o.material)) o.material.dispose();
  });
  mesh.root.removeFromParent();
}

// --- fyzika ---------------------------------------------------------------

export class Car {
  constructor(track, {
    color = 0xd7263d, name = 'Hráč', number = null, isPlayer = false, night = false, ghost = false, biome = {}, kind = 'car', accent = null,
    livery = {},
  } = {}) {
    this.track = track;
    this.name = name;
    this.color = color;
    this.number = number;
    this.isPlayer = isPlayer;
    this.biome = biome;
    this.power = 1; // výkonnost jezdce AI
    this.kind = VEHICLES[kind] ? kind : 'car';
    this.spec = VEHICLES[this.kind];
    this.mesh = createCarMesh(color, { ghost, night, number, kind: this.kind, accent, livery });
    this.controls = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
    this.proj = {};
    this.reset(0, 0);
  }

  reset(s, lat) {
    const p = this.track.sampleAt(s, lat, {});
    this.x = p.x;
    this.z = p.z;
    this.y = p.y;
    this.hd = p.hd;
    this.vx = 0;
    this.vz = 0;
    this.yawRate = 0;
    this.steer = 0;
    this.speed = 0;
    this.offMix = 0;
    this.vLong = 0;
    this.slip = 0;
    this.aLong = 0;
    this.pitch = 0;
    this.roll = 0;
    this.wheelRot = 0;
    this.nitro = this.nitro ?? 0.35;
    this.nitroActive = false;
    this.surface = 0;
    this.impact = 0;
    this.skidding = false;
    this.ghostTimer = 0;
    this.spinTimer = 0;
    this.shield = 0;
    this.draft = 0; // slipstream za jiným autem (0–1)
    this.driftOn = false; // běží drift začatý ruční brzdou
    this.driftTime = 0;
    this.driftFail = false;
    this.turbo = 0; // zbývající čas výstřelu mini-turba
    this.turboFired = 0; // úroveň právě vypáleného turba (pro událost závodu)
    this.launchBoost = 0; // perfektní start: zbývající čas extra tahu
    this.launchPenalty = 0; // předčasný start: zbývající čas protáčení kol
    this.cut = null; // zkratka, na které vůz právě je
    this.track.project(this.x, this.z, -1, this.proj);
    this.savePrev();
  }

  savePrev() {
    this.px = this.x;
    this.pz = this.z;
    this.py = this.y;
    this.phd = this.hd;
  }

  step(dt) {
    this.savePrev();
    const V = this.spec;
    const c = this.controls;
    const tr = this.track;
    const P = this.proj;
    const biome = this.biome;
    this.surface = this.cut ? SURF_OFF : tr.surfaceAt(P.lat);
    const off = this.surface === SURF_OFF;
    // podíl auta mimo asfalt: kola přejíždějí okraj postupně, takže přilnavost se mění plynule
    const offTarget = this.cut ? 1 : clamp((Math.abs(P.lat) - tr.hw - tr.curbW + V.halfWidth) / (2 * V.halfWidth), 0, 1);
    this.offMix += (offTarget - this.offMix) * Math.min(1, dt * 8);
    const mix = this.offMix;
    const roadGrip = (this.surface === SURF_ROAD ? 1 : 0.95) * (biome.roadGrip ?? 1) * (biome.wet ? V.wetGrip : 1);
    // volant točený zpátky k asfaltu pomáhá, aby se dalo vrátit i z tvrdého povrchu v ostré zatáčce
    const rejoin = this.cut ? 0 : Math.max(0, -Math.sign(P.lat) * this.steer);
    const gripMul = lerp(roadGrip, (biome.offGrip ?? 0.6) * (1 + 0.4 * rejoin), mix);
    const dragMul = lerp(1, (biome.offDrag ?? 3) * V.offDragMul, mix);
    const topMul = lerp(1, 0.6, mix);

    let throttle = c.throttle, brake = c.brake, steerIn = c.steer;
    let handbrake = c.handbrake;
    // předčasný start: kola se protáčejí a vůz skoro nejede
    if (this.launchPenalty > 0) {
      this.launchPenalty -= dt;
      throttle *= 0.3;
    }
    if (this.spinTimer > 0) {
      // zasažené auto: bez kontroly, točí se
      this.spinTimer -= dt;
      throttle = 0;
      brake = 0.3;
      handbrake = true;
    }

    const sin = Math.sin(this.hd), cos = Math.cos(this.hd);
    let vx = this.vx, vz = this.vz;
    let vLong = vx * sin + vz * cos;
    let speed = Math.hypot(vx, vz);

    // řízení: plynulé dotažení vstupu, rychlejší návrat na střed
    const rate = Math.abs(steerIn) < Math.abs(this.steer) || Math.sign(steerIn) !== Math.sign(this.steer) ? 7 : 3.6;
    this.steer += clamp(steerIn - this.steer, -rate * dt, rate * dt);
    const steerMax = V.steerMax / (1 + speed / V.steerSpeedK);
    const delta = this.steer * steerMax;

    // nitro
    this.nitroActive = false;
    if (c.nitro && this.nitro > 0.01 && throttle > 0 && this.spinTimer <= 0) {
      this.nitroActive = true;
      this.nitro = Math.max(0, this.nitro - dt * 0.3);
    }

    const hardBrakeTurn = brake > 0.5 && vLong > 18 && Math.abs(this.steer) > 0.5;
    // plný plyn ve vysoké rychlosti tlačí auto ven, v driftu ale vůz řídí právě plyn
    const baseGrip = V.grip * gripMul * (handbrake ? 1 : 1 - throttle * V.powerLoss * Math.min(1, speed / 40));
    const grip = baseGrip * (handbrake ? 0.8 : 1) * (hardBrakeTurn ? 0.85 : 1);
    // strop rychlosti otáčení: úměrný vychýlení volantu (plynulé pro gamepad)
    const yawLimit = ((baseGrip * (handbrake ? 2.0 : 1.12)) / Math.max(speed, 4)) * Math.min(1, Math.abs(this.steer) * 1.05 + 0.02);

    // úhel smyku
    let beta = 0;
    if (speed > 1.5 && vLong > 0) beta = angleDiff(this.hd, Math.atan2(vx, vz));
    this.slip = Math.abs(beta);

    let wTarget = ((-vLong * Math.tan(delta)) / V.wheelbase) * (handbrake ? 1.6 : 1);
    wTarget = clamp(wTarget, -yawLimit, yawLimit);
    wTarget += beta * (handbrake ? 1.5 : 3.2);
    if (this.spinTimer > 0) wTarget = 7 * Math.sign(this.yawRate || 1);
    this.yawRate += (wTarget - this.yawRate) * Math.min(1, dt * 10);
    this.hd += this.yawRate * dt;
    if (this.hd > Math.PI) this.hd -= TWO_PI;
    else if (this.hd < -Math.PI) this.hd += TWO_PI;

    // podélná síla
    let a = 0;
    if (throttle > 0) {
      if (vLong < -1) a += V.brake * throttle;
      else {
        // ve slipstreamu je menší odpor, takže i vyšší maximálka
        const vm = V.vmax * Math.sqrt(this.power) * topMul * (this.nitroActive ? V.nitroVmax : 1) * (1 + 0.06 * this.draft) * (this.turbo > 0 ? 1.08 : 1);
        const r = Math.max(0, vLong) / vm;
        a += V.accel * this.power * throttle * Math.max(0, 1 - r * r);
        // nitro nejvíc táhne v pomalém výjezdu ze zatáčky, v plné rychlosti už málo
        if (this.nitroActive) a += V.nitroAccel * Math.min(0.65, Math.max(0, 1 - r)) ** 2;
        if (this.launchBoost > 0) a += 7 * throttle * Math.max(0, 1 - r);
        if (this.turbo > 0) a += V.turboAccel * throttle * Math.max(0, 1 - r);
      }
    }
    if (brake > 0) {
      if (vLong > 1) a -= V.brake * brake;
      else if (vLong > -V.reverseMax) a -= V.reverseAccel * brake * (1 + vLong / V.reverseMax);
    }
    if (handbrake && vLong > 0) a -= 3.5;
    if (this.launchBoost > 0) this.launchBoost -= dt;
    const resist = V.roll * dragMul + V.drag * vLong * vLong * lerp(1, 1.6, mix) * (1 - 0.5 * this.draft);
    if (Math.abs(vLong) > 0.05) a -= Math.sign(vLong) * resist;
    if (vLong > V.offSafe) a -= (vLong - V.offSafe) * V.offSlow * V.offDragMul * mix;
    this.aLong = a;
    const nsin = Math.sin(this.hd), ncos = Math.cos(this.hd);
    vx += nsin * a * dt;
    vz += ncos * a * dt;

    // boční přilnavost: vektor rychlosti se stáčí za přídí
    speed = Math.hypot(vx, vz);
    vLong = vx * nsin + vz * ncos;
    if (speed > 0.4) {
      const velAng = Math.atan2(vx, vz);
      const target = vLong >= 0 ? this.hd : this.hd + Math.PI;
      const diff = angleDiff(velAng, target);
      const maxRot = ((vLong >= 0 ? grip : grip * 2) / speed) * dt;
      const rot = clamp(diff, -maxRot, maxRot);
      const scrub = Math.min(0.5, Math.abs(diff) * (handbrake ? 0.9 : 1.6) * dt);
      speed *= 1 - scrub;
      const na = velAng + rot;
      vx = Math.sin(na) * speed;
      vz = Math.cos(na) * speed;
    } else if (throttle === 0 && brake === 0) {
      vx *= 0.9;
      vz *= 0.9;
    }

    this.vx = vx;
    this.vz = vz;
    this.x += vx * dt;
    this.z += vz * dt;
    this.speed = Math.hypot(vx, vz);
    this.vLong = vx * nsin + vz * ncos;

    // drift dobíjí nitro
    if (this.slip > 0.18 && this.speed > 12 && !off) this.nitro = Math.min(1, this.nitro + dt * 0.22 * Math.min(1, this.slip * 2));
    this.nitro = Math.min(1, this.nitro + dt * 0.012);

    if (this.cut) this.cut.project(this.x, this.z, P);
    else tr.project(this.x, this.z, P.i ?? -1, P);
    this.updateCut();
    this.collideWalls(dt);
    this.updateDrift(dt, off);

    this.y = P.y;
    const rel = Math.cos(this.hd - P.hd);
    const targetPitch = -Math.atan(P.grade * rel) - clamp(this.aLong, -30, 20) * 0.0035;
    const targetRoll = -P.bank * rel + clamp(this.vLong * this.yawRate, -30, 30) * 0.0028;
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 8);
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 8);
    this.wheelRot += (this.vLong * dt) / 0.36;

    this.skidding = (this.launchPenalty > 0 && c.throttle > 0.3)
      || (this.speed > 6 && ((this.slip > 0.14 && this.vLong > 0) || (handbrake && this.speed > 4) || (brake > 0.85 && this.vLong > 16)));
    if (this.ghostTimer > 0) this.ghostTimer -= dt;
    if (this.shield > 0) this.shield -= dt;
  }

  // mini-turbo: drift začatý ruční brzdou se nabíjí a po vyrovnání vozu vystřelí, chyba ho zruší
  updateDrift(dt, off) {
    if (this.turbo > 0) this.turbo -= dt;
    const slide = this.slip > 0.16 && this.vLong > 12;
    if (this.controls.handbrake && slide) this.driftOn = true;
    if (!this.driftOn) return;
    if (off || this.impact > 2 || this.spinTimer > 0) {
      this.driftFail = this.driftLevel > 0;
      this.driftOn = false;
      this.driftTime = 0;
    } else if (slide) this.driftTime += dt;
    else if (!this.controls.handbrake) {
      const level = this.driftLevel;
      if (level) {
        this.turbo = TURBO_TIME[level - 1];
        this.turboFired = level;
      }
      this.driftOn = false;
      this.driftTime = 0;
    }
  }

  get driftLevel() {
    return DRIFT_LEVELS.filter((t) => this.driftTime >= t).length;
  }

  // zkratka: vjezd mezerou ve svodidle a návrat na trať (AI ji nepoužívá)
  updateCut() {
    const P = this.proj, tr = this.track, cut = this.cut;
    const lim = tr.edge - this.spec.halfWidth;
    if (cut) {
      let back = P.cutEnd !== 0;
      if (!back && (P.cutK < cut.k0 || P.cutK >= cut.k1)) {
        const m = tr.project(this.x, this.z, P.i, this.mainProj || (this.mainProj = {}));
        back = Math.abs(m.lat) < lim - 1;
      }
      if (back) {
        this.cut = null;
        tr.project(this.x, this.z, P.i, P);
      }
    } else if (this.isPlayer && tr.cuts.length && Math.abs(P.lat) > lim - 0.5) {
      const c = tr.cutAt(P.s, Math.sign(P.lat));
      if (c) {
        this.cut = c;
        P.cutK = -1;
        c.project(this.x, this.z, P);
      }
    }
  }

  collideRocks() {
    const V = this.spec;
    for (const r of this.cut.rocks) {
      const dx = this.x - r.x, dz = this.z - r.z;
      const d = Math.hypot(dx, dz) || 0.01;
      const min = r.r + V.halfWidth;
      if (d >= min) continue;
      const nx = dx / d, nz = dz / d;
      this.x = r.x + nx * min;
      this.z = r.z + nz * min;
      const vn = this.vx * nx + this.vz * nz;
      if (vn >= 0) continue;
      this.vx -= nx * vn * 1.3;
      this.vz -= nz * vn * 1.3;
      const loss = 1 - Math.min(0.7, -vn * 0.05 * V.wallLoss);
      this.vx *= loss;
      this.vz *= loss;
      this.impact = -vn;
      this.yawRate *= 0.4;
    }
  }

  collideWalls(dt) {
    const V = this.spec;
    const P = this.proj;
    const cut = this.cut;
    const lim = (cut ? cut.hw : this.track.edge) - V.halfWidth - 0.1;
    const a = Math.abs(P.lat);
    this.impact = 0;
    if (cut) this.collideRocks();
    // tam, kde se cesta dotýká trati, je na její straně k trati volno
    if (a <= lim || (cut && (P.cutK < cut.k0 || P.cutK >= cut.k1) && P.lat * cut.side < 0)) return;
    const side = Math.sign(P.lat);
    const excess = a - lim;
    const nx = P.rx * side, nz = P.rz * side;
    this.x -= nx * excess;
    this.z -= nz * excess;
    const vn = this.vx * nx + this.vz * nz;
    if (vn > 0) {
      this.vx -= nx * vn * 1.3;
      this.vz -= nz * vn * 1.3;
      const loss = 1 - Math.min(0.6, vn * 0.035 * V.wallLoss);
      this.vx *= loss;
      this.vz *= loss;
      this.impact = vn;
      // natočit podél svodidla
      const along = Math.cos(this.hd - P.hd) >= 0 ? P.hd : P.hd + Math.PI;
      this.hd += angleDiff(this.hd, along) * Math.min(0.5, vn * 0.03);
      // tvrdá rána otáčení utne, při drhnutí zůstává řízení, aby šlo od svodidla odjet
      this.yawRate *= 1 - Math.min(0.5, vn * 0.1);
    }
    // drhnutí o svodidlo brzdí i při lehkém doteku
    const grind = 1 - 0.4 * dt;
    this.vx *= grind;
    this.vz *= grind;
    P.lat = side * lim;
    P.y = P.cy + P.lat * P.tanBank;
  }

  // pozice zadních kol pro stopy pneumatik
  rearWheels(outL, outR) {
    const sin = Math.sin(this.hd), cos = Math.cos(this.hd);
    const { rearZ, rearX } = this.spec;
    const bx = this.x - sin * rearZ, bz = this.z - cos * rearZ;
    const rx = -cos, rz = sin;
    outL[0] = bx - rx * rearX; outL[1] = this.y; outL[2] = bz - rz * rearX;
    outR[0] = bx + rx * rearX; outR[1] = this.y; outR[2] = bz + rz * rearX;
  }

  // vykreslení s interpolací mezi kroky fyziky
  render(alpha) {
    const V = this.spec;
    const m = this.mesh;
    const x = lerp(this.px, this.x, alpha);
    const z = lerp(this.pz, this.z, alpha);
    const y = lerp(this.py, this.y, alpha);
    const hd = this.phd + angleDiff(this.phd, this.hd) * alpha;
    m.root.position.set(x, y, z);
    m.root.rotation.y = hd;
    m.tilt.rotation.x = this.pitch;
    m.tilt.rotation.z = this.roll;
    const steerVis = this.steer * (V.steerMax / (1 + this.speed / 30));
    for (const w of m.wheels) {
      w.spin.rotation.x = this.wheelRot;
      if (w.front) w.pivot.rotation.y = -steerVis;
    }
    const braking = this.controls.brake > 0.1 && this.vLong > 0.5;
    if (braking !== this.wasBraking) {
      this.wasBraking = braking;
      m.mats.tail.color.setHex(braking ? 0xff2a1a : 0x6a0a08);
      if (braking) m.mats.tail.color.multiplyScalar(2.6);
    }
    // blikání po respawnu
    m.root.visible = this.ghostTimer > 0 ? Math.floor(this.ghostTimer * 10) % 2 === 0 : true;
  }
}
