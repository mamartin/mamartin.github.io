// Garáž: typ a barvy vozu na samostatné obrazovce. Základ = jedna barva nebo hotový design,
// detail = barva každého dílu zvlášť a typ laku.
import { PLAYER_COLORS, ACCENT_COLORS, PLAYER_NUMBERS } from './race.js';

export const PALETTE = [
  { name: 'Červená', hex: 0xd7263d },
  { name: 'Oranžová', hex: 0xf07b2c },
  { name: 'Žlutá', hex: 0xf2c230 },
  { name: 'Limetková', hex: 0x8fd42a },
  { name: 'Zelená', hex: 0x1f9d55 },
  { name: 'Tyrkysová', hex: 0x11aa99 },
  { name: 'Nebeská', hex: 0x6ec6f0 },
  { name: 'Modrá', hex: 0x2c6fd1 },
  { name: 'Námořnická', hex: 0x1b2a6b },
  { name: 'Fialová', hex: 0x8e44ad },
  { name: 'Růžová', hex: 0xe85d9c },
  { name: 'Vínová', hex: 0x7a1e2c },
  { name: 'Zlatá', hex: 0xd4a72c },
  { name: 'Stříbrná', hex: 0xb8bec7 },
  { name: 'Bílá', hex: 0xf2f2ee },
  { name: 'Černá', hex: 0x1d1f24 },
];

export const FINISH_NAMES = { gloss: 'Lesk', metal: 'Metalíza', matte: 'Mat' };
const KIND_NAMES = { car: 'Auto', formula: 'Formule' };

// díly s vlastní barvou: body a accent mají v nastavení vlastní klíče, ostatní jsou v livery;
// def = výchozí barva (null = jako karoserie), u accent se dopočítá kontrastní
export const LIVERY_PARTS = [
  { key: 'wings', name: { car: 'Zadní křídlo', formula: 'Křídla' }, def: null },
  { key: 'cockpit', name: { car: 'Okna', formula: 'Helma jezdce' }, def: { car: 0x0c131c, formula: 0xf4f1e8 } },
  { key: 'trim', name: { car: 'Nárazníky a detaily', formula: 'Podvozek a haló' }, def: 0x15171b },
  { key: 'rims', name: 'Disky', def: 0xc9ccd1 },
  { key: 'tires', name: 'Pneumatiky', def: 0x151515 },
  { key: 'plate', name: 'Štítek s číslem', def: 0xf4f4f0 },
];
const PARTS = [
  { key: 'body', name: 'Karoserie' },
  { key: 'accent', name: { car: 'Pruhy', formula: 'Bočnice křídel' } },
  ...LIVERY_PARTS,
];

export const DESIGNS = [
  { name: 'Klasika', color: 0xd7263d, accent: 0xf2f2ee },
  { name: 'Půlnoc', color: 0x1d1f24, accent: 0xd4a72c, livery: { rims: 0xd4a72c, finish: 'metal' } },
  { name: 'Ledovec', color: 0xf2f2ee, accent: 0x2c6fd1, livery: { wings: 0x2c6fd1, rims: 0x1d1f24 } },
  { name: 'Limetka', color: 0x8fd42a, accent: 0x1d1f24, livery: { wings: 0x1d1f24, trim: 0x1d1f24 } },
  { name: 'Západ slunce', color: 0xf07b2c, accent: 0x8e44ad, livery: { wings: 0x8e44ad, rims: 0xf2c230 } },
  { name: 'Stříbrný šíp', color: 0xb8bec7, accent: 0x16181d, livery: { wings: 0x16181d, finish: 'metal' } },
  { name: 'Fialový blesk', color: 0x8e44ad, accent: 0xf2c230, livery: { wings: 0xf2c230, rims: 0xf2c230 } },
  { name: 'Maskáč', color: 0x4b5a3c, accent: 0x1d1f24, livery: { rims: 0x1d1f24, trim: 0x2e3526, finish: 'matte' } },
];

// barva v nastavení: index do palety menu (starší uložení), '#rrggbb', u doplňkové i null (automaticky)
export const customHex = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? parseInt(v.slice(1), 16) : null);
const colorOf = (v, list, fallback) => customHex(v) ?? (Number.isInteger(v) ? list[v % list.length].hex : fallback);
export const hexCss = (hex) => '#' + hex.toString(16).padStart(6, '0');
const luminance = (hex) => 0.2126 * ((hex >> 16) & 255) / 255 + 0.7152 * ((hex >> 8) & 255) / 255 + 0.0722 * (hex & 255) / 255;
const keysOf = (i) => (i === 0
  ? { color: 'color', accent: 'accent', livery: 'livery', vehicle: 'vehicle', number: 'number' }
  : { color: 'color2', accent: 'accent2', livery: 'livery2', vehicle: 'vehicle2', number: 'number2' });
const label = (name, kind) => (typeof name === 'string' ? name : name[kind]);

export const playerKinds = (S) => [S.vehicle || 'car', S.vehicle2 || 'car'];

// startovní čísla 1–99; dva hráči nesmí mít stejné
export function playerNumbers(S) {
  const a = S.number || PLAYER_NUMBERS[0];
  let b = S.number2 || PLAYER_NUMBERS[1];
  if (b === a) b = (a % 99) + 1;
  return [a, b];
}

export function playerColors(S) {
  const a = colorOf(S.color, PLAYER_COLORS, PLAYER_COLORS[0].hex);
  let b = colorOf(S.color2, PLAYER_COLORS, PLAYER_COLORS[1].hex);
  if (b === a) b = PLAYER_COLORS.find((c) => c.hex !== a).hex;
  return [a, b];
}

export const playerAccents = (S) => [colorOf(S.accent, ACCENT_COLORS, null), colorOf(S.accent2, ACCENT_COLORS, null)];

// nastavení ukládá barvy jako '#rrggbb', model chce čísla
export function playerLiveries(S) {
  return [0, 1].map((i) => {
    const src = S[keysOf(i).livery] || {};
    const out = { finish: FINISH_NAMES[src.finish] ? src.finish : 'gloss' };
    for (const p of LIVERY_PARTS) out[p.key] = customHex(src[p.key]);
    return out;
  });
}

// barva dílu pro náhled: { hex, own } – own = hráč ji nastavil sám
export function partColor(S, i, key) {
  const kind = playerKinds(S)[i];
  const body = playerColors(S)[i];
  if (key === 'body') return { hex: body, own: true };
  if (key === 'accent') {
    const own = playerAccents(S)[i];
    return { hex: own ?? (luminance(body) > 0.45 ? 0x16181d : 0xf2f2ee), own: own != null };
  }
  const p = LIVERY_PARTS.find((q) => q.key === key);
  const own = customHex((S[keysOf(i).livery] || {})[key]);
  const def = p.def == null ? body : typeof p.def === 'number' ? p.def : p.def[kind];
  return { hex: own ?? def, own: own != null };
}

export const kindName = (kind) => KIND_NAMES[kind] || KIND_NAMES.car;

export class Garage {
  constructor({ store, onChange, onClose }) {
    this.store = store;
    this.S = store.settings;
    this.onChange = onChange;
    this.onClose = onClose;
    this.player = 0;
    this.humans = 1;
    this.mode = 'basic';
    this.part = 'body';
    this.build();
  }

  el(id) {
    return document.getElementById(id);
  }

  build() {
    this.el('gar-back').addEventListener('click', () => this.onClose());
    for (const b of this.el('gar-player').children) b.addEventListener('click', () => this.select(+b.dataset.player));
    for (const b of this.el('gar-vehicle').children) {
      b.addEventListener('click', () => {
        this.S[keysOf(this.player).vehicle] = b.dataset.vehicle;
        this.changed();
      });
    }
    for (const [id, step] of [['gar-num-minus', -1], ['gar-num-plus', 1]]) {
      this.el(id).addEventListener('click', () => {
        const k = keysOf(this.player).number;
        this.S[k] = ((playerNumbers(this.S)[this.player] - 1 + step + 99) % 99) + 1;
        this.changed();
      });
    }
    // číslo jde i napsat: ukládá se hned, jakmile je platné (1–99), po opuštění pole se srovná
    const num = this.el('gar-number');
    num.addEventListener('input', () => {
      num.value = num.value.replace(/\D/g, '').slice(0, 2);
      const v = parseInt(num.value, 10);
      if (v >= 1 && v <= 99) {
        this.S[keysOf(this.player).number] = v;
        this.changed();
      }
    });
    num.addEventListener('focus', () => num.select());
    num.addEventListener('blur', () => (num.value = String(playerNumbers(this.S)[this.player])));
    num.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') num.blur();
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        this.el(e.key === 'ArrowUp' ? 'gar-num-plus' : 'gar-num-minus').click();
      }
    });
    this.el('gar-random').addEventListener('click', () => this.randomDesign());
    for (const b of this.el('gar-mode').children) {
      b.addEventListener('click', () => {
        this.mode = b.dataset.mode;
        this.refresh();
      });
    }
    // základ: barva karoserie a hotové designy
    this.fillPalette(this.el('gar-colors'), (hex, save) => this.setPart('body', hex, save));
    for (const d of DESIGNS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'design';
      const wings = d.livery?.wings ?? d.color;
      b.innerHTML = `<span class="design-chips"><i style="background:${hexCss(d.color)}"></i><i style="background:${hexCss(d.accent)}"></i><i style="background:${hexCss(wings)}"></i></span><span class="design-name">${d.name}</span>`;
      b.addEventListener('click', () => this.applyDesign(d));
      this.el('gar-designs').appendChild(b);
    }
    // detail: seznam dílů, paleta pro vybraný díl, lak
    for (const p of PARTS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'part';
      b.dataset.part = p.key;
      b.setAttribute('role', 'radio');
      b.innerHTML = '<i class="part-chip"></i><span class="part-name"></span><em class="part-own">vlastní</em>';
      b.addEventListener('click', () => {
        this.part = p.key;
        this.refresh();
      });
      this.el('gar-parts').appendChild(b);
    }
    this.fillPalette(this.el('gar-palette'), (hex, save) => this.setPart(this.part, hex, save));
    this.el('gar-part-reset').addEventListener('click', () => this.setPart(this.part, null));
    for (const [f, name] of Object.entries(FINISH_NAMES)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.dataset.finish = f;
      b.textContent = name;
      b.addEventListener('click', () => this.patchLivery({ finish: f === 'gloss' ? null : f }));
      this.el('gar-finish').appendChild(b);
    }
    this.el('gar-reset').addEventListener('click', () => {
      const k = keysOf(this.player);
      this.S[k.accent] = null;
      this.S[k.livery] = {};
      this.changed();
    });
  }

  // mřížka barev z palety + vlastní barva z pickeru
  fillPalette(box, choose) {
    for (const c of PALETTE) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.dataset.hex = c.hex;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', c.name);
      b.title = c.name;
      b.style.background = hexCss(c.hex);
      b.addEventListener('click', () => choose(c.hex, true));
      box.appendChild(b);
    }
    const custom = document.createElement('label');
    custom.className = 'swatch swatch-custom';
    custom.dataset.custom = '1';
    custom.title = 'Vlastní barva';
    const input = document.createElement('input');
    input.type = 'color';
    input.setAttribute('aria-label', 'Vlastní barva');
    input.addEventListener('input', () => choose(customHex(input.value), false));
    input.addEventListener('change', () => choose(customHex(input.value), true));
    custom.appendChild(input);
    box.appendChild(custom);
  }

  open(player, humans) {
    this.humans = humans;
    this.player = Math.min(player, humans - 1);
    this.el('garage').hidden = false;
    this.refresh();
  }

  close() {
    this.el('garage').hidden = true;
  }

  select(player) {
    this.player = player;
    this.onChange();
    this.refresh();
  }

  changed(save = true) {
    if (save) this.store.save();
    this.refresh();
    this.onChange();
  }

  patchLivery(patch, save = true) {
    const k = keysOf(this.player).livery;
    const next = { ...(this.S[k] || {}), ...patch };
    for (const key of Object.keys(next)) if (next[key] == null) delete next[key];
    this.S[k] = next;
    this.changed(save);
  }

  // hex = null vrátí díl na výchozí barvu
  setPart(key, hex, save = true) {
    const k = keysOf(this.player);
    const v = hex == null ? null : hexCss(hex);
    if (key === 'body') {
      if (v) this.S[k.color] = v;
      this.changed(save);
    } else if (key === 'accent') {
      this.S[k.accent] = v;
      this.changed(save);
    } else this.patchLivery({ [key]: v }, save);
  }

  applyDesign(d) {
    const k = keysOf(this.player);
    this.S[k.color] = hexCss(d.color);
    this.S[k.accent] = hexCss(d.accent);
    const livery = {};
    for (const [key, v] of Object.entries(d.livery || {})) livery[key] = key === 'finish' ? v : hexCss(v);
    this.S[k.livery] = livery;
    this.changed();
  }

  // náhodný, ale sladěný design: karoserie z palety, kontrastní doplňky, křídla, disky a lak
  randomDesign() {
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const body = pick(PALETTE).hex;
    const contrast = PALETTE.filter((c) => Math.abs(luminance(c.hex) - luminance(body)) > 0.35);
    const accent = pick(contrast.length ? contrast : PALETTE).hex;
    const livery = { finish: pick(['gloss', 'gloss', 'metal', 'matte']) };
    if (Math.random() < 0.5) livery.wings = Math.random() < 0.6 ? accent : 0x1d1f24;
    livery.rims = pick([0xc9ccd1, 0x1d1f24, 0xd4a72c, accent]);
    if (Math.random() < 0.3) livery.plate = accent;
    this.applyDesign({ color: body, accent, livery });
  }

  // zaškrtne v paletě aktuální barvu a obarví vzorek vlastní barvy
  markPalette(box, hex, own) {
    const preset = own && PALETTE.some((c) => c.hex === hex);
    for (const b of box.children) {
      const on = b.dataset.custom ? own && !preset : preset && +b.dataset.hex === hex;
      b.setAttribute('aria-checked', String(on));
    }
    const custom = box.querySelector('.swatch-custom');
    custom.style.background = own && !preset ? hexCss(hex) : '';
    custom.querySelector('input').value = hexCss(hex);
  }

  refresh() {
    const S = this.S, i = this.player;
    const kind = playerKinds(S)[i];
    const two = this.humans === 2;
    this.el('gar-player').hidden = !two;
    for (const b of this.el('gar-player').children) b.setAttribute('aria-checked', String(+b.dataset.player === i));
    for (const b of this.el('gar-vehicle').children) b.setAttribute('aria-checked', String(b.dataset.vehicle === kind));
    for (const b of this.el('gar-mode').children) b.setAttribute('aria-checked', String(b.dataset.mode === this.mode));
    this.el('gar-basic').hidden = this.mode !== 'basic';
    // pole s číslem nepřepisovat, dokud do něj hráč píše
    const num = this.el('gar-number');
    if (document.activeElement !== num) num.value = String(playerNumbers(S)[i]);
    this.el('gar-detail').hidden = this.mode !== 'detail';

    const body = partColor(S, i, 'body').hex;
    this.markPalette(this.el('gar-colors'), body, true);

    for (const b of this.el('gar-parts').children) {
      const p = PARTS.find((q) => q.key === b.dataset.part);
      const c = partColor(S, i, p.key);
      b.querySelector('.part-chip').style.background = hexCss(c.hex);
      b.querySelector('.part-name').textContent = label(p.name, kind);
      b.querySelector('.part-own').hidden = !c.own || p.key === 'body';
      b.setAttribute('aria-checked', String(p.key === this.part));
    }
    const part = PARTS.find((q) => q.key === this.part);
    const cur = partColor(S, i, this.part);
    this.el('gar-part-label').textContent = label(part.name, kind);
    this.markPalette(this.el('gar-palette'), cur.hex, cur.own);
    this.el('gar-part-reset').hidden = this.part === 'body' || !cur.own;
    const finish = playerLiveries(S)[i].finish;
    for (const b of this.el('gar-finish').children) b.setAttribute('aria-checked', String(b.dataset.finish === finish));
  }
}
