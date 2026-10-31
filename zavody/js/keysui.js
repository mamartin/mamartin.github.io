// Ovládání v menu a ve hře: obrázek klávesnice pro dva hráče, přenastavení kláves
// a panel s klávesami hráče v jeho části obrazovky.
import { $, S, store, input } from './state.js';
import {
  ACTIONS, KEYMAP, RESERVED, applyKeys, assignKey, keyLabel, kbd, actionKbd, onLabelsChange,
} from './keys.js';
import { partColor, hexCss } from './garage.js';
import { playerNames } from './players.js';

const isMac = /Mac|iPhone|iPad/.test(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent);
const PLAYERS = ['p1', 'p2'];
const SHORT = { up: 'plyn', down: 'brzda', left: 'vlevo', right: 'vpravo', hand: 'drift', nitro: 'nitro', item: 'power-up', reset: 'zpět' };
// na obrázku klávesnice je málo místa
const TINY = { up: 'plyn', down: 'brzda', left: '◀', right: '▶', hand: 'drift', nitro: 'nitro', item: 'power', reset: 'zpět' };

export const playerColor = (i) => hexCss(partColor(S, i, 'body').hex);
const playerTitle = (i, name) => (name && name !== `Hráč ${i + 1}` ? `Hráč ${i + 1} · ${name}` : `Hráč ${i + 1}`);

// otisk kláves: když se změní, rozcvička ve dvou se ukáže znovu
export const keysSignature = () => JSON.stringify([KEYMAP.p1, KEYMAP.p2]);

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// --- obrázek klávesnice ------------------------------------------------------------------

const row = (codes, w = 1) => codes.map((c) => [c, w]);
const letters = (s) => [...s].map((ch) => [`Key${ch}`, 1]);
const KB = [
  [['Backquote', 1], ...row(['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal']), ['Backspace', 2]],
  [['Tab', 1.5], ...letters('QWERTYUIOP'), ['BracketLeft', 1], ['BracketRight', 1], ['Backslash', 1.5]],
  [['CapsLock', 1.75], ...letters('ASDFGHJKL'), ['Semicolon', 1], ['Quote', 1], ['Enter', 2.25]],
  [['ShiftLeft', 2.25], ...letters('ZXCVBNM'), ['Comma', 1], ['Period', 1], ['Slash', 1], ['ShiftRight', 2.75]],
  isMac
    ? [['ControlLeft', 1.25], ['AltLeft', 1.25], ['MetaLeft', 1.5], ['Space', 7], ['MetaRight', 1.5], ['AltRight', 1.25]]
    : [['ControlLeft', 1.25], ['MetaLeft', 1.25], ['AltLeft', 1.25], ['Space', 6.25], ['AltRight', 1.25], ['MetaRight', 1.25], ['ContextMenu', 1.25], ['ControlRight', 1.25]],
];
const ARROWS = [['ArrowUp', 16, 3], ['ArrowLeft', 15, 4], ['ArrowDown', 16, 4], ['ArrowRight', 17, 4]];
const KB_W = 18;

const CAP = {
  Space: '', ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl',
  AltLeft: isMac ? '⌥' : 'Alt', AltRight: isMac ? '⌥' : 'Alt', MetaLeft: isMac ? '⌘' : 'Win', MetaRight: isMac ? '⌘' : 'Win',
  Backspace: '⌫', Tab: 'Tab', CapsLock: 'Caps', Enter: 'Enter', ContextMenu: '≣',
};

function owners(code) {
  const out = [];
  PLAYERS.forEach((p, i) => {
    for (const { id } of ACTIONS) if (KEYMAP[p][id].includes(code)) out.push({ i, action: id });
  });
  return out;
}

function renderKeyboard() {
  const box = $('keys-2p');
  if (!box || box.hidden) return;
  const keys = [];
  const add = (code, x, y, w) => {
    const own = owners(code);
    const o = own[0];
    const cap = CAP[code] ?? keyLabel(code);
    const style = `left:${(x / KB_W) * 100}%;top:${(y / 5) * 100}%;width:${(w / KB_W) * 100}%;${o ? `--pc:${playerColor(o.i)}` : ''}`;
    keys.push(`<span class="kb-key${o ? ' own' : ''}" style="${style}">`
      + `<b>${esc(cap)}</b>${o ? `<em>${TINY[o.action]}</em><i>${o.i + 1}</i>` : ''}</span>`);
  };
  KB.forEach((r, y) => {
    let x = 0;
    for (const [code, w] of r) {
      add(code, x, y, w);
      x += w;
    }
  });
  for (const [code, x, y] of ARROWS) add(code, x - 0.5, y, 1);
  const names = playerNames();
  box.innerHTML = `<div class="kb">${keys.join('')}</div>`
    + `<p class="kb-legend">${[0, 1].map((i) => `<span style="--pc:${playerColor(i)}"><i></i>${esc(playerTitle(i, names[i]))}</span>`).join('')}`
    + '<span class="kb-pad">Druhý gamepad patří hráči 2</span></p>';
}

// --- přenastavení kláves --------------------------------------------------------------------

let waiting = null; // { player, action } – čeká se na stisk

function renderBindings() {
  const box = $('keybind');
  if (!box) return;
  let html = '<span class="kb-h"></span><span class="kb-h">Hráč 1</span><span class="kb-h">Hráč 2</span>';
  for (const { id, label } of ACTIONS) {
    html += `<span class="kb-act">${label}</span>`;
    for (const p of PLAYERS) {
      const list = KEYMAP[p][id];
      const now = waiting && waiting.player === p && waiting.action === id;
      const text = now
        ? 'Zmáčkni klávesu…'
        : list.length ? list.map((c, n) => (n ? `<small>${esc(keyLabel(c))}</small>` : esc(keyLabel(c)))).join(' ') : 'nepřiřazeno';
      html += `<button type="button" class="kb-bind${now ? ' wait' : ''}${list.length ? '' : ' empty'}" data-player="${p}" data-action="${id}">${text}</button>`;
    }
  }
  box.innerHTML = html;
}

function stopWaiting() {
  waiting = null;
  input.capture = null;
}

function note(text) {
  const el = $('keybind-note');
  el.textContent = text;
  el.hidden = !text;
}

export function refreshKeysUI() {
  renderBindings();
  renderKeyboard();
}

export function bindKeysUI(onChange) {
  const changed = () => {
    refreshKeysUI();
    onChange?.();
  };
  $('keybind').addEventListener('click', (e) => {
    const b = e.target.closest('.kb-bind');
    if (!b) return;
    note('');
    waiting = { player: b.dataset.player, action: b.dataset.action };
    input.capture = (code) => {
      const w = waiting;
      stopWaiting();
      if (code === 'Escape') {
        renderBindings();
        return;
      }
      if (RESERVED.has(code)) {
        note(`${keyLabel(code)} má ve hře pevný význam, vyber jinou klávesu.`);
        renderBindings();
        return;
      }
      const before = owners(code).filter((o) => !(PLAYERS[o.i] === w.player && o.action === w.action));
      S.keys = assignKey(S.keys, w.player, w.action, code);
      store.save();
      if (before.length) {
        const o = before[0];
        const left = KEYMAP[PLAYERS[o.i]][o.action].length;
        note(`${keyLabel(code)} předtím patřila hráči ${o.i + 1} (${SHORT[o.action]})${left ? '' : ', ta teď nemá klávesu'}.`);
      }
      changed();
    };
    renderBindings();
  });
  // klik jinam čekání zruší
  document.addEventListener('pointerdown', (e) => {
    if (waiting && !e.target.closest('.kb-bind')) {
      stopWaiting();
      renderBindings();
    }
  });
  $('keys-reset').addEventListener('click', () => {
    stopWaiting();
    S.keys = null;
    applyKeys();
    store.save();
    note('Klávesy jsou zpět na výchozích.');
    changed();
  });
  onLabelsChange(changed);
  applyKeys(S.keys || {});
}

// --- panel s klávesami ve hře ---------------------------------------------------------------

// i = index hráče, humans = počet hráčů, opts: { items, ready, done, pad }
export function keyPanelHtml(i, humans, name, { items = false, ready = false, done = false, pad = false } = {}) {
  const p = humans > 1 ? PLAYERS[i] : 'p1';
  const solo = humans < 2;
  // sólo hráč může jezdit i šipkami, ukážeme obě sady
  const k = (a) => actionKbd(p, a) + (solo && ['up', 'down', 'left', 'right'].includes(a) ? actionKbd('p2', a) : '');
  const rows = [
    [`${k('up')} ${k('down')}`, 'plyn / brzda'],
    [`${k('left')} ${k('right')}`, 'zatáčení'],
    [k('hand'), 'drift'],
    [k('nitro'), 'nitro'],
  ];
  if (items) rows.push([k('item'), 'power-up']);
  rows.push([k('reset'), 'zpět na trať']);
  if (pad) rows.push(['🎮', 'RT plyn · LT brzda · B drift · A nitro · X power-up']);
  const title = humans > 1 ? `<i></i>${esc(playerTitle(i, name))}` : 'Ovládání';
  const foot = ready
    ? (done ? '<b>✓ Připraven</b>' : '<b>Zmáčkni kteroukoli svou klávesu</b> – tím dáš vědět, že jsi připraven')
    : `${kbd('KeyH')} schová ovládání · ${kbd('KeyC')} kamera · ${kbd('Escape')} pauza`;
  return `<h3>${title}</h3><dl>${rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl><p class="kp-foot">${foot}</p>`;
}

// popisek klávesy power-upu v HUD
export const itemKeyLabel = (i, humans) => keyLabel(KEYMAP[humans > 1 ? PLAYERS[i] : 'p1'].item[0]);

// komu klávesa patří (0/1), -1 = nikomu
export function keyPlayer(code) {
  for (let i = 0; i < 2; i++) for (const { id } of ACTIONS) if (KEYMAP[PLAYERS[i]][id].includes(code)) return i;
  return -1;
}
