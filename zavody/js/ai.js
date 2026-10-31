// AI řidič: sleduje ideální stopu, brzdí podle rychlostního profilu trati, předjíždí,
// brání pozici a občas udělá chybu.
import { clamp, angleDiff, RNG } from './rng.js';
import { CAR } from './car.js';
import { DRIVERS, nameSeed } from './drivers.js';

// corner = rychlost v zatáčkách proti rychlostnímu profilu trati, mistakes = šance na chybu
// za sekundu jízdy, defend = jak důrazně brání pozici (0–1), nitroRegen = dobíjení nitra za
// sekundu (náhrada za drift, kterým si nitro plní hráč); reference = pevná úroveň pro medaile
export const DIFFICULTY = {
  easy: { label: 'Lehká', corner: 0.8, top: 0.82, reaction: 0.34, noise: 0.05, nitro: false, variance: 0.04, mistakes: 0.05, defend: 0, nitroRegen: 0 },
  medium: { label: 'Střední', corner: 0.93, top: 0.92, reaction: 0.24, noise: 0.03, nitro: false, variance: 0.035, mistakes: 0.03, defend: 0.6, nitroRegen: 0 },
  hard: { label: 'Těžká', corner: 1.12, top: 1.0, reaction: 0.12, noise: 0.01, nitro: true, variance: 0.035, mistakes: 0.006, defend: 1, nitroRegen: 0.03 },
  expert: { label: 'Nejtěžší', corner: 1.16, top: 1.0, reaction: 0.1, noise: 0.008, nitro: true, variance: 0.03, mistakes: 0.003, defend: 1, nitroRegen: 0.05 },
  reference: { label: 'Medaile', corner: 1.12, top: 1.0, reaction: 0.16, noise: 0.012, nitro: true, variance: 0.025, mistakes: 0, defend: 1, nitroRegen: 0 },
};

export class AIDriver {
  // driver = jméno jezdce: výkonnost, povaha i stopa pak drží napříč závody
  constructor(car, track, diffKey = 'medium', seed = 1, driver = '') {
    this.car = car;
    this.track = track;
    this.diff = DIFFICULTY[diffKey] ?? DIFFICULTY.medium;
    // formule projede zatáčky rychleji než auto, AI s tím musí počítat
    const wet = car.biome.wet ? car.spec.wetGrip : 1;
    this.grip = car.spec.grip * wet;
    this.profile = track.speedProfileFor(car.kind, this.grip / CAR.grip, car.spec.vmax / CAR.vmax);
    const me = DRIVERS[driver];
    const rng = new RNG(me ? nameSeed(driver) : seed);
    this.pref = rng.range(-1, 1) * (me ? 0.3 : 0.45) * Math.max(0, track.hw - 3.5);
    this.skill = 1 + (me ? me.pace : rng.range(-1, 1)) * this.diff.variance;
    this.phase = rng.range(0, 100);
    this.aggr = me?.aggr ?? 0.5;
    this.errors = me?.errors ?? 1;
    this.rng = new RNG(seed);
    // na hraně přilnavosti a ve výjezdech rozhoduje cit: lepší jezdec z vozu vytěží víc
    this.feel = me ? 1 + (this.skill - 1) * 0.6 : 1;
    if (me) car.power = 1 + (this.skill - 1) * 1.6;
    this.avoid = 0;
    this.defend = 0;
    this.mistake = 0;
    this.mistakeKind = null;
    this.time = 0;
    this.stuck = 0;
    this.wrong = 0;
    this.recover = 0;
    this.rubber = 1;
    this.gain = 4.5;
    this.maxLat = 0.9;
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
    const hw = tr.hwAt(kA);
    const W = hw - 1.5;
    const baseLat = line + this.pref * (1 - Math.abs(line) / Math.max(1, hw - 2)) + this.avoid;
    let lat = baseLat + this.defend;
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
    let vt = Math.min(this.profile[k] * corner, 70 * this.diff.top * this.skill) * this.rubber;
    // kus před námi: nejpomalejší místo v brzdné dráze
    const k2 = tr.indexAt(s + look + speed * 0.5);
    vt = Math.min(vt, this.profile[k2] * corner * 1.08 * this.rubber);
    // ani nejlepší AI nejede rychleji, než dovolí přilnavost
    const grip = this.maxLat * this.feel * this.grip * (car.biome.roadGrip ?? 1);
    vt = Math.min(vt, Math.sqrt(grip / Math.max(Math.abs(tr.kappaS[k]), 1e-4)), 1.08 * Math.sqrt(grip / Math.max(Math.abs(tr.kappaS[k2]), 1e-4)));

    // --- chyby: občas přežene nájezd do zatáčky (vyletí ven) nebo zaváhá na plynu
    if (this.mistake > 0) this.mistake -= dt;
    else if (this.time > 4 && speed > 20 && this.rng.chance(this.diff.mistakes * this.errors * dt)) {
      this.mistakeKind = this.rng.chance(0.6) ? 'late' : 'lift';
      this.mistake = this.mistakeKind === 'late' ? 1.6 : 0.9;
    }
    if (this.mistake > 0 && this.mistakeKind === 'late') vt *= 1.13;

    // --- ostatní auta
    let targetAvoid = 0;
    let defendLat = null;
    let lift = 1;
    const L = tr.L;
    for (const o of cars) {
      if (o === car || o.ghostTimer > 0 || o.cut) continue;
      let ds = o.proj.s - s;
      if (ds < -L / 2) ds += L;
      else if (ds > L / 2) ds -= L;
      // někdo se tlačí zezadu: přesunout se před něj (jen jeden plynulý přesun, žádné kličkování)
      if (ds > -14 && ds < -2.5 && o.speed > speed - 2 && Math.abs(o.proj.lat - P.lat) < 4) defendLat = o.proj.lat;
      if (ds <= 0 || ds > 18) continue;
      const dl = o.proj.lat - P.lat;
      if (Math.abs(dl) > 3.2) continue;
      const roomLeft = o.proj.lat + W;
      const roomRight = W - o.proj.lat;
      const dir = roomRight > roomLeft ? 1 : -1;
      const want = o.proj.lat + dir * 3.4 - (line + this.pref * 0.5);
      if (Math.abs(want) > Math.abs(targetAvoid)) targetAvoid = want * (1 - ds / 22);
      if (ds < 8 && Math.abs(dl) < 2.3 && o.speed < speed) lift = Math.min(lift, 0.3 + 0.1 * this.aggr);
    }
    this.avoid += (clamp(targetAvoid, -W, W) - this.avoid) * Math.min(1, dt * 2.2);
    // brání jen na rovince, v zatáčce jede ideální stopu
    const straight = Math.abs(tr.kappaS[kA]) < 0.006;
    const wantDefend = defendLat != null && straight && targetAvoid === 0 ? clamp(defendLat - baseLat, -2.2, 2.2) * this.diff.defend * (0.8 + 0.4 * this.aggr) : 0;
    this.defend += (wantDefend - this.defend) * Math.min(1, dt * 1.2);

    let throttle = 0, brake = 0;
    const dv = vt - speed;
    if (dv > 1) throttle = 1;
    else if (dv > -1.5) throttle = clamp(0.35 + dv * 0.3, 0, 1);
    else brake = clamp(-dv / 7, 0.25, 1);
    // uprostřed zatáčky na hraně přilnavosti přivře plyn, plný plyn by auto vytlačil ven
    const demand = (speed * speed * Math.max(Math.abs(tr.kappaS[tr.indexAt(s)]), Math.abs(tr.kappaS[tr.indexAt(s + 6)]))) / (this.grip * this.feel);
    if (demand > 0.75) throttle = Math.min(throttle, clamp((1.1 - demand) * 3, 0.15, 1));
    throttle *= lift;
    if (this.mistake > 0 && this.mistakeKind === 'lift') throttle *= 0.35;

    if (this.diff.nitroRegen) car.nitro = Math.min(1, car.nitro + dt * this.diff.nitroRegen);
    let nitro = false;
    if (this.diff.nitro && car.nitro > 0.55 - 0.3 * this.aggr && speed > 28 && dv > 6 && Math.abs(tr.kappaS[tr.indexAt(s + 50)]) < 0.004) nitro = true;

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
