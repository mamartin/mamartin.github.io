// Obloha, slunce, měsíc a hvězdy + světla scény podle denní doby a ročního období.
import * as THREE from 'three';
import { smoothstep } from '../core/rng.js';

// Klíčové stavy oblohy podle výšky slunce nad obzorem (sin elevace).
const STOPS = [
  { e: -0.4, zenith: '#060b1c', horizon: '#141f3c', ground: '#0a1226', sun: '#000000', sunI: 0, hemi: 0.55 },
  { e: -0.1, zenith: '#16234a', horizon: '#6a5a7a', ground: '#262a48', sun: '#ff7a4a', sunI: 0, hemi: 0.55 },
  { e: 0.0, zenith: '#34558c', horizon: '#f29a66', ground: '#6c6c9c', sun: '#ff9550', sunI: 0.9, hemi: 0.6 },
  { e: 0.14, zenith: '#4a80c0', horizon: '#f6d0a4', ground: '#7f95c4', sun: '#ffcf9c', sunI: 2.0, hemi: 0.85 },
  { e: 0.45, zenith: '#3d84d2', horizon: '#cfe3ee', ground: '#6aa4d4', sun: '#fff3e0', sunI: 2.7, hemi: 1.0 },
  { e: 1.0, zenith: '#3a7fcf', horizon: '#c6def0', ground: '#66a2d4', sun: '#ffffff', sunI: 2.9, hemi: 1.05 },
].map((s) => ({ ...s, zenith: new THREE.Color(s.zenith), horizon: new THREE.Color(s.horizon), ground: new THREE.Color(s.ground), sun: new THREE.Color(s.sun) }));

const SKY_VS = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FS = /* glsl */ `
uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunColor;
uniform float uStars, uTime, uMoon;
varying vec3 vDir;
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 col = y > 0.0 ? mix(uHorizon, uZenith, pow(y, 0.5)) : mix(uHorizon, uGround, pow(-y, 0.55));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (smoothstep(0.9985, 0.9993, sd) * 6.0 + pow(sd, 14.0) * 0.4 + pow(sd, 3.0) * 0.12);
  float md = max(dot(d, -uSunDir), 0.0);
  col += vec3(0.85, 0.9, 1.0) * (smoothstep(0.9991, 0.9995, md) * 2.2 + pow(md, 80.0) * 0.18) * uMoon;
  if (uStars > 0.001 && y > 0.0) {
    vec3 g = d * 180.0;
    vec3 cell = floor(g);
    float h = hash(cell);
    float star = step(0.993, h) * smoothstep(0.42, 0.0, length(fract(g) - 0.5));
    float tw = 0.65 + 0.35 * sin(uTime * 2.3 + h * 80.0);
    col += vec3(0.9, 0.95, 1.0) * star * tw * uStars * smoothstep(0.0, 0.25, y) * 1.6;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class Sky {
  constructor(scene) {
    this.uniforms = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uStars: { value: 0 },
      uMoon: { value: 0 },
      uTime: { value: 0 },
    };
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(500, 32, 16),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, fog: false }),
    );
    dome.renderOrder = -1;
    dome.frustumCulled = false;
    scene.add(dome);
    this.dome = dome;

    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -15;
    sc.right = sc.top = 15;
    sc.near = 1;
    sc.far = 90;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.025;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x5a4630, 1);
    scene.add(this.hemi);

    scene.fog = new THREE.Fog(0xcfe3ee, 50, 150);
    this.fog = scene.fog;
    this.darkness = 0;
    this.sunDir = new THREE.Vector3();
    this.horizon = new THREE.Color();
    this._tint = new THREE.Color();
    this._tmp = { zenith: new THREE.Color(), horizon: new THREE.Color(), ground: new THREE.Color(), sun: new THREE.Color() };
  }

  /**
   * @param {number} tod denní doba 0..1 (0 = půlnoc, 0.25 = východ, 0.5 = poledne, 0.75 = západ)
   */
  update(tod, palette, time) {
    const th = (tod - 0.25) * Math.PI * 2;
    const dir = this.sunDir.set(Math.cos(th), Math.sin(th) * 0.82, 0.42).normalize();
    dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.7);
    const e = dir.y;

    // Interpolace mezi klíčovými stavy oblohy.
    let i = 0;
    while (i < STOPS.length - 2 && e > STOPS[i + 1].e) i++;
    const A = STOPS[i], B = STOPS[i + 1];
    const t = smoothstep(A.e, B.e, e);
    const k = this._tmp;
    for (const key of ['zenith', 'horizon', 'ground', 'sun']) k[key].lerpColors(A[key], B[key], t);
    const sunI = A.sunI + (B.sunI - A.sunI) * t;
    const hemiI = A.hemi + (B.hemi - A.hemi) * t;

    this._tint.copy(palette.colors.sky);
    k.zenith.multiply(this._tint);
    k.horizon.multiply(this._tint);

    const u = this.uniforms;
    u.uZenith.value.copy(k.zenith);
    u.uHorizon.value.copy(k.horizon);
    u.uGround.value.copy(k.ground);
    u.uSunDir.value.copy(dir);
    u.uSunColor.value.copy(k.sun).multiplyScalar(smoothstep(-0.12, 0.02, e));
    this.darkness = 1 - smoothstep(-0.16, 0.06, e);
    u.uStars.value = this.darkness;
    u.uMoon.value = this.darkness;
    u.uTime.value = time;
    this.horizon.copy(k.horizon);

    // Ve dne svítí slunce, v noci tlumené modré světlo měsíce z opačné strany.
    const moonI = 1.1 * smoothstep(-0.02, -0.2, e);
    const useSun = sunI >= moonI;
    const lightDir = useSun ? dir : dir.clone().negate();
    this.sun.position.copy(lightDir).multiplyScalar(40);
    this.sun.target.position.set(0, 0, 0);
    if (useSun) this.sun.color.copy(k.sun);
    else this.sun.color.set('#9fb6ff');
    this.sun.intensity = useSun ? sunI : moonI;

    this.hemi.color.copy(k.zenith).lerp(k.horizon, 0.35);
    this.hemi.groundColor.set('#5a4630').multiplyScalar(0.35 + hemiI * 0.4);
    this.hemi.intensity = hemiI;
    this.fog.color.copy(k.horizon);
  }
}
