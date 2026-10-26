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

// vibrace telefonu (Android; iPhone vibrace z prohlížeče nepodporuje)
export function buzz(pattern) {
  if (isTouch && S.haptics !== false && navigator.vibrate) navigator.vibrate(pattern);
}
