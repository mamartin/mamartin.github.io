// Ovládání záznamu závodu: spuštění z výsledků, pauza, posun, rychlost, kamera a sledovaný vůz;
// vpravo mapa trati s auty a průběžné pořadí (kliknutím na jezdce ho kamera sleduje).
import { ReplayPlayer } from './replay.js';
import { trackOutline } from './hud.js';
import { $, G, audio, view } from './state.js';

const hex = (n) => '#' + n.toString(16).padStart(6, '0');
let map = null; // podklad mapy a převod souřadnic
let orderKey = '';

// podklad mapy: obrys trati se startovní čarou (znovu při změně velikosti okna)
function buildMap() {
  const canvas = $('rp-map');
  const size = canvas.clientWidth || 200;
  const base = document.createElement('canvas');
  base.width = base.height = size;
  base.style.width = base.style.height = `${size}px`;
  const info = trackOutline(G.world.track, base, { pad: Math.max(8, size * 0.07), color: 'rgba(243,245,248,0.85)' });
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = canvas.height = Math.round(size * dpr);
  map = { ...info, base, size, dpr };
}

function drawMap() {
  const r = G.replay;
  if (!r || !map) return;
  const g = $('rp-map').getContext('2d');
  const { size, dpr } = map;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, size, size);
  g.drawImage(map.base, 0, 0, size, size);
  const focus = r.target();
  // vzadu ostatní, sledované auto navrch jako šipka ve směru jízdy
  for (const car of r.cars) {
    if (car === focus) continue;
    const [x, y] = map.map(car.x, car.z);
    g.fillStyle = hex(car.color);
    g.strokeStyle = 'rgba(0,0,0,0.7)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(x, y, car.isPlayer ? 5.5 : 4.5, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    if (car.isPlayer) {
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, y, 8, 0, Math.PI * 2);
      g.stroke();
    }
  }
  const [x, y] = map.map(focus.x, focus.z);
  g.save();
  g.translate(x, y);
  g.rotate(Math.atan2(Math.cos(focus.hd), Math.sin(focus.hd)));
  g.fillStyle = hex(focus.color);
  g.strokeStyle = '#fff';
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(9, 0);
  g.lineTo(-6, 6.5);
  g.lineTo(-3, 0);
  g.lineTo(-6, -6.5);
  g.closePath();
  g.stroke();
  g.fill();
  g.restore();
}

// pořadí podle ujeté dráhy v daném okamžiku záznamu; přepisuje se jen při změně
function drawOrder() {
  const r = G.replay;
  if (!r) return;
  const focus = r.target();
  const order = r.cars.map((c, i) => ({ c, i })).sort((a, b) => b.c.progress - a.c.progress);
  const key = order.map((o) => o.i).join(',') + '|' + r.cars.indexOf(focus);
  if (key === orderKey) return;
  orderKey = key;
  $('rp-order').innerHTML = order.map(({ c, i }, k) =>
    `<li><button type="button" data-car="${i}" class="${c === focus ? 'on' : ''}${c.isPlayer ? ' me' : ''}">` +
    `<span class="rp-pos">${k + 1}</span><span class="chip" style="background:${hex(c.color)}"></span>${c.name}</button></li>`).join('');
}

export function startReplay() {
  if (!G.race || !G.replayRec) return;
  G.replay = new ReplayPlayer(G.replayRec, G.race.cars, G.world.track, G.world.terrain);
  G.screen = 'replay';
  $('results').hidden = true;
  view.hudRoot.hidden = true;
  if (G.ghostMesh) G.ghostMesh.root.visible = false;
  audio.silence();
  $('replay').hidden = false;
  orderKey = '';
  buildMap();
  refreshReplayUI(true);
}

export function stopReplay() {
  if (!G.replay) return;
  G.replay.restore();
  G.replay = null;
  $('replay').hidden = true;
  G.screen = 'race';
  view.hudRoot.hidden = false;
  for (const r of view.rigs) r.snap();
  $('results').hidden = false;
  $('replay-btn').focus();
}

export function toggleReplay() {
  const r = G.replay;
  if (!r) return;
  if (!r.playing && r.t >= r.duration) r.seek(0);
  r.playing = !r.playing;
  refreshReplayUI(true);
}

const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export function refreshReplayUI(full = false) {
  const r = G.replay;
  if (!r) return;
  $('rp-time').textContent = `${clock(r.t)} / ${clock(r.duration)}`;
  if (!G.seeking) $('rp-seek').value = String(Math.round((r.t / Math.max(r.duration, 0.01)) * 1000));
  const play = $('rp-play');
  const label = r.playing ? 'Pauza' : 'Přehrát';
  if (play.textContent !== label) play.textContent = label;
  drawMap();
  drawOrder();
  if (!full) return;
  for (const b of $('rp-speed').children) b.setAttribute('aria-checked', String(+b.dataset.speed === r.speed));
  for (const b of $('rp-cam').children) b.setAttribute('aria-checked', String(b.dataset.cam === r.cam));
  for (const b of $('rp-follow').children) b.setAttribute('aria-checked', String(b.dataset.follow === r.follow));
}

export function bindReplay() {
  $('replay-btn').addEventListener('click', startReplay);
  $('rp-exit').addEventListener('click', stopReplay);
  $('rp-play').addEventListener('click', toggleReplay);
  const seek = $('rp-seek');
  seek.addEventListener('input', () => {
    G.seeking = true;
    if (G.replay) G.replay.seek((seek.value / 1000) * G.replay.duration);
  });
  seek.addEventListener('change', () => (G.seeking = false));
  // kliknutí na jezdce v pořadí: kamera ho začne sledovat
  $('rp-order').addEventListener('click', (e) => {
    const b = e.target.closest('[data-car]');
    if (!b || !G.replay) return;
    G.replay.follow = +b.dataset.car;
    G.replay.cut = true;
    refreshReplayUI(true);
  });
  window.addEventListener('resize', () => {
    if (G.replay) buildMap();
  });
  for (const [id, key, num] of [['rp-speed', 'speed', true], ['rp-cam', 'cam', false], ['rp-follow', 'follow', false]]) {
    for (const b of $(id).children) {
      b.addEventListener('click', () => {
        if (!G.replay) return;
        G.replay[key] = num ? +b.dataset[key] : b.dataset[key];
        G.replay.cut = true;
        refreshReplayUI(true);
      });
    }
  }
}
