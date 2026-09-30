// Turbo Okruh – vstupní bod: renderer, menu, závod a herní smyčka.
import * as THREE from 'three';
import { TRACKS } from './tracks.js';
import { BIOMES } from './biomes.js';
import { Track, SURF_OFF } from './track.js';
import { Terrain } from './terrain.js';
import { buildScenery, buildSky, buildLights } from './scenery.js';
import { randomTrackDef, buildCenterline, validateCenterline } from './trackmath.js';
import { Car, createCarMesh, disposeCarMesh } from './car.js';
import { Race, PLAYER_COLORS, OPPONENTS, PLAYER_NUMBER } from './race.js';
import { CameraRig } from './camera.js';
import { Effects } from './effects.js';
import { Input } from './input.js';
import { AudioEngine, GearBox } from './audio.js';
import { HUD, formatTime, formatDelta, trackOutline } from './hud.js';
import { Store } from './store.js';
import { GhostRecorder, GhostPlayer } from './ghost.js';
import { Pickups, ITEM_NAMES } from './pickups.js';
import { RNG, clamp } from './rng.js';

const STEP = 1 / 120;
const CUP_TRACKS = ['sumava', 'kanon', 'mesto'];
const CUP_POINTS = [10, 6, 4, 3, 2, 1];
const $ = (id) => document.getElementById(id);

// --- základ -------------------------------------------------------------------

const store = new Store();
const S = store.settings;
const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (!S.quality) S.quality = isTouch || Math.min(screen.width, screen.height) < 700 ? 'medium' : 'high';
if (isTouch) document.body.classList.add('touch-ui');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas: $('game'),
    antialias: S.quality !== 'low',
    powerPreference: 'high-performance',
  });
} catch (e) {
  showError('Prohlížeč nepodporuje WebGL, bez kterého 3D hra neběží. Zkus jiný prohlížeč nebo zapni hardwarovou akceleraci.');
  throw e;
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
applyPixelRatio();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 4200);
const rig = new CameraRig(camera);
rig.mode = S.camera === 'hood' ? 'hood' : 'chase';
const input = new Input();
input.bindTouch($('touch'));
const audio = new AudioEngine();
audio.muted = !S.sound;
const hud = new HUD();
const gearbox = new GearBox();
const pmrem = new THREE.PMREMGenerator(renderer);

const G = {
  screen: 'loading', // loading | menu | race
  paused: false,
  world: null,
  race: null,
  pickups: null,
  timeScale: 1,
  acc: 0,
  fps: 60,
  resultsTimer: 0,
};
window.__game = G;

function applyPixelRatio() {
  const dpr = window.devicePixelRatio || 1;
  const cap = S.quality === 'high' ? 2 : S.quality === 'medium' ? 1.5 : 1;
  renderer.setPixelRatio(Math.min(dpr, cap));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}

window.addEventListener('resize', () => {
  applyPixelRatio();
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  if (G.world) G.world.effects.setView(camera, renderer.domElement.height, scene.fog);
  if (G.race) hud.resize();
});

function showError(text) {
  $('loading').hidden = true;
  $('error').hidden = false;
  $('error-text').textContent = text;
}

// --- tratě ----------------------------------------------------------------------

function randomDef(seed) {
  const rng = new RNG(seed);
  const biome = rng.pick(['forest', 'canyon', 'city']);
  const city = biome === 'city';
  let points = randomTrackDef(seed);
  const base = { width: city ? 14 : 16, runoff: city ? 3 : 7 };
  // pro jistotu ověř geometrii, případně zkus další variantu
  for (let t = 0; t < 8; t++) {
    const cl = buildCenterline({ points });
    if (validateCenterline(cl, base.width / 2, base.runoff).ok) break;
    points = randomTrackDef(seed + (t + 1) * 7919);
  }
  const def = {
    id: 'random-' + seed,
    name: 'Náhodná trať',
    subtitle: `${BIOMES[biome].name}, seed ${seed}`,
    biome,
    ...base,
    maxBank: city ? 0.015 : 0.07,
    seed: seed % 100000,
    points,
    random: true,
  };
  if (biome === 'forest') {
    // jezero doprostřed, pokud je místo
    const cl = buildCenterline(def);
    let cx = 0, cz = 0;
    for (let k = 0; k < cl.N; k++) {
      cx += cl.px[k];
      cz += cl.pz[k];
    }
    cx /= cl.N;
    cz /= cl.N;
    let d = Infinity;
    for (let k = 0; k < cl.N; k++) d = Math.min(d, Math.hypot(cl.px[k] - cx, cl.pz[k] - cz));
    if (d > 100) def.lake = { x: cx, z: cz, r: Math.min(80, (d - 30) / 1.7) };
  }
  return def;
}

// závodní režim bez šampionátu ('race' | 'time')
const raceMode = () => (S.mode === 'time' ? 'time' : 'race');
// trať, která se má právě jet (v šampionátu podle kola)
const currentTrackId = () => (S.mode === 'cup' ? CUP_TRACKS[G.cup ? G.cup.round : 0] : S.track);

function trackDef(id) {
  if (id === 'random') return randomDef(S.randomSeed);
  return TRACKS.find((t) => t.id === id) || TRACKS[0];
}

function disposeObject(root) {
  root.traverse((o) => {
    if (o.isLight && o.dispose) o.dispose();
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        for (const key of ['map', 'emissiveMap']) if (m[key]) m[key].dispose();
        m.dispose();
      }
    }
  });
}

function disposeWorld() {
  const w = G.world;
  if (!w) return;
  scene.remove(w.group, w.sky);
  disposeObject(w.group);
  disposeObject(w.sky);
  w.effects.dispose(scene);
  if (w.envRT) w.envRT.dispose();
  for (const c of w.showcase) disposeCarMesh(c.mesh);
  G.world = null;
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

let loadToken = 0;
async function loadWorld(id) {
  const token = ++loadToken;
  G.screen = G.screen === 'race' ? 'race' : 'loading';
  // první načtení zakryje vše, další jen jemně ztmaví scénu
  $('loading').classList.toggle('soft', !!G.world);
  $('loading').hidden = false;
  $('loading-text').textContent = 'Stavím trať…';
  await nextFrame();
  await nextFrame();
  // mezitím si hráč vybral jinou trať
  if (token !== loadToken) return G.world;
  disposeWorld();
  const def = trackDef(id);
  const biome = BIOMES[def.biome];
  const track = new Track(def);
  const terrain = new Terrain(track, def.biome, { seed: def.seed, lake: def.lake, cell: S.quality === 'low' ? 11 : 8 });
  const group = new THREE.Group();
  group.add(terrain.buildMesh(biome.terrain));
  group.add(track.buildMeshes(biome.track, renderer.capabilities.getMaxAnisotropy()));
  const scenery = buildScenery(track, terrain, def.biome, biome, S.quality, def.seed + 3);
  group.add(scenery.group);
  const lights = buildLights(biome, S.quality);
  group.add(lights.group);
  const sky = buildSky(biome);
  scene.add(group, sky);
  scene.fog = new THREE.Fog(biome.fog.color, biome.fog.near, biome.fog.far);
  scene.background = new THREE.Color(biome.fog.color);
  renderer.toneMappingExposure = biome.exposure;
  renderer.shadowMap.enabled = S.quality !== 'low';

  // odrazy na autech a vodě z oblohy
  const envScene = new THREE.Scene();
  const envSky = buildSky(biome);
  envScene.add(envSky);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(biome.terrain.groundA).multiplyScalar(0.6) }));
  ground.position.y = -30;
  envScene.add(ground);
  const envRT = pmrem.fromScene(envScene, 0.02, 0.1, 3000);
  scene.environment = envRT.texture;
  scene.environmentIntensity = biome.night ? 0.5 : 1;
  disposeObject(envSky);
  ground.geometry.dispose();

  const effects = new Effects(scene, S.quality);
  effects.setView(camera, renderer.domElement.height, scene.fog);

  G.world = { def, biome, track, terrain, group, sky, lights, effects, envRT, showcase: [], crowd: scenery.extra.crowd };
  buildShowcase();
  $('loading').hidden = true;
  return G.world;
}

// auta na roštu v menu
function buildShowcase() {
  const w = G.world;
  for (const c of w.showcase) disposeCarMesh(c.mesh);
  w.showcase = [];
  const playerColor = PLAYER_COLORS[S.color]?.hex ?? PLAYER_COLORS[0].hex;
  const pool = OPPONENTS.filter((o) => o.color !== playerColor);
  const race = raceMode() === 'race';
  const count = race ? 6 : 1;
  for (let slot = 0; slot < count; slot++) {
    const isPlayer = race ? slot === 3 : true;
    const info = isPlayer ? { color: playerColor, number: PLAYER_NUMBER } : pool[(slot > 3 ? slot - 1 : slot) % pool.length];
    const car = new Car(w.track, { color: info.color, number: info.number, night: w.biome.night, biome: w.biome, isPlayer });
    const g = w.track.gridSlot(race ? slot : 2);
    car.reset(g.s, g.lat);
    car.step(0);
    car.render(1);
    scene.add(car.mesh.root);
    w.showcase.push(car);
  }
}

// --- menu ---------------------------------------------------------------------------

const menuTracks = [];

function trackMeta(def, track) {
  const rec = store.record(def.id);
  const km = (track.L / 1000).toFixed(2).replace('.', ',');
  return `${km} km · ${rec.lap ? 'rekord ' + formatTime(rec.lap) : 'bez rekordu'}`;
}

function buildTrackList() {
  const list = $('track-list');
  list.innerHTML = '';
  menuTracks.length = 0;
  const defs = [...TRACKS.map((t) => ({ def: t, id: t.id })), { def: randomDef(S.randomSeed), id: 'random' }];
  for (const { def, id } of defs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'track-card';
    btn.setAttribute('role', 'radio');
    btn.dataset.id = id;
    const canvas = document.createElement('canvas');
    btn.appendChild(canvas);
    const name = document.createElement('span');
    name.className = 'tc-name';
    name.textContent = def.name;
    const meta = document.createElement('span');
    meta.className = 'tc-meta';
    btn.append(name, meta);
    if (id === 'random') {
      const re = document.createElement('span');
      re.className = 'tc-reroll';
      re.setAttribute('role', 'button');
      re.setAttribute('aria-label', 'Vygenerovat jinou trať');
      re.title = 'Vygenerovat jinou trať';
      re.textContent = '↻';
      re.addEventListener('click', (e) => {
        e.stopPropagation();
        S.randomSeed = Math.floor(Math.random() * 1e9);
        store.save();
        buildTrackList();
        selectTrack('random', true);
      });
      btn.appendChild(re);
    }
    btn.addEventListener('click', () => selectTrack(id));
    list.appendChild(btn);
    menuTracks.push({ id, def, btn, canvas, meta });
  }
  requestAnimationFrame(() => {
    for (const m of menuTracks) {
      const tr = new Track(m.def);
      trackOutline(tr, m.canvas, { pad: 6, color: '#f3f5f8', width: 2.4 });
      m.meta.textContent = m.id === 'random' ? `${(tr.L / 1000).toFixed(2).replace('.', ',')} km · ${m.def.subtitle}` : trackMeta(m.def, tr);
      m.btn.setAttribute('aria-label', `${m.def.name}, ${m.meta.textContent}`);
    }
  });
  refreshMenu();
}

async function selectTrack(id, force = false) {
  if (S.track === id && !force && G.world) return;
  S.track = id;
  store.save();
  refreshMenu();
  await loadWorld(id);
  G.screen = 'menu';
}

function refreshMenu() {
  for (const m of menuTracks) m.btn.setAttribute('aria-checked', String(m.id === S.track));
  for (const b of $('mode-seg').children) b.setAttribute('aria-checked', String(b.dataset.mode === S.mode));
  for (const b of $('diff-seg').children) b.setAttribute('aria-checked', String(b.dataset.diff === S.difficulty));
  for (const b of $('quality-seg').children) b.setAttribute('aria-checked', String(b.dataset.q === S.quality));
  $('laps-value').textContent = S.laps;
  $('diff-opt').hidden = S.mode === 'time';
  $('weapons-opt').hidden = S.mode === 'time';
  $('track-block').hidden = S.mode === 'cup';
  $('cup-block').hidden = S.mode !== 'cup';
  $('mode-hint').textContent = {
    race: 'Ty proti pěti soupeřům. Drift plní nitro, krabice s otazníkem dávají power-upy.',
    cup: 'Tři závody za sebou. Body za umístění 10, 6, 4, 3, 2, 1 a vítězí nejvíc bodů.',
    time: 'Sám na trati proti průhlednému ghostu svého nejlepšího kola.',
  }[S.mode];
  if (S.mode === 'cup') {
    $('cup-list').innerHTML = CUP_TRACKS.map((id) => {
      const def = TRACKS.find((t) => t.id === id);
      const rec = store.record(id);
      return `<li><span class="cl-name">${def.name}</span><span class="cl-meta">${rec.lap ? 'rekord ' + formatTime(rec.lap) : 'bez rekordu'}</span></li>`;
    }).join('');
    const best = store.records.cup?.best;
    $('cup-best').textContent = best ? `Tvoje nejlepší celkové umístění: ${best}. místo.` : 'Šampionát jsi ještě nedokončil.';
  }
  const wt = $('weapons-toggle');
  wt.setAttribute('aria-pressed', String(S.weapons));
  wt.querySelector('em').textContent = S.weapons ? 'Zapnuto' : 'Vypnuto';
  const st = $('sound-toggle');
  st.setAttribute('aria-pressed', String(S.sound));
  st.querySelector('em').textContent = S.sound ? 'Zapnuto' : 'Vypnuto';
  const sw = $('swatches');
  if (!sw.children.length) {
    PLAYER_COLORS.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', c.name);
      b.title = c.name;
      b.style.background = '#' + c.hex.toString(16).padStart(6, '0');
      b.addEventListener('click', () => {
        S.color = i;
        store.save();
        refreshMenu();
        if (G.world && G.screen === 'menu') buildShowcase();
      });
      sw.appendChild(b);
    });
  }
  [...sw.children].forEach((b, i) => b.setAttribute('aria-checked', String(i === S.color)));
}

function bindMenu() {
  for (const b of $('mode-seg').children) {
    b.addEventListener('click', async () => {
      S.mode = b.dataset.mode;
      store.save();
      refreshMenu();
      const want = trackDef(currentTrackId()).id;
      if (G.world && G.world.def.id !== want) {
        await loadWorld(currentTrackId());
        G.screen = 'menu';
      } else if (G.world) buildShowcase();
    });
  }
  for (const b of $('diff-seg').children) {
    b.addEventListener('click', () => {
      S.difficulty = b.dataset.diff;
      store.save();
      refreshMenu();
    });
  }
  for (const b of $('quality-seg').children) {
    b.addEventListener('click', async () => {
      if (S.quality === b.dataset.q) return;
      S.quality = b.dataset.q;
      store.save();
      refreshMenu();
      applyPixelRatio();
      await loadWorld(currentTrackId());
      G.screen = 'menu';
    });
  }
  $('laps-minus').addEventListener('click', () => {
    S.laps = Math.max(1, S.laps - 1);
    store.save();
    refreshMenu();
  });
  $('laps-plus').addEventListener('click', () => {
    S.laps = Math.min(9, S.laps + 1);
    store.save();
    refreshMenu();
  });
  $('weapons-toggle').addEventListener('click', () => {
    S.weapons = !S.weapons;
    store.save();
    refreshMenu();
  });
  $('sound-toggle').addEventListener('click', () => {
    S.sound = !S.sound;
    audio.setMuted(!S.sound);
    store.save();
    refreshMenu();
  });
  $('start-btn').addEventListener('click', () => startFromMenu());
  $('pause-btn').addEventListener('click', () => setPaused(!G.paused));
  $('resume-btn').addEventListener('click', () => setPaused(false));
  $('restart-btn').addEventListener('click', () => startRace());
  $('menu-btn').addEventListener('click', () => toMenu());
  $('again-btn').addEventListener('click', () => {
    if (G.cup) {
      if (G.cup.round < CUP_TRACKS.length - 1) {
        G.cup.round++;
        G.cup.awarded = false;
      } else G.cup = newCup();
    }
    startRace();
  });
  $('res-menu-btn').addEventListener('click', () => toMenu());
}

// --- závod ---------------------------------------------------------------------------

function newCup() {
  return { round: 0, points: {}, awarded: false };
}

function startFromMenu() {
  G.cup = S.mode === 'cup' ? newCup() : null;
  return startRace();
}

function clearRace() {
  const r = G.race;
  if (!r) return;
  for (const c of r.cars) {
    if (c.headlight) c.headlight.dispose?.();
    disposeCarMesh(c.mesh);
  }
  if (G.ghostMesh) {
    disposeCarMesh(G.ghostMesh);
    G.ghostMesh = null;
  }
  if (G.pickups) {
    G.pickups.dispose();
    G.pickups = null;
  }
  G.race = null;
}

async function startRace() {
  if (G.starting) return;
  G.starting = true;
  try {
    await startRaceInner();
  } finally {
    G.starting = false;
  }
}

async function startRaceInner() {
  audio.init();
  audio.setMuted(!S.sound);
  $('results').hidden = true;
  $('pause').hidden = true;
  G.paused = false;
  clearRace();
  if (S.mode === 'cup' && !G.cup) G.cup = newCup();
  if (S.mode !== 'cup') G.cup = null;
  const trackId = currentTrackId();
  if (!G.world || G.world.def.id !== trackDef(trackId).id) await loadWorld(trackId);
  const w = G.world;
  for (const c of w.showcase) disposeCarMesh(c.mesh);
  w.showcase = [];
  w.effects.clear();
  const playerColor = PLAYER_COLORS[S.color]?.hex ?? PLAYER_COLORS[0].hex;
  const race = new Race({
    track: w.track, biome: w.biome, mode: raceMode(), laps: S.laps, difficulty: S.difficulty, playerColor, night: w.biome.night,
  });
  for (const c of race.cars) {
    scene.add(c.mesh.root);
    c.render(1);
  }
  if (w.biome.night) {
    // skutečné světlo jen pro hráče
    const spot = new THREE.SpotLight(0xfff1d8, 90, 90, 0.5, 0.55, 1.4);
    spot.position.set(0, 1.0, 1.6);
    spot.target.position.set(0, 0, 22);
    race.player.mesh.root.add(spot, spot.target);
    race.player.headlight = spot;
  }
  G.race = race;
  G.acc = 0;
  G.resultsTimer = 0;
  G.bestBefore = Infinity;
  G.recorder = new GhostRecorder();
  G.ghost = null;
  if (raceMode() === 'time') {
    const data = store.ghost(w.def.id);
    if (data && data.frames && data.frames.length > 8) {
      G.ghost = new GhostPlayer(data);
      G.ghostMesh = createCarMesh(0x9fd8ff, { ghost: true });
      G.ghostMesh.root.visible = false;
      scene.add(G.ghostMesh.root);
    }
  }
  if (raceMode() === 'race' && S.weapons) {
    G.pickups = new Pickups({ track: w.track, scene, race, effects: w.effects, audio, seed: Date.now() % 100000 });
  }
  document.body.classList.toggle('items-on', !!G.pickups);
  hud.setupRace(race);
  hud.setItem(null);
  hud.show(true);
  const hint = $('rotate-hint');
  hint.style.animation = 'none';
  void hint.offsetWidth;
  hint.style.animation = '';
  $('menu').hidden = true;
  document.activeElement?.blur();
  const fromMenu = G.screen === 'menu' && rig.mode === 'chase';
  if (fromMenu) rig.flyTo(race.player);
  else rig.snap();
  w.track.setStartLights(0);
  if (G.cup) hud.sub(`Šampionát · závod ${G.cup.round + 1}/${CUP_TRACKS.length} · ${w.def.name}`, 3.2);
  if (!isTouch && (S.racesStarted || 0) < 3) {
    hud.sub('<kbd>W</kbd> plyn · <kbd>A</kbd><kbd>D</kbd> zatáčení · <kbd>Mezerník</kbd> drift · <kbd>Shift</kbd> nitro' + (G.pickups ? ' · <kbd>F</kbd> power-up' : ''), 5, 'help');
  }
  S.racesStarted = (S.racesStarted || 0) + 1;
  store.save();
  G.screen = 'race';
}

function toMenu() {
  clearRace();
  G.cup = null;
  $('results').hidden = true;
  $('pause').hidden = true;
  hud.show(false);
  audio.silence();
  G.paused = false;
  G.screen = 'menu';
  $('menu').hidden = false;
  if (G.world) {
    G.world.effects.clear();
    G.world.track.setStartLights(0);
    buildShowcase();
  }
  buildTrackList();
}

function setPaused(p) {
  if (G.screen !== 'race' || !G.race || !$('results').hidden) return;
  G.paused = p;
  $('pause').hidden = !p;
  if (p) {
    audio.silence();
    $('resume-btn').focus();
  } else {
    G.acc = 0;
    document.activeElement?.blur();
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && G.screen === 'race' && G.race && G.race.state !== 'finished') setPaused(true);
});

function handleKeys(pressed) {
  for (const code of pressed) {
    if (code === 'KeyM') {
      S.sound = !S.sound;
      audio.setMuted(!S.sound);
      store.save();
      refreshMenu();
    }
    if (G.screen === 'menu') {
      const free = !document.activeElement || document.activeElement === document.body;
      if (((code === 'Enter' || code === 'NumpadEnter') && free) || code === 'PadA') startFromMenu();
      continue;
    }
    if (G.screen !== 'race') continue;
    if (code === 'Escape' || code === 'KeyP') {
      if (!$('results').hidden) toMenu();
      else setPaused(!G.paused);
    }
    if (G.paused) continue;
    if (code === 'KeyC') {
      rig.mode = rig.mode === 'chase' ? 'hood' : 'chase';
      S.camera = rig.mode;
      store.save();
      rig.snap();
    }
    if (code === 'KeyR' && G.race && G.race.state === 'running' && !G.race.player.finished) {
      G.race.respawn(G.race.player);
    }
    if ((code === 'KeyF' || code === 'KeyE' || code === 'PadX') && G.race) G.wantUse = true;
  }
}

// --- události závodu ---------------------------------------------------------------

function processEvents() {
  const race = G.race;
  const w = G.world;
  const p = race.player;
  for (const e of race.events) {
    if (e.type === 'count') {
      hud.message(String(e.value), '', 0.9);
      audio.beep(false);
      w.track.setStartLights([0, 5, 4, 2][e.value] ?? 0);
    } else if (e.type === 'go') {
      hud.message('Start!', 'go', 1.1);
      audio.beep(true);
      w.track.setStartLights(0, true);
      G.lightsOff = 2.5;
    } else if (e.type === 'lap' && e.car.isPlayer) {
      const prevBest = G.bestBefore ?? Infinity;
      let html = `Kolo ${e.lap} · ${formatTime(e.lapTime)}`;
      if (isFinite(prevBest)) {
        const d = e.lapTime - prevBest;
        html += ` <span class="${d < 0 ? 'good' : 'bad'}">${formatDelta(d)}</span>`;
      }
      G.bestBefore = Math.min(prevBest, e.lapTime);
      // ghost nejlepšího kola
      const ghost = G.recorder.finish(e.lapTime);
      G.recorder.reset();
      const stored = store.ghost(w.def.id);
      if (!stored || e.lapTime < stored.time) store.saveGhost(w.def.id, ghost);
      // v časovce jezdíme hned proti nejlepšímu kolu
      if (race.mode === 'time' && (!G.ghost || e.lapTime < G.ghost.data.time)) {
        G.ghost = new GhostPlayer(ghost);
        if (!G.ghostMesh) {
          G.ghostMesh = createCarMesh(0x9fd8ff, { ghost: true });
          scene.add(G.ghostMesh.root);
        }
      }
      if (!p.finished) {
        if (e.lap === race.laps - 1) {
          hud.message('Poslední kolo', 'warn', 1.6);
        } else if (e.best && e.lap > 1) hud.message('Nejlepší kolo', 'warn', 1.4);
        hud.sub(html, 3);
        audio.chime();
      }
    } else if (e.type === 'finish' && e.car.isPlayer) {
      const place = e.car.place;
      hud.message(race.mode === 'race' ? `${place}. místo` : 'Cíl', place === 1 || race.mode !== 'race' ? 'go' : '', 3);
      audio.fanfare();
      if (race.mode !== 'race' || place <= 3) w.effects.confetti(e.car.x, e.car.y, e.car.z);
      G.resultsTimer = 3.2;
      G.results = saveResults();
    } else if (e.type === 'bump') {
      if (e.a.isPlayer || e.b.isPlayer) {
        audio.impact(e.strength);
        rig.addShake(Math.min(0.8, e.strength * 0.06));
      }
    } else if (e.type === 'respawn' && e.car.isPlayer) {
      hud.sub('Zpět na trati', 1.2);
    }
  }
  race.events.length = 0;

  if (G.pickups) {
    for (const e of G.pickups.events) {
      const near = (x, z) => clamp(1 - Math.hypot(x - p.x, z - p.z) / 120, 0, 1);
      if (e.type === 'box') audio.pickup();
      else if (e.type === 'got') hud.sub(ITEM_NAMES[e.item] + ' · F nebo X', 1.6);
      else if (e.type === 'fire') { if (near(e.car.x, e.car.z) > 0.2) audio.launch(); }
      else if (e.type === 'hit') {
        const v = near(e.x, e.z);
        if (v > 0.05) audio.explosion();
        if (e.target.isPlayer) {
          rig.addShake(1.1);
          hud.message('Zásah!', 'warn', 1.2);
        } else if (e.by && e.by.isPlayer) hud.sub(`Trefa · ${e.target.name}`, 1.6);
      } else if (e.type === 'blocked') {
        audio.impact(8);
        if (e.target.isPlayer) hud.sub('Štít zachytil zásah', 1.4);
      } else if (e.type === 'boom') {
        if (near(e.x, e.z) > 0.1) audio.explosion();
      } else if (e.type === 'shield' || e.type === 'nitro') {
        if (e.car.isPlayer) audio.pickup();
      }
    }
    G.pickups.events.length = 0;
  }
}

function saveResults() {
  const race = G.race;
  const p = race.player;
  const res = store.submit(G.world.def.id, { lap: p.bestLap, race: p.finishTime, laps: race.laps, mode: race.mode });
  return res;
}

function showResults() {
  const race = G.race;
  const w = G.world;
  const p = race.player;
  const lapsTxt = `${race.laps} ${race.laps === 1 ? 'kolo' : race.laps < 5 ? 'kola' : 'kol'}`;
  const cup = G.cup;
  $('res-track').textContent = cup
    ? `Šampionát · závod ${cup.round + 1}/${CUP_TRACKS.length} · ${w.def.name}`
    : `${w.def.name} · ${lapsTxt}`;
  $('res-title').textContent = race.mode === 'race' ? `${p.finishOrder}. místo` : formatTime(p.finishTime);
  const badges = [];
  if (race.mode === 'race' && p.finishOrder === 1) badges.push('Vítězství');
  if (G.results?.lap) badges.push('Nový rekord kola');
  if (G.results?.race) badges.push('Nový rekord závodu');
  const rows = race.cars
    .map((c) => ({ c, t: race.estimateFinish(c) }))
    .sort((a, b) => a.t - b.t);
  renderCup(rows, badges);
  $('res-badges').innerHTML = badges.map((b) => `<span class="badge">${b}</span>`).join('');
  $('res-body').innerHTML = rows
    .map(({ c, t }, i) => {
      const est = !c.finished;
      const color = '#' + c.color.toString(16).padStart(6, '0');
      return `<tr class="${c.isPlayer ? 'me' : ''}"><td class="pos">${i + 1}</td>` +
        `<td><span class="chip" style="background:${color}"></span>${c.name}</td>` +
        `<td class="num ${est ? 'est' : ''}">${est ? '~' : ''}${formatTime(t)}</td>` +
        `<td class="num">${formatTime(c.bestLap)}</td></tr>`;
    })
    .join('');
  $('results').hidden = false;
  $('again-btn').focus();
}

// body do šampionátu a tabulka průběžného pořadí
function renderCup(rows, badges) {
  const cup = G.cup;
  $('cup-wrap').hidden = !cup;
  $('race-caption').hidden = !cup;
  $('res-dialog').classList.toggle('cup', !!cup);
  const again = $('again-btn');
  if (!cup) {
    again.textContent = 'Jet znovu';
    return;
  }
  const gained = {};
  rows.forEach(({ c }, i) => (gained[c.name] = CUP_POINTS[i] ?? 0));
  if (!cup.awarded) {
    for (const [name, pts] of Object.entries(gained)) cup.points[name] = (cup.points[name] || 0) + pts;
    cup.awarded = true;
    cup.colors = cup.colors || {};
    for (const { c } of rows) cup.colors[c.name] = c.color;
  }
  const last = cup.round === CUP_TRACKS.length - 1;
  const table = Object.entries(cup.points).sort((a, b) => b[1] - a[1]);
  const myPlace = table.findIndex(([name]) => name === 'Ty') + 1;
  $('cup-caption').textContent = last ? 'Konečné pořadí šampionátu' : `Šampionát po ${cup.round + 1}. závodě`;
  $('cup-body').innerHTML = table
    .map(([name, total], i) => {
      const color = '#' + (cup.colors[name] ?? 0x888888).toString(16).padStart(6, '0');
      return `<tr class="${name === 'Ty' ? 'me' : ''}"><td class="pos">${i + 1}</td>` +
        `<td><span class="chip" style="background:${color}"></span>${name}</td>` +
        `<td class="num plus">+${gained[name] ?? 0}</td><td class="num">${total}</td></tr>`;
    })
    .join('');
  if (last) {
    $('res-title').textContent = `Šampionát: ${myPlace}. místo`;
    if (myPlace === 1) badges.unshift('Mistr Turbo Okruhu');
    const rec = (store.records.cup = store.records.cup || {});
    if (!rec.best || myPlace < rec.best) {
      rec.best = myPlace;
      store.save();
    }
    again.textContent = 'Nový šampionát';
  } else {
    const next = TRACKS.find((t) => t.id === CUP_TRACKS[cup.round + 1]);
    again.textContent = `Další závod: ${next.name}`;
  }
}

// --- efekty -----------------------------------------------------------------------

const wl = [0, 0, 0], wr = [0, 0, 0];
function emitEffects(dt) {
  const race = G.race;
  const w = G.world;
  const fx = w.effects;
  const smokeCol = w.biome.night ? [0.5, 0.52, 0.58] : [0.82, 0.82, 0.8];
  for (const car of race.cars) {
    const dx = car.x - camera.position.x, dz = car.z - camera.position.z;
    const far = dx * dx + dz * dz > 170 * 170;
    car.rearWheels(wl, wr);
    if (car.skidding && car.proj && Math.abs(car.proj.lat) < w.track.edge) {
      if (car.lastWheels) {
        const [pl, pr] = car.lastWheels;
        const d = Math.hypot(wl[0] - pl[0], wl[2] - pl[2]);
        if (d > 0.35) {
          if (d < 4) {
            const rx = -Math.cos(car.hd), rz = Math.sin(car.hd);
            const a = clamp(car.slip * 2.2, 0.25, 0.55);
            fx.skids.add(pl, wl, 0.3, a, rx, rz);
            fx.skids.add(pr, wr, 0.3, a, rx, rz);
          }
          car.lastWheels = [[...wl], [...wr]];
        }
      } else car.lastWheels = [[...wl], [...wr]];
      if (!far && Math.random() < dt * 40) {
        const amt = clamp(car.slip * 2.5, 0.3, 1.4);
        if (car.surface === SURF_OFF) fx.dust(wl[0], wl[1], wl[2], car.vx, car.vz, w.biome.dust);
        else {
          fx.tireSmoke(wl[0], wl[1], wl[2], car.vx, car.vz, amt, smokeCol);
          fx.tireSmoke(wr[0], wr[1], wr[2], car.vx, car.vz, amt, smokeCol);
        }
      }
    } else car.lastWheels = null;
    if (!far && car.surface === SURF_OFF && car.speed > 6 && Math.random() < dt * 30) {
      fx.dust(wl[0], wl[1], wl[2], car.vx, car.vz, w.biome.dust);
      fx.dust(wr[0], wr[1], wr[2], car.vx, car.vz, w.biome.dust);
    }
    if (car.nitroActive && !far) {
      const s = Math.sin(car.hd), c = Math.cos(car.hd);
      const bx = car.x - s * 2.35, bz = car.z - c * 2.35;
      const rx = -c, rz = s;
      fx.nitroFlame(bx + rx * 0.4, car.y + 0.42, bz + rz * 0.4, -s, -c, car.vx, car.vz);
      fx.nitroFlame(bx - rx * 0.4, car.y + 0.42, bz - rz * 0.4, -s, -c, car.vx, car.vz);
    }
    if (car.impact > 2.5) {
      const side = Math.sign(car.proj.lat);
      const x = car.x + car.proj.rx * side * 1.0, z = car.z + car.proj.rz * side * 1.0;
      if (!far) fx.sparks(x, car.y, z, car.proj.rx * side, car.proj.rz * side, car.impact);
      if (car.isPlayer) {
        audio.impact(car.impact);
        rig.addShake(Math.min(0.9, car.impact * 0.05));
      }
    }
  }
}

// --- herní smyčka ---------------------------------------------------------------------

let last = performance.now();
let fpsAcc = 0, fpsFrames = 0;
const orbitCenter = new THREE.Vector3();

function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  fpsAcc += rawDt;
  fpsFrames++;
  if (fpsAcc > 0.5) {
    G.fps = Math.round(fpsFrames / fpsAcc);
    fpsAcc = 0;
    fpsFrames = 0;
  }
  const dt = rawDt * G.timeScale;
  handleKeys(input.takePressed());
  const w = G.world;
  if (!w) return;
  input.enabled = G.screen === 'race';

  if (G.screen === 'race' && G.race) {
    const race = G.race;
    const p = race.player;
    if (!G.paused) {
      const ctrl = input.controls();
      G.acc += dt;
      let steps = 0;
      while (G.acc >= STEP && steps < 1200) {
        race.step(STEP, ctrl);
        if (race.state === 'running' && !p.finished) G.recorder.sample(STEP, p);
        G.acc -= STEP;
        steps++;
      }
      const alpha = G.acc / STEP;
      if (G.pickups) {
        const useItem = G.wantUse || !!input.touch.item;
        G.pickups.update(dt, useItem);
        input.touch.item = 0;
        hud.setItem(p.item, p.itemRoll > 0);
      }
      G.wantUse = false;
      processEvents();
      for (const c of race.cars) c.render(alpha);
      emitEffects(dt);

      // ghost
      race.ghostPos = null;
      if (G.ghost && G.ghostMesh && race.state === 'running' && !p.finished) {
        const g = G.ghost.at(race.time - p.lapStart);
        if (g) {
          G.ghostMesh.root.visible = true;
          G.ghostMesh.root.position.set(g.x, g.y, g.z);
          G.ghostMesh.root.rotation.y = g.hd;
          race.ghostPos = g;
          // ztráta / náskok na ghost podle vzdálenosti po trati
          G.ghostProj = w.track.project(g.x, g.z, G.ghostProj ? G.ghostProj.i : -1, G.ghostProj || {});
          let ds = p.proj.s - G.ghostProj.s;
          if (ds > w.track.L / 2) ds -= w.track.L;
          else if (ds < -w.track.L / 2) ds += w.track.L;
          race.ghostDelta = -ds / Math.max(12, p.speed);
        } else {
          G.ghostMesh.root.visible = false;
          race.ghostDelta = null;
        }
      } else if (G.ghostMesh) G.ghostMesh.root.visible = false;

      if (G.lightsOff > 0) {
        G.lightsOff -= dt;
        if (G.lightsOff <= 0) w.track.setStartLights(0);
      }

      // kamera
      if (p.finished && G.resultsTimer <= 1.5) rig.showcase(dt, p);
      else rig.follow(dt, p, alpha, w.track);
      // auto těsně u kamery by zakrylo výhled
      for (const c of race.cars) {
        if (c === p) continue;
        const r = c.mesh.root.position;
        const dx = r.x - camera.position.x, dy = r.y + 0.7 - camera.position.y, dz = r.z - camera.position.z;
        if (dx * dx + dy * dy + dz * dz < 4 * 4) c.mesh.root.visible = false;
      }

      // zvuk
      const onGrid = race.state === 'countdown';
      const ctrlNow = p.controls;
      const rpm = gearbox.update(dt, Math.abs(p.vLong), ctrlNow.throttle, onGrid);
      let rival = null, rd = Infinity;
      for (const c of race.cars) {
        if (c === p) continue;
        const d = Math.hypot(c.x - p.x, c.z - p.z);
        if (d < rd) { rd = d; rival = c; }
      }
      audio.update({
        active: $('results').hidden,
        rpm,
        throttle: ctrlNow.throttle,
        speed: p.speed,
        skid: p.skidding ? clamp(p.slip * 3 + (ctrlNow.handbrake ? 0.3 : 0), 0, 1) : 0,
        nitro: p.nitroActive,
        offroad: p.surface === SURF_OFF,
        rivalDist: rival ? rd : null,
        rivalRpm: rival ? 2400 + ((rival.speed * 97) % 4200) : 0,
      });

      // protisměr
      const wrong = p.wrongWay > 1.2 && !p.finished;
      if (wrong) {
        if (hud.msgTimer <= 0.2) hud.message('Špatný směr', 'warn', 0.6);
      }
      hud.update(dt, race, gearbox.gear);

      if (G.resultsTimer > 0) {
        G.resultsTimer -= dt;
        if (G.resultsTimer <= 0) showResults();
      }
    }
  } else {
    // menu: pomalý oblet kolem startovního roštu
    const tr = w.track;
    const c = tr.pointS(-26, 0);
    orbitCenter.set(c[0], c[1] + 1, c[2]);
    rig.orbit(dt, orbitCenter, 26, 8.5, 0.07);
  }

  w.effects.update(dt);
  // slunce a stíny sledují dění
  const focus = G.screen === 'race' && G.race ? G.race.player : null;
  const sun = w.lights.sun;
  const tx = focus ? focus.x : rig.look.x, ty = focus ? focus.y : rig.look.y, tz = focus ? focus.z : rig.look.z;
  sun.target.position.set(tx, ty, tz);
  const d = sun.userData.dir;
  sun.position.set(tx + d.x * 260, ty + d.y * 260, tz + d.z * 260);
  w.sky.position.copy(camera.position);
  renderer.render(scene, camera);
}

// --- start ---------------------------------------------------------------------------

async function boot() {
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('italic 700 60px "Chakra Petch"'),
        document.fonts.load('600 20px "Barlow Semi Condensed"'),
      ]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch {
    /* písma nejsou nutná */
  }
  bindMenu();
  buildTrackList();
  await loadWorld(currentTrackId());
  G.screen = 'menu';
  $('menu').hidden = false;
  requestAnimationFrame(frame);
}

// debug / testy
Object.assign(G, {
  scene, camera, renderer, store, audio,
  setTimeScale: (v) => (G.timeScale = v),
  autopilot: (on = true) => G.race && G.race.setAutopilot(on),
  start: (opts = {}) => {
    Object.assign(S, opts);
    return startFromMenu();
  },
  toMenu,
  selectTrack,
  info: () => ({ fps: G.fps, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }),
});

boot().catch((e) => {
  console.error(e);
  showError('Chyba při načítání: ' + e.message);
});
