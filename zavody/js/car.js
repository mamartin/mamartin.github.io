// Auto: 3D model z primitiv + arkádová fyzika.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, angleDiff, lerp } from './rng.js';
import { SURF_OFF, SURF_CURB } from './track.js';

export const CAR = {
  wheelbase: 2.65,
  accel: 13.5,
  vmax: 64,
  nitroAccel: 9,
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
};

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

// dvojitý závodní pruh po horních plochách karoserie (z, y úseků profilu)
const STRIPE_SEGMENTS = [
  [-2.2, 0.91, -1.5, 0.97],
  [-0.9, 1.35, 0.12, 1.38],
  [0.9, 0.93, 1.85, 0.77],
  [1.85, 0.77, 2.22, 0.61],
];

let shared = null;
function sharedParts() {
  if (shared) return shared;
  const body = new THREE.Shape();
  body.moveTo(-2.0, 0.26);
  body.lineTo(-2.2, 0.32);
  body.lineTo(-2.26, 0.58);
  body.lineTo(-2.2, 0.86);
  body.lineTo(-1.5, 0.92);
  body.lineTo(0.8, 0.88);
  body.lineTo(1.85, 0.72);
  body.lineTo(2.22, 0.56);
  body.lineTo(2.3, 0.4);
  body.lineTo(2.16, 0.26);
  body.lineTo(1.8, 0.26);
  body.absarc(1.35, 0.3, 0.45, 0, Math.PI, false);
  body.lineTo(-0.85, 0.26);
  body.absarc(-1.3, 0.3, 0.45, 0, Math.PI, false);
  body.lineTo(-2.0, 0.26);
  const bodyW = 1.8;
  const bodyGeo = new THREE.ExtrudeGeometry(body, {
    depth: bodyW, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.05, bevelSegments: 3, curveSegments: 10,
  });
  bodyGeo.rotateY(-Math.PI / 2);
  bodyGeo.translate(bodyW / 2, 0, 0);
  bodyGeo.computeVertexNormals();
  bodyGeo.clearGroups();

  const cabin = new THREE.Shape();
  cabin.moveTo(-1.5, 0.86);
  cabin.lineTo(-0.9, 1.28);
  cabin.lineTo(0.12, 1.31);
  cabin.lineTo(0.9, 0.86);
  cabin.lineTo(-1.5, 0.86);
  const cabW = 1.44;
  const cabinGeo = new THREE.ExtrudeGeometry(cabin, {
    depth: cabW, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.07, bevelSegments: 3, curveSegments: 4,
  });
  cabinGeo.rotateY(-Math.PI / 2);
  cabinGeo.translate(cabW / 2, 0, 0);
  cabinGeo.computeVertexNormals();

  const wing = new THREE.BoxGeometry(1.86, 0.05, 0.4);
  const strut = new THREE.BoxGeometry(0.06, 0.26, 0.18);
  const headlight = new THREE.BoxGeometry(0.46, 0.12, 0.12);
  const taillight = new THREE.BoxGeometry(0.52, 0.11, 0.06);
  const paintGeo = mergeGeometries([bodyGeo, placed(wing, 0, 1.13, -1.98)]);
  const darkGeo = mergeGeometries([
    placed(strut, -0.56, 0.99, -1.95),
    placed(strut, 0.56, 0.99, -1.95),
    placed(new THREE.BoxGeometry(1.84, 0.06, 0.34), 0, 0.25, 2.12),
    placed(new THREE.BoxGeometry(1.6, 0.16, 0.2), 0, 0.34, -2.2),
  ]);
  const headGeo = mergeGeometries([placed(headlight, -0.58, 0.6, 2.17, -0.45), placed(headlight, 0.58, 0.6, 2.17, -0.45)]);
  const tailGeo = mergeGeometries([placed(taillight, -0.58, 0.74, -2.26), placed(taillight, 0.58, 0.74, -2.26)]);
  const tire = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 18).rotateZ(Math.PI / 2);
  const rimGeo = mergeGeometries([
    ni(new THREE.CylinderGeometry(0.23, 0.23, 0.32, 10).rotateZ(Math.PI / 2)),
    ni(new THREE.BoxGeometry(0.33, 0.06, 0.4)),
  ]);
  const stripeBox = new THREE.BoxGeometry(0.17, 0.014, 1);
  const stripeParts = [];
  for (const [z0, y0, z1, y1] of STRIPE_SEGMENTS) {
    const len = Math.hypot(z1 - z0, y1 - y0);
    const ang = Math.atan2(y1 - y0, z1 - z0);
    for (const x of [-0.14, 0.14]) {
      const g = stripeBox.clone().scale(1, 1, len).rotateX(-ang).translate(x, (y0 + y1) / 2 + 0.006, (z0 + z1) / 2);
      stripeParts.push(ni(g));
    }
  }
  const stripeGeo = mergeGeometries(stripeParts);
  [wing, strut, headlight, taillight, stripeBox].forEach((g) => g.dispose());

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
    paintGeo, cabinGeo, darkGeo, headGeo, tailGeo, tire, rimGeo, stripeGeo,
    numberGeo: new THREE.PlaneGeometry(0.62, 0.62).rotateX(-Math.PI / 2),
    blob: new THREE.PlaneGeometry(2.7, 5.4).rotateX(-Math.PI / 2),
    beam: new THREE.PlaneGeometry(9, 26).rotateX(-Math.PI / 2),
    tireMat: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.92, metalness: 0 }),
    rimMat: new THREE.MeshStandardMaterial({ color: 0xc9ccd1, roughness: 0.3, metalness: 0.85 }),
    darkMat: new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.6, metalness: 0.2 }),
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

function numberMaterial(n) {
  const P = sharedParts();
  if (P.numberMats.has(n)) return P.numberMats.get(n);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f4f0';
  g.beginPath();
  g.arc(64, 64, 60, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#111317';
  g.font = 'italic 700 74px "Chakra Petch", "Arial Narrow", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(n), 62, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map: t, transparent: true, polygonOffset: true, polygonOffsetFactor: -2 });
  P.numberMats.set(n, mat);
  return mat;
}

export function createCarMesh(color, { ghost = false, night = false, number = null } = {}) {
  const P = sharedParts();
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  root.add(tilt);

  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.45, envMapIntensity: 1.2 });
  const tail = new THREE.MeshBasicMaterial({ color: 0x6a0a08, toneMapped: false });
  let mats = { paint, tail, glass: P.glassMat, dark: P.darkMat, tire: P.tireMat, rim: P.rimMat, head: P.headMat };
  if (ghost) {
    const g = (c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.32, depthWrite: false });
    mats = { paint: g(color), tail: g(0xff3322), glass: g(0x9fd8ff), dark: g(0x333333), tire: g(0x222222), rim: g(0xaaaaaa), head: g(0xffffff) };
  }

  const bodyMesh = new THREE.Mesh(P.paintGeo, mats.paint);
  const cabinMesh = new THREE.Mesh(P.cabinGeo, mats.glass);
  tilt.add(
    bodyMesh,
    cabinMesh,
    new THREE.Mesh(P.darkGeo, mats.dark),
    new THREE.Mesh(P.headGeo, mats.head),
    new THREE.Mesh(P.tailGeo, mats.tail),
  );

  const wheels = [];
  const wheelPos = [
    [0.86, 1.35, true], [-0.86, 1.35, true], [0.86, -1.3, false], [-0.86, -1.3, false],
  ];
  for (const [x, z, front] of wheelPos) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.36, z);
    const spin = new THREE.Group();
    const tireMesh = new THREE.Mesh(P.tire, mats.tire);
    spin.add(tireMesh, new THREE.Mesh(P.rimGeo, mats.rim));
    pivot.add(spin);
    tilt.add(pivot);
    wheels.push({ pivot, spin, front });
    if (!ghost) tireMesh.castShadow = true;
  }

  if (!ghost) {
    const c = new THREE.Color(color);
    const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    tilt.add(new THREE.Mesh(P.stripeGeo, lum > 0.45 ? P.stripeDark : P.stripeLight));
    if (number != null) {
      const plate = new THREE.Mesh(P.numberGeo, numberMaterial(number));
      plate.position.set(0, 1.386, -0.36);
      tilt.add(plate);
    }
    const blob = new THREE.Mesh(P.blob, P.blobMat);
    blob.position.y = 0.04;
    blob.renderOrder = 1;
    root.add(blob);
    bodyMesh.castShadow = cabinMesh.castShadow = true;
  }
  let beam = null;
  if (night && !ghost) {
    beam = new THREE.Mesh(P.beam, P.beamMat);
    beam.position.set(0, 0.06, 15);
    root.add(beam);
  }
  return { root, tilt, wheels, mats, beam };
}

// uvolní materiály patřící jen tomuto autu (sdílené geometrie a materiály zůstávají)
export function disposeCarMesh(mesh) {
  const P = sharedParts();
  const sharedMats = new Set([
    P.tireMat, P.rimMat, P.darkMat, P.glassMat, P.headMat, P.stripeLight, P.stripeDark, P.blobMat, P.beamMat, ...P.numberMats.values(),
  ]);
  mesh.root.traverse((o) => {
    if (o.material && !sharedMats.has(o.material)) o.material.dispose();
  });
  mesh.root.removeFromParent();
}

// --- fyzika ---------------------------------------------------------------

export class Car {
  constructor(track, { color = 0xd7263d, name = 'Hráč', number = null, isPlayer = false, night = false, ghost = false, biome = {} } = {}) {
    this.track = track;
    this.name = name;
    this.color = color;
    this.number = number;
    this.isPlayer = isPlayer;
    this.biome = biome;
    this.mesh = createCarMesh(color, { ghost, night, number });
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
    const c = this.controls;
    const tr = this.track;
    const P = this.proj;
    const biome = this.biome;
    this.surface = tr.surfaceAt(P.lat);
    const off = this.surface === SURF_OFF;
    const gripMul = off ? biome.offGrip ?? 0.6 : (this.surface === SURF_CURB ? 0.95 : 1) * (biome.roadGrip ?? 1);
    const dragMul = off ? biome.offDrag ?? 3 : 1;
    const topMul = off ? 0.6 : 1;

    let throttle = c.throttle, brake = c.brake, steerIn = c.steer;
    let handbrake = c.handbrake;
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
    const steerMax = CAR.steerMax / (1 + speed / CAR.steerSpeedK);
    const delta = this.steer * steerMax;

    // nitro
    this.nitroActive = false;
    if (c.nitro && this.nitro > 0.01 && throttle > 0 && this.spinTimer <= 0) {
      this.nitroActive = true;
      this.nitro = Math.max(0, this.nitro - dt * 0.3);
    }

    const hardBrakeTurn = brake > 0.5 && vLong > 18 && Math.abs(this.steer) > 0.5;
    const baseGrip = CAR.grip * gripMul;
    const grip = baseGrip * (handbrake ? 0.8 : 1) * (hardBrakeTurn ? 0.85 : 1);
    // strop rychlosti otáčení: úměrný vychýlení volantu (plynulé pro gamepad)
    const yawLimit = ((baseGrip * (handbrake ? 2.0 : 1.12)) / Math.max(speed, 4)) * Math.min(1, Math.abs(this.steer) * 1.05 + 0.02);

    // úhel smyku
    let beta = 0;
    if (speed > 1.5 && vLong > 0) beta = angleDiff(this.hd, Math.atan2(vx, vz));
    this.slip = Math.abs(beta);

    let wTarget = ((-vLong * Math.tan(delta)) / CAR.wheelbase) * (handbrake ? 1.6 : 1);
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
      if (vLong < -1) a += CAR.brake * throttle;
      else {
        const vm = CAR.vmax * topMul * (this.nitroActive ? CAR.nitroVmax : 1);
        const r = Math.max(0, vLong) / vm;
        a += CAR.accel * throttle * Math.max(0, 1 - r * r);
        if (this.nitroActive) a += CAR.nitroAccel * Math.max(0, 1 - r);
      }
    }
    if (brake > 0) {
      if (vLong > 1) a -= CAR.brake * brake;
      else if (vLong > -CAR.reverseMax) a -= CAR.reverseAccel * brake * (1 + vLong / CAR.reverseMax);
    }
    if (handbrake && vLong > 0) a -= 3.5;
    const resist = CAR.roll * dragMul + CAR.drag * vLong * vLong * (off ? 1.6 : 1);
    if (Math.abs(vLong) > 0.05) a -= Math.sign(vLong) * resist;
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

    tr.project(this.x, this.z, P.i ?? -1, P);
    this.collideWalls();

    this.y = P.y;
    const rel = Math.cos(this.hd - P.hd);
    const targetPitch = -Math.atan(P.grade * rel) - clamp(this.aLong, -30, 20) * 0.0035;
    const targetRoll = -P.bank * rel + clamp(this.vLong * this.yawRate, -30, 30) * 0.0028;
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 8);
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 8);
    this.wheelRot += (this.vLong * dt) / 0.36;

    this.skidding = this.speed > 6 && ((this.slip > 0.14 && this.vLong > 0) || (handbrake && this.speed > 4) || (brake > 0.85 && this.vLong > 16));
    if (this.ghostTimer > 0) this.ghostTimer -= dt;
    if (this.shield > 0) this.shield -= dt;
  }

  collideWalls() {
    const P = this.proj;
    const lim = this.track.edge - CAR.halfWidth - 0.1;
    const a = Math.abs(P.lat);
    this.impact = 0;
    if (a <= lim) return;
    const side = Math.sign(P.lat);
    const excess = a - lim;
    const nx = P.rx * side, nz = P.rz * side;
    this.x -= nx * excess;
    this.z -= nz * excess;
    const vn = this.vx * nx + this.vz * nz;
    if (vn > 0) {
      this.vx -= nx * vn * 1.3;
      this.vz -= nz * vn * 1.3;
      const loss = 1 - Math.min(0.35, vn * 0.018);
      this.vx *= loss;
      this.vz *= loss;
      this.impact = vn;
      // natočit podél svodidla
      const along = Math.cos(this.hd - P.hd) >= 0 ? P.hd : P.hd + Math.PI;
      this.hd += angleDiff(this.hd, along) * Math.min(0.5, vn * 0.03);
      this.yawRate *= 0.5;
    }
    P.lat = side * lim;
    P.y = P.cy + P.lat * P.tanBank;
  }

  // pozice zadních kol pro stopy pneumatik
  rearWheels(outL, outR) {
    const sin = Math.sin(this.hd), cos = Math.cos(this.hd);
    const bx = this.x - sin * 1.3, bz = this.z - cos * 1.3;
    const rx = -cos, rz = sin;
    outL[0] = bx - rx * 0.86; outL[1] = this.y; outL[2] = bz - rz * 0.86;
    outR[0] = bx + rx * 0.86; outR[1] = this.y; outR[2] = bz + rz * 0.86;
  }

  // vykreslení s interpolací mezi kroky fyziky
  render(alpha) {
    const m = this.mesh;
    const x = lerp(this.px, this.x, alpha);
    const z = lerp(this.pz, this.z, alpha);
    const y = lerp(this.py, this.y, alpha);
    const hd = this.phd + angleDiff(this.phd, this.hd) * alpha;
    m.root.position.set(x, y, z);
    m.root.rotation.y = hd;
    m.tilt.rotation.x = this.pitch;
    m.tilt.rotation.z = this.roll;
    const steerVis = this.steer * (CAR.steerMax / (1 + this.speed / 30));
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
