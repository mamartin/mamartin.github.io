// Medaile za nejlepší kolo. Limity vychází z letmého kola autopilota (pevná úroveň AI bez chyb)
// na suché trati, které se spočítá krátkou simulací bez vykreslování a uloží do mezipaměti.
import { Race } from './race.js';
import { Track } from './track.js';
import { BIOMES } from './biomes.js';
import { disposeCarMesh } from './car.js';

const STEP = 1 / 120; // stejný krok fyziky jako ve hře

export const MEDALS = [
  { id: 'gold', name: 'Zlato', mul: 1.0 },
  { id: 'silver', name: 'Stříbro', mul: 1.05 },
  { id: 'bronze', name: 'Bronz', mul: 1.12 },
];

const KEY = 'turbo-okruh-ref';
const VERSION = 4;
let cache = null;

function load() {
  try {
    cache = JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    cache = {};
  }
  if (cache.v !== VERSION) cache = { v: VERSION };
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // bez úložiště se limity jen spočítají znovu
  }
}

// klíč i podle tvaru trati (vlastní tratě se dají upravit)
function keyOf(def, kind) {
  let h = 0;
  for (const p of def.points) for (const v of p) h = (h * 31 + Math.round(v)) | 0;
  return `${def.id}|${kind}|${h}`;
}

export function hasReference(def, kind) {
  if (!cache) load();
  return cache[keyOf(def, kind)] != null;
}

// čas letmého kola autopilota; první volání pro trať a vůz trvá zlomek sekundy
export function referenceLap(def, kind) {
  if (!cache) load();
  const key = keyOf(def, kind);
  if (cache[key] == null) {
    const race = new Race({ track: new Track(def), biome: BIOMES[def.biome], mode: 'time', laps: 2, playerKinds: [kind] });
    race.setAutopilot(true, race.player, 'reference');
    const pilot = race.autopilot;
    pilot.diff = { ...pilot.diff, mistakes: 0 };
    const idle = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
    const laps = race.player.lapTimes;
    for (let n = 0; laps.length < 2 && n < 300 / STEP; n++) {
      race.step(STEP, [idle]);
      race.events.length = 0;
    }
    for (const c of race.cars) disposeCarMesh(c.mesh);
    cache[key] = laps[1] ?? 0;
    save();
  }
  return cache[key];
}

// medaile pro čas kola (null = žádná)
export function medalFor(def, kind, lap) {
  const ref = referenceLap(def, kind);
  if (!ref || !lap || !isFinite(lap)) return null;
  return MEDALS.find((m) => lap <= ref * m.mul) || null;
}

// nejbližší lepší medaile a kolik na ni chybí
export function nextMedal(def, kind, lap) {
  const ref = referenceLap(def, kind);
  if (!ref || !lap || !isFinite(lap)) return null;
  const better = [...MEDALS].reverse().find((m) => lap > ref * m.mul);
  return better ? { ...better, gap: lap - ref * better.mul } : null;
}
