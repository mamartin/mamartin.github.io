// Efekty u aut: stopy a kouř pneumatik, prach, sprška na mokru, plameny nitra, jiskry o svodidla.
import { SURF_OFF } from './track.js';
import { clamp } from './rng.js';
import { G, audio, view, buzz } from './state.js';
import { addDamage } from './damage.js';

const wl = [0, 0, 0], wr = [0, 0, 0];
// ujetý sníh je šedomodrý, ne černý jako guma na asfaltu
const SNOW_TRACK = [0.42, 0.47, 0.55];
export function emitEffects(dt) {
  const race = G.race;
  const w = G.world;
  const fx = w.effects;
  const smokeCol = w.biome.night ? [0.5, 0.52, 0.58] : [0.82, 0.82, 0.8];
  const sprayCol = w.biome.night ? [0.45, 0.5, 0.56] : [0.7, 0.75, 0.8];
  const cams = race.players.length > 1 ? [view.camera, view.camera2] : [view.camera];
  const winter = w.def.biome === 'winter';
  for (const car of race.cars) {
    const far = cams.every((c) => (car.x - c.position.x) ** 2 + (car.z - c.position.z) ** 2 > 170 * 170);
    car.rearWheels(wl, wr);
    if (car.skidding && car.proj && Math.abs(car.proj.lat) < w.track.edge) {
      if (car.lastWheels) {
        const [pl, pr] = car.lastWheels;
        const d = Math.hypot(wl[0] - pl[0], wl[2] - pl[2]);
        if (d > 0.35) {
          if (d < 4) {
            const rx = -Math.cos(car.hd), rz = Math.sin(car.hd);
            const a = clamp(car.slip * 2.2, 0.25, 0.55);
            fx.skids.add(pl, wl, 0.3, a, rx, rz);
            fx.skids.add(pr, wr, 0.3, a, rx, rz);
          }
          car.lastWheels = [[...wl], [...wr]];
        }
      } else car.lastWheels = [[...wl], [...wr]];
      if (!far && Math.random() < dt * 40) {
        const amt = clamp(car.slip * 2.5, 0.3, 1.4);
        if (car.surface === SURF_OFF) fx.dust(wl[0], wl[1], wl[2], car.vx, car.vz, w.biome.dust);
        else {
          fx.tireSmoke(wl[0], wl[1], wl[2], car.vx, car.vz, amt, smokeCol);
          fx.tireSmoke(wr[0], wr[1], wr[2], car.vx, car.vz, amt, smokeCol);
        }
      }
    } else car.lastWheels = null;
    // sníh: kola nechávají koleje (na zasněžené silnici i mimo ni) a víří sníh
    const inSnow = winter && (w.snowy || car.surface === SURF_OFF) && car.proj && Math.abs(car.proj.lat) < w.track.edge;
    if (inSnow && car.speed > 2) {
      const prev = car.snowWheels;
      if (prev) {
        const d = Math.hypot(wl[0] - prev[0][0], wl[2] - prev[0][2]);
        if (d > 1.1) {
          if (d < 5) {
            const rx = -Math.cos(car.hd), rz = Math.sin(car.hd);
            const a = car.surface === SURF_OFF ? 0.42 : 0.2;
            fx.snowTracks.add(prev[0], wl, 0.32, a, rx, rz, SNOW_TRACK);
            fx.snowTracks.add(prev[1], wr, 0.32, a, rx, rz, SNOW_TRACK);
          }
          car.snowWheels = [[...wl], [...wr]];
        }
      } else car.snowWheels = [[...wl], [...wr]];
      if (!far && car.speed > 10 && Math.random() < dt * (car.surface === SURF_OFF ? 30 : 14)) {
        const amt = clamp((car.speed - 10) / 35, 0.25, 1) * (car.skidding ? 1.4 : 1);
        fx.snowSpray(wl[0], wl[1], wl[2], car.vx, car.vz, amt);
        fx.snowSpray(wr[0], wr[1], wr[2], car.vx, car.vz, amt);
      }
    } else car.snowWheels = null;
    // na mokru zvedají kola za sebou spršku vody
    if (w.wet && !far && car.speed > 12 && car.surface !== SURF_OFF && Math.random() < dt * 18) {
      const amt = clamp((car.speed - 12) / 40, 0.2, 0.75);
      fx.tireSmoke(wl[0], wl[1], wl[2], car.vx, car.vz, amt, sprayCol);
      fx.tireSmoke(wr[0], wr[1], wr[2], car.vx, car.vz, amt, sprayCol);
    }
    if (!far && car.surface === SURF_OFF && car.speed > 6 && Math.random() < dt * 30) {
      fx.dust(wl[0], wl[1], wl[2], car.vx, car.vz, w.biome.dust);
      fx.dust(wr[0], wr[1], wr[2], car.vx, car.vz, w.biome.dust);
    }
    if ((car.nitroActive || car.launchBoost > 0 || car.turbo > 0) && !far) {
      const s = Math.sin(car.hd), c = Math.cos(car.hd);
      const bx = car.x - s * 2.35, bz = car.z - c * 2.35;
      const rx = -c, rz = s;
      fx.nitroFlame(bx + rx * 0.4, car.y + 0.42, bz + rz * 0.4, -s, -c, car.vx, car.vz);
      fx.nitroFlame(bx - rx * 0.4, car.y + 0.42, bz - rz * 0.4, -s, -c, car.vx, car.vz);
    }
    if (car.impact > 2.5) {
      const side = Math.sign(car.proj.lat);
      const x = car.x + car.proj.rx * side * 1.0, z = car.z + car.proj.rz * side * 1.0;
      if (!far) fx.sparks(x, car.y, z, car.proj.rx * side, car.proj.rz * side, car.impact);
      addDamage(car, x, z, car.impact);
      if (car.isPlayer) {
        audio.impact(car.impact);
        view.rigs[car.humanIndex].addShake(Math.min(0.9, car.impact * 0.05));
        buzz(Math.min(70, 10 + car.impact * 4));
      }
    }
  }
}
