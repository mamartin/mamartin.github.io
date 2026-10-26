// Ovládání záznamu závodu: spuštění z výsledků, pauza, posun, rychlost, kamera a sledovaný vůz.
import { ReplayPlayer } from './replay.js';
import { $, G, audio, view } from './state.js';

export function startReplay() {
  if (!G.race || !G.replayRec) return;
  G.replay = new ReplayPlayer(G.replayRec, G.race.cars, G.world.track, G.world.terrain);
  G.screen = 'replay';
  $('results').hidden = true;
  view.hudRoot.hidden = true;
  if (G.ghostMesh) G.ghostMesh.root.visible = false;
  audio.silence();
  $('replay').hidden = false;
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
