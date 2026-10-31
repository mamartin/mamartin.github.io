// Definice tratí pro hru: pevné, náhodné, denní výzva, vlastní a obrácené; šampionáty a počasí.
import { TRACKS } from './tracks.js';
import { BIOMES } from './biomes.js';
import { randomTrackDef, buildCenterline, validateCenterline } from './trackmath.js';
import { RNG } from './rng.js';
import { customToDef } from './editor.js';
import { S, G, store } from './state.js';
import { seasonEvent } from './season.js';

// šampionáty: čtyři závody za sebou; bouřkový se jede v dešti
export const CUPS = [
  { id: 'classic', name: 'Klasický pohár', tracks: ['sumava', 'kanon', 'serpentiny', 'mesto'] },
  { id: 'reverse', name: 'Obrácený pohár', tracks: ['mesto~r', 'serpentiny~r', 'kanon~r', 'sumava~r'] },
  { id: 'storm', name: 'Bouřkový pohár', tracks: ['kanon', 'sumava~r', 'mesto', 'serpentiny~r'], rain: true },
];
export const currentCup = () => CUPS.find((c) => c.id === S.cup) || CUPS[0];
export const cupTracks = () => currentCup().tracks;
export const CUP_POINTS = [10, 6, 4, 3, 2, 1];

export function randomDef(seed) {
  const rng = new RNG(seed);
  const biome = rng.pick(['forest', 'canyon', 'winter', 'city']);
  const city = biome === 'city';
  let points = randomTrackDef(seed);
  const base = { width: city ? 14 : biome === 'winter' ? 15 : 16, runoff: city ? 3 : biome === 'winter' ? 6 : 7 };
  // pro jistotu ověř geometrii, případně zkus další variantu
  for (let t = 0; t < 8; t++) {
    const cl = buildCenterline({ points });
    if (validateCenterline(cl, base.width / 2, base.runoff).ok) break;
    points = randomTrackDef(seed + (t + 1) * 7919);
  }
  const def = {
    id: 'random-' + seed,
    name: 'Náhodná trať',
    subtitle: `${BIOMES[biome].name}, seed ${seed}`,
    biome,
    ...base,
    maxBank: city ? 0.015 : 0.07,
    seed: seed % 100000,
    points,
    random: true,
  };
  if (biome === 'forest') {
    // jezero doprostřed, pokud je místo
    const cl = buildCenterline(def);
    let cx = 0, cz = 0;
    for (let k = 0; k < cl.N; k++) {
      cx += cl.px[k];
      cz += cl.pz[k];
    }
    cx /= cl.N;
    cz /= cl.N;
    let d = Infinity;
    for (let k = 0; k < cl.N; k++) d = Math.min(d, Math.hypot(cl.px[k] - cx, cl.pz[k] - cz));
    if (d > 100) def.lake = { x: cx, z: cz, r: Math.min(80, (d - 30) / 1.7) };
  }
  return def;
}

// právě vybraný závod sezóny (mimo režim Sezóna null)
export const currentEvent = () => (S.mode === 'season' ? seasonEvent(S.seasonEvent) : null);
// podmínky závodu: v sezóně pevné, jinde podle menu
export const raceLaps = () => currentEvent()?.laps ?? S.laps;
export const raceDifficulty = () => currentEvent()?.difficulty ?? S.difficulty;
export const raceWeapons = () => currentEvent()?.weapons ?? (currentEvent() ? true : S.weapons);

// závodní režim bez šampionátu ('race' | 'time')
export const raceMode = () => (S.mode === 'time' ? 'time' : 'race');
// trať, která se má právě jet (v šampionátu podle kola)
export function currentTrackId() {
  if (S.mode === 'season') return currentEvent().track;
  return S.mode === 'cup' ? cupTracks()[G.cup ? G.cup.round : 0] : S.track + (S.reverse ? REV : '');
}

// prší podle volby v menu, v bouřkovém poháru a v deštivé denní výzvě (na zimní trati sněží)
export function wantsRain(def) {
  if (def.biome === 'winter') return false;
  if (S.mode === 'season') return !!currentEvent().rain;
  return !!(def.rain || S.weather === 'rain' || (S.mode === 'cup' && currentCup().rain));
}

// nejlepší umístění v šampionátu (klasický má kvůli starším uložením vlastní místo)
export function cupRecord(id) {
  if (id === 'classic') return (store.records.cup ??= {});
  store.records.cups ??= {};
  return (store.records.cups[id] ??= {});
}

// denní výzva: každý den jiná vygenerovaná trať, pro všechny stejná, občas v dešti
export function dailyDef() {
  const d = new Date();
  const day = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  const def = randomDef((day * 7919 + 104729) % 999999937);
  return {
    ...def, id: `daily-${day}`, name: 'Denní výzva', subtitle: `${d.getDate()}. ${d.getMonth() + 1}. · ${BIOMES[def.biome].name}`,
    rain: new RNG(day).next() < 0.35, daily: true,
  };
}

// obrácená varianta trati: stejné body v opačném pořadí (start zůstává uprostřed rovinky),
// vlastní id kvůli rekordům a ghostům; zkratka je stavěná jen po směru, obráceně by nic nepřinesla
export const REV = '~r';
export const baseId = (id) => (id && id.endsWith(REV) ? id.slice(0, -REV.length) : id);
export function reverseDef(def) {
  return { ...def, id: def.id + REV, name: `${def.name} (obráceně)`, cut: null, points: [def.points[0], ...def.points.slice(1).reverse()] };
}

export function trackDef(id) {
  if (id && id.endsWith(REV)) return reverseDef(trackDef(baseId(id)));
  if (id === 'random') return randomDef(S.randomSeed);
  if (id === 'daily') return dailyDef();
  if (id && id.startsWith('custom-')) {
    const t = store.getCustom(id);
    if (t) return customToDef(t);
  }
  return TRACKS.find((t) => t.id === id) || TRACKS[0];
}
