// Záznam závodu: poloha a stav všech aut 20× za sekundu a přehrávání s TV kamerami u trati
// nebo s kamerou za autem.
import * as THREE from 'three';
import { angleDiff, lerp, clamp } from './rng.js';

const RATE = 20;
const F = 10; // x, y, z, směr, sklon, náklon, natočení kol, otočení kol, ujetá dráha, příznaky
const MAX_FRAMES = RATE * 60 * 15;

export class ReplayRecorder {
  constructor(cars) {
    this.cars = cars;
    this.data = cars.map(() => []);
    this.frames = 0;
    this.acc = 1 / RATE;
  }

  sample(dt) {
    this.acc += dt;
    if (this.acc < 1 / RATE || this.frames >= MAX_FRAMES) return;
    this.acc -= 1 / RATE;
    this.cars.forEach((c, k) => {
      const braking = c.controls.brake > 0.1 && c.vLong > 0.5;
      this.data[k].push(c.x, c.y, c.z, c.hd, c.pitch, c.roll, c.steer, c.wheelRot, c.progress, (c.nitroActive ? 1 : 0) | (braking ? 2 : 0));
    });
    this.frames++;
  }

  get duration() {
    return Math.max(0, (this.frames - 1) / RATE);
  }
}

// stav aut, který přehrávání přepíše a po něm se vrátí
const SNAP = ['x', 'y', 'z', 'px', 'py', 'pz', 'hd', 'phd', 'vx', 'vz', 'yawRate', 'steer', 'speed', 'vLong', 'pitch', 'roll',
  'wheelRot', 'progress', 'nitroActive', 'skidding', 'surface', 'impact', 'ghostTimer'];

export class ReplayPlayer {
  constructor(rec, cars, track, terrain) {
    this.rec = rec;
    this.cars = cars;
    this.track = track;
    this.t = 0;
    this.speed = 1;
    this.playing = true;
    this.cam = 'tv';
    this.follow = 'player';
    this.cut = true;
    this.spot = -1;
    this.look = new THREE.Vector3();
    this.saved = cars.map((c) => {
      const o = {};
      for (const k of SNAP) o[k] = c[k];
      o.brake = c.controls.brake;
      return o;
    });
    this.spots = buildSpots(track, terrain);
  }

  get duration() {
    return this.rec.duration;
  }

  seek(t) {
    this.t = clamp(t, 0, this.duration);
    this.cut = true;
  }

  update(dt) {
    if (this.playing) {
      this.t += dt * this.speed;
      if (this.t >= this.duration) {
        this.t = this.duration;
        this.playing = false;
      }
    }
    this.apply();
  }

  apply() {
    const f = this.t * RATE;
    const i0 = Math.min(Math.floor(f), Math.max(0, this.rec.frames - 1));
    const i1 = Math.min(this.rec.frames - 1, i0 + 1);
    const u = f - i0;
    this.cars.forEach((c, k) => {
      const d = this.rec.data[k];
      const a = i0 * F, b = i1 * F;
      const L = (j) => lerp(d[a + j], d[b + j], u);
      c.x = c.px = L(0);
      c.y = c.py = L(1);
      c.z = c.pz = L(2);
      c.hd = c.phd = d[a + 3] + angleDiff(d[a + 3], d[b + 3]) * u;
      c.pitch = L(4);
      c.roll = L(5);
      c.steer = L(6);
      c.wheelRot = L(7);
      c.progress = L(8);
      const flags = d[a + 9];
      // rychlost z rozdílu snímků (kamera za autem a světla brzd)
      c.vx = (d[b] - d[a]) * RATE;
      c.vz = (d[b + 2] - d[a + 2]) * RATE;
      c.speed = c.vLong = Math.hypot(c.vx, c.vz);
      c.nitroActive = !!(flags & 1);
      c.controls.brake = flags & 2 ? 1 : 0;
      c.skidding = false;
      c.impact = 0;
      c.surface = 0;
      c.ghostTimer = 0;
      c.render(1);
    });
  }

  // sledovaný vůz: hráč, vedoucí, nebo konkrétní auto (index)
  target() {
    if (typeof this.follow === 'number') return this.cars[this.follow] || this.cars[0];
    if (this.follow === 'leader') return this.cars.reduce((a, b) => (b.progress > a.progress ? b : a));
    return this.cars.find((c) => c.isPlayer) || this.cars[0];
  }

  // kamera: TV kamery u trati se přepínají střihem, za autem plynule
  updateCamera(dt, camera, rig) {
    const car = this.target();
    const L = this.track.L;
    let fov;
    if (this.cam === 'tv') {
      // kamera, kterou auto právě míjí (nebo k ní jede), střih po 30 m za ní
      const s = ((car.progress % L) + L) % L;
      let best = 0, bestRel = Infinity;
      this.spots.forEach((p, k) => {
        const rel = (((p.s - s + 30) % L) + L) % L;
        if (rel < bestRel) {
          bestRel = rel;
          best = k;
        }
      });
      if (best !== this.spot) {
        this.spot = best;
        this.cut = true;
      }
      const p = this.spots[best];
      camera.position.set(p.x, p.y, p.z);
      const dist = camera.position.distanceTo(car.mesh.root.position);
      fov = clamp((2 * Math.atan(7 / Math.max(dist, 1)) * 180) / Math.PI, 9, 58);
      this.aim(dt, car.x, car.y + 0.8, car.z, 10);
    } else {
      const s = Math.sin(car.hd), c = Math.cos(car.hd);
      const tx = car.x - s * 7.5, ty = car.y + 2.6, tz = car.z - c * 7.5;
      const k = this.cut ? 1 : Math.min(1, dt * 6);
      camera.position.x += (tx - camera.position.x) * k;
      camera.position.y += (ty - camera.position.y) * k;
      camera.position.z += (tz - camera.position.z) * k;
      fov = 62;
      this.aim(dt, car.x + s * 3, car.y + 1, car.z + c * 3, 12);
    }
    this.cut = false;
    camera.lookAt(this.look);
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    // slunce a stíny míří tam, kam se díváme
    rig.pos.copy(camera.position);
    rig.look.copy(this.look);
    rig.fov = fov;
  }

  aim(dt, x, y, z, rate) {
    if (this.cut) this.look.set(x, y, z);
    else {
      const k = Math.min(1, dt * rate);
      this.look.x += (x - this.look.x) * k;
      this.look.y += (y - this.look.y) * k;
      this.look.z += (z - this.look.z) * k;
    }
  }

  // vrátí auta do stavu před přehráváním
  restore() {
    this.cars.forEach((c, k) => {
      const o = this.saved[k];
      for (const key of SNAP) c[key] = o[key];
      c.controls.brake = o.brake;
      this.track.project(c.x, c.z, -1, c.proj);
      c.render(1);
    });
  }
}

// TV kamery: po trati zhruba každých 85 m, na vnější straně zatáčky, kus nad terénem
function buildSpots(track, terrain) {
  const n = Math.max(6, Math.round(track.L / 85));
  const spots = [];
  for (let k = 0; k < n; k++) {
    const s = (k / n) * track.L;
    const i = track.indexAt(s + 25);
    const side = track.kappaS[i] > 0 ? -1 : 1;
    const p = track.sampleAt(s, side * (track.edge + 6), {});
    const ground = terrain ? terrain.heightAt(p.x, p.z) : p.y;
    spots.push({ s, x: p.x, y: Math.max(p.y, ground) + 4.5, z: p.z });
  }
  return spots;
}
