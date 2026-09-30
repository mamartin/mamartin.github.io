// AI řidič: sleduje ideální stopu, brzdí podle rychlostního profilu trati, předjíždí.
import { clamp, angleDiff, RNG } from './rng.js';

export const DIFFICULTY = {
  easy: { label: 'Lehká', corner: 0.8, top: 0.82, reaction: 0.34, noise: 0.05, nitro: false, variance: 0.04 },
  medium: { label: 'Střední', corner: 0.93, top: 0.92, reaction: 0.24, noise: 0.03, nitro: false, variance: 0.035 },
  hard: { label: 'Těžká', corner: 1.04, top: 1.0, reaction: 0.16, noise: 0.012, nitro: true, variance: 0.025 },
};

export class AIDriver {
  constructor(car, track, diffKey = 'medium', seed = 1) {
    this.car = car;
    this.track = track;
    this.diff = DIFFICULTY[diffKey] ?? DIFFICULTY.medium;
    const rng = new RNG(seed);
    this.pref = rng.range(-0.45, 0.45) * Math.max(0, track.hw - 3.5);
    this.skill = 1 + rng.range(-this.diff.variance, this.diff.variance);
    this.phase = rng.range(0, 100);
    this.avoid = 0;
    this.time = 0;
    this.stuck = 0;
    this.wrong = 0;
    this.recover = 0;
    this.rubber = 1;
    this.gain = 4.5;
    this.wantsRespawn = false;
    this.tmp = {};
  }

  update(dt, cars) {
    const car = this.car, tr = this.track, P = car.proj, c = car.controls;
    this.time += dt;
    const speed = car.speed;
    const s = P.s;

    // --- vyproštění, když auto uvízne nebo jede v protisměru
    const facing = Math.cos(car.hd - P.hd);
    if (speed < 2.5) this.stuck += dt;
    else this.stuck = Math.max(0, this.stuck - dt * 2);
    if (facing < -0.3) this.wrong += dt;
    else this.wrong = 0;
    if (this.stuck > 5 || this.wrong > 2.5) {
      this.wantsRespawn = true;
      this.stuck = 0;
      this.wrong = 0;
    }
    if (this.stuck > 1.2 && this.recover <= 0) this.recover = 1.1;

    // --- cíl řízení
    const Ld = 7 + speed * 0.42;
    const kA = tr.indexAt(s + Ld);
    const line = tr.racingLat[kA];
    const W = tr.hw - 1.5;
    let lat = line + this.pref * (1 - Math.abs(line) / Math.max(1, tr.hw - 2)) + this.avoid;
    lat = clamp(lat, -W, W);
    const tgt = tr.sampleAt(s + Ld, lat, this.tmp);
    const desired = Math.atan2(tgt.x - car.x, tgt.z - car.z);
    const err = angleDiff(car.hd, desired);
    let steer = clamp(-err * this.gain + car.yawRate * 0.06, -1, 1);
    steer += Math.sin(this.time * 1.3 + this.phase) * this.diff.noise;

    // --- rychlost
    const look = speed * this.diff.reaction + 2;
    const k = tr.indexAt(s + look);
    const corner = this.diff.corner * this.skill;
    let vt = Math.min(tr.speedProfile[k] * corner, 70 * this.diff.top * this.skill) * this.rubber;
    // kus před námi: nejpomalejší místo v brzdné dráze
    const k2 = tr.indexAt(s + look + speed * 0.5);
    vt = Math.min(vt, tr.speedProfile[k2] * corner * 1.08 * this.rubber);

    // --- ostatní auta
    let targetAvoid = 0;
    let lift = 1;
    const L = tr.L;
    for (const o of cars) {
      if (o === car || o.ghostTimer > 0) continue;
      let ds = o.proj.s - s;
      if (ds < -L / 2) ds += L;
      else if (ds > L / 2) ds -= L;
      if (ds <= 0 || ds > 18) continue;
      const dl = o.proj.lat - P.lat;
      if (Math.abs(dl) > 3.2) continue;
      const roomLeft = o.proj.lat + W;
      const roomRight = W - o.proj.lat;
      const dir = roomRight > roomLeft ? 1 : -1;
      const want = o.proj.lat + dir * 3.4 - (line + this.pref * 0.5);
      if (Math.abs(want) > Math.abs(targetAvoid)) targetAvoid = want * (1 - ds / 22);
      if (ds < 8 && Math.abs(dl) < 2.3 && o.speed < speed) lift = Math.min(lift, 0.35);
    }
    this.avoid += (clamp(targetAvoid, -W, W) - this.avoid) * Math.min(1, dt * 2.2);

    let throttle = 0, brake = 0;
    const dv = vt - speed;
    if (dv > 1) throttle = 1;
    else if (dv > -1.5) throttle = clamp(0.35 + dv * 0.3, 0, 1);
    else brake = clamp(-dv / 7, 0.25, 1);
    throttle *= lift;

    let nitro = false;
    if (this.diff.nitro && car.nitro > 0.4 && speed > 28 && dv > 6 && Math.abs(tr.kappaS[tr.indexAt(s + 50)]) < 0.004) nitro = true;

    if (this.recover > 0) {
      this.recover -= dt;
      throttle = 0;
      brake = 1;
      steer = clamp(err * 2, -1, 1);
    }

    c.throttle = throttle;
    c.brake = brake;
    c.steer = clamp(steer, -1, 1);
    c.handbrake = false;
    c.nitro = nitro;
  }
}
