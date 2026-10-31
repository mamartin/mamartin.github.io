// Proměnlivé počasí: závod začne za sucha (za jasna) a během něj se postupně rozprší
// nebo na zimní trati rozsněží. Prolínají se mlha, obloha, světla, vzhled silnice,
// déšť nebo sníh a přilnavost aut.
import * as THREE from 'three';
import { wetBiome, snowBiome } from './biomes.js';
import { buildRain, buildSnow } from './scenery.js';
import { clamp } from './rng.js';

const RAMP = 30; // za kolik sekund se počasí úplně změní

const lerp = (a, b, t) => a + (b - a) * t;
const col = (hex) => new THREE.Color(hex);

export class WeatherShift {
  // w = svět z loadWorld (postavený za sucha), kind = 'rain' | 'snow'
  constructor(w, kind, { scene, renderer, quality }) {
    this.w = w;
    this.kind = kind;
    this.scene = scene;
    this.renderer = renderer;
    const A = w.biome;
    const B = kind === 'snow' ? snowBiome(A) : wetBiome(A);
    this.A = { ...A, track: { ...A.track } };
    this.B = B;
    this.blend = 0;
    this.started = false;
    this.done = false;
    const n = quality === 'low' ? 1 : quality === 'medium' ? 1.7 : 2.7;
    if (kind === 'rain') {
      w.rain = buildRain(Math.round(1500 * n));
      this.particles = w.rain.points;
      this.perItem = 2;
    } else {
      w.snow = buildSnow(Math.round(2200 * n));
      this.particles = w.snow.points;
      this.perItem = 1;
    }
    this.total = this.particles.geometry.attributes.position.count / this.perItem;
    w.group.add(this.particles);
    const sky = w.sky.getObjectByName('sky');
    this.skyU = sky?.material.uniforms;
    this.road = w.track.roadMat;
    this.roadColor = this.road?.color.clone();
    this.roadRough = this.road?.roughness;
    this.from = {
      fog: col(A.fog.color), top: col(A.sky.top), horizon: col(A.sky.horizon), bottom: col(A.sky.bottom),
      cloud: col(A.clouds ?? '#ffffff'),
    };
    this.to = {
      fog: col(B.fog.color), top: col(B.sky.top), horizon: col(B.sky.horizon), bottom: col(B.sky.bottom),
      cloud: col(B.clouds ?? A.clouds ?? '#ffffff'),
    };
    this.tmp = new THREE.Color();
    this.apply(0);
  }

  // kdy se počasí začne měnit: v půlce prvního kola vedoucího (u jednoho kola po 25 s)
  update(dt, race) {
    if (!this.started && race.state === 'running') {
      const leader = Math.max(...race.cars.map((c) => c.progress));
      const trigger = race.laps > 1 ? race.track.L * 0.6 : race.track.L * 0.35;
      if (leader > trigger) {
        this.started = true;
        return this.kind === 'snow' ? 'Začíná sněžit – silnice bude klouzat' : 'Začíná pršet – silnice bude klouzat';
      }
    }
    if (this.started && !this.done) {
      this.apply(Math.min(1, this.blend + dt / RAMP));
      if (this.blend >= 1) this.done = true;
    }
    return null;
  }

  apply(t) {
    this.blend = t;
    const { w, A, B, from, to } = this;
    // mlha a obloha se mění rychleji než silnice: nejdřív se zatáhne, pak začne pršet
    const sky = clamp(t * 1.6, 0, 1);
    const fall = clamp((t - 0.15) / 0.85, 0, 1);
    const fog = this.scene.fog;
    fog.color.copy(from.fog).lerp(to.fog, sky);
    fog.near = lerp(A.fog.near, B.fog.near, sky);
    fog.far = lerp(A.fog.far, B.fog.far, sky);
    this.scene.background?.copy?.(fog.color);
    const u = this.skyU;
    if (u) {
      u.top.value.copy(from.top).lerp(to.top, sky);
      u.horizon.value.copy(from.horizon).lerp(to.horizon, sky);
      u.bottom.value.copy(from.bottom).lerp(to.bottom, sky);
      u.fogColor.value.copy(fog.color);
      u.cloudColor.value.copy(from.cloud).lerp(to.cloud, sky);
      u.glow.value = lerp(A.sky.glow, B.sky.glow, sky);
      u.cover.value = lerp(A.cloudCover ?? 0.5, B.cloudCover ?? 0.2, sky);
      u.sunShow.value = 1 - sky;
    }
    w.lights.sun.intensity = lerp(A.sun.intensity, B.sun.intensity, sky);
    w.lights.hemi.intensity = lerp(A.hemi.intensity, B.hemi.intensity, sky);
    this.renderer.toneMappingExposure = lerp(A.exposure, B.exposure, sky);
    // déšť / sníh houstne
    this.particles.geometry.setDrawRange(0, Math.round(this.total * fall) * this.perItem);
    this.particles.visible = fall > 0.001;
    // silnice: mokrá ztmavne a leskne se, zasněžená zesvětlí
    if (this.road) {
      if (this.kind === 'rain') {
        this.road.color.copy(this.roadColor).multiplyScalar(lerp(1, 0.62, fall));
        if (this.road.isMeshStandardMaterial) this.road.roughness = lerp(this.roadRough, this.roadRough * 0.45, fall);
      } else if (this.road.emissive) {
        this.road.emissive.setRGB(0.19, 0.21, 0.24).multiplyScalar(fall);
      }
    }
    // přilnavost: biome sdílí svět i všechna auta
    const b = w.biome;
    b.roadGrip = lerp(A.roadGrip ?? 1, B.roadGrip ?? 1, fall);
    b.offGrip = lerp(A.offGrip ?? 0.6, B.offGrip ?? 0.6, fall);
    if (this.kind === 'rain') {
      b.wet = fall > 0.5;
      w.wet = fall > 0.35; // zvuk deště a sprška od kol
    }
  }

  reset() {
    this.started = false;
    this.done = false;
    this.apply(0);
  }
}
