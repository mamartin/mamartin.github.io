// Vstupy: klávesnice, gamepad a dotyková tlačítka.

const GAME_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ShiftLeft', 'ShiftRight', 'KeyC', 'KeyR', 'KeyP', 'KeyM', 'Escape',
]);

export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = [];
    this.touch = { left: 0, right: 0, gas: 0, brake: 0, nitro: 0, drift: 0 };
    this.enabled = true;
    this.padPrev = [];
    this.usingPad = false;
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
        this.touch[key] = 0;
        b.classList.remove('on');
      };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('lostpointercapture', off);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  // Jednorázové stisky (C, R, P, …) od posledního volání.
  takePressed() {
    const p = this.pressed;
    this.pressed = [];
    this.pollPadButtons(p);
    return p;
  }

  pollPadButtons(out) {
    const pad = this.getPad();
    if (!pad) return;
    const map = { 2: 'PadX', 3: 'KeyC', 8: 'KeyR', 9: 'Escape' };
    for (const [i, code] of Object.entries(map)) {
      const down = !!pad.buttons[i]?.pressed;
      if (down && !this.padPrev[i]) out.push(code);
      this.padPrev[i] = down;
    }
    const a = !!pad.buttons[0]?.pressed;
    if (a && !this.padPrev[0]) out.push('PadA');
    this.padPrev[0] = a;
  }

  getPad() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  controls() {
    const k = this.keys;
    let throttle = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    let brake = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    let steer = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let handbrake = k.has('Space');
    let nitro = k.has('ShiftLeft') || k.has('ShiftRight');

    const t = this.touch;
    throttle = Math.max(throttle, t.gas);
    brake = Math.max(brake, t.brake);
    if (t.left || t.right) steer = t.right - t.left;
    handbrake = handbrake || !!t.drift;
    nitro = nitro || !!t.nitro;

    const pad = this.getPad();
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      const dz = 0.12;
      if (Math.abs(ax) > dz) {
        steer = Math.sign(ax) * ((Math.abs(ax) - dz) / (1 - dz));
        this.usingPad = true;
      }
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
