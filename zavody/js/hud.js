// HUD: pozice, časomíra, tachometr, minimapa a hlášky uprostřed.

export function formatTime(t, digits = 2) {
  if (!isFinite(t) || t <= 0) return '–';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(digits).padStart(3 + digits, '0').replace('.', ',')}`;
}

export function formatDelta(d) {
  const sign = d < 0 ? '−' : '+';
  return sign + Math.abs(d).toFixed(2).replace('.', ',');
}

export function trackOutline(track, canvas, { pad = 8, color = '#f3f5f8', width = null, start = true } = {}) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || canvas.width, h = canvas.clientHeight || canvas.height;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let k = 0; k < track.N; k++) {
    minX = Math.min(minX, track.px[k]);
    maxX = Math.max(maxX, track.px[k]);
    minZ = Math.min(minZ, track.pz[k]);
    maxZ = Math.max(maxZ, track.pz[k]);
  }
  const sc = Math.min((w - pad * 2) / (maxX - minX), (h - pad * 2) / (maxZ - minZ));
  const ox = (w - (maxX - minX) * sc) / 2, oz = (h - (maxZ - minZ) * sc) / 2;
  const map = (x, z) => [ox + (x - minX) * sc, oz + (z - minZ) * sc];
  g.lineJoin = g.lineCap = 'round';
  g.beginPath();
  for (let k = 0; k <= track.N; k += 2) {
    const [x, y] = map(track.px[k % track.N], track.pz[k % track.N]);
    if (k === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  const lw = width ?? Math.max(2.5, Math.min(7, track.def.width * sc));
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.lineWidth = lw + 3;
  g.stroke();
  g.strokeStyle = color;
  g.lineWidth = lw;
  g.stroke();
  if (start) {
    const [sx, sy] = map(track.px[0], track.pz[0]);
    const rx = track.rx[0], rz = track.rz[0];
    g.strokeStyle = '#e8392c';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(sx - rx * (lw + 4), sy - rz * (lw + 4));
    g.lineTo(sx + rx * (lw + 4), sy + rz * (lw + 4));
    g.stroke();
  }
  return { map, w, h, dpr };
}

const hex = (n) => '#' + n.toString(16).padStart(6, '0');

// Jeden pohled HUD (při hře dvou hráčů má každý svůj).
export class HUD {
  constructor(view) {
    this.view = view;
    const q = (sel) => view.querySelector(sel);
    this.pos = q('.pos-num');
    this.posOf = q('.pos-of');
    this.posLabel = q('.pos-label');
    this.tower = q('.tower');
    this.lap = q('.h-lap');
    this.time = q('.h-time');
    this.lapTime = q('.h-laptime');
    this.best = q('.h-best');
    this.msg = q('.center-msg');
    this.subEl = q('.sub-msg');
    this.minimap = q('.minimap');
    this.speedo = q('.speedo');
    this.itemSlot = q('.item-slot');
    this.itemIcon = q('.item-icon');
    this.itemKey = q('.item-slot em');
    this.tag = q('.player-tag');
    this.msgTimer = 0;
    this.subTimer = 0;
    this.cache = {};
    this.rows = [];
  }

  setupRace(race, car, { tag = '', itemKey = 'F' } = {}) {
    this.race = race;
    this.car = car;
    // věž s pořadím
    this.tower.innerHTML = '';
    this.rows = race.cars.map(() => {
      const li = document.createElement('li');
      li.innerHTML = '<span class="tw-pos"></span><span class="tw-chip"></span><span class="tw-name"></span><span class="tw-gap"></span>';
      this.tower.appendChild(li);
      return { li, pos: li.children[0], chip: li.children[1], name: li.children[2], gap: li.children[3], key: '' };
    });
    this.tower.hidden = race.cars.length < 2;
    this.posOf.textContent = race.mode === 'time' ? '' : '/' + race.cars.length;
    this.posLabel.textContent = race.mode === 'time' ? 'na ghost' : 'pozice';
    this.pos.classList.toggle('delta', race.mode === 'time');
    this.tag.textContent = tag;
    this.tag.hidden = !tag;
    this.tag.style.background = hex(car.color);
    this.itemKey.textContent = itemKey;
    this.cache = {};
    this.clearMessages();
    this.resize();
  }

  // přepočet velikostí plátna (volá se i při změně okna)
  resize() {
    if (!this.race) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = this.minimap.clientWidth || 190;
    const base = document.createElement('canvas');
    base.width = base.height = size;
    this.mapInfo = trackOutline(this.race.track, base, { pad: Math.max(8, size * 0.075), color: 'rgba(243,245,248,0.85)' });
    this.mapBase = base;
    this.minimap.width = size * dpr;
    this.minimap.height = size * dpr;
    this.mapCtx = this.minimap.getContext('2d');
    const sp = this.speedo;
    const s = sp.clientWidth || 230;
    this.speedoSize = s;
    this.speedoDpr = dpr;
    sp.width = s * dpr;
    sp.height = s * dpr;
    this.speedoCtx = sp.getContext('2d');
  }

  set(el, key, value) {
    if (this.cache[key] !== value) {
      this.cache[key] = value;
      el.textContent = value;
    }
  }

  message(text, cls = '', dur = 1.2) {
    this.msg.textContent = text;
    this.msg.className = 'center-msg show ' + cls;
    this.msgTimer = dur;
  }

  sub(html, dur = 2.5, cls = '') {
    this.subEl.innerHTML = html;
    this.subEl.className = 'sub-msg show ' + cls;
    this.subTimer = dur;
  }

  clearMessages() {
    this.msg.className = 'center-msg';
    this.subEl.className = 'sub-msg';
    this.msgTimer = this.subTimer = 0;
  }

  update(dt, race, gear) {
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) this.msg.classList.remove('show');
    }
    if (this.subTimer > 0) {
      this.subTimer -= dt;
      if (this.subTimer <= 0) this.subEl.classList.remove('show');
    }
    const p = this.car;
    if (race.mode === 'time') {
      const d = race.ghostDelta;
      this.set(this.pos, 'pos', d == null ? '–' : formatDelta(d));
      this.pos.classList.toggle('ahead', d != null && d < 0);
      this.pos.classList.toggle('behind', d != null && d > 0);
    } else this.set(this.pos, 'pos', String(p.place));
    const lapNow = Math.min(race.laps, p.lap + 1);
    this.set(this.lap, 'lap', `${lapNow}/${race.laps}`);
    const running = race.state !== 'countdown';
    this.set(this.time, 'time', running ? formatTime(p.finished ? p.finishTime : race.time) : '0:00,00');
    this.set(this.lapTime, 'laptime', running && !p.finished ? formatTime(race.time - p.lapStart) : '–');
    this.set(this.best, 'best', formatTime(p.bestLap));

    // věž
    const st = race.standings || race.cars;
    st.forEach((car, i) => {
      const r = this.rows[i];
      if (!r) return;
      let gap = '';
      if (car.finished) gap = 'cíl';
      else if (i === 0) gap = 'vede';
      else {
        const g = race.gapToLeader(car);
        gap = g != null ? '+' + g.toFixed(1).replace('.', ',') : '';
      }
      const key = car.name + '|' + gap + '|' + (car === p);
      if (r.key !== key) {
        r.key = key;
        r.pos.textContent = i + 1;
        r.chip.style.background = hex(car.color);
        r.name.textContent = car.name;
        r.gap.textContent = gap;
        r.li.classList.toggle('me', car === p);
      }
    });

    this.drawMinimap(race);
    this.drawSpeedo(p, gear);
  }

  drawMinimap(race) {
    const g = this.mapCtx;
    const { map, dpr } = this.mapInfo;
    const size = this.minimap.width / dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);
    g.fillStyle = 'rgba(10,17,31,0.55)';
    g.beginPath();
    g.roundRect ? g.roundRect(0, 0, size, size, 10) : g.rect(0, 0, size, size);
    g.fill();
    g.drawImage(this.mapBase, 0, 0, size, size);
    for (const car of race.cars) {
      if (car === this.car) continue;
      const [x, y] = map(car.x, car.z);
      g.fillStyle = hex(car.color);
      g.strokeStyle = 'rgba(0,0,0,0.7)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, y, 4.2, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    if (race.ghostPos) {
      const [x, y] = map(race.ghostPos.x, race.ghostPos.z);
      g.strokeStyle = 'rgba(160,220,255,0.9)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, 4.5, 0, Math.PI * 2);
      g.stroke();
    }
    const p = this.car;
    const [x, y] = map(p.x, p.z);
    const s = Math.sin(p.hd), c = Math.cos(p.hd);
    g.save();
    g.translate(x, y);
    g.rotate(Math.atan2(c, s));
    g.fillStyle = '#fff';
    g.strokeStyle = hex(p.color);
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(8, 0);
    g.lineTo(-5, 5.5);
    g.lineTo(-2.5, 0);
    g.lineTo(-5, -5.5);
    g.closePath();
    g.stroke();
    g.fill();
    g.restore();
  }

  drawSpeedo(car, gear) {
    const g = this.speedoCtx;
    const dpr = this.speedoDpr, S = this.speedoSize;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, S, S);
    const cx = S / 2, cy = S / 2 + 8, R = S * 0.42;
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const maxKmh = 260;
    const kmh = Math.abs(car.vLong) * 3.6;
    const ang = (v) => a0 + (a1 - a0) * Math.min(1, v / maxKmh);
    // podklad
    g.fillStyle = 'rgba(10,17,31,0.62)';
    g.beginPath();
    g.arc(cx, cy, R + 12, 0, Math.PI * 2);
    g.fill();
    // stupnice
    g.lineCap = 'butt';
    g.strokeStyle = 'rgba(243,245,248,0.16)';
    g.lineWidth = 10;
    g.beginPath();
    g.arc(cx, cy, R, a0, a1);
    g.stroke();
    g.strokeStyle = 'rgba(232,57,44,0.75)';
    g.beginPath();
    g.arc(cx, cy, R, ang(220), a1);
    g.stroke();
    // aktuální rychlost
    const grd = g.createLinearGradient(cx - R, cy, cx + R, cy);
    grd.addColorStop(0, '#f3f5f8');
    grd.addColorStop(1, car.nitroActive ? '#ffc21a' : '#f3f5f8');
    g.strokeStyle = grd;
    g.beginPath();
    g.arc(cx, cy, R, a0, ang(kmh));
    g.stroke();
    // rysky
    g.fillStyle = 'rgba(243,245,248,0.75)';
    g.font = `600 ${Math.round(S * 0.052)}px "Chakra Petch", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let v = 0; v <= maxKmh; v += 20) {
      const a = ang(v);
      const major = v % 40 === 0;
      g.strokeStyle = 'rgba(243,245,248,0.7)';
      g.lineWidth = major ? 2 : 1;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * (R - 8), cy + Math.sin(a) * (R - 8));
      g.lineTo(cx + Math.cos(a) * (R - (major ? 16 : 12)), cy + Math.sin(a) * (R - (major ? 16 : 12)));
      g.stroke();
      if (major) g.fillText(String(v), cx + Math.cos(a) * (R - 28), cy + Math.sin(a) * (R - 28));
    }
    // ručička
    const na = ang(kmh);
    g.strokeStyle = '#e8392c';
    g.lineWidth = 3;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx - Math.cos(na) * 10, cy - Math.sin(na) * 10);
    g.lineTo(cx + Math.cos(na) * (R - 6), cy + Math.sin(na) * (R - 6));
    g.stroke();
    // digitální údaje
    g.fillStyle = '#f3f5f8';
    g.font = `italic 700 ${Math.round(S * 0.2)}px "Chakra Petch", sans-serif`;
    g.fillText(String(Math.round(kmh)), cx, cy + S * 0.13);
    g.fillStyle = 'rgba(154,167,186,1)';
    g.font = `600 ${Math.round(S * 0.055)}px "Barlow Semi Condensed", sans-serif`;
    g.fillText('KM/H', cx, cy + S * 0.25);
    // rychlostní stupeň
    const gtxt = car.vLong < -0.5 ? 'R' : String(gear);
    g.fillStyle = 'rgba(243,245,248,0.1)';
    g.fillRect(cx - S * 0.07, cy - S * 0.2, S * 0.14, S * 0.14);
    g.fillStyle = '#ffc21a';
    g.font = `italic 700 ${Math.round(S * 0.1)}px "Chakra Petch", sans-serif`;
    g.fillText(gtxt, cx, cy - S * 0.13);
    // nitro
    const nw = S * 0.5, nh = 7, nx = cx - nw / 2, ny = cy + S * 0.33;
    g.fillStyle = 'rgba(243,245,248,0.15)';
    g.fillRect(nx, ny, nw, nh);
    g.fillStyle = car.nitroActive ? '#fff3b0' : '#ffc21a';
    g.fillRect(nx, ny, nw * car.nitro, nh);
    g.fillStyle = 'rgba(154,167,186,1)';
    g.font = `600 ${Math.round(S * 0.045)}px "Barlow Semi Condensed", sans-serif`;
    g.fillText('NITRO', cx, ny + nh + S * 0.045);
  }

  setItem(item, rolling) {
    if (!item && !rolling) {
      this.itemSlot.hidden = true;
      return;
    }
    this.itemSlot.hidden = false;
    this.itemSlot.classList.toggle('rolling', !!rolling);
    const key = rolling ? 'roll' : item;
    if (this.cache.item !== key) {
      this.cache.item = key;
      this.itemIcon.innerHTML = ITEM_ICONS[rolling ? 'roll' : item] ?? '';
    }
  }
}

export const ITEM_ICONS = {
  roll: '<svg viewBox="0 0 40 40" width="40" height="40"><text x="20" y="29" text-anchor="middle" font-size="28" font-weight="700" fill="#ffc21a" font-family="Chakra Petch, sans-serif">?</text></svg>',
  rocket: '<svg viewBox="0 0 40 40" width="42" height="42"><g transform="rotate(45 20 20)"><path d="M20 3c5 5 6 12 5 20h-10c-1-8 0-15 5-20z" fill="#f3f5f8"/><path d="M15 23l-5 6 6-1zM25 23l5 6-6-1z" fill="#e8392c"/><circle cx="20" cy="13" r="2.6" fill="#2c6fd1"/><path d="M16.5 24h7l-1.5 8h-4z" fill="#ffc21a"/></g></svg>',
  mine: '<svg viewBox="0 0 40 40" width="42" height="42"><g stroke="#9aa7ba" stroke-width="3" stroke-linecap="round"><path d="M20 5v6M20 29v6M5 20h6M29 20h6M9.5 9.5l4 4M26.5 26.5l4 4M30.5 9.5l-4 4M13.5 26.5l-4 4"/></g><circle cx="20" cy="20" r="10" fill="#2a3140"/><circle cx="20" cy="20" r="3.5" fill="#e8392c"/></svg>',
  shield: '<svg viewBox="0 0 40 40" width="42" height="42"><path d="M20 4l13 5v9c0 9-6 15-13 18-7-3-13-9-13-18V9z" fill="#2c6fd1" stroke="#9fd8ff" stroke-width="2"/><path d="M14 20l4 4 8-9" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  nitro: '<svg viewBox="0 0 40 40" width="42" height="42"><path d="M23 3L9 23h9l-3 14 16-21h-9z" fill="#ffc21a" stroke="#fff3b0" stroke-width="1.5" stroke-linejoin="round"/></svg>',
};
