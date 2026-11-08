// Sdílený stav hry: nastavení a rekordy, průběžný stav (obrazovka, svět, závod) a služby
// (zvuk, vstupy). Kamery a HUD sem při startu doplní main.js do „view“.
import { Store } from './store.js';
import { Input } from './input.js';
import { AudioEngine, Music } from './audio.js';

export const $ = (id) => document.getElementById(id);

export const store = new Store();
export const S = store.settings;
export const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

export const G = {
  screen: 'loading', // loading | menu | race | editor
  paused: false,
  world: null,
  race: null,
  pickups: null,
  timeScale: 1,
  acc: 0,
  fps: 60,
  resultsTimer: 0,
};

export const input = new Input();
export const audio = new AudioEngine();
export const music = new Music(audio);

// kamery, jejich ovládání a kořen HUD (nastaví main.js)
export const view = {};

// Vibrace telefonu (Android; iPhone vibrace z prohlížeče nepodporuje) a ovladače hráče.
// Vzor je jako u navigator.vibrate: délka v ms, nebo [zap, vyp, zap, …]. S autem vibruje ovladač
// hráče, který ho řídí (u dvou hráčů každý svůj); bez auta ovladač hráče 1.
export function buzz(pattern, car = null) {
  if (S.haptics !== false) {
    if (isTouch && navigator.vibrate) navigator.vibrate(pattern);
    rumble(pattern, car);
  }
}

// jen ovladač, s danou silou (trvalé chvění, např. kostky)
export function padRumble(car, ms, strong, weak) {
  if (S.haptics === false) return;
  const humans = G.race?.players.length ?? 1;
  const i = car?.humanIndex ?? 0;
  const act = input.padFor(humans < 2 ? 'solo' : i === 0 ? 'p1' : 'p2')?.vibrationActuator;
  act?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
}

function rumble(pattern, car) {
  const humans = G.race?.players.length ?? 1;
  const i = car?.humanIndex ?? 0;
  const pad = input.padFor(humans < 2 ? 'solo' : i === 0 ? 'p1' : 'p2');
  const act = pad?.vibrationActuator;
  if (!act?.playEffect) return;
  const parts = Array.isArray(pattern) ? pattern : [pattern];
  // motor ovladače se roztáčí pomaleji než vibrace telefonu: pulz o něco delší, síla podle délky;
  // nový efekt přeruší běžící, proto další pulzy vzoru až po uplynutí předchozích
  const pulse = (ms) => {
    const m = Math.min(1, Math.max(0.25, ms / 80));
    act.playEffect('dual-rumble', {
      duration: Math.min(250, ms * 1.4 + 40),
      strongMagnitude: m,
      weakMagnitude: Math.min(1, m + 0.2),
    }).catch(() => {});
  };
  let at = 0;
  for (let k = 0; k < parts.length; k += 2) {
    const ms = parts[k];
    if (at === 0) pulse(ms);
    else setTimeout(() => pulse(ms), at);
    at += ms + (parts[k + 1] ?? 0);
  }
}
