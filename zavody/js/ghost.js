// Ghost: záznam nejlepšího kola a jeho přehrávání v časovce.
import { angleDiff } from './rng.js';

const RATE = 20; // snímků za sekundu

// Snímek k se přehrává v čase k / RATE od startu kola, proto se první snímek bere hned v kroku,
// kdy kolo začalo, a další přesně po 1 / RATE. Kolo se dělí v kroku fyziky, kdy auto projelo
// cílem (podle car.lap), ne až při zpracování události: v jednom snímku obrazovky je víc kroků.
export class GhostRecorder {
  constructor() {
    this.reset();
  }
  reset() {
    this.frames = [];
    this.acc = 0;
    this.lap = null;
    this.done = null; // snímky právě dokončeného kola, dokud si je nevezme finish()
  }
  sample(dt, car) {
    if (this.lap != null && car.lap !== this.lap) {
      this.done = this.frames;
      this.frames = [];
      this.acc = 0;
    }
    this.lap = car.lap;
    while (this.acc <= 1e-9) {
      this.acc += 1 / RATE;
      this.frames.push(
        Math.round(car.x * 100) / 100,
        Math.round(car.y * 100) / 100,
        Math.round(car.z * 100) / 100,
        Math.round(car.hd * 1000) / 1000,
      );
    }
    this.acc -= dt;
  }
  // ghost dokončeného kola (záznam dalšího kola už mezitím běží dál)
  finish(lapTime) {
    const frames = this.done || this.frames;
    this.done = null;
    return { time: lapTime, rate: RATE, frames: frames.slice() };
  }
}

// uložený ghost, který jde přehrát (poškozené uložení se bere jako žádný ghost)
export const validGhost = (g) => !!g && Array.isArray(g.frames) && g.frames.length > 8 && g.frames.length % 4 === 0
  && g.rate > 0 && g.time > 0 && g.frames.every(Number.isFinite);

export class GhostPlayer {
  constructor(data) {
    this.data = data;
    this.out = { x: 0, y: 0, z: 0, hd: 0 };
  }
  at(t) {
    const f = this.data.frames;
    const n = f.length / 4;
    if (n < 2) return null;
    const pos = t * this.data.rate;
    if (pos >= n - 1) return null;
    const i = Math.max(0, Math.floor(pos));
    const u = pos - i;
    const a = i * 4, b = (i + 1) * 4;
    const o = this.out;
    o.x = f[a] + (f[b] - f[a]) * u;
    o.y = f[a + 1] + (f[b + 1] - f[a + 1]) * u;
    o.z = f[a + 2] + (f[b + 2] - f[a + 2]) * u;
    o.hd = f[a + 3] + angleDiff(f[a + 3], f[b + 3]) * u;
    return o;
  }
}
