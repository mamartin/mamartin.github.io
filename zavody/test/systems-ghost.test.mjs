// Ghost bez prohlížeče: záznam musí v čase t od startu kola ukázat polohu auta v čase t,
// i když se v jednom snímku obrazovky spustí víc kroků fyziky a kolo skončí uprostřed nich.
// Spuštění: node --test test/systems-ghost.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GhostRecorder, GhostPlayer } from '../js/ghost.js';

const STEP = 1 / 120;
const SPEED = 50; // m/s po ose x, kolo = 1000 m

// smyčka jako v main.js: frameDt rozdělený na kroky, po kroku sample, události kola až po snímku
function drive(frameDt, until) {
  const rec = new GhostRecorder();
  const car = { x: 0, y: 0, z: 0, hd: 0, lap: 0, lapStart: 0 };
  const laps = [];
  let time = 0, acc = 0;
  while (time < until) {
    acc += frameDt;
    const events = [];
    while (acc >= STEP - 1e-12) {
      // první krok závodu má čas 0 (jako Race.step při zhasnutí světel), další po STEP
      if (rec.lap != null) time += STEP;
      const dist = SPEED * time;
      car.x = dist % 1000;
      const lap = Math.floor(dist / 1000);
      if (lap > car.lap) {
        events.push({ lapTime: time - car.lapStart });
        car.lap = lap;
        car.lapStart = time;
      }
      rec.sample(STEP, car);
      acc -= STEP;
    }
    for (const e of events) laps.push(rec.finish(e.lapTime));
  }
  return laps;
}

for (const frameDt of [1 / 60, 0.1, 0.6]) {
  test(`ghost sedí na polohu auta (snímek ${frameDt.toFixed(3)} s)`, () => {
    const laps = drive(frameDt, 61);
    assert.ok(laps.length >= 2, 'aspoň dvě kola');
    for (const [k, data] of laps.entries()) {
      const g = new GhostPlayer(data);
      for (const t of [0, 0.01, 0.5, 7.3, 15, 19.9]) {
        const pos = g.at(t);
        assert.ok(pos, `kolo ${k + 1}: ghost v čase ${t} existuje`);
        // auto v čase t od startu kola je SPEED * t za čarou (kolo začalo nejvýš krok za čarou)
        const want = (SPEED * (t + k * 20)) % 1000;
        assert.ok(Math.abs(pos.x - want) < SPEED * STEP + 0.02, `kolo ${k + 1}, t=${t}: ghost x=${pos.x.toFixed(2)}, auto x=${want.toFixed(2)}`);
      }
    }
  });
}

test('poslední kolo (auto v cíli už se nezaznamenává) vrátí jeho snímky', () => {
  const rec = new GhostRecorder();
  const car = { x: 0, y: 0, z: 0, hd: 0, lap: 0 };
  for (let i = 0; i < 240; i++) {
    car.x = i;
    rec.sample(STEP, car);
  }
  const data = rec.finish(2);
  assert.equal(data.frames.length / 4, 40);
  assert.equal(data.frames[0], 0);
  assert.equal(data.frames[4], 6);
});
