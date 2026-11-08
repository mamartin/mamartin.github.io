// AI řidič: sleduje ideální stopu, brzdí podle rychlostního profilu trati a své stopy, předjíždí
// tam, kde je místo, brání pozici, vyprošťuje se ode zdi a občas udělá chybu.
import { clamp, angleDiff, RNG } from './rng.js';
import { smoothCircular } from './trackmath.js';
import { settGrip } from './track.js';
import { CAR } from './car.js';
import { DRIVERS, nameSeed } from './drivers.js';

// --- stopa AI -------------------------------------------------------------
// Stopa s nejmenším zakřivením v mezích skutečné šířky silnice (track.hwAt, tedy i def.widths):
// vnější nájezd, vrchol u vnitřního okraje, výjezd ven. Střed auta drží LINE_MARGIN od kraje asfaltu,
// v úzkých ulicích tak AI neleze na chodník a v ostrém rohu pořád využije, co šířka dovolí.
const LINE_MARGIN = 1.4;
const lines = new WeakMap();

export function aiLine(tr) {
  let line = lines.get(tr);
  if (line) return line;
  const { N, px, pz, rx, rz } = tr;
  const W = new Float64Array(N);
  for (let k = 0; k < N; k++) W[k] = Math.max(0.3, tr.hwAt(k) - LINE_MARGIN);
  const lat = Float64Array.from(tr.racingLat, (v, k) => clamp(v, -W[k], W[k]));
  // vyrovnání zakřivení (metoda K1999): zakřivení v bodě se posouvá na průměr sousedů, takže
  // mezi dotyky s okrajem se mění plynule a zatáčka se projede jedním širokým obloukem od vnějšího
  // nájezdu přes vrchol u vnitřního okraje po výjezd ven. Nejdřív jen každý m-tý bod (mezi nimi
  // lineárně), pak v detailu; jen pár milisekund i na dlouhé trati.
  const x = new Float64Array(N), z = new Float64Array(N);
  const put = (k) => {
    x[k] = px[k] + rx[k] * lat[k];
    z[k] = pz[k] + rz[k] * lat[k];
  };
  for (let k = 0; k < N; k++) put(k);
  const curv = (a, b, c) => {
    const ux = x[b] - x[a], uz = z[b] - z[a], vx = x[c] - x[b], vz = z[c] - z[b], wx = ux + vx, wz = uz + vz;
    const d = Math.sqrt((ux * ux + uz * uz) * (vx * vx + vz * vz) * (wx * wx + wz * wz));
    return d > 1e-9 ? (2 * (ux * vz - uz * vx)) / d : 0;
  };
  for (const [m, iters] of [[16, 40], [8, 30], [4, 30], [2, 30], [1, 30]]) {
    const idx = [];
    for (let k = 0; k + m / 2 < N || k === 0; k += m) idx.push(k);
    const n = idx.length;
    for (let it = 0; it < iters; it++) {
      for (let j = 0; j < n; j++) {
        const k = idx[j], a = idx[(j - 1 + n) % n], b = idx[(j + 1) % n];
        const target = (curv(idx[(j - 2 + n) % n], a, k) + curv(k, b, idx[(j + 2) % n])) / 2;
        // změna zakřivení při posunu bodu k o metr do strany (bod se hýbe po normále)
        const ux = x[k] - x[a], uz = z[k] - z[a], vx = x[b] - x[k], vz = z[b] - z[k];
        const cx = x[b] - x[a], cz = z[b] - z[a];
        const d = Math.sqrt((ux * ux + uz * uz) * (vx * vx + vz * vz) * (cx * cx + cz * cz));
        if (d < 1e-9) continue;
        const c0 = (2 * (ux * vz - uz * vx)) / d;
        const dc = (2 * (rx[k] * cz - rz[k] * cx)) / d;
        if (Math.abs(dc) < 1e-7) continue;
        lat[k] = clamp(lat[k] + clamp((target - c0) / dc, -1, 1), -W[k], W[k]);
        put(k);
      }
    }
    if (m > 1) {
      // body mezi optimalizovanými lineárně
      for (let j = 0; j < n; j++) {
        const k0 = idx[j], k1 = j + 1 < n ? idx[j + 1] : N;
        const l0 = lat[k0], l1 = lat[k1 % N];
        for (let k = k0 + 1; k < k1; k++) {
          lat[k] = clamp(l0 + ((l1 - l0) * (k - k0)) / (k1 - k0), -W[k], W[k]);
          put(k);
        }
      }
    }
  }
  // zakřivení stopy (kružnice třemi body po 4 m) a délky úseků
  const raw = new Float64Array(N), ds = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    const a = (k - 2 + N) % N, b = (k + 2) % N, n = (k + 1) % N;
    const ax = x[k] - x[a], az = z[k] - z[a], bx = x[b] - x[k], bz = z[b] - z[k];
    const cross = ax * bz - az * bx;
    const cx = x[b] - x[a], cz = z[b] - z[a];
    raw[k] = (2 * cross) / (Math.sqrt((ax * ax + az * az) * (bx * bx + bz * bz) * (cx * cx + cz * cz)) || 1);
    ds[k] = Math.sqrt((x[n] - x[k]) ** 2 + (z[n] - z[k]) ** 2);
  }
  line = { lat: Float32Array.from(lat), kappa: Float32Array.from(smoothCircular(raw, 2)), ds, profiles: new Map() };
  lines.set(tr, line);
  return line;
}

// nejvyšší rychlost po stopě AI: boční přilnavost aLat, brzdění brake (m/s²), strop vmax
export function lineProfile(tr, aLat, brake, vmax) {
  const line = aiLine(tr);
  const key = `${aLat.toFixed(1)}|${brake}|${vmax}`;
  let v = line.profiles.get(key);
  if (v) return v;
  const N = tr.N, kap = line.kappa;
  v = new Float32Array(N);
  for (let k = 0; k < N; k++) v[k] = Math.min(vmax, Math.sqrt(aLat / Math.max(Math.abs(kap[k]), 1e-4)));
  for (let pass = 0; pass < 2; pass++) {
    for (let k = N - 1; k >= 0; k--) {
      const n = (k + 1) % N;
      const lim = Math.sqrt(v[n] * v[n] + 2 * brake * line.ds[k]);
      if (lim < v[k]) v[k] = lim;
    }
  }
  line.profiles.set(key, v);
  return v;
}

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
    this.recoverMin = 0;
    this.passDir = 0; // strana rozjetého předjíždění (−1/1), 0 = nepředjíždí
    this.lastLat = null;
    this.rubber = 1;
    this.gain = 4.5;
    this.maxLat = 0.9;
    this.wantsRespawn = false;
    this.tmp = {};
    this.line = aiLine(track);
    this.setRoadGrip(car.biome.roadGrip ?? 1);
  }

  // boční přilnavost a brzdění, se kterými AI počítá po své stopě (proměnlivé počasí je mění za jízdy)
  setRoadGrip(rg) {
    this.rg = rg;
    this.aLat = 0.93 * this.grip * this.feel * rg;
    this.brakeA = 18 * rg;
    this.lineV = lineProfile(this.track, this.aLat, this.brakeA, 80);
  }

  update(dt, cars) {
    const car = this.car, tr = this.track, P = car.proj, c = car.controls;
    this.time += dt;
    const speed = car.speed;
    const s = P.s;
    const rg = car.biome.roadGrip ?? 1;
    if (Math.abs(rg - this.rg) > 0.02) this.setRoadGrip(rg);

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
    // nosem ke zdi (stojí u kraje a míří ven z trati): couvnout hned, ne až po chvíli stání
    const toWall = Math.sin(angleDiff(P.hd, car.hd)) * Math.sign(P.lat);
    const atWall = Math.abs(P.lat) > tr.edgeAt(P.i) - car.spec.halfWidth - 1.2 && toWall < -0.5;
    // v protisměru v malé rychlosti: otočit se couváním na tři body, široký obrat v úzké ulici
    // by skončil v protější zdi
    const backward = speed < 5 && Math.abs(angleDiff(P.hd, car.hd)) > 1.9;
    if (this.recover <= 0 && (this.stuck > 1.2 || (atWall && this.stuck > 0.4) || backward)) {
      this.recover = 1.6;
      this.recoverMin = 0.4;
    }

    // --- cíl řízení: bod na stopě kus před autem (+ osobní posun, vyhýbání a obrana)
    const Ld = 7 + speed * 0.42;
    const kA = tr.indexAt(s + Ld);
    const line = this.line.lat[kA];
    const hw = tr.hwAt(kA);
    const W = hw - 1.5;
    const baseLat = line + this.pref * (1 - Math.abs(line) / Math.max(1, hw - 2)) + this.avoid;
    const tgt = tr.sampleAt(s + Ld, clamp(baseLat + this.defend, -W, W), this.tmp);
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
    const grip = this.maxLat * this.feel * this.grip * (car.biome.roadGrip ?? 1) * (tr.onSett(s) || tr.onSett(s + look) ? settGrip(car.biome.wet) : 1);
    vt = Math.min(vt, Math.sqrt(grip / Math.max(Math.abs(tr.kappaS[k]), 1e-4)), 1.08 * Math.sqrt(grip / Math.max(Math.abs(tr.kappaS[k2]), 1e-4)));
    // a ne rychleji, než projede skutečnou stopu: v úzké ulici je ostrá zatáčka ostrá i po stopě,
    // profil stopy navíc nese brzdné body před ní
    vt = Math.min(vt, this.lineV[tr.indexAt(s + 2)], this.lineV[k]);
    // uhnutí ze stopy (předjíždění, obrana) blíž k vnitřku zatáčky: ostřejší oblouk, menší rychlost
    const off = this.avoid + this.defend;
    if (Math.abs(off) > 0.3) {
      for (const d of [2, look, look + speed * 0.5]) {
        const kk = tr.indexAt(s + d), kl = Math.abs(this.line.kappa[kk]);
        const inside = -off * Math.sign(tr.kappaS[kk]);
        const ko = kl / Math.max(0.3, 1 - kl * inside);
        vt = Math.min(vt, Math.sqrt(this.aLat / Math.max(ko, 1e-4) + 2 * this.brakeA * (d - 2)));
      }
    }

    // --- chyby: občas přežene nájezd do zatáčky (vyletí ven) nebo zaváhá na plynu
    if (this.mistake > 0) this.mistake -= dt;
    else if (this.time > 4 && speed > 20 && this.rng.chance(this.diff.mistakes * this.errors * dt)) {
      this.mistakeKind = this.rng.chance(0.6) ? 'late' : 'lift';
      this.mistake = this.mistakeKind === 'late' ? 1.6 : 0.9;
    }
    // v úzké ulici je zeď blízko: přehnaný nájezd jen mírnější
    if (this.mistake > 0 && this.mistakeKind === 'late') vt *= 1 + 0.13 * clamp((hw - 4) / 3, 0.4, 1);

    // --- ostatní auta
    let targetAvoid = 0, beside = null, defendLat = null, lift = 1, passing = 0;
    const L = tr.L;
    const ref = line + this.pref * 0.5;
    const vFree = vt; // kolik by jel bez provozu: předjíždí se, jen když je na soupeře rychlost
    for (const o of cars) {
      if (o === car || o.ghostTimer > 0 || o.cut) continue;
      let ds = o.proj.s - s;
      if (ds < -L / 2) ds += L;
      else if (ds > L / 2) ds -= L;
      const dl = o.proj.lat - P.lat;
      // někdo se tlačí zezadu: přesunout se před něj (jen jeden plynulý přesun, žádné kličkování);
      // když už je vedle, uhnout mu do cesty by znamenalo náraz
      if (ds > -14 && ds < -4.5 && o.speed > speed - 2 && Math.abs(dl) < 4) defendLat = o.proj.lat;
      // vedle sebe: držet boční odstup na své straně (u zdi jen do kraje silnice), i když se
      // k sobě teprve sjíždějí (boční rychlost obou aut za 0,4 s)
      if (Math.abs(ds) < 5.5) {
        const vlat = (o.vx * P.rx + o.vz * P.rz) - (car.vx * P.rx + car.vz * P.rz);
        const fut = dl + vlat * 0.4;
        const near = Math.sign(fut) !== Math.sign(dl) ? 0 : Math.min(Math.abs(dl), Math.abs(fut));
        if (near < 2.7 && (!beside || near < beside.near)) beside = { dl, ds, near, lat: o.proj.lat };
      }
      if (ds <= 0 || ds > 18) continue;
      if (Math.abs(dl) > 3.2) continue;
      // kam se soupeř posune: AI i hráč se drží zhruba stopy, takže místo vedle něj se měří
      // proti jeho poloze teď i za chvíli; předjíždí se jen tam, kde se vedle něj vejde
      const oFut = 0.4 * o.proj.lat + 0.6 * this.line.lat[tr.indexAt(o.proj.s + Math.min(25, o.speed * 0.7))];
      const lo = Math.min(o.proj.lat, oFut), hi = Math.max(o.proj.lat, oFut);
      const roomLeft = lo + W, roomRight = W - hi;
      // strana předjíždění vydrží, dokud je na ní místo (přehození uprostřed zatáčky by auto nedotočilo)
      let dir = this.passDir && (this.passDir > 0 ? roomRight : roomLeft) >= 2.2 ? this.passDir : roomRight > roomLeft ? 1 : -1;
      const quicker = vFree > o.speed + 1.5 || speed > o.speed + 1.5 || dir === this.passDir;
      if (quicker && ((dir > 0 ? roomRight : roomLeft) >= 2.6 || dir === this.passDir)) {
        passing = dir;
        const want = (dir > 0 ? hi : lo) + dir * 3.2 - ref;
        if (Math.abs(want) > Math.abs(targetAvoid)) targetAvoid = want * (1 - ds / 22);
      }
      // přímo za ním: odstup podle rychlosti, ať do něj nenajede (v úzké ulici se nedá vždy uhnout)
      if (Math.abs(dl) < 2.3) {
        vt = Math.min(vt, o.speed + Math.max(0, ds - 5) * 0.6);
        if (ds < 8 && o.speed < speed) lift = Math.min(lift, 0.3 + 0.1 * this.aggr);
      }
    }
    if (beside) {
      const side = beside.dl > 0 ? -1 : 1;
      targetAvoid = clamp(beside.lat + side * 2.8, -W, W) - ref;
      // u kraje už není kam uhnout: kdo je o kus vzadu, ubere a zařadí se za něj
      if (beside.ds > 1 && Math.abs(P.lat + side * 0.5) > W) lift = Math.min(lift, 0.5);
    }
    this.passDir = passing;
    // v ostrém oblouku se posun mění jen pomalu, auto by změnu stopy nedotočilo
    const calm = clamp(1.25 - Math.abs(this.line.kappa[k]) * 25, 0.3, 1);
    this.avoid += (clamp(targetAvoid, -W - ref, W - ref) - this.avoid) * Math.min(1, dt * (beside ? 3.5 : 2.2 * calm));
    // brání jen na rovince, v zatáčce jede ideální stopu; v úzké ulici jen naznačí
    const straight = Math.abs(tr.kappaS[kA]) < 0.006;
    const narrow = clamp((hw - 4) / 2.5, 0.4, 1);
    const wantDefend = defendLat != null && straight && targetAvoid === 0 ? clamp(defendLat - baseLat, -2.2, 2.2) * narrow * this.diff.defend * (0.8 + 0.4 * this.aggr) : 0;
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
    // nedotáčivost: volant na dorazu a auto se pořád sune ke kraji, tak ubrat, případně přibrzdit
    // (pomalejší auto zatočí ostřeji); brzda jen lehce, prudké brzdění v zatáčce by ubralo přilnavost
    // (skok polohy po respawnu se nepočítá)
    const latVel = dt > 0 && this.lastLat != null && Math.abs(P.lat - this.lastLat) < 1 ? (P.lat - this.lastLat) / dt : 0;
    this.lastLat = P.lat;
    const outward = latVel * Math.sign(P.lat);
    if (Math.abs(c.steer) > 0.9 && outward > 0.5 && speed > 10) {
      const t = (tr.hwAt(P.i) + 0.4 - Math.abs(P.lat)) / outward;
      if (t < 1) throttle = Math.min(throttle, clamp(t - 0.4, 0, 1) * 0.5);
      if (t < 0.6) brake = Math.max(brake, 0.35);
    }

    if (this.diff.nitroRegen) car.nitro = Math.min(1, car.nitro + dt * this.diff.nitroRegen);
    let nitro = false;
    if (this.diff.nitro && car.nitro > 0.55 - 0.3 * this.aggr && speed > 28 && dv > 6 && Math.abs(tr.kappaS[tr.indexAt(s + 50)]) < 0.004) nitro = true;

    if (this.recover > 0) {
      this.recover -= dt;
      this.recoverMin -= dt;
      // couvá, dokud se nenatočí zhruba po trati a neodlepí od zdi
      if (this.recoverMin <= 0 && Math.abs(err) < (backward ? 0.3 : 0.6) && !atWall) this.recover = 0;
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
