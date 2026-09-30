// Částice (kouř, prach, jiskry, plameny) a stopy pneumatik.
import * as THREE from 'three';

const particleVS = /* glsl */ `
  attribute float size;
  attribute vec4 pcolor;
  varying vec4 vColor;
  varying float vFog;
  uniform float uScale;
  uniform float uFogNear;
  uniform float uFogFar;
  void main() {
    vColor = pcolor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
    vFog = smoothstep(uFogNear, uFogFar, -mv.z);
  }`;
const particleFS = /* glsl */ `
  varying vec4 vColor;
  varying float vFog;
  uniform vec3 uFogColor;
  uniform float uAdditive;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float a = smoothstep(0.5, 0.12, d);
    if (a <= 0.0) discard;
    vec3 col = uAdditive > 0.5 ? vColor.rgb : mix(vColor.rgb, uFogColor, vFog);
    float alpha = vColor.a * a * (uAdditive > 0.5 ? (1.0 - vFog) : 1.0);
    gl_FragColor = vec4(col, alpha);
    #include <colorspace_fragment>
  }`;

class ParticlePool {
  constructor(max, additive) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('pcolor', this.colAttr);
    g.setAttribute('size', this.sizeAttr);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uScale: { value: 400 },
        uFogColor: { value: new THREE.Color() },
        uFogNear: { value: 100 },
        uFogFar: { value: 1000 },
        uAdditive: { value: additive ? 1 : 0 },
      },
      vertexShader: particleVS,
      fragmentShader: particleFS,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
  }

  emit(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, drag = 1, grav = 0) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.s0[i] = s0;
    this.s1[i] = s1;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b;
    this.a0[i] = a;
    this.drag[i] = drag;
    this.grav[i] = grav;
  }

  update(dt) {
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        if (this.size[i] !== 0) { this.size[i] = 0; any = true; }
        continue;
      }
      any = true;
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.col[i * 4 + 3] = this.a0[i] * (1 - t) * Math.min(1, t * 8 + 0.2);
    }
    if (any) {
      this.posAttr.needsUpdate = true;
      this.colAttr.needsUpdate = true;
      this.sizeAttr.needsUpdate = true;
    }
  }

  clear() {
    this.life.fill(0);
  }
}

export class Effects {
  constructor(scene, quality) {
    const mul = quality === 'low' ? 0.5 : 1;
    this.smoke = new ParticlePool(Math.round(1400 * mul), false);
    this.glow = new ParticlePool(Math.round(900 * mul), true);
    scene.add(this.smoke.points, this.glow.points);
    this.skids = new SkidMarks(scene, quality === 'low' ? 1500 : 3500);
    this.rng = Math.random;
    this.quality = quality;
  }

  setView(camera, rendererHeight, fog) {
    const scale = rendererHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
    for (const p of [this.smoke, this.glow]) {
      p.material.uniforms.uScale.value = scale;
      if (fog) {
        p.material.uniforms.uFogColor.value.copy(fog.color);
        p.material.uniforms.uFogNear.value = fog.near;
        p.material.uniforms.uFogFar.value = fog.far;
      }
    }
  }

  tireSmoke(x, y, z, vx, vz, amount, color) {
    const r = this.rng;
    this.smoke.emit(
      x + (r() - 0.5) * 0.4, y + 0.25, z + (r() - 0.5) * 0.4,
      vx * 0.25 + (r() - 0.5) * 1.5, 0.6 + r() * 1.2, vz * 0.25 + (r() - 0.5) * 1.5,
      1.2 + r() * 1.2, 0.8, 3.6 + amount * 2.5,
      color[0], color[1], color[2], 0.32 * Math.min(1, amount), 1.4, -0.3,
    );
  }

  dust(x, y, z, vx, vz, color) {
    const r = this.rng;
    this.smoke.emit(
      x + (r() - 0.5) * 0.6, y + 0.2, z + (r() - 0.5) * 0.6,
      vx * 0.3 + (r() - 0.5) * 2, 0.8 + r() * 1.5, vz * 0.3 + (r() - 0.5) * 2,
      1.0 + r() * 1.0, 1.0, 4.5,
      color[0], color[1], color[2], 0.45, 1.2, -0.2,
    );
  }

  sparks(x, y, z, nx, nz, strength) {
    const r = this.rng;
    const n = Math.min(26, 4 + strength * 1.5);
    for (let i = 0; i < n; i++) {
      this.glow.emit(
        x, y + 0.4 + r() * 0.4, z,
        -nx * (2 + r() * 6) + (r() - 0.5) * 7, 1 + r() * 4, -nz * (2 + r() * 6) + (r() - 0.5) * 7,
        0.25 + r() * 0.35, 0.35, 0.05,
        1.0, 0.72 + r() * 0.2, 0.3, 1.0, 0.5, 9,
      );
    }
  }

  nitroFlame(x, y, z, bx, bz, vx, vz) {
    const r = this.rng;
    for (let i = 0; i < 3; i++) {
      const blue = i === 0;
      this.glow.emit(
        x + (r() - 0.5) * 0.08, y + (r() - 0.5) * 0.08, z + (r() - 0.5) * 0.08,
        vx + bx * (6 + r() * 6), (r() - 0.2) * 0.6, vz + bz * (6 + r() * 6),
        0.08 + r() * 0.1, blue ? 0.5 : 0.8, 0.12,
        blue ? 0.3 : 1.0, blue ? 0.5 : 0.5 + r() * 0.2, blue ? 1.0 : 0.15, 0.7, 2, 0,
      );
    }
  }

  explosion(x, y, z) {
    const r = this.rng;
    for (let i = 0; i < 40; i++) {
      const a = r() * Math.PI * 2, u = r() * 2 - 1, sp = 4 + r() * 12;
      const s = Math.sqrt(1 - u * u);
      this.glow.emit(x, y + 0.8, z, Math.cos(a) * s * sp, Math.abs(u) * sp * 0.8 + 2, Math.sin(a) * s * sp,
        0.4 + r() * 0.5, 2.2, 0.4, 1, 0.55 + r() * 0.3, 0.15, 1, 2.5, 4);
    }
    for (let i = 0; i < 22; i++) {
      this.smoke.emit(x + (r() - 0.5) * 2, y + 0.8 + r(), z + (r() - 0.5) * 2, (r() - 0.5) * 5, 2 + r() * 3, (r() - 0.5) * 5,
        1.5 + r() * 1.5, 2, 7, 0.16, 0.15, 0.15, 0.55, 1.5, -0.4);
    }
  }

  confetti(x, y, z) {
    const r = this.rng;
    const cols = [[1, 0.25, 0.2], [1, 0.8, 0.1], [0.2, 0.6, 1], [0.2, 0.9, 0.4], [1, 1, 1], [0.8, 0.3, 1]];
    for (let i = 0; i < 160; i++) {
      const c = cols[i % cols.length];
      const a = r() * Math.PI * 2, sp = 3 + r() * 9;
      this.glow.emit(x + (r() - 0.5) * 3, y + 2 + r() * 2, z + (r() - 0.5) * 3,
        Math.cos(a) * sp, 8 + r() * 10, Math.sin(a) * sp,
        2.2 + r() * 1.5, 0.35, 0.3, c[0], c[1], c[2], 1, 1.2, 7);
    }
  }

  update(dt) {
    this.smoke.update(dt);
    this.glow.update(dt);
    this.skids.flush();
  }

  clear() {
    this.smoke.clear();
    this.glow.clear();
    this.skids.clear();
  }

  dispose(scene) {
    scene.remove(this.smoke.points, this.glow.points, this.skids.mesh);
    this.smoke.points.geometry.dispose();
    this.glow.points.geometry.dispose();
    this.skids.mesh.geometry.dispose();
  }
}

// Stopy pneumatik: kruhový buffer čtyřúhelníků položených na silnici.
class SkidMarks {
  constructor(scene, max) {
    this.max = max;
    this.pos = new Float32Array(max * 4 * 3);
    this.col = new Float32Array(max * 4 * 4);
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) {
      const v = i * 4;
      idx.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6);
    }
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('color', this.colAttr);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.cursor = 0;
    this.dirty = false;
  }

  add(a, b, width, alpha, rx, rz) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const w = width / 2;
    const p = this.pos;
    const o = i * 12;
    const y0 = a[1] + 0.03, y1 = b[1] + 0.03;
    p[o] = a[0] - rx * w; p[o + 1] = y0; p[o + 2] = a[2] - rz * w;
    p[o + 3] = a[0] + rx * w; p[o + 4] = y0; p[o + 5] = a[2] + rz * w;
    p[o + 6] = b[0] + rx * w; p[o + 7] = y1; p[o + 8] = b[2] + rz * w;
    p[o + 9] = b[0] - rx * w; p[o + 10] = y1; p[o + 11] = b[2] - rz * w;
    const c = this.col;
    for (let v = 0; v < 4; v++) {
      const q = i * 16 + v * 4;
      c[q] = 0.03; c[q + 1] = 0.03; c[q + 2] = 0.03; c[q + 3] = alpha;
    }
    this.dirty = true;
  }

  flush() {
    if (!this.dirty) return;
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.dirty = false;
  }

  clear() {
    this.pos.fill(0);
    this.col.fill(0);
    this.dirty = true;
  }
}
