// Turbo Okruh – vstupní bod: renderer, menu, závod a herní smyčka.
import * as THREE from 'three';
import { TRACKS } from './tracks.js';
import { BIOMES } from './biomes.js';
import { Track, SURF_OFF } from './track.js';
import { Terrain } from './terrain.js';
import { buildScenery, buildSky, buildLights } from './scenery.js';
import { randomTrackDef, buildCenterline, validateCenterline } from './trackmath.js';
import { Car, createCarMesh, disposeCarMesh } from './car.js';
import { Race, PLAYER_COLORS, OPPONENTS, PLAYER_NUMBERS } from './race.js';
import { CameraRig } from './camera.js';
import { Effects } from './effects.js';
import { Input } from './input.js';
import { AudioEngine, GearBox, Music } from './audio.js';
import { HUD, formatTime, formatDelta, trackOutline } from './hud.js';
import { Store } from './store.js';
import { GhostRecorder, GhostPlayer } from './ghost.js';
import { Pickups, ITEM_NAMES } from './pickups.js';
import { RNG, clamp } from './rng.js';
import { Post } from './post.js';
import { TrackEditor, customToDef } from './editor.js';

const STEP = 1 / 120;
const CUP_TRACKS = ['sumava', 'kanon', 'serpentiny', 'mesto'];
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
renderer.info.autoReset = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
applyPixelRatio();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 4200);
const camera2 = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 4200);
const rig = new CameraRig(camera);
const rigs = [rig, new CameraRig(camera2)];
for (const r of rigs) r.mode = S.camera === 'hood' ? 'hood' : 'chase';
const input = new Input();
input.bindTouch($('touch'));
const audio = new AudioEngine();
audio.muted = !S.sound;
const music = new Music(audio);
music.enabled = S.music !== false;
// zvuk smí začít až po prvním kliknutí nebo klávese
function unlockAudio() {
  audio.init();
  music.start();
}
window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });
// HUD: jeden pohled na hráče (druhý vzniká klonováním šablony)
const hudRoot = $('hud');
const hudTemplate = hudRoot.querySelector('.hud-view');
const huds = [new HUD(hudTemplate)];
const hud = huds[0];
const gearboxes = [new GearBox(), new GearBox()];
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

// bloom jen pro vysokou kvalitu
function setupPost() {
  const want = S.quality === 'high';
  if (want && !G.post) G.post = new Post(renderer, scene, camera);
  if (!want && G.post) {
    G.post.dispose();
    G.post = null;
  }
  if (G.world) {
    if (G.post) G.post.setBloom(G.world.biome.bloom);
    G.world.effects.setBoost(G.post ? 1.7 : 1);
  }
}

window.addEventListener('resize', () => {
  applyPixelRatio();
  if (G.post) G.post.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  if (G.world) G.world.effects.setView(camera, renderer.domElement.height, scene.fog);
  if (G.race) for (const h of huds) h.resize();
});

function showError(text) {
  $('loading').hidden = true;
  $('error').hidden = false;
  $('error-text').textContent = text;
}

// --- tratě ----------------------------------------------------------------------

function randomDef(seed) {
  const rng = new RNG(seed);
  const biome = rng.pick(['forest', 'canyon', 'winter', 'city']);
  const city = biome === 'city';
  let points = randomTrackDef(seed);
  const base = { width: city ? 14 : biome === 'winter' ? 15 : 16, runoff: city ? 3 : biome === 'winter' ? 6 : 7 };
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

// počet lidských hráčů (dva jen v závodě/šampionátu a ne na dotykovém zařízení)
const humanCount = () => (raceMode() === 'race' && S.players === 2 && !isTouch ? 2 : 1);
function playerColors() {
  const a = S.color % PLAYER_COLORS.length;
  let b = (S.color2 ?? 1) % PLAYER_COLORS.length;
  if (b === a) b = (a + 1) % PLAYER_COLORS.length;
  return [PLAYER_COLORS[a].hex, PLAYER_COLORS[b].hex];
}

// závodní režim bez šampionátu ('race' | 'time')
const raceMode = () => (S.mode === 'time' ? 'time' : 'race');
// trať, která se má právě jet (v šampionátu podle kola)
const currentTrackId = () => (S.mode === 'cup' ? CUP_TRACKS[G.cup ? G.cup.round : 0] : S.track);

function trackDef(id) {
  if (id === 'random') return randomDef(S.randomSeed);
  if (id && id.startsWith('custom-')) {
    const t = store.getCustom(id);
    if (t) return customToDef(t);
  }
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
  scene.environmentIntensity = biome.night ? 0.9 : 1;
  disposeObject(envSky);
  ground.geometry.dispose();

  const effects = new Effects(scene, S.quality);
  effects.setView(camera, renderer.domElement.height, scene.fog);

  G.world = { def, biome, track, terrain, group, sky, lights, effects, envRT, showcase: [], crowd: scenery.extra.crowd, snow: scenery.extra.snow };
  setupPost();
  buildShowcase();
  $('loading').hidden = true;
  return G.world;
}

// auta na roštu v menu
function buildShowcase() {
  const w = G.world;
  for (const c of w.showcase) disposeCarMesh(c.mesh);
  w.showcase = [];
  const colors = playerColors();
  const humans = humanCount();
  const pool = OPPONENTS.filter((o) => !colors.slice(0, humans).includes(o.color));
  const race = raceMode() === 'race';
  const count = race ? 6 : 1;
  let ai = 0;
  for (let slot = 0; slot < count; slot++) {
    const h = race ? slot - 3 : 0;
    const isPlayer = h >= 0 && h < humans;
    const info = isPlayer ? { color: colors[h], number: PLAYER_NUMBERS[h] } : pool[ai++ % pool.length];
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

const editor = new TrackEditor({
  store,
  onDrive: (track) => {
    if (G.world && G.world.def.id === track.id) G.forceReload = true;
    S.track = track.id;
    if (S.mode === 'cup') S.mode = 'race';
    store.save();
    G.screen = 'menu';
    buildTrackList();
    startFromMenu();
  },
  onExit: async (track, deletedId) => {
    G.screen = 'menu';
    $('menu').hidden = false;
    if (deletedId && S.track === deletedId) S.track = 'sumava';
    buildTrackList();
    const reload = (track && G.world && G.world.def.id === track.id) || (deletedId && G.world && G.world.def.id === deletedId);
    if (reload) await selectTrack(currentTrackId(), true);
  },
});

function openEditor(track) {
  G.screen = 'editor';
  $('menu').hidden = true;
  editor.open(track || null);
}

function trackMeta(def, track) {
  const rec = store.record(def.id);
  const km = (track.L / 1000).toFixed(2).replace('.', ',');
  return `${km} km · ${rec.lap ? 'rekord ' + formatTime(rec.lap) : 'bez rekordu'}`;
}

function buildTrackList() {
  const list = $('track-list');
  list.innerHTML = '';
  menuTracks.length = 0;
  const defs = [
    ...TRACKS.map((t) => ({ def: t, id: t.id })),
    { def: randomDef(S.randomSeed), id: 'random' },
    ...store.custom.map((t) => ({ def: customToDef(t), id: t.id, custom: t })),
  ];
  for (const { def, id, custom } of defs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'track-card' + (custom && !custom.valid ? ' draft' : '');
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
    if (custom) {
      const ed = document.createElement('span');
      ed.className = 'tc-edit';
      ed.setAttribute('role', 'button');
      ed.textContent = 'Upravit';
      ed.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditor(custom);
      });
      btn.appendChild(ed);
    }
    btn.addEventListener('click', () => (custom && !custom.valid ? openEditor(custom) : selectTrack(id)));
    list.appendChild(btn);
    menuTracks.push({ id, def, btn, canvas, meta, custom });
  }
  requestAnimationFrame(() => {
    for (const m of menuTracks) {
      const tr = new Track(m.def);
      trackOutline(tr, m.canvas, { pad: 6, color: '#f3f5f8', width: 2.4 });
      if (m.id === 'random') m.meta.textContent = `${(tr.L / 1000).toFixed(2).replace('.', ',')} km · ${m.def.subtitle}`;
      else if (m.custom && !m.custom.valid) m.meta.textContent = 'rozpracovaná, dokonči v editoru';
      else m.meta.textContent = trackMeta(m.def, tr);
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
  const two = humanCount() === 2;
  $('players-opt').hidden = S.mode === 'time' || isTouch;
  for (const b of $('players-seg').children) b.setAttribute('aria-checked', String(+b.dataset.players === (S.players || 1)));
  $('color2-opt').hidden = !two;
  $('color1-label').textContent = two ? 'Barva hráče 1' : 'Barva auta';
  $('keys-2p').hidden = !two;
  $('diff-opt').hidden = S.mode === 'time';
  $('weapons-opt').hidden = S.mode === 'time';
  $('track-block').hidden = S.mode === 'cup';
  $('cup-block').hidden = S.mode !== 'cup';
  $('mode-hint').textContent = {
    race: 'Ty proti pěti soupeřům. Drift plní nitro, krabice s otazníkem dávají power-upy.',
    cup: 'Čtyři závody za sebou. Body za umístění 10, 6, 4, 3, 2, 1 a vítězí nejvíc bodů.',
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
  const mt = $('music-toggle');
  mt.setAttribute('aria-pressed', String(S.music !== false));
  mt.querySelector('em').textContent = S.music !== false ? 'Zapnuto' : 'Vypnuto';
  for (const [id, key] of [['swatches', 'color'], ['swatches2', 'color2']]) {
    const sw = $(id);
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
          S[key] = i;
          store.save();
          refreshMenu();
          if (G.world && G.screen === 'menu') buildShowcase();
        });
        sw.appendChild(b);
      });
    }
    const cur = key === 'color' ? S.color : PLAYER_COLORS.findIndex((c) => c.hex === playerColors()[1]);
    [...sw.children].forEach((b, i) => b.setAttribute('aria-checked', String(i === cur)));
  }
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
  for (const b of $('players-seg').children) {
    b.addEventListener('click', () => {
      S.players = +b.dataset.players;
      store.save();
      refreshMenu();
      if (G.world && G.screen === 'menu') buildShowcase();
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
  $('music-toggle').addEventListener('click', () => {
    S.music = S.music === false;
    audio.init();
    music.setEnabled(S.music);
    store.save();
    refreshMenu();
  });
  $('start-btn').addEventListener('click', () => startFromMenu());
  $('new-track').addEventListener('click', () => openEditor(null));
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
  music.start();
  music.setIntensity(1);
  audio.setMuted(!S.sound);
  $('results').hidden = true;
  $('pause').hidden = true;
  G.paused = false;
  clearRace();
  if (S.mode === 'cup' && !G.cup) G.cup = newCup();
  if (S.mode !== 'cup') G.cup = null;
  const trackId = currentTrackId();
  const custom = trackId.startsWith('custom-') ? store.getCustom(trackId) : null;
  if (custom && !custom.valid) {
    // rozpracovaná trať: nejdřív ji dokončit v editoru
    openEditor(custom);
    return;
  }
  if (!G.world || G.forceReload || G.world.def.id !== trackDef(trackId).id) {
    G.forceReload = false;
    await loadWorld(trackId);
  }
  const w = G.world;
  for (const c of w.showcase) disposeCarMesh(c.mesh);
  w.showcase = [];
  w.effects.clear();
  const humans = humanCount();
  const race = new Race({
    track: w.track, biome: w.biome, mode: raceMode(), laps: S.laps, difficulty: S.difficulty,
    playerColors: playerColors().slice(0, humans), humans, night: w.biome.night,
  });
  for (const c of race.cars) {
    scene.add(c.mesh.root);
    c.render(1);
  }
  if (w.biome.night) {
    // skutečné světlo jen pro hráče
    for (const car of race.players) {
      const spot = new THREE.SpotLight(0xfff1d8, 90, 90, 0.5, 0.55, 1.4);
      spot.position.set(0, 1.0, 1.6);
      spot.target.position.set(0, 0, 22);
      car.mesh.root.add(spot, spot.target);
      car.headlight = spot;
    }
  }
  G.race = race;
  G.acc = 0;
  G.resultsTimer = 0;
  G.waitOthers = 0;
  G.wantUse = [false, false];
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
  setupHuds(race);
  hudRoot.hidden = false;
  const hint = $('rotate-hint');
  hint.style.animation = 'none';
  void hint.offsetWidth;
  hint.style.animation = '';
  $('menu').hidden = true;
  document.activeElement?.blur();
  const fromMenu = G.screen === 'menu' && rig.mode === 'chase' && humans === 1;
  if (fromMenu) rig.flyTo(race.player);
  else for (const r of rigs) r.snap();
  w.track.setStartLights(0);
  if (G.cup) for (const h of G.huds) h.sub(`Šampionát · závod ${G.cup.round + 1}/${CUP_TRACKS.length} · ${w.def.name}`, 3.2);
  if (!isTouch && (S.racesStarted || 0) < 3) {
    if (humans === 1) {
      hud.sub('<kbd>W</kbd> plyn · <kbd>A</kbd><kbd>D</kbd> zatáčení · <kbd>Mezerník</kbd> drift · <kbd>Shift</kbd> nitro' + (G.pickups ? ' · <kbd>F</kbd> power-up' : ''), 5, 'help');
    } else {
      huds[0].sub('<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> · drift <kbd>Mezerník</kbd> · nitro <kbd>Shift</kbd>' + (G.pickups ? ' · <kbd>E</kbd>' : ''), 5, 'help');
      huds[1].sub('šipky · drift <kbd>-</kbd> · nitro pravý <kbd>Shift</kbd>' + (G.pickups ? ' · <kbd>.</kbd>' : ''), 5, 'help');
    }
  }
  S.racesStarted = (S.racesStarted || 0) + 1;
  store.save();
  G.screen = 'race';
}

// pohledy HUD podle počtu hráčů
function setupHuds(race) {
  const n = race.players.length;
  while (huds.length > n) huds.pop().view.remove();
  while (huds.length < n) {
    const v = hudTemplate.cloneNode(true);
    v.dataset.view = String(huds.length);
    hudRoot.insertBefore(v, huds[huds.length - 1].view.nextSibling);
    huds.push(new HUD(v));
  }
  G.huds = huds.slice(0, n);
  hudRoot.classList.toggle('split', n > 1);
  race.players.forEach((car, i) => {
    huds[i].setupRace(race, car, { tag: n > 1 ? car.name : '', itemKey: n > 1 ? (i === 0 ? 'E' : '.') : 'F' });
    huds[i].setItem(null);
  });
}

const hudOf = (car) => huds[car && car.isPlayer ? car.humanIndex || 0 : 0];

function toMenu() {
  clearRace();
  G.cup = null;
  $('results').hidden = true;
  $('pause').hidden = true;
  hudRoot.hidden = true;
  audio.silence();
  music.setIntensity(0);
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
  music.setIntensity(p ? 0 : 1);
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
  // plánovač hudby v pozadí nestíhá, proto ji zastavíme
  if (document.hidden) music.stop();
  else if (audio.ctx) music.start();
});

function handleKeys(pressed) {
  for (const code of pressed) {
    const pad = /^Pad(\d+):(\w+)$/.exec(code);
    const padIdx = pad ? +pad[1] : -1;
    const btn = pad ? pad[2] : null;
    if (code === 'KeyM') {
      S.sound = !S.sound;
      audio.setMuted(!S.sound);
      store.save();
      refreshMenu();
    }
    if (G.screen === 'menu') {
      const free = !document.activeElement || document.activeElement === document.body;
      if (((code === 'Enter' || code === 'NumpadEnter') && free) || btn === 'A') startFromMenu();
      continue;
    }
    if (G.screen !== 'race' || !G.race) continue;
    if (code === 'Escape' || code === 'KeyP' || btn === 'Start') {
      if (!$('results').hidden) toMenu();
      else setPaused(!G.paused);
    }
    if (G.paused) continue;
    const race = G.race;
    const humans = race.players.length;
    if (code === 'KeyC' || btn === 'Y') {
      const list = btn ? [rigs[input.playerForPad(padIdx, humans)]] : rigs;
      for (const r of list) {
        r.mode = r.mode === 'chase' ? 'hood' : 'chase';
        r.snap();
      }
      S.camera = rigs[0].mode;
      store.save();
    }
    let who = input.keyOwner(code, 'reset', humans);
    if (btn === 'Back') who = input.playerForPad(padIdx, humans);
    const resetCar = race.players[who];
    if (resetCar && race.state === 'running' && !resetCar.finished) race.respawn(resetCar);
    let user = input.keyOwner(code, 'item', humans);
    if (btn === 'X') user = input.playerForPad(padIdx, humans);
    if (user >= 0) G.wantUse[user] = true;
  }
}

// --- události závodu ---------------------------------------------------------------

function processEvents() {
  const race = G.race;
  const w = G.world;
  const p = race.player;
  const solo = race.players.length === 1;
  const each = (fn) => G.huds.forEach(fn);
  for (const e of race.events) {
    if (e.type === 'count') {
      each((h) => h.message(String(e.value), '', 0.9));
      audio.beep(false);
      w.track.setStartLights([0, 5, 4, 2][e.value] ?? 0);
    } else if (e.type === 'go') {
      each((h) => h.message('Start!', 'go', 1.1));
      audio.beep(true);
      w.track.setStartLights(0, true);
      G.lightsOff = 2.5;
    } else if (e.type === 'lap' && e.car.isPlayer) {
      const car = e.car;
      const h = hudOf(car);
      const prevBest = car.bestBefore ?? Infinity;
      let html = `Kolo ${e.lap} · ${formatTime(e.lapTime)}`;
      if (isFinite(prevBest)) {
        const d = e.lapTime - prevBest;
        html += ` <span class="${d < 0 ? 'good' : 'bad'}">${formatDelta(d)}</span>`;
      }
      car.bestBefore = Math.min(prevBest, e.lapTime);
      if (solo) {
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
      }
      if (!car.finished) {
        if (e.lap === race.laps - 1) h.message('Poslední kolo', 'warn', 1.6);
        else if (e.best && e.lap > 1) h.message('Nejlepší kolo', 'warn', 1.4);
        h.sub(html, 3);
        audio.chime();
      }
    } else if (e.type === 'finish' && e.car.isPlayer) {
      const place = e.car.place;
      hudOf(e.car).message(race.mode === 'race' ? `${place}. místo` : 'Cíl', place === 1 || race.mode !== 'race' ? 'go' : '', 3);
      audio.fanfare();
      if (race.mode !== 'race' || place <= 3) w.effects.confetti(e.car.x, e.car.y, e.car.z);
      if (race.players.every((c) => c.finished)) {
        G.resultsTimer = 3.2;
        G.waitOthers = 0;
      } else if (!G.waitOthers) {
        // na druhého hráče čekáme nejvýš 25 s
        G.waitOthers = 25;
        const other = race.players.find((c) => !c.finished);
        hudOf(other).sub(`${e.car.name} je v cíli`, 2.5);
      }
    } else if (e.type === 'bump') {
      for (const car of [e.a, e.b]) {
        if (!car.isPlayer) continue;
        audio.impact(e.strength);
        rigs[car.humanIndex].addShake(Math.min(0.8, e.strength * 0.06));
      }
    } else if (e.type === 'respawn' && e.car.isPlayer) {
      hudOf(e.car).sub('Zpět na trati', 1.2);
    }
  }
  race.events.length = 0;

  if (G.pickups) {
    const near = (x, z) => Math.max(...race.players.map((c) => clamp(1 - Math.hypot(x - c.x, z - c.z) / 120, 0, 1)));
    const keyFor = (car) => (solo ? 'F nebo X' : car.humanIndex === 0 ? 'E' : 'tečka');
    for (const e of G.pickups.events) {
      if (e.type === 'box') audio.pickup();
      else if (e.type === 'got') hudOf(e.car).sub(`${ITEM_NAMES[e.item]} · ${keyFor(e.car)}`, 1.6);
      else if (e.type === 'fire') { if (near(e.car.x, e.car.z) > 0.2) audio.launch(); }
      else if (e.type === 'hit') {
        if (near(e.x, e.z) > 0.05) audio.explosion();
        if (e.target.isPlayer) {
          rigs[e.target.humanIndex].addShake(1.1);
          hudOf(e.target).message('Zásah!', 'warn', 1.2);
        }
        if (e.by && e.by.isPlayer && e.by !== e.target) hudOf(e.by).sub(`Trefa · ${e.target.name}`, 1.6);
      } else if (e.type === 'blocked') {
        audio.impact(8);
        if (e.target.isPlayer) hudOf(e.target).sub('Štít zachytil zásah', 1.4);
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
  const out = {};
  for (const car of race.players) {
    const res = store.submit(G.world.def.id, {
      lap: car.bestLap, race: car.finished ? car.finishTime : null, laps: race.laps, mode: race.mode,
    });
    if (res.lap) out.lap = true;
    if (res.race) out.race = true;
  }
  return out;
}

function showResults() {
  const race = G.race;
  const w = G.world;
  const p = race.player;
  const humans = race.players;
  const lapsTxt = `${race.laps} ${race.laps === 1 ? 'kolo' : race.laps < 5 ? 'kola' : 'kol'}`;
  const cup = G.cup;
  $('res-track').textContent = cup
    ? `Šampionát · závod ${cup.round + 1}/${CUP_TRACKS.length} · ${w.def.name}`
    : `${w.def.name} · ${lapsTxt}`;
  const rows = race.cars
    .map((c) => ({ c, t: race.estimateFinish(c) }))
    .sort((a, b) => a.t - b.t);
  const placeOf = (car) => rows.findIndex((r) => r.c === car) + 1;
  const badges = [];
  if (race.mode !== 'race') $('res-title').textContent = formatTime(p.finishTime);
  else if (humans.length === 1) {
    $('res-title').textContent = `${placeOf(p)}. místo`;
    if (placeOf(p) === 1) badges.push('Vítězství');
  } else {
    const [a, b] = humans;
    const winner = placeOf(a) < placeOf(b) ? a : b;
    $('res-title').textContent = `${winner.name} vyhrál souboj`;
    for (const c of humans) badges.push(`${c.name}: ${placeOf(c)}. místo`);
  }
  if (G.results?.lap) badges.push('Nový rekord kola');
  if (G.results?.race) badges.push('Nový rekord závodu');
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
  const humanNames = G.race.players.map((c) => c.name);
  const placeOf = (name) => table.findIndex(([n]) => n === name) + 1;
  const myPlace = Math.min(...humanNames.map(placeOf));
  $('cup-caption').textContent = last ? 'Konečné pořadí šampionátu' : `Šampionát po ${cup.round + 1}. závodě`;
  $('cup-body').innerHTML = table
    .map(([name, total], i) => {
      const color = '#' + (cup.colors[name] ?? 0x888888).toString(16).padStart(6, '0');
      return `<tr class="${humanNames.includes(name) ? 'me' : ''}"><td class="pos">${i + 1}</td>` +
        `<td><span class="chip" style="background:${color}"></span>${name}</td>` +
        `<td class="num plus">+${gained[name] ?? 0}</td><td class="num">${total}</td></tr>`;
    })
    .join('');
  if (last) {
    if (humanNames.length === 1) {
      $('res-title').textContent = `Šampionát: ${myPlace}. místo`;
      if (myPlace === 1) badges.unshift('Mistr Turbo Okruhu');
      const rec = (store.records.cup = store.records.cup || {});
      if (!rec.best || myPlace < rec.best) {
        rec.best = myPlace;
        store.save();
      }
    } else {
      const best = humanNames.reduce((a, b) => (placeOf(a) < placeOf(b) ? a : b));
      $('res-title').textContent = `${best} vyhrál souboj o šampionát`;
      if (placeOf(best) === 1) badges.unshift(`Mistr Turbo Okruhu: ${best}`);
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
  const cams = race.players.length > 1 ? [camera, camera2] : [camera];
  for (const car of race.cars) {
    const far = cams.every((c) => (car.x - c.position.x) ** 2 + (car.z - c.position.z) ** 2 > 170 * 170);
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
        rigs[car.humanIndex].addShake(Math.min(0.9, car.impact * 0.05));
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
  if (!w || G.screen === 'editor') return;
  input.enabled = G.screen === 'race';

  if (G.screen === 'race' && G.race) {
    const race = G.race;
    const p = race.player;
    const humans = race.players;
    if (!G.paused) {
      const ctrls = humans.length > 1 ? [input.controls('p1'), input.controls('p2')] : [input.controls('solo')];
      G.acc += dt;
      let steps = 0;
      while (G.acc >= STEP && steps < 1200) {
        race.step(STEP, ctrls);
        if (humans.length === 1 && race.state === 'running' && !p.finished) G.recorder.sample(STEP, p);
        G.acc -= STEP;
        steps++;
      }
      const alpha = G.acc / STEP;
      if (G.pickups) {
        G.pickups.update(dt, [G.wantUse[0] || !!input.touch.item, G.wantUse[1]]);
        input.touch.item = 0;
        humans.forEach((c, i) => huds[i].setItem(c.item, c.itemRoll > 0));
      }
      G.wantUse = [false, false];
      processEvents();
      for (const c of race.cars) c.render(alpha);
      emitEffects(dt);

      // ghost (jen časovka jednoho hráče)
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

      // kamery
      humans.forEach((car, i) => {
        if (car.finished && (humans.length > 1 || G.resultsTimer <= 1.5)) rigs[i].showcase(dt, car);
        else rigs[i].follow(dt, car, alpha, w.track);
      });

      // zvuk: hráč 1 hlavní motor; druhý motor patří hráči 2, nebo nejbližšímu soupeři
      const onGrid = race.state === 'countdown';
      const rpm = gearboxes[0].update(dt, Math.abs(p.vLong), p.controls.throttle, onGrid);
      let rivalDist = null, rivalRpm = 0;
      if (humans.length > 1) {
        const q = humans[1];
        rivalDist = 0;
        rivalRpm = gearboxes[1].update(dt, Math.abs(q.vLong), q.controls.throttle, onGrid);
      } else {
        let rd = Infinity, rival = null;
        for (const c of race.cars) {
          if (c === p) continue;
          const d = Math.hypot(c.x - p.x, c.z - p.z);
          if (d < rd) { rd = d; rival = c; }
        }
        if (rival) {
          rivalDist = rd;
          rivalRpm = 2400 + ((rival.speed * 97) % 4200);
        }
      }
      audio.setDuo(humans.length > 1);
      const skidOf = (c) => (c.skidding ? clamp(c.slip * 3 + (c.controls.handbrake ? 0.3 : 0), 0, 1) : 0);
      audio.update({
        active: $('results').hidden,
        rpm,
        throttle: p.controls.throttle,
        speed: Math.max(...humans.map((c) => c.speed)),
        skid: Math.max(...humans.map(skidOf)),
        nitro: humans.some((c) => c.nitroActive),
        offroad: humans.some((c) => c.surface === SURF_OFF),
        rivalDist,
        rivalRpm,
      });

      humans.forEach((c, i) => {
        // protisměr
        if (c.wrongWay > 1.2 && !c.finished && huds[i].msgTimer <= 0.2) huds[i].message('Špatný směr', 'warn', 0.6);
        huds[i].update(dt, race, gearboxes[i].gear);
      });

      if (G.waitOthers > 0) {
        G.waitOthers -= dt;
        if (G.waitOthers <= 0 && G.resultsTimer <= 0) G.resultsTimer = 0.01;
      }
      if (G.resultsTimer > 0) {
        G.resultsTimer -= dt;
        if (G.resultsTimer <= 0) {
          G.results = saveResults();
          showResults();
        }
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
  if (w.snow) w.snow.update(dt);
  renderViews(w);
}

// auto těsně u kamery by zakrylo výhled
function hideNear(cam, race, own) {
  for (const c of race.cars) {
    c.mesh.root.visible = c.baseVisible;
    if (c === own) continue;
    const r = c.mesh.root.position;
    const dx = r.x - cam.position.x, dy = r.y + 0.7 - cam.position.y, dz = r.z - cam.position.z;
    if (dx * dx + dy * dy + dz * dz < 16) c.mesh.root.visible = false;
  }
}

// slunce (a jeho stínová kamera) sleduje dění v daném pohledu
function aimSun(w, x, y, z) {
  const sun = w.lights.sun;
  sun.target.position.set(x, y, z);
  const d = sun.userData.dir;
  sun.position.set(x + d.x * 260, y + d.y * 260, z + d.z * 260);
}

function renderViews(w) {
  const race = G.screen === 'race' ? G.race : null;
  const players = race ? race.players : [];
  if (race) for (const c of race.cars) c.baseVisible = c.mesh.root.visible;
  renderer.info.reset();
  if (players.length < 2) {
    const focus = race ? race.player : null;
    if (race) hideNear(camera, race, focus);
    if (Math.abs(camera.aspect - window.innerWidth / window.innerHeight) > 1e-3) {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    }
    aimSun(w, focus ? focus.x : rig.look.x, focus ? focus.y : rig.look.y, focus ? focus.z : rig.look.z);
    w.sky.position.copy(camera.position);
    w.effects.setView(camera, renderer.domElement.height, scene.fog);
    if (w.snow) w.snow.setView(camera, renderer.domElement.height);
    if (G.post) G.post.render();
    else renderer.render(scene, camera);
    return;
  }
  // rozdělená obrazovka: hráč 1 nahoře, hráč 2 dole
  const W = window.innerWidth, H = window.innerHeight;
  const h2 = Math.floor(H / 2);
  renderer.setScissorTest(true);
  players.forEach((car, i) => {
    const cam = i === 0 ? camera : camera2;
    const aspect = W / h2;
    if (Math.abs(cam.aspect - aspect) > 1e-3) {
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
    }
    hideNear(cam, race, car);
    aimSun(w, car.x, car.y, car.z);
    w.sky.position.copy(cam.position);
    w.effects.setView(cam, h2 * renderer.getPixelRatio(), scene.fog);
    if (w.snow) w.snow.setView(cam, h2 * renderer.getPixelRatio());
    const y = i === 0 ? H - h2 : 0;
    renderer.setViewport(0, y, W, h2);
    renderer.setScissor(0, y, W, h2);
    renderer.render(scene, cam);
  });
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, W, H);
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
  scene, camera, renderer, store, audio, editor, music,
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
