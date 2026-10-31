// Efekty přes obraz. Vysoká kvalita: bloom kolem světel, neonů, nitra a slunce, rozmazání rychlostí
// a ztmavení rohů. Ultra navíc: stínění ve škvírách, odrazy na mokré silnici a hloubka ostrosti v záznamu.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

// šum bez opakujícího se vzoru: rotuje vzorky mezi pixely
const NOISE = /* glsl */ `
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }`;

const VIEW_POS = /* glsl */ `
  uniform sampler2D tDepth;
  uniform mat4 invProj;
  vec3 viewAt(vec2 uv) {
    vec4 p = invProj * vec4(uv * 2.0 - 1.0, texture2D(tDepth, uv).r * 2.0 - 1.0, 1.0);
    return p.xyz / p.w;
  }`;

const AO_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform vec2 texel;
  uniform float focal;
  uniform float aspect;
  ${VIEW_POS}
  ${NOISE}
  const int SAMPLES = 10;
  const float RADIUS = 1.7;
  void main() {
    float z = texture2D(tDepth, vUv).r;
    if (z >= 1.0) { gl_FragColor = vec4(1.0); return; }
    vec3 p = viewAt(vUv);
    float dist = -p.z;
    if (dist > 130.0) { gl_FragColor = vec4(1.0); return; }
    // normála z té strany sousedů, která leží na stejné ploše
    vec3 l = viewAt(vUv - vec2(texel.x, 0.0)), r = viewAt(vUv + vec2(texel.x, 0.0));
    vec3 d = viewAt(vUv - vec2(0.0, texel.y)), u = viewAt(vUv + vec2(0.0, texel.y));
    vec3 dx = abs(r.z - p.z) < abs(p.z - l.z) ? r - p : p - l;
    vec3 dy = abs(u.z - p.z) < abs(p.z - d.z) ? u - p : p - d;
    vec3 n = normalize(cross(dx, dy));
    float rad = min(0.09, RADIUS * focal * 0.5 / dist);
    float angle = ign(gl_FragCoord.xy) * 6.2832;
    float occ = 0.0;
    for (int i = 0; i < SAMPLES; i++) {
      float t = (float(i) + 0.5) / float(SAMPLES);
      float a = angle + float(i) * 2.39996;
      vec3 v = viewAt(vUv + vec2(cos(a) / aspect, sin(a)) * rad * sqrt(t)) - p;
      float d2 = dot(v, v);
      float falloff = 1.0 - smoothstep(RADIUS * RADIUS, RADIUS * RADIUS * 4.0, d2);
      occ += max(dot(n, v) - 0.05 - dist * 0.0012, 0.0) / (d2 + 0.08) * falloff;
    }
    float ao = clamp(1.0 - occ / float(SAMPLES) * 2.1, 0.0, 1.0);
    gl_FragColor = vec4(vec3(mix(1.0, ao, 1.0 - smoothstep(70.0, 130.0, dist))), 1.0);
  }`;

const SSR_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tScene;
  uniform mat4 proj;
  uniform vec3 up;
  ${VIEW_POS}
  ${NOISE}
  const int STEPS = 22;
  void main() {
    float rough = texture2D(tScene, vUv).a;
    if (rough > 0.6) { gl_FragColor = vec4(0.0); return; }
    vec3 p = viewAt(vUv);
    vec3 v = normalize(p);
    // lehké zvlnění: mokrá silnice odraz protahuje
    float j = ign(gl_FragCoord.xy);
    vec3 n = normalize(up + vec3((j - 0.5) * 0.02, 0.0, 0.0));
    vec3 ray = reflect(v, n);
    float step = 0.5, hit = 0.0;
    vec3 q = p + ray * step * j;
    vec2 uv = vUv;
    for (int i = 0; i < STEPS; i++) {
      q += ray * step;
      vec4 c = proj * vec4(q, 1.0);
      uv = c.xy / c.w * 0.5 + 0.5;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || c.w < 0.0) break;
      float dz = viewAt(uv).z - q.z;
      if (dz > 0.0 && dz < step * 2.6 + 0.25) { hit = 1.0; break; }
      step *= 1.13;
    }
    if (hit < 0.5) { gl_FragColor = vec4(0.0); return; }
    float fresnel = 0.16 + 0.84 * pow(1.0 - max(dot(-v, n), 0.0), 3.5);
    vec2 edge = smoothstep(vec2(0.0), vec2(0.08), uv) * (1.0 - smoothstep(vec2(0.92), vec2(1.0), uv));
    float gloss = 1.0 - smoothstep(0.06, 0.6, rough);
    float a = fresnel * edge.x * edge.y * gloss;
    gl_FragColor = vec4(texture2D(tScene, uv).rgb * a, a);
  }`;

const FINAL_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tDiffuse;
  uniform vec2 texel;
  uniform vec2 vanish;
  uniform vec2 carPos;
  uniform float carMask;
  uniform float blur;
  uniform float aspect;
  ${NOISE}
  #if HEAVY
  uniform sampler2D tAO;
  uniform sampler2D tSSR;
  uniform float useAO;
  uniform float useSSR;
  uniform float focusDist;
  ${VIEW_POS}
  vec3 bokeh(vec2 uv, float radius, float j) {
    vec3 sum = texture2D(tDiffuse, uv).rgb;
    for (int i = 0; i < 12; i++) {
      float t = (float(i) + 0.5) / 12.0;
      float a = (float(i) + j) * 2.39996;
      sum += texture2D(tDiffuse, uv + vec2(cos(a) / aspect, sin(a)) * radius * sqrt(t)).rgb;
    }
    return sum / 13.0;
  }
  #endif
  void main() {
    vec3 col = texture2D(tDiffuse, vUv).rgb;
    float j = ign(gl_FragCoord.xy);
    #if HEAVY
    if (focusDist > 0.0) {
      float dist = -viewAt(vUv).z;
      float coc = smoothstep(0.22, 1.2, abs(dist - focusDist) / focusDist);
      if (coc > 0.01) col = bokeh(vUv, coc * 0.006, j);
    }
    #endif
    if (blur > 0.0003) {
      // rozmazání od bodu, kam auto míří; vlastní auto a střed obrazu zůstávají ostré
      vec2 dir = vUv - vanish;
      float amount = blur * smoothstep(0.14, 0.62, length(dir * vec2(aspect, 1.0)));
      vec2 fromCar = (vUv - carPos) * vec2(aspect * 0.8, 1.35);
      amount *= mix(1.0, smoothstep(0.12, 0.34, length(fromCar)), carMask);
      if (amount > 0.0003) {
        vec3 sum = col;
        for (int i = 0; i < 6; i++) sum += texture2D(tDiffuse, vUv - dir * amount * (float(i) + j) / 6.0).rgb;
        col = sum / 7.0;
      }
    }
    #if HEAVY
    if (useSSR > 0.5) {
      vec4 r = vec4(0.0);
      for (int i = 0; i < 5; i++) r += texture2D(tSSR, vUv + vec2((float(i) - 2.0) * texel.x * 0.5, (float(i) - 2.0) * texel.y * 3.0));
      r /= 5.0;
      if (r.a > 0.001) col = mix(col, r.rgb / r.a, min(r.a, 0.62));
    }
    if (useAO > 0.5) {
      float ao = texture2D(tAO, vUv + texel * vec2(-1.0, -1.0)).r + texture2D(tAO, vUv + texel * vec2(1.0, -1.0)).r
        + texture2D(tAO, vUv + texel * vec2(-1.0, 1.0)).r + texture2D(tAO, vUv + texel * vec2(1.0, 1.0)).r;
      col *= ao * 0.25;
    }
    #endif
    // rohy obrazu
    vec2 c = (vUv - 0.5) * vec2(1.1, 1.0);
    col *= 1.0 - 0.3 * smoothstep(0.32, 0.86, length(c));
    gl_FragColor = vec4(col, 1.0);
  }`;

class ScreenPass extends Pass {
  constructor(camera, ultra) {
    super();
    this.camera = camera;
    this.ultra = ultra;
    this.heavy = ultra;
    this.wet = 0;
    this.quad = new FullScreenQuad();
    this.shared = {
      tDepth: { value: null },
      invProj: { value: new THREE.Matrix4() },
      aspect: { value: 1 },
    };
    this.final = new THREE.ShaderMaterial({
      defines: { HEAVY: ultra ? 1 : 0 },
      uniforms: {
        ...this.shared,
        tDiffuse: { value: null },
        tAO: { value: null },
        tSSR: { value: null },
        texel: { value: new THREE.Vector2() },
        vanish: { value: new THREE.Vector2(0.5, 0.5) },
        carPos: { value: new THREE.Vector2(0.5, 0.3) },
        carMask: { value: 1 },
        blur: { value: 0 },
        useAO: { value: 0 },
        useSSR: { value: 0 },
        focusDist: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: FINAL_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    if (!ultra) return;
    const half = { type: THREE.HalfFloatType, depthBuffer: false };
    this.aoRT = new THREE.WebGLRenderTarget(4, 4, { ...half, format: THREE.RGBAFormat });
    this.ssrRT = new THREE.WebGLRenderTarget(4, 4, half);
    this.ao = new THREE.ShaderMaterial({
      uniforms: { ...this.shared, texel: { value: new THREE.Vector2() }, focal: { value: 1 } },
      vertexShader: VERT,
      fragmentShader: AO_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.ssr = new THREE.ShaderMaterial({
      uniforms: { ...this.shared, tScene: { value: null }, proj: { value: new THREE.Matrix4() }, up: { value: new THREE.Vector3(0, 1, 0) } },
      vertexShader: VERT,
      fragmentShader: SSR_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.final.uniforms.tAO.value = this.aoRT.texture;
    this.final.uniforms.tSSR.value = this.ssrRT.texture;
  }

  setSize(w, h) {
    this.final.uniforms.texel.value.set(2 / w, 2 / h);
    if (!this.ultra) return;
    const hw = Math.max(1, Math.round(w / 2)), hh = Math.max(1, Math.round(h / 2));
    this.aoRT.setSize(hw, hh);
    this.ssrRT.setSize(hw, hh);
    this.ao.uniforms.texel.value.set(1 / hw, 1 / hh);
  }

  pass(renderer, material, target) {
    this.quad.material = material;
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
  }

  render(renderer, writeBuffer, readBuffer) {
    const f = this.final.uniforms, cam = this.camera;
    f.tDiffuse.value = readBuffer.texture;
    f.aspect.value = cam.aspect;
    if (this.ultra) {
      this.shared.tDepth.value = readBuffer.depthTexture;
      this.shared.invProj.value.copy(cam.projectionMatrixInverse);
      f.useAO.value = f.useSSR.value = 0;
      if (this.heavy) {
        this.ao.uniforms.focal.value = cam.projectionMatrix.elements[5];
        this.pass(renderer, this.ao, this.aoRT);
        f.useAO.value = 1;
        if (this.wet) {
          const s = this.ssr.uniforms;
          s.tScene.value = readBuffer.texture;
          s.proj.value.copy(cam.projectionMatrix);
          s.up.value.set(0, 1, 0).transformDirection(cam.matrixWorldInverse);
          this.pass(renderer, this.ssr, this.ssrRT);
          f.useSSR.value = 1;
        }
      }
    }
    this.pass(renderer, this.final, this.renderToScreen ? null : writeBuffer);
  }

  dispose() {
    this.quad.dispose();
    this.final.dispose();
    if (!this.ultra) return;
    this.ao.dispose();
    this.ssr.dispose();
    this.aoRT.dispose();
    this.ssrRT.dispose();
  }
}

const probe = new THREE.Vector3();

export class Post {
  constructor(renderer, scene, camera, ultra = false) {
    this.renderer = renderer;
    this.camera = camera;
    this.ultra = ultra;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    if (ultra) rt.depthTexture = new THREE.DepthTexture(size.x, size.y, THREE.UnsignedIntType);
    this.composer = new EffectComposer(renderer, rt);
    // scéna se kreslí vždy do prvního bufferu; do druhého jde jen celoobrazovkový průchod a MSAA by ho zbytečně prodražilo
    this.composer.renderTarget2.samples = 0;
    this.composer.renderTarget2.depthTexture = null;
    this.composer.addPass(new RenderPass(scene, camera));
    this.screen = new ScreenPass(camera, ultra);
    this.composer.addPass(this.screen);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.4, 0.5, 1);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.setSize(window.innerWidth, window.innerHeight);
    this.motion = 0;
  }

  get heavy() {
    return this.screen.heavy;
  }

  set heavy(on) {
    this.screen.heavy = on;
  }

  setSize(w, h) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  setBloom({ strength, radius, threshold }) {
    this.bloom.strength = strength;
    this.bloom.radius = radius;
    this.bloom.threshold = threshold;
  }

  setWet(wet) {
    this.screen.wet = wet;
  }

  // car = auto, které kamera sleduje (null mimo jízdu)
  setMotion(car, hood) {
    const f = this.screen.final.uniforms;
    let target = 0;
    if (car) {
      const fast = Math.min(1, Math.max(0, (car.speed - 28) / 42));
      target = fast * fast * 0.075 + (car.nitroActive ? 0.03 : 0);
      probe.set(this.camera.position.x + Math.sin(car.hd) * 500, this.camera.position.y, this.camera.position.z + Math.cos(car.hd) * 500).project(this.camera);
      if (probe.z < 1) f.vanish.value.set(probe.x * 0.5 + 0.5, probe.y * 0.5 + 0.5);
      probe.set(car.x, car.y + 0.6, car.z).project(this.camera);
      f.carPos.value.set(probe.x * 0.5 + 0.5, probe.y * 0.5 + 0.5);
      f.carMask.value = hood ? 0 : 1;
    }
    this.motion += (target - this.motion) * 0.12;
    f.blur.value = this.motion;
  }

  // ostrost na danou vzdálenost, 0 = bez hloubky ostrosti
  setFocus(dist) {
    this.screen.final.uniforms.focusDist.value = this.ultra && this.heavy ? dist : 0;
  }

  render() {
    this.composer.render();
  }

  dispose() {
    this.composer.dispose();
    this.bloom.dispose();
    this.screen.dispose();
  }
}
