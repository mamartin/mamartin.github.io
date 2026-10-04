// Postprocessing: záře (svatojánské mušky, slunce), tilt-shift pro dojem makety a jemná vinětace.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { HorizontalTiltShiftShader } from 'three/addons/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/addons/shaders/VerticalTiltShiftShader.js';

const VignetteShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 } },
  vertexShader: /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uTime;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  vec2 q = vUv - 0.5;
  float v = smoothstep(0.9, 0.25, length(q * vec2(1.0, 0.85)));
  c.rgb *= mix(0.74, 1.0, v);
  float n = fract(sin(dot(vUv * 731.0 + fract(uTime) * 17.0, vec2(12.9898, 78.233))) * 43758.5453);
  c.rgb += (n - 0.5) * 0.018;
  gl_FragColor = c;
}`,
};

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.65, 1.15);
    this.composer.addPass(this.bloom);
    this.tiltH = new ShaderPass(HorizontalTiltShiftShader);
    this.tiltV = new ShaderPass(VerticalTiltShiftShader);
    this.composer.addPass(this.tiltH);
    this.composer.addPass(this.tiltV);
    this.composer.addPass(new OutputPass());
    this.vignette = new ShaderPass(VignetteShader);
    this.composer.addPass(this.vignette);
    this.setSize(window.innerWidth, window.innerHeight);
  }

  setSize(w, h) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.tiltH.uniforms.h.value = 3.2 / (w * pr);
    this.tiltV.uniforms.v.value = 3.2 / (h * pr);
    this.tiltH.uniforms.r.value = this.tiltV.uniforms.r.value = 0.5;
  }

  setTilt(on) {
    this.tiltH.enabled = this.tiltV.enabled = on;
  }

  render(time) {
    this.vignette.uniforms.uTime.value = time;
    this.composer.render();
  }
}
