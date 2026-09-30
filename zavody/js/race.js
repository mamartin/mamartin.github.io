// Správa závodu: startovní rošt, odpočet, kola, pořadí, kolize aut, respawn.
import { Car } from './car.js';
import { AIDriver } from './ai.js';
import { clamp } from './rng.js';

export const OPPONENTS = [
  { name: 'Tonda Blesk', color: 0x2c6fd1, number: 11 },
  { name: 'Jarka Smyková', color: 0xf2c230, number: 3 },
  { name: 'Kuba Turbo', color: 0x1f9d55, number: 22 },
  { name: 'Eliška Drift', color: 0xf07b2c, number: 44 },
  { name: 'Radek Pedál', color: 0x8e44ad, number: 5 },
  { name: 'Mirka Vítr', color: 0xe8e8e8, number: 88 },
];
export const PLAYER_NUMBER = 7;
export const PLAYER_NUMBERS = [7, 8];

export const PLAYER_COLORS = [
  { name: 'Závodní červená', hex: 0xd7263d },
  { name: 'Modrá', hex: 0x2c6fd1 },
  { name: 'Žlutá', hex: 0xf2c230 },
  { name: 'Zelená', hex: 0x1f9d55 },
  { name: 'Oranžová', hex: 0xf07b2c },
  { name: 'Černá', hex: 0x1d1f24 },
];

export const COUNTDOWN = 3.6;

export class Race {
  constructor({
    track, biome, mode = 'race', laps = 3, difficulty = 'medium', playerColor = 0xd7263d, playerColors = null,
    humans = 1, night = false, opponents = null,
  }) {
    this.track = track;
    this.biome = biome;
    this.mode = mode;
    this.laps = laps;
    this.difficulty = difficulty;
    this.cars = [];
    this.ais = new Map();
    this.state = 'countdown';
    this.clock = 0; // od začátku odpočtu
    this.time = 0; // závodní čas od startu
    this.events = [];
    this.finishedCount = 0;
    this.leaderMarks = [];

    if (mode !== 'race') humans = 1;
    const colors = playerColors || [playerColor];
    const opp = opponents ?? 6 - humans;
    const count = mode === 'race' ? opp + humans : 1;
    // lidé startují uprostřed roštu (4. a 5. místo)
    const firstHuman = mode === 'race' ? Math.min(3, count - humans) : 0;
    const pool = OPPONENTS.filter((o) => !colors.includes(o.color));
    this.players = [];
    let ai = 0;
    for (let slot = 0; slot < count; slot++) {
      const h = slot - firstHuman;
      const isPlayer = h >= 0 && h < humans;
      const info = isPlayer
        ? { name: humans > 1 ? `Hráč ${h + 1}` : 'Ty', color: colors[h] ?? colors[0], number: PLAYER_NUMBERS[h] }
        : pool[ai++ % pool.length];
      const car = new Car(track, { color: info.color, name: info.name, number: info.number, isPlayer, night, biome });
      const g = track.gridSlot(mode === 'race' ? slot : 2);
      car.reset(g.s, g.lat);
      car.nitro = 0.35;
      this.initRaceData(car, g.s);
      car.slot = slot;
      this.cars.push(car);
      if (isPlayer) {
        car.humanIndex = h;
        this.players[h] = car;
      } else this.ais.set(car, new AIDriver(car, track, difficulty, 1000 + slot * 77));
    }
    this.player = this.players[0];
    this.autopilots = new Map();
  }

  get autopilot() {
    return this.autopilots.get(this.player) || null;
  }

  initRaceData(car, s) {
    car.lastS = car.proj.s;
    car.progress = car.proj.s > this.track.L / 2 ? car.proj.s - this.track.L : car.proj.s;
    car.lap = 0;
    car.lapStart = 0;
    car.lapTimes = [];
    car.bestLap = Infinity;
    car.finished = false;
    car.finishTime = 0;
    car.place = 0;
    car.wrongWay = 0;
    car.lastWheels = null;
  }

  emit(type, data = {}) {
    this.events.push({ type, ...data });
  }

  get countdownValue() {
    // 3, 2, 1, 0 (= start)
    const t = this.clock;
    if (t < COUNTDOWN - 3) return 4;
    return Math.max(0, Math.ceil(COUNTDOWN - t));
  }

  setAutopilot(on, car = this.player) {
    if (on && !this.autopilots.has(car)) this.autopilots.set(car, new AIDriver(car, this.track, 'hard', 4242 + (car.humanIndex || 0)));
    if (!on) this.autopilots.delete(car);
  }

  // controls: ovládání pro jednoho hráče, nebo pole pro víc hráčů (podle players)
  step(dt, controls) {
    const list = Array.isArray(controls) ? controls : [controls];
    this.clock += dt;
    const racing = this.state === 'running' || this.state === 'finished';
    if (this.state === 'countdown') {
      const cv = this.countdownValue;
      if (cv !== this.lastCount) {
        this.lastCount = cv;
        if (cv <= 3 && cv > 0) this.emit('count', { value: cv });
      }
      if (this.clock >= COUNTDOWN) {
        this.state = 'running';
        this.time = 0;
        this.emit('go');
      }
    } else {
      this.time += dt;
    }

    // ovládání
    for (const car of this.cars) {
      const ai = this.ais.get(car);
      const mine = car.isPlayer ? list[car.humanIndex] || list[0] : null;
      if (!racing) {
        // na roštu: jen „túrování“ motoru, auta stojí
        const c = car.controls;
        c.throttle = mine ? mine.throttle : 0;
        c.brake = 1;
        c.steer = mine ? mine.steer : 0;
        c.handbrake = true;
        c.nitro = false;
        continue;
      }
      if (ai) {
        ai.rubber = this.rubberFor(car);
        ai.update(dt, this.cars);
        if (ai.wantsRespawn) {
          ai.wantsRespawn = false;
          this.respawn(car);
        }
      } else if (car.isPlayer) {
        if (this.autopilots.has(car) || car.finished) {
          if (!this.autopilots.has(car)) this.setAutopilot(true, car);
          const pilot = this.autopilots.get(car);
          pilot.update(dt, this.cars);
          if (pilot.wantsRespawn) {
            pilot.wantsRespawn = false;
            this.respawn(car);
          }
          if (car.finished) {
            car.controls.throttle *= 0.55;
            car.controls.nitro = false;
          }
        } else Object.assign(car.controls, mine);
      }
    }

    for (const car of this.cars) {
      if (!racing) {
        // na roštu jen natáčení kol a otáčky
        car.savePrev();
        car.steer += (car.controls.steer - car.steer) * Math.min(1, dt * 6);
        car.vLong = 0;
        continue;
      }
      car.step(dt);
    }
    if (racing) this.collideCars();
    if (racing) for (const car of this.cars) this.updateProgress(car, dt);
    this.updatePlaces();
    if (racing) this.trackLeader();
  }

  rubberFor(car) {
    const racing = this.players.filter((p) => !p.finished);
    if (this.mode !== 'race' || !racing.length) return 1;
    const human = Math.max(...racing.map((p) => p.progress));
    const gap = car.progress - human; // + = AI vepředu
    if (gap > 0) return 1 - clamp((gap - 60) / 400, 0, 0.07);
    return 1 + clamp((-gap - 90) / 500, 0, 0.06);
  }

  updateProgress(car, dt) {
    const L = this.track.L;
    const s = car.proj.s;
    let ds = s - car.lastS;
    if (ds < -L / 2) ds += L;
    else if (ds > L / 2) ds -= L;
    car.progress += ds;
    car.lastS = s;

    const done = Math.floor(car.progress / L);
    if (done > car.lap && !car.finished) {
      car.lap = done;
      const lapTime = this.time - car.lapStart;
      car.lapStart = this.time;
      car.lapTimes.push(lapTime);
      const best = lapTime < car.bestLap;
      if (best) car.bestLap = lapTime;
      this.emit('lap', { car, lapTime, best, lap: done });
      if (done >= this.laps) {
        car.finished = true;
        car.finishTime = this.time;
        car.finishOrder = ++this.finishedCount;
        this.emit('finish', { car });
        if (car.isPlayer && this.players.every((p) => p.finished)) this.state = 'finished';
      }
    }

    // protisměr
    if (car.isPlayer) {
      const facing = Math.cos(car.hd - car.proj.hd);
      if (facing < -0.25 && car.speed > 4) car.wrongWay += dt;
      else car.wrongWay = 0;
    }
  }

  // časová ztráta na vedoucího podle značek po 10 m, které vedoucí projel
  trackLeader() {
    const lead = this.standings ? this.standings[0] : null;
    if (!lead || lead.progress <= 0) return;
    const idx = Math.floor(lead.progress / 10);
    for (let i = this.leaderMarks.length; i <= idx; i++) this.leaderMarks[i] = this.time;
  }

  gapToLeader(car) {
    if (car.progress <= 0) return null;
    const t = this.leaderMarks[Math.floor(car.progress / 10)];
    return t != null ? Math.max(0, this.time - t) : null;
  }

  updatePlaces() {
    const sorted = [...this.cars].sort((a, b) => {
      if (a.finished && b.finished) return a.finishOrder - b.finishOrder;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    sorted.forEach((c, i) => (c.place = i + 1));
    this.standings = sorted;
  }

  collideCars() {
    const cars = this.cars;
    const R = 1.05, off = 1.15;
    for (let i = 0; i < cars.length; i++) {
      const a = cars[i];
      if (a.ghostTimer > 0) continue;
      for (let j = i + 1; j < cars.length; j++) {
        const b = cars[j];
        if (b.ghostTimer > 0) continue;
        const dx0 = a.x - b.x, dz0 = a.z - b.z;
        if (dx0 * dx0 + dz0 * dz0 > 36) continue;
        if (Math.abs(a.y - b.y) > 3) continue;
        const as = Math.sin(a.hd), ac = Math.cos(a.hd), bs = Math.sin(b.hd), bc = Math.cos(b.hd);
        let best = null;
        for (const oa of [-off, off]) {
          for (const ob of [-off, off]) {
            const ax = a.x + as * oa, az = a.z + ac * oa;
            const bx = b.x + bs * ob, bz = b.z + bc * ob;
            const dx = ax - bx, dz = az - bz;
            const d2 = dx * dx + dz * dz;
            if (d2 < 4 * R * R && (!best || d2 < best.d2)) best = { d2, dx, dz, oa, ob };
          }
        }
        if (!best) continue;
        const d = Math.sqrt(best.d2) || 0.001;
        const nx = best.dx / d, nz = best.dz / d;
        const pen = 2 * R - d;
        a.x += nx * pen * 0.5;
        a.z += nz * pen * 0.5;
        b.x -= nx * pen * 0.5;
        b.z -= nz * pen * 0.5;
        const vrel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
        if (vrel < 0) {
          const jimp = (-(1 + 0.25) * vrel) / 2;
          a.vx += nx * jimp;
          a.vz += nz * jimp;
          b.vx -= nx * jimp;
          b.vz -= nz * jimp;
          // otočení podle místa dotyku
          const ta = best.oa * (ac * nx - as * nz) * jimp * 0.05;
          const tb = best.ob * (bs * nz - bc * nx) * jimp * 0.05;
          a.yawRate += clamp(ta, -1.2, 1.2);
          b.yawRate += clamp(tb, -1.2, 1.2);
          if (-vrel > 2.5) this.emit('bump', { a, b, strength: -vrel, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
        }
      }
    }
  }

  respawn(car) {
    const tr = this.track;
    const s = car.proj.s - 6;
    const k = tr.indexAt(s);
    car.reset(s, tr.racingLat[k] * 0.5);
    car.ghostTimer = 2.2;
    car.lastWheels = null;
    const ai = this.ais.get(car);
    if (ai) ai.avoid = 0;
    this.emit('respawn', { car });
  }

  // odhad cílového času aut, která ještě nedojela
  estimateFinish(car) {
    if (car.finished) return car.finishTime;
    const remaining = this.laps * this.track.L - car.progress;
    const avg = car.progress > 50 ? car.progress / Math.max(1, this.time) : 30;
    return this.time + remaining / Math.max(10, avg);
  }
}
