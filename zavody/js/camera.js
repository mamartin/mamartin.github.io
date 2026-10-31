// Kamera: za autem, z kapoty, přelet nad tratí v menu, oblet v cíli.
import * as THREE from 'three';
import { angleDiff, clamp, lerp } from './rng.js';

// podíl dorovnání za dt nezávislý na počtu snímků za sekundu
const ease = (rate, dt) => 1 - Math.exp(-rate * dt);
// o kolik kamera zaostává za autem na každý m/s rychlosti (dřív vznikalo zpožděním vyhlazování)
const SPEED_LAG = 0.055;
// jak rychle se kamera natáčí za autem; v ustálené zatáčce zůstává o yawRate / YAW_RATE pozadu
const YAW_RATE = 5.5;

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'chase';
    this.yaw = 0;
    this.pos = new THREE.Vector3();
    // poloha kamery vůči autu: vyhlazuje se tahle odchylka, ne poloha ve světě. Kdyby se kamera
    // dotahovala ve světě, její zpoždění za rychlým autem by záviselo na délce snímku a při
    // kolísání FPS by se cukala (nejvíc vidět na autech, která jedou vedle)
    this.offset = new THREE.Vector3();
    this.yawRel = 0;
    this.look = new THREE.Vector3();
    this.shake = 0;
    this.orbitAngle = 0;
    this.fov = camera.fov;
    this.initialized = false;
    this.blend = 0;
    this.showing = false; // oblet kolem auta v cíli (bez rozmazání rychlostí)
    this.tmp = {};
  }

  addShake(v) {
    this.shake = Math.min(1.2, this.shake + v);
  }

  snap() {
    this.initialized = false;
    this.showing = false;
    this.blend = 0;
  }

  // plynulý přelet z aktuální pozice (menu) za auto
  flyTo(car) {
    this.initialized = true;
    this.yaw = car.hd;
    this.yawRel = 0;
    this.offset.set(this.pos.x - car.x, this.pos.y - car.y, this.pos.z - car.z);
    this.blend = 1.6;
  }

  follow(dt, car, alpha, track) {
    this.showing = false;
    const x = lerp(car.px, car.x, alpha), z = lerp(car.pz, car.z, alpha), y = lerp(car.py, car.y, alpha);
    const hd = car.phd + angleDiff(car.phd, car.hd) * alpha;
    const speed = car.speed;
    if (!this.initialized) {
      this.yaw = hd;
      this.yawRel = 0;
      this.initialized = true;
      this.offset.set(-Math.sin(hd) * 7, 2.6, -Math.cos(hd) * 7);
    }

    let fovTarget = 64 + Math.min(speed, 70) * 0.2 + (car.nitroActive ? 7 : car.turbo > 0 ? 5 : 0);
    if (this.mode === 'hood') {
      const s = Math.sin(hd), c = Math.cos(hd);
      this.pos.set(x + s * 0.95, y + 1.3, z + c * 0.95);
      this.offset.set(this.pos.x - x, this.pos.y - y, this.pos.z - z);
      const pitch = car.pitch;
      this.look.set(x + s * 21, y + 0.95 - Math.sin(pitch) * 20, z + c * 21);
      fovTarget += 6;
      this.yaw = hd;
      this.yawRel = 0;
    } else {
      // měkké dotahování směru – při driftu je vidět bok auta; vyhlazuje se odchylka od směru auta,
      // v zatáčce kamera zaostává úměrně rychlosti otáčení (stejně jako dřív, ale bez cukání)
      const vAng = speed > 3 && car.vLong > 0 ? Math.atan2(car.vx, car.vz) : hd;
      const relTarget = clamp(angleDiff(hd, vAng) * 0.45 - (car.yawRate || 0) / YAW_RATE, -1.3, 1.3);
      this.yawRel += (relTarget - this.yawRel) * ease(YAW_RATE, dt);
      this.yaw = hd + this.yawRel;
      const dist = 6.4 + Math.min(speed, 60) * 0.028;
      const height = 2.35 + Math.min(speed, 60) * 0.01;
      const lag = SPEED_LAG * Math.min(1, 80 / Math.max(speed, 1));
      const ox = -Math.sin(this.yaw) * dist - car.vx * lag;
      const oz = -Math.cos(this.yaw) * dist - car.vz * lag;
      let ty = y + height;
      // neprostrčit kameru pod silnici na horizontech
      const p = track.project(x + ox, z + oz, car.proj.i, this.tmp);
      if (Math.abs(p.lat) < track.edge + 4) ty = Math.max(ty, p.y + 1.2);
      let k = ease(14, dt), ky = ease(8, dt);
      if (this.blend > 0) {
        this.blend -= dt;
        const t = Math.max(0, this.blend) / 1.6;
        k = ky = ease(2.2 + (1 - t) * 10, dt);
      }
      const o = this.offset;
      o.x += (ox - o.x) * k;
      o.z += (oz - o.z) * k;
      o.y += (ty - y - o.y) * ky;
      this.pos.set(x + o.x, y + o.y, z + o.z);
      const lx = x + Math.sin(hd) * 3.5, ly = y + 1.15, lz = z + Math.cos(hd) * 3.5;
      if (this.blend > 0) {
        const lk = ease(5, dt);
        this.look.x += (lx - this.look.x) * lk;
        this.look.y += (ly - this.look.y) * lk;
        this.look.z += (lz - this.look.z) * lk;
      } else this.look.set(lx, ly, lz);
    }
    this.fov += (fovTarget - this.fov) * ease(3, dt);
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

  // oblet kolem auta v cíli; auto ještě dojíždí, takže se kamera drží jeho vykreslené
  // (interpolované) polohy a vyhlazuje jen odchylku od něj, jinak by auto v záběru poskakovalo
  showcase(dt, car, alpha = 1) {
    // oblet začne tam, kde kamera právě je, ať se neotáčí kolem půlky auta
    if (!this.showing) this.orbitAngle = Math.atan2(this.offset.z, this.offset.x);
    this.showing = true;
    const x = lerp(car.px, car.x, alpha), z = lerp(car.pz, car.z, alpha), y = lerp(car.py, car.y, alpha);
    this.orbitAngle += dt * 0.35;
    const a = this.orbitAngle;
    const k = ease(3, dt);
    const o = this.offset;
    o.x += (Math.cos(a) * 9 - o.x) * k;
    o.z += (Math.sin(a) * 9 - o.z) * k;
    o.y += (3 - o.y) * k;
    this.pos.set(x + o.x, y + o.y, z + o.z);
    this.look.set(x, y + 0.9, z);
    this.fov += (50 - this.fov) * ease(2, dt);
    this.applyShake(dt);
  }

  // garáž: bližší oblet kolem vozu; offX/offY posunou vůz ve výřezu (zlomek poloviny šířky/výšky),
  // aby ho nezakrýval panel
  garage(dt, car, offX = 0, offY = 0, spin = true) {
    if (spin) this.orbitAngle += dt * 0.22;
    const a = this.orbitAngle, R = 8.6;
    const tx = car.x + Math.cos(a) * R, tz = car.z + Math.sin(a) * R;
    const k = Math.min(1, dt * 4);
    this.pos.x += (tx - this.pos.x) * k;
    this.pos.z += (tz - this.pos.z) * k;
    this.pos.y += (car.y + 2.7 - this.pos.y) * k;
    this.fov += (46 - this.fov) * Math.min(1, dt * 3);
    const dx = car.x - this.pos.x, dz = car.z - this.pos.z;
    const dist = Math.hypot(dx, dz) || R;
    const halfH = Math.tan((this.fov * Math.PI) / 360) * dist;
    const halfW = halfH * this.camera.aspect;
    // pravý vektor pohledu ve vodorovné rovině; pohled doleva = vůz se posune doprava
    const rx = -dz / dist, rz = dx / dist;
    this.look.set(car.x - rx * offX * halfW, car.y + 0.5 - offY * halfH, car.z - rz * offX * halfW);
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
