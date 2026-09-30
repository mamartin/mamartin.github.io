// Vstupy: klávesnice (jeden nebo dva hráči), gamepady a dotyková tlačítka.

// Rozložení kláves. Sólo hráč může používat obě poloviny klávesnice.
export const KEYMAP = {
  p1: {
    up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
    hand: ['Space'], nitro: ['ShiftLeft'], item: ['KeyE', 'KeyF'], reset: ['KeyR'],
  },
  p2: {
    up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    hand: ['Slash', 'Numpad0', 'ControlRight'], nitro: ['ShiftRight'], item: ['Period', 'NumpadDecimal'], reset: ['Enter', 'NumpadEnter'],
  },
};
KEYMAP.solo = Object.fromEntries(Object.keys(KEYMAP.p1).map((k) => [k, [...KEYMAP.p1[k], ...KEYMAP.p2[k]]]));

const GAME_KEYS = new Set([...Object.values(KEYMAP.solo).flat(), 'KeyC', 'KeyP', 'KeyM', 'Escape']);

// tlačítka gamepadu (standardní mapování) -> jméno události
const PAD_BUTTONS = { 0: 'A', 1: 'B', 2: 'X', 3: 'Y', 8: 'Back', 9: 'Start' };

export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = [];
    this.touch = { left: 0, right: 0, gas: 0, brake: 0, nitro: 0, drift: 0, item: 0 };
    this.enabled = true;
    this.padPrev = {};
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (GAME_KEYS.has(e.code) && this.enabled) e.preventDefault();
      if (!e.repeat) this.pressed.push(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  bindTouch(root) {
    const buttons = root.querySelectorAll('[data-touch]');
    for (const b of buttons) {
      const key = b.dataset.touch;
      const on = (e) => {
        e.preventDefault();
        this.touch[key] = 1;
        b.classList.add('on');
        if (b.setPointerCapture && e.pointerId !== undefined) b.setPointerCapture(e.pointerId);
      };
      const off = (e) => {
        e.preventDefault();
        if (key !== 'item') this.touch[key] = 0;
        b.classList.remove('on');
      };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('lostpointercapture', off);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  // Jednorázové stisky od posledního volání: kódy kláves a "Pad<i>:<tlačítko>".
  takePressed() {
    const p = this.pressed;
    this.pressed = [];
    const pads = this.pads();
    pads.forEach((pad, i) => {
      const prev = (this.padPrev[pad.index] = this.padPrev[pad.index] || {});
      for (const [b, name] of Object.entries(PAD_BUTTONS)) {
        const down = !!pad.buttons[b]?.pressed;
        if (down && !prev[b]) p.push(`Pad${i}:${name}`);
        prev[b] = down;
      }
    });
    return p;
  }

  pads() {
    if (!navigator.getGamepads) return [];
    return [...navigator.getGamepads()].filter((p) => p && p.connected);
  }

  // Který hráč (0/1) ovládá gamepad s pořadím i.
  playerForPad(i, humans) {
    if (humans < 2) return 0;
    return this.pads().length >= 2 ? Math.min(i, 1) : 1;
  }

  padFor(profile) {
    const pads = this.pads();
    if (profile === 'solo') return pads[0] || null;
    if (pads.length >= 2) return profile === 'p1' ? pads[0] : pads[1];
    return profile === 'p2' ? pads[0] || null : null;
  }

  // Který hráč stiskl danou klávesu akce (item/reset); -1 = nikdo.
  keyOwner(code, action, humans) {
    if (humans < 2) return KEYMAP.solo[action].includes(code) ? 0 : -1;
    if (KEYMAP.p1[action].includes(code)) return 0;
    if (KEYMAP.p2[action].includes(code)) return 1;
    return -1;
  }

  controls(profile = 'solo') {
    const k = this.keys;
    const map = KEYMAP[profile];
    const any = (list) => list.some((c) => k.has(c));
    let throttle = any(map.up) ? 1 : 0;
    let brake = any(map.down) ? 1 : 0;
    let steer = (any(map.right) ? 1 : 0) - (any(map.left) ? 1 : 0);
    let handbrake = any(map.hand);
    let nitro = any(map.nitro);

    if (profile === 'solo') {
      const t = this.touch;
      throttle = Math.max(throttle, t.gas);
      brake = Math.max(brake, t.brake);
      if (t.left || t.right) steer = t.right - t.left;
      handbrake = handbrake || !!t.drift;
      nitro = nitro || !!t.nitro;
    }

    const pad = this.padFor(profile);
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      const dz = 0.12;
      if (Math.abs(ax) > dz) steer = Math.sign(ax) * ((Math.abs(ax) - dz) / (1 - dz));
      const rt = pad.buttons[7]?.value ?? 0, lt = pad.buttons[6]?.value ?? 0;
      if (rt > 0.05) throttle = Math.max(throttle, rt);
      if (lt > 0.05) brake = Math.max(brake, lt);
      if (pad.buttons[1]?.pressed || pad.buttons[5]?.pressed) handbrake = true;
      if (pad.buttons[0]?.pressed || pad.buttons[4]?.pressed) nitro = true;
      if (pad.buttons[14]?.pressed) steer = -1;
      if (pad.buttons[15]?.pressed) steer = 1;
    }
    return { throttle, brake, steer, handbrake, nitro };
  }
}
