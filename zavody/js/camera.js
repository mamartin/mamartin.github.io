// Kamera: za autem, z kapoty, přelet nad tratí v menu, oblet v cíli.
import * as THREE from 'three';
import { angleDiff, clamp, lerp } from './rng.js';

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'chase';
    this.yaw = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.shake = 0;
    this.orbitAngle = 0;
    this.fov = camera.fov;
    this.initialized = false;
    this.blend = 0;
    this.tmp = {};
  }

  addShake(v) {
    this.shake = Math.min(1.2, this.shake + v);
  }

  snap() {
    this.initialized = false;
    this.blend = 0;
  }

  // plynulý přelet z aktuální pozice (menu) za auto
  flyTo(car) {
    this.initialized = true;
    this.yaw = car.hd;
    this.blend = 1.6;
  }

  follow(dt, car, alpha, track) {
    const cam = this.camera;
    const x = lerp(car.px, car.x, alpha), z = lerp(car.pz, car.z, alpha), y = lerp(car.py, car.y, alpha);
    const hd = car.phd + angleDiff(car.phd, car.hd) * alpha;
    const speed = car.speed;
    if (!this.initialized) {
      this.yaw = hd;
      this.initialized = true;
      this.pos.set(x - Math.sin(hd) * 7, y + 2.6, z - Math.cos(hd) * 7);
    }

    let fovTarget = 64 + Math.min(speed, 70) * 0.2 + (car.nitroActive ? 7 : 0);
    if (this.mode === 'hood') {
      const s = Math.sin(hd), c = Math.cos(hd);
      this.pos.set(x + s * 0.95, y + 1.3, z + c * 0.95);
      const pitch = car.pitch;
      this.look.set(x + s * 21, y + 0.95 - Math.sin(pitch) * 20, z + c * 21);
      fovTarget += 6;
      this.yaw = hd;
    } else {
      // měkké dotahování směru – při driftu je vidět bok auta
      const vAng = speed > 3 && car.vLong > 0 ? Math.atan2(car.vx, car.vz) : hd;
      const aim = hd + angleDiff(hd, vAng) * 0.45;
      this.yaw += angleDiff(this.yaw, aim) * Math.min(1, dt * 5.5);
      const dist = 6.4 + Math.min(speed, 60) * 0.028;
      const height = 2.35 + Math.min(speed, 60) * 0.01;
      const tx = x - Math.sin(this.yaw) * dist;
      const tz = z - Math.cos(this.yaw) * dist;
      let ty = y + height;
      // neprostrčit kameru pod silnici na horizontech
      const p = track.project(tx, tz, car.proj.i, this.tmp);
      if (Math.abs(p.lat) < track.edge + 4) ty = Math.max(ty, p.y + 1.2);
      let k = Math.min(1, dt * 14), ky = Math.min(1, dt * 8);
      if (this.blend > 0) {
        this.blend -= dt;
        const t = Math.max(0, this.blend) / 1.6;
        k = ky = Math.min(1, dt * (2.2 + (1 - t) * 10));
      }
      this.pos.x += (tx - this.pos.x) * k;
      this.pos.z += (tz - this.pos.z) * k;
      this.pos.y += (ty - this.pos.y) * ky;
      const lx = x + Math.sin(hd) * 3.5, ly = y + 1.15, lz = z + Math.cos(hd) * 3.5;
      if (this.blend > 0) {
        const lk = Math.min(1, dt * 5);
        this.look.x += (lx - this.look.x) * lk;
        this.look.y += (ly - this.look.y) * lk;
        this.look.z += (lz - this.look.z) * lk;
      } else this.look.set(lx, ly, lz);
    }
    this.fov += (fovTarget - this.fov) * Math.min(1, dt * 3);
    this.applyShake(dt);
  }

  orbit(dt, center, radius, height, speed = 0.06) {
    this.orbitAngle += dt * speed;
    const a = this.orbitAngle;
    this.pos.set(center.x + Math.cos(a) * radius, center.y + height, center.z + Math.sin(a) * radius);
    this.look.copy(center);
    this.fov += (55 - this.fov) * Math.min(1, dt * 2);
    this.applyShake(dt);
    this.initialized = false;
  }

  // oblet kolem auta v cíli
  showcase(dt, car) {
    this.orbitAngle += dt * 0.35;
    const a = this.orbitAngle;
    const tx = car.x + Math.cos(a) * 9, tz = car.z + Math.sin(a) * 9;
    const k = Math.min(1, dt * 3);
    this.pos.x += (tx - this.pos.x) * k;
    this.pos.z += (tz - this.pos.z) * k;
    this.pos.y += (car.y + 3 - this.pos.y) * k;
    this.look.set(car.x, car.y + 0.9, car.z);
    this.fov += (50 - this.fov) * Math.min(1, dt * 2);
    this.applyShake(dt);
  }

  applyShake(dt) {
    const cam = this.camera;
    cam.position.copy(this.pos);
    if (this.shake > 0.001) {
      const s = this.shake * 0.25;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
      this.shake *= Math.exp(-dt * 6);
    }
    cam.lookAt(this.look);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
