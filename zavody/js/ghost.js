// Ghost: záznam nejlepšího kola a jeho přehrávání v časovce.
import { angleDiff } from './rng.js';

const RATE = 20; // snímků za sekundu

export class GhostRecorder {
  constructor() {
    this.frames = [];
    this.acc = 0;
  }
  reset() {
    this.frames = [];
    this.acc = 0;
  }
  sample(dt, car) {
    this.acc += dt;
    while (this.acc >= 1 / RATE) {
      this.acc -= 1 / RATE;
      this.frames.push(
        Math.round(car.x * 100) / 100,
        Math.round(car.y * 100) / 100,
        Math.round(car.z * 100) / 100,
        Math.round(car.hd * 1000) / 1000,
      );
    }
  }
  finish(lapTime) {
    return { time: lapTime, rate: RATE, frames: this.frames.slice() };
  }
}

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
