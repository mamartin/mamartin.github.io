// Syntetizované zvuky přes WebAudio – bez jediného audio souboru.
import { clamp } from './rng.js';

const GEAR_TOPS = [0, 13, 22, 31, 40, 49, 75];

export class GearBox {
  constructor() {
    this.gear = 1;
    this.rpm = 900;
  }
  update(dt, speed, throttle, onGrid) {
    let target;
    if (onGrid) {
      this.gear = 1;
      target = 900 + throttle * 6200;
    } else {
      let g = this.gear;
      while (g < 6 && speed > GEAR_TOPS[g]) g++;
      while (g > 1 && speed < GEAR_TOPS[g - 1] * 0.82) g--;
      this.gear = g;
      const lo = g === 1 ? 0 : GEAR_TOPS[g - 1] * 0.62;
      const hi = GEAR_TOPS[g];
      const t = clamp((speed - lo) / (hi - lo), 0, 1);
      target = 1000 + t * 6600 + throttle * 250;
    }
    this.rpm += (target - this.rpm) * Math.min(1, dt * (onGrid ? 6 : 10));
    return this.rpm;
  }
}

class EngineVoice {
  constructor(ctx, out, level) {
    this.ctx = ctx;
    this.level = level;
    this.o1 = ctx.createOscillator();
    this.o1.type = 'sawtooth';
    this.o2 = ctx.createOscillator();
    this.o2.type = 'square';
    this.o3 = ctx.createOscillator();
    this.o3.type = 'sawtooth';
    this.o3.detune.value = 12;
    const g1 = ctx.createGain(), g2 = ctx.createGain(), g3 = ctx.createGain();
    g1.gain.value = 0.5;
    g2.gain.value = 0.32;
    g3.gain.value = 0.18;
    this.shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2);
    }
    this.shaper.curve = curve;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 2.5;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.o1.connect(g1).connect(this.shaper);
    this.o2.connect(g2).connect(this.shaper);
    this.o3.connect(g3).connect(this.shaper);
    this.shaper.connect(this.filter).connect(this.gain).connect(out);
    this.o1.start();
    this.o2.start();
    this.o3.start();
  }
  set(rpm, throttle, vol) {
    const t = this.ctx.currentTime;
    const f = (rpm / 60) * 2;
    this.o1.frequency.setTargetAtTime(f, t, 0.02);
    this.o2.frequency.setTargetAtTime(f * 0.5, t, 0.02);
    this.o3.frequency.setTargetAtTime(f * 2.01, t, 0.02);
    this.filter.frequency.setTargetAtTime(280 + throttle * 1500 + rpm * 0.22, t, 0.04);
    this.gain.gain.setTargetAtTime(vol * this.level * (0.5 + 0.5 * throttle), t, 0.05);
  }
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.8;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.player = new EngineVoice(ctx, this.master, 0.3);
    this.rival = new EngineVoice(ctx, this.master, 0.16);
    this.skid = this.loopNoise('bandpass', 950, 1.4);
    this.wind = this.loopNoise('lowpass', 520, 0.7);
    this.nitro = this.loopNoise('highpass', 1600, 0.8);
    this.offroad = this.loopNoise('lowpass', 260, 1.0);
  }

  loopNoise(type, freq, q) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    return { src, f, g };
  }

  // dva hráči: druhý motor hraje stejně nahlas jako první
  setDuo(on) {
    if (this.rival) this.rival.level = on ? 0.3 : 0.16;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  // průběžná aktualizace smyček
  update(s) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.player.set(s.rpm, s.throttle, s.active ? 1 : 0);
    const rv = s.rivalDist != null ? clamp(1 / (1 + s.rivalDist / 10), 0, 1) : 0;
    this.rival.set(s.rivalRpm ?? 3000, 0.8, s.active ? rv : 0);
    this.skid.g.gain.setTargetAtTime(s.active ? clamp(s.skid, 0, 1) * 0.28 : 0, t, 0.05);
    this.skid.f.frequency.setTargetAtTime(700 + clamp(s.speed, 0, 50) * 12, t, 0.1);
    this.wind.g.gain.setTargetAtTime(s.active ? clamp(s.speed / 60, 0, 1.3) * 0.13 : 0, t, 0.1);
    this.nitro.g.gain.setTargetAtTime(s.active && s.nitro ? 0.16 : 0, t, 0.05);
    this.offroad.g.gain.setTargetAtTime(s.active && s.offroad ? clamp(s.speed / 30, 0, 1) * 0.32 : 0, t, 0.08);
  }

  silence() {
    this.update({ rpm: 900, throttle: 0, active: false, skid: 0, speed: 0 });
  }

  env(g, t, a, peak, dec) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }

  tone(freq, dur, type = 'sine', peak = 0.25, when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    o.connect(g).connect(this.master);
    this.env(g, t, 0.01, peak, dur);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  burst(dur, type, freq, peak, sweepTo) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = this.ctx.createGain();
    src.connect(f).connect(g).connect(this.master);
    this.env(g, t, 0.005, peak, dur);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  beep(high) {
    this.tone(high ? 1046 : 523, high ? 0.6 : 0.22, 'square', 0.12);
  }

  impact(strength) {
    const s = clamp(strength / 15, 0.1, 1);
    this.burst(0.25 + s * 0.2, 'lowpass', 900, 0.5 * s);
    this.tone(55 + Math.random() * 20, 0.25, 'sine', 0.5 * s);
  }

  chime() {
    this.tone(784, 0.25, 'triangle', 0.2);
    this.tone(1175, 0.4, 'triangle', 0.2, 0.12);
  }

  fanfare() {
    [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this.tone(f, i === 5 ? 0.8 : 0.18, 'triangle', 0.22, i * 0.13));
  }

  pickup() {
    [660, 880, 1320].forEach((f, i) => this.tone(f, 0.12, 'square', 0.08, i * 0.05));
  }

  launch() {
    this.burst(0.5, 'bandpass', 500, 0.35, 3000);
  }

  explosion() {
    this.burst(1.1, 'lowpass', 1400, 0.9, 120);
    this.tone(48, 0.6, 'sine', 0.6);
  }
}

// --- hudba -------------------------------------------------------------------
// Procedurální synthwave smyčka Am–F–C–G. V menu klidná, v závodě s bicími.

const CHORDS = [
  [57, 60, 64],
  [53, 57, 60],
  [48, 52, 55],
  [55, 59, 62],
];
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const BPM = 112;

export class Music {
  constructor(audio) {
    this.a = audio;
    this.enabled = true;
    this.intensity = 0;
    this.step = 0;
    this.timer = null;
    this.sixteenth = 60 / BPM / 4;
  }

  setup() {
    const ctx = this.a.ctx;
    if (!ctx || this.bus) return !!this.bus;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(this.a.master);
    // ozvěna pro arpeggio
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = this.sixteenth * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.delay.connect(fb).connect(this.delay);
    this.delay.connect(wet).connect(this.bus);
    return true;
  }

  start() {
    if (!this.enabled || this.timer || !this.setup()) return;
    const ctx = this.a.ctx;
    this.nextTime = ctx.currentTime + 0.08;
    this.timer = setInterval(() => this.schedule(), 25);
    this.fade();
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    if (this.bus) this.bus.gain.setTargetAtTime(0, this.a.ctx.currentTime, 0.2);
  }

  setEnabled(on) {
    this.enabled = on;
    if (on) this.start();
    else this.stop();
  }

  // 0 = menu, 1 = závod
  setIntensity(v) {
    if (this.intensity === v) return;
    this.intensity = v;
    this.fade();
  }

  fade() {
    if (!this.bus) return;
    this.bus.gain.setTargetAtTime(this.intensity > 0.5 ? 0.6 : 1.0, this.a.ctx.currentTime, 0.4);
  }

  schedule() {
    const ctx = this.a.ctx;
    while (this.nextTime < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += this.sixteenth;
      this.step = (this.step + 1) % 64;
    }
  }

  playStep(step, t) {
    const chord = CHORDS[Math.floor(step / 16) % 4];
    const s = step % 16;
    const full = this.intensity > 0.5;
    if (s % 2 === 0) this.bass(midi(chord[0] - 12), t, full ? 0.2 : 0.11);
    const arp = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[1] + 12];
    if (full || s % 2 === 0) this.arp(midi(arp[s % 4] + (s >= 8 && full ? 12 : 0)), t, full ? 0.045 : 0.04);
    if (s === 0) this.pad(chord.map(midi), t, this.sixteenth * 16, full ? 0.03 : 0.05);
    if (full) {
      if (s % 4 === 0) this.kick(t);
      if (s === 4 || s === 12) this.snare(t);
      if (s % 2 === 1) this.hat(t, s === 15 ? 0.05 : 0.03);
    }
  }

  env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  voice(type, freq, t, dur, peak, filterFreq, dest = this.bus) {
    const ctx = this.a.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filterFreq;
    const g = ctx.createGain();
    o.connect(f).connect(g).connect(dest);
    this.env(g, t, 0.006, peak, dur);
    o.start(t);
    o.stop(t + dur + 0.05);
    return g;
  }

  bass(freq, t, peak) {
    this.voice('sawtooth', freq, t, this.sixteenth * 1.8, peak, 420);
  }

  arp(freq, t, peak) {
    const g = this.voice('square', freq, t, 0.12, peak, 2600);
    g.connect(this.delay);
  }

  pad(freqs, t, dur, peak) {
    const ctx = this.a.ctx;
    for (const f0 of freqs) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f0;
        o.detune.value = det;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 900;
        const g = ctx.createGain();
        o.connect(f).connect(g).connect(this.bus);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.35);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.05);
        o.start(t);
        o.stop(t + dur * 1.1);
      }
    }
  }

  kick(t) {
    const ctx = this.a.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const g = ctx.createGain();
    o.connect(g).connect(this.bus);
    this.env(g, t, 0.003, 0.5, 0.22);
    o.start(t);
    o.stop(t + 0.3);
  }

  noise(t, type, freq, dur, peak) {
    const ctx = this.a.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.a.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    src.connect(f).connect(g).connect(this.bus);
    this.env(g, t, 0.002, peak, dur);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  snare(t) {
    this.noise(t, 'bandpass', 1900, 0.16, 0.22);
    this.voice('triangle', 190, t, 0.08, 0.12, 2000);
  }

  hat(t, peak) {
    this.noise(t, 'highpass', 7500, 0.04, peak);
  }
}
