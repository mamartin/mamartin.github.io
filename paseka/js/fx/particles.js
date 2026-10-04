// Částice: pyl, padající listí, sněžení, svatojánské mušky a jiskřičky při zasazení.
// Všechny používají jeden shader s měkkými, natáčenými body (lístky jsou protáhlé elipsy).
import * as THREE from 'three';
import { RNG } from '../core/rng.js';

const VS = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aPhase;
attribute float aAlpha;
attribute float aAspect;
uniform float uScale;
uniform float uTime;
varying vec3 vColor;
varying float vAlpha;
varying float vAngle;
varying float vAspect;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vAspect = aAspect;
  vAngle = aPhase * 6.2831 + uTime * (0.6 + fract(aPhase * 7.0) * 1.8);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * aAspect * uScale / -mv.z;
}`;

const FS = /* glsl */ `
uniform float uOpacity;
varying vec3 vColor;
varying float vAlpha;
varying float vAngle;
varying float vAspect;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vAngle), s = sin(vAngle);
  p = mat2(c, -s, s, c) * p;
  p.y *= vAspect;
  float d = length(p) * 2.0;
  float a = smoothstep(1.0, 0.55, d);
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a * vAlpha * uOpacity);
}`;

function makePoints(count, additive) {
  const geo = new THREE.BufferGeometry();
  const attrs = {
    position: new THREE.BufferAttribute(new Float32Array(count * 3), 3),
    aColor: new THREE.BufferAttribute(new Float32Array(count * 3), 3),
    aSize: new THREE.BufferAttribute(new Float32Array(count), 1),
    aPhase: new THREE.BufferAttribute(new Float32Array(count), 1),
    aAlpha: new THREE.BufferAttribute(new Float32Array(count), 1),
    aAspect: new THREE.BufferAttribute(new Float32Array(count).fill(1), 1),
  };
  for (const [k, a] of Object.entries(attrs)) {
    if (k === 'position' || k === 'aAlpha') a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(k, a);
  }
  const uniforms = { uScale: shared.uScale, uTime: shared.uTime, uOpacity: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VS, fragmentShader: FS,
    transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return { points, geo, attrs, uniforms };
}

// Měřítko bodů (pixely na jednotku ve vzdálenosti 1) a čas sdílí všechny systémy.
export const shared = { uScale: { value: 500 }, uTime: { value: 0 } };

export function setPointScale(height, pixelRatio, fov) {
  shared.uScale.value = (height * pixelRatio) / (2 * Math.tan((fov * Math.PI) / 360));
}

// Padající nebo poletující částice nad ostrovem.
class Drift {
  constructor(board, count, cfg, seed) {
    this.board = board;
    this.cfg = cfg;
    this.rng = new RNG(seed);
    const { points, attrs, uniforms } = makePoints(count, cfg.additive);
    this.points = points;
    this.attrs = attrs;
    this.uniforms = uniforms;
    this.p = [];
    const col = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const q = { fall: this.rng.range(...cfg.fall), sway: this.rng.range(0.5, 1) * cfg.sway, ph: this.rng.next() * 6.28 };
      this.respawn(q, true);
      this.p.push(q);
      col.set(this.rng.pick(cfg.colors));
      attrs.aColor.setXYZ(i, col.r, col.g, col.b);
      attrs.aSize.setX(i, this.rng.range(...cfg.size));
      attrs.aPhase.setX(i, this.rng.next());
      attrs.aAspect.setX(i, cfg.aspect);
      attrs.aAlpha.setX(i, 1);
    }
  }

  respawn(q, anywhere) {
    const a = this.rng.next() * Math.PI * 2, d = Math.sqrt(this.rng.next()) * 13;
    q.x = Math.cos(a) * d;
    q.z = Math.sin(a) * d;
    q.y = anywhere ? this.rng.range(-4, 8) : this.rng.range(7, 9);
  }

  update(dt, time, opacity, wind) {
    this.uniforms.uOpacity.value = opacity;
    this.points.visible = opacity > 0.01;
    if (!this.points.visible) return;
    const pos = this.attrs.position;
    this.p.forEach((q, i) => {
      q.y -= q.fall * dt;
      q.x += (Math.sin(time * 0.9 + q.ph) * q.sway + wind * 0.25) * dt;
      q.z += Math.cos(time * 0.7 + q.ph * 1.3) * q.sway * 0.6 * dt;
      const tile = this.board.tileAt(q.x, q.z);
      const ground = tile ? tile.h : -6;
      if (this.cfg.float) {
        // Pyl se vznáší: místo dopadu se vrací nahoru a krouží.
        q.y += Math.sin(time * 0.6 + q.ph) * 0.12 * dt;
        if (q.y < ground + 0.2 || q.y > 6 || Math.hypot(q.x, q.z) > 14) this.respawnLow(q);
      } else if (q.y < ground || Math.hypot(q.x, q.z) > 15) {
        this.respawn(q, false);
      }
      pos.setXYZ(i, q.x, q.y, q.z);
    });
    pos.needsUpdate = true;
  }

  respawnLow(q) {
    this.respawn(q, true);
    q.y = this.rng.range(1, 4);
  }
}

// Svatojánské mušky: poletují nízko nad loukou a lesem a pomalu blikají.
class Fireflies {
  constructor(board, count, seed) {
    const rng = new RNG(seed);
    const land = board.tiles.filter((t) => t.type === 'louka' || t.type === 'les' || t.type === 'paseka');
    const { points, attrs, uniforms } = makePoints(count, true);
    this.points = points;
    this.attrs = attrs;
    this.uniforms = uniforms;
    this.f = [];
    for (let i = 0; i < count; i++) {
      const t = rng.pick(land);
      this.f.push({
        x: t.x + rng.range(-0.6, 0.6), y: t.h + rng.range(0.25, 1.2), z: t.z + rng.range(-0.6, 0.6),
        a: rng.range(0.3, 0.7), b: rng.range(0.4, 0.9), c: rng.range(0.3, 0.6),
        p: rng.next() * 6.28, blink: rng.range(0.8, 1.8),
      });
      attrs.aColor.setXYZ(i, 2.6, 2.3, 0.7);
      attrs.aSize.setX(i, rng.range(0.09, 0.14));
      attrs.aPhase.setX(i, rng.next());
    }
  }

  update(dt, time, opacity) {
    this.uniforms.uOpacity.value = opacity;
    this.points.visible = opacity > 0.01;
    if (!this.points.visible) return;
    const pos = this.attrs.position, al = this.attrs.aAlpha;
    this.f.forEach((f, i) => {
      pos.setXYZ(i,
        f.x + Math.sin(time * f.a + f.p) * 0.7,
        f.y + Math.sin(time * f.b + f.p * 2) * 0.3,
        f.z + Math.cos(time * f.c + f.p * 3) * 0.7);
      al.setX(i, Math.pow(Math.max(0, Math.sin(time * f.blink + f.p)), 3));
    });
    pos.needsUpdate = true;
    al.needsUpdate = true;
  }
}

// Jiskřičky při zasazení rostliny.
class Burst {
  constructor(count) {
    const { points, attrs } = makePoints(count, true);
    this.points = points;
    this.attrs = attrs;
    this.rng = new RNG(77);
    this.b = Array.from({ length: count }, () => ({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }));
    this.next = 0;
    attrs.aAlpha.array.fill(0);
  }

  spawn(x, y, z, n = 26) {
    const col = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.b.length;
      const a = this.rng.next() * Math.PI * 2, sp = this.rng.range(0.4, 1.4);
      Object.assign(this.b[i], {
        life: 1, x, y: y + 0.1, z,
        vx: Math.cos(a) * sp, vy: this.rng.range(1.2, 2.6), vz: Math.sin(a) * sp,
        decay: this.rng.range(0.9, 1.6),
      });
      col.setRGB(1.6, 2.0, 0.9).multiplyScalar(this.rng.range(0.7, 1.3));
      this.attrs.aColor.setXYZ(i, col.r, col.g, col.b);
      this.attrs.aSize.setX(i, this.rng.range(0.04, 0.08));
      this.attrs.aPhase.setX(i, this.rng.next());
    }
    this.attrs.aColor.needsUpdate = this.attrs.aSize.needsUpdate = this.attrs.aPhase.needsUpdate = true;
  }

  update(dt) {
    const pos = this.attrs.position, al = this.attrs.aAlpha;
    this.b.forEach((b, i) => {
      if (b.life <= 0) return;
      b.life -= dt * b.decay;
      b.vy -= 3.2 * dt;
      b.vx *= 0.97;
      b.vz *= 0.97;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      pos.setXYZ(i, b.x, b.y, b.z);
      al.setX(i, Math.max(0, b.life));
    });
    pos.needsUpdate = true;
    al.needsUpdate = true;
  }
}

export class Particles {
  constructor(scene, board) {
    this.pollen = new Drift(board, 260, {
      colors: ['#fff6d8', '#fdf0b0', '#ffffff'], size: [0.035, 0.06], aspect: 1, fall: [-0.02, 0.05], sway: 0.35, float: true, additive: true,
    }, 1);
    this.leaves = new Drift(board, 320, {
      colors: ['#d9772b', '#e8a23a', '#c4472a', '#f2c53d', '#a8552a'], size: [0.09, 0.14], aspect: 2.2, fall: [0.35, 0.65], sway: 1.3,
    }, 2);
    this.snow = new Drift(board, 900, {
      colors: ['#ffffff', '#eef4ff'], size: [0.05, 0.09], aspect: 1, fall: [0.45, 0.9], sway: 0.45,
    }, 3);
    this.fireflies = new Fireflies(board, 110, 4);
    this.burst = new Burst(320);
    for (const s of [this.pollen, this.leaves, this.snow, this.fireflies, this.burst]) scene.add(s.points);
  }

  update(dt, time, palette, sky) {
    shared.uTime.value = time;
    const a = palette.amounts;
    const wind = a.wind;
    this.pollen.update(dt, time, a.pollen * (1 - sky.darkness) * 0.8, wind);
    this.leaves.update(dt, time, a.falling, wind);
    this.snow.update(dt, time, a.snowfall, wind);
    this.fireflies.update(dt, time, a.fireflies * sky.darkness);
    this.burst.update(dt);
  }
}
