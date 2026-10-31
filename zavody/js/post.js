// Efekty přes obraz. Vysoká kvalita: bloom kolem světel, neonů, nitra a slunce, rozmazání rychlostí
// a ztmavení rohů. Ultra navíc: stínění ve škvírách, odrazy na mokré silnici a hloubka ostrosti v záznamu.
// Všechno se skládá v jediném průchodu rovnou na obrazovku: každý další celoobrazovkový průchod přes
// velký buffer je na 4K a retině dražší než celá scéna.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

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
  uniform sampler2D tBloom;
  uniform float bloom;
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
    col += texture2D(tBloom, vUv).rgb * bloom;
    // rohy obrazu
    vec2 c = (vUv - 0.5) * vec2(1.1, 1.0);
    col *= 1.0 - 0.3 * smoothstep(0.32, 0.86, length(c));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    gl_FragColor.rgb += (j - 0.5) / 255.0; // úsporný buffer má méně odstínů, šum schová pruhy v přechodech
  }`;

// bloom: zmenšování a zvětšování po patrech je mnohem levnější než velké rozostření v plném rozlišení
const BLOOM_DOWN = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tex;
  uniform vec2 px;
  uniform float threshold;
  vec3 bright(vec2 o) {
    vec3 c = min(texture2D(tex, vUv + o * px).rgb, vec3(12.0));
    #if BRIGHT
    c *= smoothstep(threshold, threshold + 0.3, dot(c, vec3(0.2126, 0.7152, 0.0722)));
    #endif
    return c;
  }
  void main() {
    vec3 c = bright(vec2(0.0)) * 4.0 + bright(vec2(-1.0, -1.0)) + bright(vec2(1.0, -1.0)) + bright(vec2(-1.0, 1.0)) + bright(vec2(1.0, 1.0));
    gl_FragColor = vec4(c / 8.0, 1.0);
  }`;

const BLOOM_UP = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tex;
  uniform sampler2D add;
  uniform vec2 px;
  vec3 at(float x, float y) { return texture2D(tex, vUv + vec2(x, y) * px).rgb; }
  void main() {
    vec3 c = at(-2.0, 0.0) + at(2.0, 0.0) + at(0.0, -2.0) + at(0.0, 2.0)
      + 2.0 * (at(-1.0, -1.0) + at(1.0, -1.0) + at(-1.0, 1.0) + at(1.0, 1.0));
    gl_FragColor = vec4(c / 12.0 + texture2D(add, vUv).rgb, 1.0);
  }`;

const BLOOM_LEVELS = 5;

const screenMaterial = (fragmentShader, uniforms, defines = {}) => new THREE.ShaderMaterial({
  uniforms, defines, vertexShader: VERT, fragmentShader, depthTest: false, depthWrite: false,
});

const probe = new THREE.Vector3();

export class Post {
  constructor(renderer, scene, camera, ultra = false) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.ultra = ultra;
    this.heavy = ultra;
    this.wet = false;
    this.motion = 0;
    this.compact = renderer.extensions.has('EXT_color_buffer_float');
    this.quad = new FullScreenQuad();
    this.rt = this.hdrTarget({ samples: 4, depthBuffer: true });
    if (ultra) this.rt.depthTexture = new THREE.DepthTexture(4, 4, THREE.UnsignedIntType);
    this.down = Array.from({ length: BLOOM_LEVELS }, () => this.hdrTarget());
    this.up = Array.from({ length: BLOOM_LEVELS - 1 }, () => this.hdrTarget());
    const blurUniforms = () => ({ tex: { value: null }, px: { value: new THREE.Vector2() }, threshold: { value: 1 } });
    this.brightMat = screenMaterial(BLOOM_DOWN, blurUniforms(), { BRIGHT: 1 });
    this.downMat = screenMaterial(BLOOM_DOWN, blurUniforms(), { BRIGHT: 0 });
    this.upMat = screenMaterial(BLOOM_UP, { ...blurUniforms(), add: { value: null } });
    this.shared = { tDepth: { value: null }, invProj: { value: new THREE.Matrix4() }, aspect: { value: 1 } };
    this.final = screenMaterial(FINAL_FRAG, {
      ...this.shared,
      tDiffuse: { value: this.rt.texture },
      tBloom: { value: this.up[0].texture },
      bloom: { value: 0 },
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
    }, { HEAVY: ultra ? 1 : 0 });
    if (ultra) {
      this.aoRT = new THREE.WebGLRenderTarget(4, 4, { format: THREE.RedFormat, depthBuffer: false });
      this.ssrRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
      this.ao = screenMaterial(AO_FRAG, { ...this.shared, texel: { value: new THREE.Vector2() }, focal: { value: 1 } });
      this.ssr = screenMaterial(SSR_FRAG, { ...this.shared, tScene: { value: null }, proj: { value: new THREE.Matrix4() }, up: { value: new THREE.Vector3() } });
      this.final.uniforms.tAO.value = this.aoRT.texture;
      this.final.uniforms.tSSR.value = this.ssrRT.texture;
    }
    this.setSize();
  }

  // bez alfa kanálu má pixel polovic bajtů a celé skládání je znatelně rychlejší
  hdrTarget(options = {}) {
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false, ...options });
    this.packTexture(rt, true);
    return rt;
  }

  packTexture(rt, compact) {
    const on = compact && this.compact;
    rt.texture.format = on ? THREE.RGBFormat : THREE.RGBAFormat;
    rt.texture.internalFormat = on ? 'R11F_G11F_B10F' : null;
  }

  setSize() {
    const { x: w, y: h } = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.rt.setSize(w, h);
    const level = (i) => [Math.max(1, w >> (i + 1)), Math.max(1, h >> (i + 1))];
    this.down.forEach((rt, i) => rt.setSize(...level(i)));
    this.up.forEach((rt, i) => rt.setSize(...level(i)));
    this.final.uniforms.texel.value.set(2 / w, 2 / h);
    if (!this.ultra) return;
    const [hw, hh] = level(0);
    this.aoRT.setSize(hw, hh);
    this.ssrRT.setSize(hw, hh);
    this.ao.uniforms.texel.value.set(1 / hw, 1 / hh);
  }

  setBloom({ strength, threshold }) {
    this.final.uniforms.bloom.value = strength * 0.6;
    this.brightMat.uniforms.threshold.value = threshold;
  }

  // odrazy na mokré silnici čtou její hrubost z alfa kanálu, jen tehdy je potřeba
  setWet(wet) {
    this.wet = !!wet;
    if (!this.ultra) return;
    this.packTexture(this.rt, !this.wet);
    this.rt.dispose();
  }

  // car = auto, které kamera sleduje (null mimo jízdu)
  setMotion(car, hood) {
    const f = this.final.uniforms;
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
    this.final.uniforms.focusDist.value = this.ultra && this.heavy ? dist : 0;
  }

  draw(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.quad.render(this.renderer);
  }

  renderBloom() {
    let from = this.rt;
    this.down.forEach((rt, i) => {
      const mat = i === 0 ? this.brightMat : this.downMat;
      mat.uniforms.tex.value = from.texture;
      mat.uniforms.px.value.set(1 / from.width, 1 / from.height);
      this.draw(mat, rt);
      from = rt;
    });
    const u = this.upMat.uniforms;
    for (let i = this.up.length - 1; i >= 0; i--) {
      u.tex.value = from.texture;
      u.add.value = this.down[i].texture;
      u.px.value.set(0.5 / from.width, 0.5 / from.height);
      this.draw(this.upMat, this.up[i]);
      from = this.up[i];
    }
  }

  renderHeavy() {
    const f = this.final.uniforms, cam = this.camera;
    this.shared.tDepth.value = this.rt.depthTexture;
    this.shared.invProj.value.copy(cam.projectionMatrixInverse);
    this.ao.uniforms.focal.value = cam.projectionMatrix.elements[5];
    this.draw(this.ao, this.aoRT);
    f.useAO.value = 1;
    if (!this.wet) return;
    const s = this.ssr.uniforms;
    s.tScene.value = this.rt.texture;
    s.proj.value.copy(cam.projectionMatrix);
    s.up.value.set(0, 1, 0).transformDirection(cam.matrixWorldInverse);
    this.draw(this.ssr, this.ssrRT);
    f.useSSR.value = 1;
  }

  render() {
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, this.camera);
    this.present(true);
  }

  // rozdělená obrazovka: scéna se kreslí po částech do společného bufferu
  setView(x, y, w, h) {
    const pr = this.renderer.getPixelRatio();
    this.rt.viewport.set(Math.round(x * pr), Math.round(y * pr), Math.round(w * pr), Math.round(h * pr));
    this.rt.scissor.copy(this.rt.viewport);
    this.rt.scissorTest = true;
    this.renderer.setRenderTarget(this.rt);
  }

  // složí hotovou scénu na obrazovku; effects = efekty závislé na jedné kameře
  present(effects = false) {
    const f = this.final.uniforms;
    f.aspect.value = this.camera.aspect;
    f.useAO.value = f.useSSR.value = 0;
    if (!effects) {
      f.blur.value = f.focusDist.value = 0;
      this.rt.viewport.set(0, 0, this.rt.width, this.rt.height);
      this.rt.scissorTest = false;
    } else if (this.ultra && this.heavy) this.renderHeavy();
    this.renderBloom();
    this.draw(this.final, null);
  }

  dispose() {
    this.quad.dispose();
    for (const m of [this.final, this.brightMat, this.downMat, this.upMat, this.ao, this.ssr]) m?.dispose();
    for (const rt of [this.rt, ...this.down, ...this.up, this.aoRT, this.ssrRT]) rt?.dispose();
  }
}
