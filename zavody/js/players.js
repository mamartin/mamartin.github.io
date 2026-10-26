// Hráči a soupeři: počet hráčů, vozy a barvy z garáže, jména jezdců a vzhled soupeřů.
import {
  playerColors as colorsOf, playerAccents as accentsOf, playerLiveries as liveriesOf, playerKinds as kindsOf, DESIGNS,
} from './garage.js';
import { F1_TEAMS } from './race.js';
import { S, G, isTouch } from './state.js';
import { raceMode } from './trackdefs.js';

// počet lidských hráčů (dva jen v závodě/šampionátu a ne na dotykovém zařízení)
export const humanCount = () => (raceMode() === 'race' && S.players === 2 && !isTouch ? 2 : 1);
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
  return names;
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
