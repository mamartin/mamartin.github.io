// Hráči a soupeři: počet hráčů, vozy a barvy z garáže, jména jezdců a vzhled soupeřů.
import {
  playerColors as colorsOf, playerAccents as accentsOf, playerLiveries as liveriesOf, playerKinds as kindsOf, DESIGNS,
} from './garage.js';
import { F1_TEAMS } from './race.js';
import { S, G, isTouch } from './state.js';
import { raceMode, currentEvent } from './trackdefs.js';
import { strongest } from './drivers.js';

// počet lidských hráčů (dva jen v závodě/šampionátu a ne na dotykovém zařízení)
export const humanCount = () => (S.mode !== 'season' && raceMode() === 'race' && S.players === 2 && !isTouch ? 2 : 1);
// typ a barvy vozů hráčů (upravují se v garáži)
export const playerColors = () => colorsOf(S);
export const playerAccents = () => accentsOf(S);
export const playerLiveries = () => liveriesOf(S);
export const playerKinds = () => kindsOf(S);
// soupeři jezdí to, co si vybral hráč 1
export const opponentKind = () => playerKinds()[0];
// vybraná jména jezdců F1 (prázdné = výchozí „Ty“ / „Hráč 2“), dva hráči nesmí mít stejné
export function playerNames() {
  const a = S.driver || '';
  const b = S.driver2 || '';
  return [a, b === a ? '' : b];
}

// soupeři dostanou náhodná jména jezdců F1, kromě těch, která mají hráči
export function opponentNames() {
  const taken = playerNames();
  const names = F1_TEAMS.flatMap((t) => t.drivers).filter((d) => !taken.includes(d));
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  // rival musí být v poli (první čtyři jména vždy jedou)
  const rival = names.indexOf(wantedRival());
  if (rival >= 4) {
    const to = Math.floor(Math.random() * 4);
    [names[rival], names[to]] = [names[to], names[rival]];
  }
  return names;
}

// rival: v sezóně daný závodem, jinak jezdec, který hráče minule porazil
export const wantedRival = () => currentEvent()?.rival ?? S.rival;

// rival závodu pro jednoho hráče; když není v poli, je jím nejsilnější soupeř
export function pickRival(race) {
  if (race.mode !== 'race' || race.players.length > 1) return null;
  const others = race.cars.filter((c) => !c.isPlayer);
  const name = others.some((c) => c.name === wantedRival()) ? wantedRival() : strongest(others.map((c) => c.name));
  return others.find((c) => c.name === name);
}

// proč je právě on rival (krátká věta na kartu před startem)
export function rivalWhy(rival) {
  if (currentEvent()) return 'Porazit ho je cíl závodu.';
  if (rival.name !== S.rival) return 'Nejsilnější soupeř na startu.';
  return S.rivalBeat ? 'Minule tě porazil.' : 'Minule skončil těsně za tebou.';
}

// soupeři jezdí v hotových designech z garáže (náhodně, kromě barev hráčů);
// v šampionátu zůstávají stejné, v menu se drží do dalšího startu
export function opponentLooks() {
  const taken = playerColors().slice(0, humanCount());
  const looks = DESIGNS.filter((d) => !taken.includes(d.color)).map(({ color, accent, livery }) => ({ color, accent, livery: livery || {} }));
  for (let i = looks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [looks[i], looks[j]] = [looks[j], looks[i]];
  }
  return looks;
}
export function currentLooks() {
  if (G.cup) return (G.cup.looks ??= opponentLooks());
  const taken = playerColors().slice(0, humanCount());
  if (!G.looks || G.looks.some((l) => taken.includes(l.color))) G.looks = opponentLooks();
  return G.looks;
}
