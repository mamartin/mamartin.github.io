// Klávesy hráčů: výchozí rozložení, vlastní přenastavení a popisky podle skutečné klávesnice
// (česká, anglická, Mac). Kód klávesy (e.code) je fyzické místo na klávesnici, ne napsaný znak:
// na české klávesnici je třeba „Slash“ klávesa s pomlčkou, proto se popisky zjišťují zvlášť.

export const ACTIONS = [
  { id: 'up', label: 'Plyn' },
  { id: 'down', label: 'Brzda / couvání' },
  { id: 'left', label: 'Doleva' },
  { id: 'right', label: 'Doprava' },
  { id: 'hand', label: 'Drift (ruční brzda)' },
  { id: 'nitro', label: 'Nitro' },
  { id: 'item', label: 'Power-up' },
  { id: 'reset', label: 'Zpět na trať' },
];

// první klávesa je hlavní (ukazuje se v návodech), další jsou náhradní
export const DEFAULT_KEYS = {
  p1: {
    up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
    hand: ['Space'], nitro: ['ShiftLeft'], item: ['KeyE', 'KeyF'], reset: ['KeyR'],
  },
  // hráč 2: pravá ruka na šipkách, levá u pravého Shiftu; na Macu i pravý Option (⌥)
  p2: {
    up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    hand: ['Slash', 'AltRight', 'ControlRight', 'Numpad0'], nitro: ['ShiftRight'], item: ['Period', 'NumpadDecimal'], reset: ['Enter', 'NumpadEnter'],
  },
};

// klávesy s pevným významem, ty přenastavit nejde
const FIXED = ['Escape', 'KeyP', 'KeyC', 'KeyM', 'KeyH', 'Backspace'];
// a klávesy, které systém používá po svém (⌘ na Macu nepouští uvolnění ostatních kláves)
export const RESERVED = new Set([...FIXED, 'Tab', 'MetaLeft', 'MetaRight', 'CapsLock', 'OSLeft', 'OSRight']);

export const KEYMAP = { p1: {}, p2: {}, solo: {} };
let gameKeys = new Set();

// custom = { p1: { akce: [kódy] }, p2: {...} } z nastavení; chybějící akce mají výchozí klávesy
export function applyKeys(custom = {}) {
  for (const p of ['p1', 'p2']) {
    for (const { id } of ACTIONS) {
      const list = custom?.[p]?.[id];
      KEYMAP[p][id] = Array.isArray(list) ? [...list] : [...DEFAULT_KEYS[p][id]];
    }
  }
  // sólo hráč smí používat obě poloviny klávesnice
  for (const { id } of ACTIONS) KEYMAP.solo[id] = [...new Set([...KEYMAP.p1[id], ...KEYMAP.p2[id]])];
  gameKeys = new Set([...Object.values(KEYMAP.solo).flat(), ...FIXED]);
}
applyKeys();

export const isGameKey = (code) => gameKeys.has(code);

// kdo a k čemu klávesu používá: [{ player: 'p1', action: 'up' }]
export function keyUsers(code) {
  const out = [];
  for (const p of ['p1', 'p2']) for (const { id } of ACTIONS) if (KEYMAP[p][id].includes(code)) out.push({ player: p, action: id });
  return out;
}

// Nové přiřazení: klávesa se odebere všude jinde (žádné dvě akce na jedné klávese).
// Vrací nový objekt vlastních kláves pro uložení.
export function assignKey(custom, player, action, code) {
  const next = { p1: {}, p2: {} };
  for (const p of ['p1', 'p2']) for (const { id } of ACTIONS) next[p][id] = [...KEYMAP[p][id]];
  for (const p of ['p1', 'p2']) for (const { id } of ACTIONS) next[p][id] = next[p][id].filter((c) => c !== code);
  next[player][action] = [code];
  applyKeys(next);
  return next;
}

// --- popisky -------------------------------------------------------------------------

const isMac = /Mac|iPhone|iPad/.test(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent);
const lang = (navigator.language || '').toLowerCase();
const czLike = lang.startsWith('cs') || lang.startsWith('sk');

const NAMED = {
  Space: 'Mezerník', Enter: 'Enter', NumpadEnter: 'Enter (num.)', Backspace: 'Backspace', Escape: 'Esc', Tab: 'Tab',
  ShiftLeft: 'levý Shift', ShiftRight: 'pravý Shift',
  ControlLeft: 'levý Ctrl', ControlRight: 'pravý Ctrl',
  AltLeft: isMac ? 'levý ⌥' : 'levý Alt', AltRight: isMac ? 'pravý ⌥' : 'pravý Alt',
  MetaLeft: isMac ? 'levý ⌘' : 'levý Win', MetaRight: isMac ? 'pravý ⌘' : 'pravý Win',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  CapsLock: 'Caps Lock', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
  NumpadDecimal: 'num. ,', NumpadAdd: 'num. +', NumpadSubtract: 'num. −', NumpadMultiply: 'num. ×', NumpadDivide: 'num. ÷',
  ContextMenu: 'Menu',
};

// znaky na anglické a na české klávesnici, než se dozvíme, jakou hráč opravdu má
const US = {
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
  Backquote: '`', Comma: ',', Period: '.', Slash: '/', IntlBackslash: '\\',
};
const CZ = {
  ...US, Minus: '=', Equal: '´', BracketLeft: 'ú', BracketRight: ')', Backslash: '¨', Semicolon: 'ů', Quote: '§',
  Backquote: ';', Slash: '-', IntlBackslash: '\\', KeyY: 'Z', KeyZ: 'Y',
  Digit1: '+', Digit2: 'ě', Digit3: 'š', Digit4: 'č', Digit5: 'ř', Digit6: 'ž', Digit7: 'ý', Digit8: 'á', Digit9: 'í', Digit0: 'é',
};

const learned = new Map();
const listeners = new Set();
export const onLabelsChange = (fn) => listeners.add(fn);
const changed = () => listeners.forEach((fn) => fn());

// skutečné rozložení z prohlížeče (Chrome, Edge); jinde se učíme z napsaných znaků
if (navigator.keyboard?.getLayoutMap) {
  navigator.keyboard.getLayoutMap().then((map) => {
    for (const [code, key] of map) learned.set(code, key.toUpperCase());
    changed();
  }).catch(() => {});
}

// z události klávesy: na tomhle místě je tenhle znak
export function learnKey(code, key) {
  if (!key || key.length !== 1 || key === ' ' || NAMED[code]) return;
  const up = key.toUpperCase();
  if (learned.get(code) === up) return;
  // s Shiftem nebo Alt by se naučil jiný znak, než je na klávese natištěný
  learned.set(code, up);
  changed();
}

export function keyLabel(code) {
  if (!code) return '—';
  if (NAMED[code]) return NAMED[code];
  if (learned.has(code)) return learned.get(code);
  if (czLike && CZ[code]) return CZ[code];
  if (US[code]) return US[code];
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^Digit(\d)$/.exec(code);
  if (m) return m[1];
  m = /^Numpad(\d)$/.exec(code);
  if (m) return `num. ${m[1]}`;
  return code.replace(/^(Key|Digit)/, '');
}

// hlavní klávesa akce hráče jako <kbd>
export const kbd = (code) => `<kbd>${escapeHtml(keyLabel(code))}</kbd>`;
export const mainKey = (player, action) => KEYMAP[player][action][0];
export const actionKbd = (player, action) => (KEYMAP[player][action].length ? kbd(mainKey(player, action)) : '<kbd>—</kbd>');

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
