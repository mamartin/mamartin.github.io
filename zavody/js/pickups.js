// Power-upy: krabice s otazníkem na trati, rakety, miny, štít a nitro.
import * as THREE from 'three';
import { RNG, clamp } from './rng.js';

export const ITEM_NAMES = { rocket: 'Raketa', mine: 'Mina', shield: 'Štít', nitro: 'Nitro' };

function boxTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 128, 128);
  grd.addColorStop(0, '#ffd84a');
  grd.addColorStop(1, '#ff8a1f');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 8;
  g.strokeRect(6, 6, 116, 116);
  g.fillStyle = '#10223f';
  g.font = '700 92px "Chakra Petch", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('?', 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Pickups {
  constructor({ track, scene, race, effects, audio, seed = 9 }) {
    this.track = track;
    this.scene = scene;
    this.race = race;
    this.effects = effects;
    this.audio = audio;
    this.rng = new RNG(seed);
    this.group = new THREE.Group();
    this.group.name = 'pickups';
    scene.add(this.group);
    this.events = [];
    this.boxes = [];
    this.rockets = [];
    this.mines = [];
    this.shields = new Map();
    this.time = 0;
    this.tmp = {};

    const boxGeo = new THREE.BoxGeometry(1.35, 1.35, 1.35);
    const boxMat = new THREE.MeshStandardMaterial({
      map: boxTexture(), emissive: 0xffa630, emissiveIntensity: 0.35, roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0.92,
    });
    const L = track.L;
    for (const f of [0.14, 0.38, 0.62, 0.86]) {
      // najdi rovnější místo kolem f
      let bestS = f * L, bestK = Infinity;
      for (let d = -60; d <= 60; d += 10) {
        const s = f * L + d;
        const k = Math.abs(track.kappaS[track.indexAt(s)]);
        if (k < bestK) { bestK = k; bestS = s; }
      }
      const lanes = track.hw > 7.5 ? [-0.62, -0.21, 0.21, 0.62] : [-0.55, 0, 0.55];
      for (const l of lanes) {
        const p = track.sampleAt(bestS, l * track.hw, {});
        const mesh = new THREE.Mesh(boxGeo, boxMat);
        mesh.position.set(p.x, p.y + 1.1, p.z);
        mesh.castShadow = true;
        this.group.add(mesh);
        this.boxes.push({ x: p.x, y: p.y, z: p.z, mesh, respawn: 0, phase: this.rng.range(0, 6) });
      }
    }

    // modely střel
    this.rocketGeo = (() => {
      const body = new THREE.CylinderGeometry(0.16, 0.16, 1.1, 8).rotateX(Math.PI / 2);
      const nose = new THREE.ConeGeometry(0.16, 0.4, 8).rotateX(Math.PI / 2).translate(0, 0, 0.75);
      return [body, nose];
    })();
    this.rocketMat = new THREE.MeshStandardMaterial({ color: 0xf3f5f8, roughness: 0.4, metalness: 0.5 });
    this.noseMat = new THREE.MeshStandardMaterial({ color: 0xe8392c, roughness: 0.4 });
    this.mineGeo = new THREE.SphereGeometry(0.5, 12, 8);
    this.mineMat = new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: 0.5, metalness: 0.6 });
    this.mineLightGeo = new THREE.SphereGeometry(0.14, 8, 6);
    this.shieldGeo = new THREE.SphereGeometry(1, 20, 14);
  }

  dispose() {
    this.scene.remove(this.group);
    const mats = new Set();
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) mats.add(o.material);
    });
    for (const m of [this.rocketMat, this.noseMat, this.mineMat, ...mats]) {
      if (m.map) m.map.dispose();
      m.dispose();
    }
    this.rocketGeo.forEach((g) => g.dispose());
    this.mineGeo.dispose();
    this.mineLightGeo.dispose();
    this.shieldGeo.dispose();
  }

  emit(type, data) {
    this.events.push({ type, ...data });
  }

  rollItem(car) {
    const n = this.race.cars.length;
    const f = n > 1 ? (car.place - 1) / (n - 1) : 0.5;
    const r = this.rng.next();
    let table;
    if (f < 0.2) table = [['mine', 0.4], ['shield', 0.35], ['nitro', 0.25]];
    else if (f < 0.65) table = [['rocket', 0.36], ['mine', 0.24], ['shield', 0.18], ['nitro', 0.22]];
    else table = [['rocket', 0.5], ['nitro', 0.35], ['shield', 0.15]];
    let acc = 0;
    for (const [item, w] of table) {
      acc += w;
      if (r <= acc) return item;
    }
    return table[table.length - 1][0];
  }

  update(dt, playerWantsUse) {
    this.time += dt;
    const cars = this.race.cars;
    const racing = this.race.state !== 'countdown';

    // krabice
    for (const b of this.boxes) {
      if (b.respawn > 0) {
        b.respawn -= dt;
        b.mesh.visible = b.respawn <= 0;
        if (b.respawn <= 0) b.mesh.scale.setScalar(0.2);
        continue;
      }
      const sc = Math.min(1, b.mesh.scale.x + dt * 2.5);
      b.mesh.scale.setScalar(sc);
      b.mesh.rotation.y = this.time * 1.6 + b.phase;
      b.mesh.rotation.x = Math.sin(this.time * 1.2 + b.phase) * 0.35;
      b.mesh.position.y = b.y + 1.1 + Math.sin(this.time * 2 + b.phase) * 0.15;
      if (!racing) continue;
      for (const car of cars) {
        if (car.item || car.itemRoll > 0 || car.ghostTimer > 0) continue;
        const dx = car.x - b.x, dz = car.z - b.z;
        if (dx * dx + dz * dz < 4.2 && Math.abs(car.y - b.y) < 2.5) {
          b.respawn = 1.8;
          b.mesh.visible = false;
          car.itemRoll = car.isPlayer ? 1.1 : 0.8;
          car.pendingItem = this.rollItem(car);
          car.itemTimer = this.rng.range(1.2, 4);
          if (car.isPlayer) this.emit('box', { car });
          this.effects.sparks(b.x, b.y + 0.4, b.z, 0, 0, 6);
        }
      }
    }

    // losování a použití
    for (const car of cars) {
      if (car.itemRoll > 0) {
        car.itemRoll -= dt;
        if (car.itemRoll <= 0) {
          car.item = car.pendingItem;
          car.pendingItem = null;
          if (car.isPlayer) this.emit('got', { car, item: car.item });
        }
        continue;
      }
      if (!car.item || !racing) continue;
      if (car.isPlayer && !this.race.autopilot && !car.finished) {
        if (playerWantsUse) this.use(car);
      } else this.aiUse(dt, car);
    }

    this.updateRockets(dt);
    this.updateMines(dt);
    this.updateShields(dt);
  }

  aiUse(dt, car) {
    car.itemTimer -= dt;
    if (car.itemTimer > 0) return;
    const L = this.track.L;
    const nearest = (ahead) => {
      let best = null, bd = Infinity;
      for (const o of this.race.cars) {
        if (o === car) continue;
        let ds = o.proj.s - car.proj.s;
        if (ds < -L / 2) ds += L;
        else if (ds > L / 2) ds -= L;
        if (ahead ? ds > 0 && ds < bd : ds < 0 && -ds < bd) {
          bd = Math.abs(ds);
          best = o;
        }
      }
      return best ? { car: best, dist: bd } : null;
    };
    const waited = -car.itemTimer;
    if (car.item === 'rocket') {
      const t = nearest(true);
      if ((t && t.dist < 90) || waited > 9) this.use(car);
    } else if (car.item === 'mine') {
      const t = nearest(false);
      if ((t && t.dist < 35) || waited > 6) this.use(car);
    } else if (car.item === 'nitro') {
      if (Math.abs(this.track.kappaS[this.track.indexAt(car.proj.s + 40)]) < 0.004 || waited > 5) this.use(car);
    } else this.use(car);
  }

  use(car) {
    const item = car.item;
    car.item = null;
    const tr = this.track;
    if (item === 'rocket') {
      const L = tr.L;
      let target = null, bd = 140;
      for (const o of this.race.cars) {
        if (o === car) continue;
        let ds = o.proj.s - car.proj.s;
        if (ds < -L / 2) ds += L;
        else if (ds > L / 2) ds -= L;
        if (ds > 0 && ds < bd) {
          bd = ds;
          target = o;
        }
      }
      const mesh = new THREE.Group();
      const body = new THREE.Mesh(this.rocketGeo[0], this.rocketMat);
      const nose = new THREE.Mesh(this.rocketGeo[1], this.noseMat);
      mesh.add(body, nose);
      this.group.add(mesh);
      this.rockets.push({
        s: car.proj.s + 3, lat: car.proj.lat, speed: Math.max(car.speed + 28, 72), owner: car, target, life: 4, mesh,
      });
      this.emit('fire', { car });
    } else if (item === 'mine') {
      const sin = Math.sin(car.hd), cos = Math.cos(car.hd);
      const x = car.x - sin * 3.4, z = car.z - cos * 3.4;
      const p = tr.project(x, z, car.proj.i, {});
      const mesh = new THREE.Group();
      mesh.add(new THREE.Mesh(this.mineGeo, this.mineMat));
      const lightMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false });
      const light = new THREE.Mesh(this.mineLightGeo, lightMat);
      light.position.y = 0.45;
      mesh.add(light);
      mesh.position.set(x, p.y + 0.3, z);
      this.group.add(mesh);
      this.mines.push({ x, y: p.y, z, owner: car, arm: 1.2, life: 35, mesh, lightMat });
      this.emit('drop', { car });
    } else if (item === 'shield') {
      car.shield = 6;
      this.emit('shield', { car });
    } else if (item === 'nitro') {
      car.nitro = 1;
      this.emit('nitro', { car });
    }
  }

  hit(target, by, x, y, z) {
    if (target.shield > 0) {
      target.shield = 0;
      this.effects.sparks(x, y, z, 0, 0, 14);
      this.emit('blocked', { target, by, x, y, z });
      return;
    }
    target.spinTimer = 1.25;
    target.vx *= 0.35;
    target.vz *= 0.35;
    target.yawRate = (this.rng.chance(0.5) ? 1 : -1) * 6;
    this.effects.explosion(x, y, z);
    this.emit('hit', { target, by, x, y, z });
  }

  updateRockets(dt) {
    const tr = this.track;
    const L = tr.L;
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.life -= dt;
      r.s += r.speed * dt;
      if (r.target) {
        r.lat += clamp(r.target.proj.lat - r.lat, -10 * dt, 10 * dt);
      }
      r.lat = clamp(r.lat, -tr.edge + 1, tr.edge - 1);
      const p = tr.sampleAt(r.s, r.lat, this.tmp);
      r.mesh.position.set(p.x, p.y + 0.75, p.z);
      r.mesh.rotation.y = p.hd;
      const bx = -Math.sin(p.hd), bz = -Math.cos(p.hd);
      this.effects.nitroFlame(p.x + bx * 0.7, p.y + 0.75, p.z + bz * 0.7, bx, bz, 0, 0);
      let done = r.life <= 0;
      for (const car of this.race.cars) {
        if (car === r.owner || car.ghostTimer > 0) continue;
        let ds = car.proj.s - r.s;
        if (ds < -L / 2) ds += L;
        else if (ds > L / 2) ds -= L;
        if (ds > -2 && ds < 2.6 && Math.abs(car.proj.lat - r.lat) < 1.6) {
          this.hit(car, r.owner, car.x, car.y, car.z);
          done = true;
          break;
        }
      }
      // zásah miny raketou
      for (let m = this.mines.length - 1; m >= 0 && !done; m--) {
        const mine = this.mines[m];
        const dx = mine.x - p.x, dz = mine.z - p.z;
        if (dx * dx + dz * dz < 2.2) {
          this.effects.explosion(mine.x, mine.y, mine.z);
          this.emit('boom', { x: mine.x, y: mine.y, z: mine.z });
          this.removeMine(m);
          done = true;
        }
      }
      if (done) {
        if (r.life <= 0) {
          this.effects.explosion(p.x, p.y, p.z);
          this.emit('boom', { x: p.x, y: p.y, z: p.z });
        }
        this.group.remove(r.mesh);
        this.rockets.splice(i, 1);
      }
    }
  }

  removeMine(i) {
    const m = this.mines[i];
    this.group.remove(m.mesh);
    m.lightMat.dispose();
    this.mines.splice(i, 1);
  }

  updateMines(dt) {
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      m.arm -= dt;
      m.life -= dt;
      m.lightMat.color.setHex(Math.floor(this.time * 4) % 2 ? 0xff2a1a : 0x330605);
      if (m.life <= 0) {
        this.removeMine(i);
        continue;
      }
      if (m.arm > 0) continue;
      for (const car of this.race.cars) {
        if (car.ghostTimer > 0) continue;
        const dx = car.x - m.x, dz = car.z - m.z;
        if (dx * dx + dz * dz < 3.6) {
          this.hit(car, m.owner, m.x, m.y, m.z);
          this.removeMine(i);
          break;
        }
      }
    }
  }

  updateShields(dt) {
    for (const car of this.race.cars) {
      let s = this.shields.get(car);
      if (car.shield > 0) {
        if (!s) {
          const mat = new THREE.MeshBasicMaterial({
            color: 0x6fc4ff, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending,
          });
          s = new THREE.Mesh(this.shieldGeo, mat);
          s.scale.set(1.7, 1.25, 3.0);
          this.group.add(s);
          this.shields.set(car, s);
        }
        s.visible = true;
        s.position.set(car.x, car.y + 0.75, car.z);
        s.rotation.y = car.hd;
        const blink = car.shield < 1.5 ? (Math.floor(car.shield * 8) % 2 ? 0.08 : 0.3) : 0.22 + Math.sin(this.time * 6) * 0.06;
        s.material.opacity = blink;
      } else if (s) s.visible = false;
    }
  }
}
