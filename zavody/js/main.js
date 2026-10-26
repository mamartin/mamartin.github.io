// Turbo Okruh – vstupní bod: renderer, menu, závod a herní smyčka.
import * as THREE from 'three';
import { TRACKS } from './tracks.js';
import { BIOMES, wetBiome } from './biomes.js';
import { Track, SURF_OFF } from './track.js';
import { Terrain } from './terrain.js';
import { buildScenery, buildSky, buildLights, buildRain } from './scenery.js';
import { randomTrackDef, buildCenterline, validateCenterline } from './trackmath.js';
import { Car, createCarMesh, disposeCarMesh } from './car.js';
import { medalFor, nextMedal, hasReference, referenceLap } from './medals.js';
import { ReplayRecorder, ReplayPlayer } from './replay.js';
import { Race, OPPONENTS, F1_TEAMS } from './race.js';
import {
  Garage, playerColors as colorsOf, playerAccents as accentsOf, playerLiveries as liveriesOf, playerKinds as kindsOf, playerNumbers as numbersOf,
  partColor, kindName, hexCss, DESIGNS,
} from './garage.js';
import { CameraRig } from './camera.js';
import { Effects } from './effects.js';
import { Input } from './input.js';
import { AudioEngine, GearBox, Music, rpmForSpeed } from './audio.js';
import { HUD, formatTime, formatDelta, trackOutline } from './hud.js';
import { Store } from './store.js';
import { GhostRecorder, GhostPlayer } from './ghost.js';
import { Pickups, ITEM_NAMES } from './pickups.js';
import { RNG, clamp } from './rng.js';
import { Post } from './post.js';
import { TrackEditor, customToDef, decodeTrack, checkDef } from './editor.js';

const STEP = 1 / 120;
// šampionáty: čtyři závody za sebou; bouřkový se jede v dešti
const CUPS = [
  { id: 'classic', name: 'Klasický pohár', tracks: ['sumava', 'kanon', 'serpentiny', 'mesto'] },
  { id: 'reverse', name: 'Obrácený pohár', tracks: ['mesto~r', 'serpentiny~r', 'kanon~r', 'sumava~r'] },
  { id: 'storm', name: 'Bouřkový pohár', tracks: ['kanon', 'sumava~r', 'mesto', 'serpentiny~r'], rain: true },
];
const currentCup = () => CUPS.find((c) => c.id === S.cup) || CUPS[0];
const cupTracks = () => currentCup().tracks;
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
const ENGINE_VOLUME = { low: 0.5, mid: 0.8, high: 1.1 };
audio.engineVolume = ENGINE_VOLUME[S.engine] ?? ENGINE_VOLUME.mid;
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
const camRight = new THREE.Vector3();
audio.voiceOn = S.voice !== false;
input.tilt.invert = !!S.tiltInvert;
// náklon zapnutý z minula: senzory se zapnou při prvním dotyku (iPhone chce povolení z gesta)
if (S.steer === 'tilt' && isTouch) window.addEventListener('pointerdown', () => input.setTilt(true), { once: true });
const pmrem = new THREE.PMREMGenerator(renderer);

const G = {
  screen: 'loading', // loading | menu | race | editor
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
// typ a barvy vozů hráčů (upravují se v garáži)
const playerColors = () => colorsOf(S);
const playerAccents = () => accentsOf(S);
const playerLiveries = () => liveriesOf(S);
const playerKinds = () => kindsOf(S);
// soupeři jezdí to, co si vybral hráč 1
const opponentKind = () => playerKinds()[0];
// vybraná jména jezdců F1 (prázdné = výchozí „Ty“ / „Hráč 2“), dva hráči nesmí mít stejné
function playerNames() {
  const a = S.driver || '';
  const b = S.driver2 || '';
  return [a, b === a ? '' : b];
}

// soupeři dostanou náhodná jména jezdců F1, kromě těch, která mají hráči
function opponentNames() {
  const taken = playerNames();
  const names = F1_TEAMS.flatMap((t) => t.drivers).filter((d) => !taken.includes(d));
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  return names;
}

// soupeři jezdí v hotových designech z garáže (náhodně, kromě barev hráčů);
// v šampionátu zůstávají stejné, v menu se drží do dalšího startu
function opponentLooks() {
  const taken = playerColors().slice(0, humanCount());
  const looks = DESIGNS.filter((d) => !taken.includes(d.color)).map(({ color, accent, livery }) => ({ color, accent, livery: livery || {} }));
  for (let i = looks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [looks[i], looks[j]] = [looks[j], looks[i]];
  }
  return looks;
}
function currentLooks() {
  if (G.cup) return (G.cup.looks ??= opponentLooks());
  const taken = playerColors().slice(0, humanCount());
  if (!G.looks || G.looks.some((l) => taken.includes(l.color))) G.looks = opponentLooks();
  return G.looks;
}

// závodní režim bez šampionátu ('race' | 'time')
const raceMode = () => (S.mode === 'time' ? 'time' : 'race');
// trať, která se má právě jet (v šampionátu podle kola)
const currentTrackId = () => (S.mode === 'cup' ? cupTracks()[G.cup ? G.cup.round : 0] : S.track + (S.reverse ? REV : ''));

// prší podle volby v menu, v bouřkovém poháru a v deštivé denní výzvě (na zimní trati sněží)
const wantsRain = (def) => (def.rain || S.weather === 'rain' || (S.mode === 'cup' && currentCup().rain)) && def.biome !== 'winter';

// nejlepší umístění v šampionátu (klasický má kvůli starším uložením vlastní místo)
function cupRecord(id) {
  if (id === 'classic') return (store.records.cup ??= {});
  store.records.cups ??= {};
  return (store.records.cups[id] ??= {});
}

// denní výzva: každý den jiná vygenerovaná trať, pro všechny stejná, občas v dešti
function dailyDef() {
  const d = new Date();
  const day = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  const def = randomDef((day * 7919 + 104729) % 999999937);
  return {
    ...def, id: `daily-${day}`, name: 'Denní výzva', subtitle: `${d.getDate()}. ${d.getMonth() + 1}. · ${BIOMES[def.biome].name}`,
    rain: new RNG(day).next() < 0.35, daily: true,
  };
}

// obrácená varianta trati: stejné body v opačném pořadí (start zůstává uprostřed rovinky),
// vlastní id kvůli rekordům a ghostům
const REV = '~r';
const baseId = (id) => (id && id.endsWith(REV) ? id.slice(0, -REV.length) : id);
function reverseDef(def) {
  return { ...def, id: def.id + REV, name: `${def.name} (obráceně)`, points: [def.points[0], ...def.points.slice(1).reverse()] };
}

function trackDef(id) {
  if (id && id.endsWith(REV)) return reverseDef(trackDef(baseId(id)));
  if (id === 'random') return randomDef(S.randomSeed);
  if (id === 'daily') return dailyDef();
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

// počká na vykreslení snímku (aby se ukázalo „Stavím trať…“); ve skryté kartě snímky nechodí, proto i časový limit
const nextFrame = () => new Promise((r) => {
  requestAnimationFrame(() => r());
  setTimeout(r, 60);
});

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
  // déšť (na zimní trati místo něj padá sníh)
  const baseDef = trackDef(id);
  const wet = wantsRain(baseDef);
  const def = wet ? { ...baseDef, wet: true } : baseDef;
  const biome = wet ? wetBiome(BIOMES[def.biome]) : BIOMES[def.biome];
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
  ground.material.dispose();

  const effects = new Effects(scene, S.quality);
  effects.setView(camera, renderer.domElement.height, scene.fog);

  const rain = wet ? buildRain(S.quality === 'low' ? 1500 : S.quality === 'medium' ? 2600 : 4000) : null;
  if (rain) group.add(rain.points);
  G.world = {
    def, biome, track, terrain, group, sky, lights, effects, envRT, showcase: [], crowd: scenery.extra.crowd, snow: scenery.extra.snow, rain, wet,
  };
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
    const info = isPlayer
      ? { color: colors[h], number: numbersOf(S)[h], kind: playerKinds()[h], accent: playerAccents()[h], livery: playerLiveries()[h] }
      : { ...pool[ai % pool.length], ...currentLooks()[ai++], kind: opponentKind() };
    const car = new Car(w.track, {
      color: info.color, number: info.number, night: w.biome.night, biome: w.biome, isPlayer, kind: info.kind, accent: info.accent,
      livery: info.livery,
    });
    if (isPlayer) car.humanIndex = h;
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
    if (G.world && baseId(G.world.def.id) === track.id) G.forceReload = true;
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
    const shown = G.world && baseId(G.world.def.id);
    const reload = (track && shown === track.id) || (deletedId && shown === deletedId);
    if (reload) await selectTrack(currentTrackId(), true);
  },
});

function openEditor(track) {
  G.screen = 'editor';
  $('menu').hidden = true;
  editor.open(track || null);
}

// popisek trati: délka (u denní výzvy datum a počasí), rekord a medaile podle vozu hráče 1
function trackMeta(def, track) {
  const kind = playerKinds()[0];
  const rec = store.record(def.id + (S.reverse ? REV : ''), kind);
  const km = (track.L / 1000).toFixed(2).replace('.', ',');
  const head = def.daily ? `${def.subtitle}${def.rain && def.biome !== 'winter' ? ' · déšť' : ''}` : `${km} km`;
  if (!rec.lap) return { text: `${head} · bez rekordu` };
  const medal = hasReference(def, kind) ? medalFor(def, kind, rec.lap) : null;
  return { text: `${head} · rekord ${formatTime(rec.lap)}`, medal };
}

function buildTrackList() {
  const list = $('track-list');
  list.innerHTML = '';
  menuTracks.length = 0;
  const defs = [
    ...TRACKS.map((t) => ({ def: t, id: t.id })),
    { def: dailyDef(), id: 'daily' },
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
      m.track = new Track(m.def);
      trackOutline(m.track, m.canvas, { pad: 6, color: '#f3f5f8', width: 2.4 });
    }
    refreshTrackMeta();
  });
  refreshMenu();
}

// délka a rekord u tratí v menu (rekord podle vozu hráče 1)
function refreshTrackMeta() {
  for (const m of menuTracks) {
    const tr = m.track;
    if (!tr) continue;
    if (m.id === 'random') m.meta.textContent = `${(tr.L / 1000).toFixed(2).replace('.', ',')} km · ${m.def.subtitle}`;
    else if (m.custom && !m.custom.valid) m.meta.textContent = 'rozpracovaná, dokonči v editoru';
    else {
      const { text, medal } = trackMeta(m.def, tr);
      m.meta.textContent = text;
      if (medal) m.meta.insertAdjacentHTML('beforeend', ` · <span class="medal ${medal.id}">${medal.name}</span>`);
    }
    m.btn.setAttribute('aria-label', `${m.def.name}, ${m.meta.textContent}`);
  }
  warmMedals();
}

// limity medailí se počítají simulací; v menu po jedné trati na pozadí, ať se neseká
let warmTimer = 0;
function warmMedals() {
  clearTimeout(warmTimer);
  const kind = playerKinds()[0];
  const todo = menuTracks.find((m) => m.track && !(m.custom && !m.custom.valid) && m.id !== 'random' && !hasReference(m.def, kind)
    && store.record(m.def.id + (S.reverse ? REV : ''), kind).lap);
  if (!todo) return;
  warmTimer = setTimeout(() => {
    if (G.screen !== 'menu') return;
    referenceLap(todo.def, kind);
    refreshTrackMeta();
  }, 400);
}

async function selectTrack(id, force = false) {
  if (S.track === id && !force && G.world) return;
  S.track = id;
  store.save();
  refreshMenu();
  await loadWorld(currentTrackId());
  G.screen = 'menu';
}

function refreshMenu() {
  for (const m of menuTracks) m.btn.setAttribute('aria-checked', String(m.id === S.track));
  for (const b of $('mode-seg').children) b.setAttribute('aria-checked', String(b.dataset.mode === S.mode));
  for (const b of $('diff-seg').children) b.setAttribute('aria-checked', String(b.dataset.diff === S.difficulty));
  for (const b of $('dir-seg').children) b.setAttribute('aria-checked', String((b.dataset.dir === 'rev') === !!S.reverse));
  for (const b of $('weather-seg').children) b.setAttribute('aria-checked', String(b.dataset.weather === (S.weather || 'dry')));
  const winter = trackDef(currentTrackId()).biome === 'winter';
  $('weather-hint').hidden = !(winter && S.weather === 'rain');
  for (const b of $('quality-seg').children) b.setAttribute('aria-checked', String(b.dataset.q === S.quality));
  $('laps-value').textContent = S.laps;
  const two = humanCount() === 2;
  $('players-opt').hidden = S.mode === 'time' || isTouch;
  for (const b of $('players-seg').children) b.setAttribute('aria-checked', String(+b.dataset.players === (S.players || 1)));
  $('driver2-opt').hidden = !two;
  $('driver1-label').textContent = two ? 'Jezdec hráče 1' : 'Jezdec';
  playerNames().forEach((name, i) => refreshDriverPick($(i === 0 ? 'driver-pick' : 'driver2-pick'), name, playerNames()[1 - i]));
  for (const card of document.querySelectorAll('.car-card')) {
    const i = +card.dataset.player;
    card.hidden = i > 0 && !two;
    card.querySelector('.car-chips').innerHTML = ['body', 'accent', 'wings']
      .map((k) => `<i style="background:${hexCss(partColor(S, i, k).hex)}"></i>`).join('');
    card.querySelector('strong').textContent = kindName(playerKinds()[i]);
    card.querySelector('em').textContent = two ? `Hráč ${i + 1} · barvy a typ vozu` : 'Barvy a typ vozu';
  }
  $('keys-2p').hidden = !two;
  $('diff-opt').hidden = S.mode === 'time';
  $('weapons-opt').hidden = S.mode === 'time';
  $('track-block').hidden = S.mode === 'cup';
  $('cup-block').hidden = S.mode !== 'cup';
  $('mode-hint').textContent = {
    race: 'Ty proti pěti soupeřům. Drift plní nitro, krabice s otazníkem dávají power-upy.',
    cup: `${currentCup().name}: čtyři závody za sebou${currentCup().rain ? ' v dešti' : ''}. Body za umístění 10, 6, 4, 3, 2, 1 a vítězí nejvíc bodů.`,
    time: 'Sám na trati proti průhlednému ghostu svého nejlepšího kola.',
  }[S.mode];
  if (S.mode === 'cup') {
    for (const b of $('cup-seg').children) b.setAttribute('aria-checked', String(b.dataset.cup === currentCup().id));
    $('cup-list').innerHTML = cupTracks().map((id) => {
      const def = trackDef(id);
      const rec = store.record(id, playerKinds()[0]);
      return `<li><span class="cl-name">${def.name}</span><span class="cl-meta">${rec.lap ? 'rekord ' + formatTime(rec.lap) : 'bez rekordu'}</span></li>`;
    }).join('');
    const best = cupRecord(currentCup().id).best;
    $('cup-best').textContent = best ? `Tvoje nejlepší celkové umístění: ${best}. místo.` : 'Šampionát jsi ještě nedokončil.';
  }
  const wt = $('weapons-toggle');
  wt.setAttribute('aria-pressed', String(S.weapons));
  wt.querySelector('em').textContent = S.weapons ? 'Zapnuto' : 'Vypnuto';
  const st = $('sound-toggle');
  st.setAttribute('aria-pressed', String(S.sound));
  st.querySelector('em').textContent = S.sound ? 'Zapnuto' : 'Vypnuto';
  for (const b of $('engine-seg').children) b.setAttribute('aria-checked', String(b.dataset.engine === (S.engine || 'mid')));
  const mt = $('music-toggle');
  mt.setAttribute('aria-pressed', String(S.music !== false));
  mt.querySelector('em').textContent = S.music !== false ? 'Zapnuto' : 'Vypnuto';
  for (const [id, on] of [['voice-toggle', S.voice !== false], ['invert-toggle', !!S.tiltInvert], ['haptics-toggle', S.haptics !== false]]) {
    $(id).setAttribute('aria-pressed', String(on));
    $(id).querySelector('em').textContent = on ? 'Zapnuto' : 'Vypnuto';
  }
  const tilt = S.steer === 'tilt';
  for (const b of $('steer-seg').children) b.setAttribute('aria-checked', String((b.dataset.steer === 'tilt') === tilt));
  $('invert-opt').hidden = !tilt;
  document.body.classList.toggle('tilt-steer', tilt && isTouch);
}

// vibrace telefonu (Android; iPhone vibrace z prohlížeče nepodporuje)
function buzz(pattern) {
  if (isTouch && S.haptics !== false && navigator.vibrate) navigator.vibrate(pattern);
}

// výběr jezdce: tlačítko s rozbalovacím seznamem jezdců F1 po týmech (místo systémového selectu)
function bindDriverPick(root, noneLabel) {
  const key = root.dataset.key;
  const btn = root.querySelector('.pick');
  const pop = root.querySelector('.pick-pop');
  const option = (name, label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pick-opt';
    b.setAttribute('role', 'option');
    b.dataset.name = name;
    b.textContent = label;
    b.addEventListener('click', () => {
      S[key] = name;
      store.save();
      close(true);
      refreshMenu();
    });
    pop.appendChild(b);
  };
  // vlastní jméno: krátký text bez znaků, které by šly do HTML výsledků
  const form = document.createElement('form');
  form.className = 'pick-custom';
  form.innerHTML = '<input type="text" maxlength="18" placeholder="Vlastní jméno" aria-label="Vlastní jméno" autocomplete="off" spellcheck="false"><button type="submit">OK</button>';
  const input = form.querySelector('input');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.replace(/[<>&"]/g, '').replace(/\s+/g, ' ').trim();
    if (!name) return;
    S[key] = name;
    store.save();
    close(true);
    refreshMenu();
  });
  pop.appendChild(form);
  option('', noneLabel);
  for (const t of F1_TEAMS) {
    const h = document.createElement('div');
    h.className = 'pick-team-head';
    h.textContent = t.team;
    pop.appendChild(h);
    for (const d of t.drivers) option(d, d);
  }
  const options = () => [...pop.querySelectorAll('.pick-opt:not(:disabled)')];
  const close = (focus) => {
    if (pop.hidden) return;
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    if (focus) btn.focus();
  };
  const outside = (e) => {
    if (!root.contains(e.target)) close(false);
  };
  btn.addEventListener('click', () => {
    if (!pop.hidden) return close(true);
    // otevřít nahoru, když pod tlačítkem není místo
    const r = btn.getBoundingClientRect();
    root.classList.toggle('up', innerHeight - r.bottom < 330 && r.top > innerHeight - r.bottom);
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    const cur = pop.querySelector('.pick-opt[aria-selected="true"]') || (input.value ? input : options()[0]);
    cur.scrollIntoView({ block: 'center' });
    cur.focus();
  });
  pop.addEventListener('keydown', (e) => {
    const list = options();
    const i = list.indexOf(document.activeElement);
    if (document.activeElement === input && e.key !== 'ArrowDown' && e.key !== 'Escape') return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      next.focus();
      next.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') close(false);
  });
}

function refreshDriverPick(root, name, other) {
  const team = F1_TEAMS.find((t) => t.drivers.includes(name));
  const input = root.querySelector('.pick-custom input');
  if (document.activeElement !== input) input.value = name && !team ? name : '';
  root.querySelector('.pick-name').textContent = name || root.querySelector('.pick-opt').textContent;
  root.querySelector('.pick-team').textContent = team ? team.team : '';
  for (const b of root.querySelectorAll('.pick-opt')) {
    b.setAttribute('aria-selected', String(b.dataset.name === name));
    // jméno, které má druhý hráč, nejde vybrat
    b.disabled = !!b.dataset.name && b.dataset.name === other && humanCount() === 2;
  }
}

// přestavba aut v menu nejvýš jednou za snímek (picker barvy posílá hodně změn)
let showcaseQueued = false;
function queueShowcase() {
  if (showcaseQueued) return;
  showcaseQueued = true;
  requestAnimationFrame(() => {
    showcaseQueued = false;
    if (G.world && (G.screen === 'menu' || G.screen === 'garage')) buildShowcase();
  });
}

// --- garáž ---------------------------------------------------------------------------

const garage = new Garage({ store, onChange: () => { refreshMenu(); queueShowcase(); }, onClose: () => closeGarage() });

function openGarage(player) {
  if (G.screen !== 'menu') return;
  G.screen = 'garage';
  $('menu').hidden = true;
  garage.open(player, humanCount());
  document.activeElement?.blur();
}

// v garáži jde vůz otáčet tažením po scéně
let dragX = null;
const gameCanvas = $('game');
gameCanvas.addEventListener('pointerdown', (e) => {
  if (G.screen !== 'garage') return;
  dragX = e.clientX;
  gameCanvas.setPointerCapture(e.pointerId);
});
gameCanvas.addEventListener('pointermove', (e) => {
  if (dragX == null) return;
  rig.orbitAngle += (e.clientX - dragX) * 0.008;
  dragX = e.clientX;
  G.garageIdle = 0;
});
for (const ev of ['pointerup', 'pointercancel']) gameCanvas.addEventListener(ev, () => (dragX = null));

function closeGarage() {
  garage.close();
  G.screen = 'menu';
  $('menu').hidden = false;
  if (G.world) for (const c of G.world.showcase) c.mesh.root.visible = true;
  refreshMenu();
  refreshTrackMeta();
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
  for (const b of $('cup-seg').children) {
    b.addEventListener('click', async () => {
      if (currentCup().id === b.dataset.cup) return;
      S.cup = b.dataset.cup;
      store.save();
      refreshMenu();
      await loadWorld(currentTrackId());
      G.screen = 'menu';
    });
  }
  for (const b of $('weather-seg').children) {
    b.addEventListener('click', async () => {
      if ((S.weather || 'dry') === b.dataset.weather) return;
      S.weather = b.dataset.weather;
      store.save();
      refreshMenu();
      await loadWorld(currentTrackId());
      G.screen = 'menu';
    });
  }
  for (const b of $('dir-seg').children) {
    b.addEventListener('click', async () => {
      const rev = b.dataset.dir === 'rev';
      if (!!S.reverse === rev) return;
      S.reverse = rev;
      store.save();
      refreshMenu();
      refreshTrackMeta();
      await loadWorld(currentTrackId());
      G.screen = 'menu';
    });
  }
  for (const b of $('diff-seg').children) {
    b.addEventListener('click', () => {
      S.difficulty = b.dataset.diff;
      store.save();
      refreshMenu();
    });
  }
  for (const card of document.querySelectorAll('.car-card')) card.addEventListener('click', () => openGarage(+card.dataset.player));
  bindDriverPick($('driver-pick'), 'Ty (bez jména)');
  bindDriverPick($('driver2-pick'), 'Hráč 2 (bez jména)');
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
  for (const b of $('engine-seg').children) {
    b.addEventListener('click', () => {
      S.engine = b.dataset.engine;
      audio.engineVolume = ENGINE_VOLUME[S.engine];
      store.save();
      refreshMenu();
    });
  }
  $('voice-toggle').addEventListener('click', () => {
    S.voice = S.voice === false;
    audio.voiceOn = S.voice;
    store.save();
    refreshMenu();
  });
  $('invert-toggle').addEventListener('click', () => {
    S.tiltInvert = !S.tiltInvert;
    input.tilt.invert = S.tiltInvert;
    store.save();
    refreshMenu();
  });
  $('haptics-toggle').addEventListener('click', () => {
    S.haptics = S.haptics === false;
    store.save();
    refreshMenu();
    buzz(30);
  });
  for (const b of $('steer-seg').children) {
    b.addEventListener('click', async () => {
      const tilt = b.dataset.steer === 'tilt';
      // náklon potřebuje povolení senzorů (na iPhonu jen z kliknutí)
      if (tilt && !(await input.setTilt(true))) {
        $('mode-hint').textContent = 'Prohlížeč nepovolil čtení náklonu telefonu.';
        return;
      }
      if (!tilt) input.setTilt(false);
      S.steer = tilt ? 'tilt' : 'buttons';
      store.save();
      refreshMenu();
    });
  }
  $('music-toggle').addEventListener('click', () => {
    S.music = S.music === false;
    audio.init();
    music.setEnabled(S.music);
    store.save();
    refreshMenu();
  });
  $('start-btn').addEventListener('click', () => startFromMenu());
  // celá obrazovka (kde to prohlížeč umí)
  const fsOk = !!(document.documentElement.requestFullscreen && document.fullscreenEnabled);
  const fsLabel = () => (document.fullscreenElement ? 'Ukončit celou obrazovku' : 'Celá obrazovka');
  for (const b of document.querySelectorAll('[data-fullscreen]')) {
    b.hidden = !fsOk;
    b.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      } catch {
        /* prohlížeč odmítl */
      }
    });
  }
  document.addEventListener('fullscreenchange', () => {
    for (const b of document.querySelectorAll('[data-fullscreen]')) b.textContent = fsLabel();
  });
  $('new-track').addEventListener('click', () => openEditor(null));
  $('pause-btn').addEventListener('click', () => setPaused(!G.paused));
  $('resume-btn').addEventListener('click', () => setPaused(false));
  $('restart-btn').addEventListener('click', () => startRace());
  $('menu-btn').addEventListener('click', () => toMenu());
  $('again-btn').addEventListener('click', () => {
    if (G.cup) {
      if (G.cup.round < cupTracks().length - 1) {
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

// --- instalace na plochu a hra offline ----------------------------------------------

// mezipaměť pro hru offline se registruje hned, i kdyby se hra nespustila
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  // knihovny a písma z CDN, které stránka načetla (i později, např. postprocessing), ať jsou i offline
  const cdn = /^https:\/\/(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;
  const offerCdn = () => navigator.serviceWorker.ready.then((reg) => {
    const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((u) => cdn.test(u));
    reg.active?.postMessage({ type: 'cache', urls });
  });
  offerCdn();
  setTimeout(offerCdn, 15000);
}

function bindInstall() {
  // prohlížeče s vlastní nabídkou instalace (Chrome, Edge, Android) ji pustí přes tlačítko v menu
  let prompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    prompt = e;
    $('install-btn').hidden = false;
  });
  $('install-btn').addEventListener('click', async () => {
    if (!prompt) return;
    prompt.prompt();
    await prompt.userChoice.catch(() => null);
    prompt = null;
    $('install-btn').hidden = true;
  });
  window.addEventListener('appinstalled', () => ($('install-btn').hidden = true));
}

// --- záznam závodu --------------------------------------------------------------------

function startReplay() {
  if (!G.race || !G.replayRec) return;
  G.replay = new ReplayPlayer(G.replayRec, G.race.cars, G.world.track, G.world.terrain);
  G.screen = 'replay';
  $('results').hidden = true;
  hudRoot.hidden = true;
  if (G.ghostMesh) G.ghostMesh.root.visible = false;
  audio.silence();
  $('replay').hidden = false;
  refreshReplayUI(true);
}

function stopReplay() {
  if (!G.replay) return;
  G.replay.restore();
  G.replay = null;
  $('replay').hidden = true;
  G.screen = 'race';
  hudRoot.hidden = false;
  for (const r of rigs) r.snap();
  $('results').hidden = false;
  $('replay-btn').focus();
}

function toggleReplay() {
  const r = G.replay;
  if (!r) return;
  if (!r.playing && r.t >= r.duration) r.seek(0);
  r.playing = !r.playing;
  refreshReplayUI(true);
}

const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function refreshReplayUI(full = false) {
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

function bindReplay() {
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

function clearRace() {
  const r = G.race;
  if (!r) return;
  if (G.replay) {
    G.replay = null;
    $('replay').hidden = true;
  }
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
  if (!G.world || G.forceReload || G.world.def.id !== trackDef(trackId).id || G.world.wet !== wantsRain(trackDef(trackId))) {
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
    playerColors: playerColors().slice(0, humans), playerKinds: playerKinds(), playerNames: playerNames(),
    opponentNames: G.cup ? (G.cup.names ??= opponentNames()) : opponentNames(), opponentKind: opponentKind(),
    opponentLooks: G.cup ? currentLooks() : (G.looks = opponentLooks()),
    playerAccents: playerAccents(), playerLiveries: playerLiveries(), playerNumbers: numbersOf(S), humans, night: w.biome.night,
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
  G.replayRec = new ReplayRecorder(race.cars);
  G.recording = true;
  G.ghost = null;
  if (raceMode() === 'time') {
    const data = store.ghost(w.def.id, race.player.kind);
    if (data && data.frames && data.frames.length > 8) {
      G.ghost = new GhostPlayer(data);
      G.ghostMesh = createCarMesh(0x9fd8ff, { ghost: true, kind: race.player.kind });
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
  if (G.cup) for (const h of G.huds) h.sub(`Šampionát · závod ${G.cup.round + 1}/${cupTracks().length} · ${w.def.name}`, 3.2);
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
    if (G.screen === 'garage') {
      if (code === 'Escape' || btn === 'B') closeGarage();
      continue;
    }
    if (G.screen === 'replay') {
      if (code === 'Escape' || btn === 'B') stopReplay();
      if ((code === 'Space' && document.activeElement?.tagName !== 'BUTTON') || btn === 'A') toggleReplay();
      continue;
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
      if (e.value === 3) input.centerTilt();
      // prvních pár závodů napovíme, jak na perfektní start
      if (e.value === 3 && (S.startTips || 0) < 3) {
        S.startTips = (S.startTips || 0) + 1;
        store.save();
        each((h) => h.sub('Plyn přidej až na poslední světlo – perfektní start', 2.6));
      }
      audio.beep(false);
      w.track.setStartLights([0, 5, 4, 2][e.value] ?? 0);
    } else if (e.type === 'go') {
      each((h) => h.message('Start!', 'go', 1.1));
      audio.beep(true);
      w.track.setStartLights(0, true);
      G.lightsOff = 2.5;
    } else if (e.type === 'sector' && e.car.isPlayer) {
      const { prev, better } = store.submitSector(w.def.id, e.car.kind, e.index, e.time);
      // třetí sektor končí v cíli kola, tam už je hláška o kole
      if (e.index < 2) {
        const d = prev == null ? '' : ` <span class="${better ? 'good' : 'bad'}">${formatDelta(e.time - prev)}</span>`;
        hudOf(e.car).sub(`Sektor ${e.index + 1} · ${formatTime(e.time)}${d}`, 1.8);
      }
    } else if (e.type === 'start' && e.car.isPlayer) {
      const perfect = e.quality === 'perfect';
      hudOf(e.car).sub(perfect ? '<span class="good">Perfektní start!</span>' : '<span class="bad">Předčasný start</span> · kola se protáčejí', 2);
      if (perfect) audio.perfectStart();
      else audio.wheelspin();
      buzz(perfect ? 25 : [40, 30, 40]);
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
        const stored = store.ghost(w.def.id, car.kind);
        if (!stored || e.lapTime < stored.time) store.saveGhost(w.def.id, ghost, car.kind);
        // v časovce jezdíme hned proti nejlepšímu kolu
        if (race.mode === 'time' && (!G.ghost || e.lapTime < G.ghost.data.time)) {
          G.ghost = new GhostPlayer(ghost);
          if (!G.ghostMesh) {
            G.ghostMesh = createCarMesh(0x9fd8ff, { ghost: true, kind: race.player.kind });
            scene.add(G.ghostMesh.root);
          }
        }
      }
      if (!car.finished) {
        if (e.lap === race.laps - 1) {
          h.message('Poslední kolo', 'warn', 1.6);
          if (car === p) audio.say('Poslední kolo');
        }
        else if (e.best && e.lap > 1) h.message('Nejlepší kolo', 'warn', 1.4);
        h.sub(html, 3);
        audio.chime();
      }
    } else if (e.type === 'finish' && e.car.isPlayer) {
      const place = e.car.place;
      hudOf(e.car).message(race.mode === 'race' ? `${place}. místo` : 'Cíl', place === 1 || race.mode !== 'race' ? 'go' : '', 3);
      audio.fanfare();
      audio.crowd();
      if (e.car === p) audio.say(race.mode === 'race' ? `Cíl. ${['První', 'Druhé', 'Třetí', 'Čtvrté', 'Páté', 'Šesté'][place - 1] ?? place + '.'} místo` : 'Cíl');
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
        buzz(Math.min(60, 15 + e.strength * 4));
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
          buzz([90, 50, 90]);
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
  // medaile hráče 1: limity podle trati po směru, lepší medaile než dosud = odznak
  const def = trackDef(baseId(currentTrackId()));
  const p = race.player;
  const prevLap = store.record(G.world.def.id, p.kind).lap;
  for (const car of race.players) {
    const res = store.submit(G.world.def.id, {
      lap: car.bestLap, race: car.finished ? car.finishTime : null, laps: race.laps, mode: race.mode,
    }, car.kind);
    if (res.lap) out.lap = true;
    if (res.race) out.race = true;
  }
  const lap = store.record(G.world.def.id, p.kind).lap;
  // náhodné tratě se mění, medaile mají jen pevné tratě a denní výzva
  if (lap && (!def.random || def.daily)) {
    const before = medalFor(def, p.kind, prevLap);
    const now = medalFor(def, p.kind, lap);
    if (now && now !== before) out.medal = now;
    out.next = nextMedal(def, p.kind, lap);
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
    ? `Šampionát · závod ${cup.round + 1}/${cupTracks().length} · ${w.def.name}`
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
  if (G.results?.medal) {
    badges.push(`<span class="medal ${G.results.medal.id}">Medaile: ${G.results.medal.name}</span>`);
    audio.say({ gold: 'Zlatá medaile', silver: 'Stříbrná medaile', bronze: 'Bronzová medaile' }[G.results.medal.id]);
  }
  if (G.results?.next) badges.push(`Na ${G.results.next.name.toLowerCase()} chybí ${G.results.next.gap.toFixed(2).replace('.', ',')} s`);
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
  G.recording = false;
  $('replay-btn').hidden = !G.replayRec || G.replayRec.duration < 3;
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
  const last = cup.round === cupTracks().length - 1;
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
      if (myPlace === 1) badges.unshift(`Vítěz: ${currentCup().name}`);
      const rec = cupRecord(currentCup().id);
      if (!rec.best || myPlace < rec.best) {
        rec.best = myPlace;
        store.save();
      }
    } else {
      const best = humanNames.reduce((a, b) => (placeOf(a) < placeOf(b) ? a : b));
      $('res-title').textContent = `${best} vyhrál souboj o šampionát`;
      if (placeOf(best) === 1) badges.unshift(`${currentCup().name}: vyhrál ${best}`);
    }
    again.textContent = 'Nový šampionát';
  } else {
    const next = trackDef(cupTracks()[cup.round + 1]);
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
  const sprayCol = w.biome.night ? [0.45, 0.5, 0.56] : [0.7, 0.75, 0.8];
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
    // na mokru zvedají kola za sebou spršku vody
    if (w.wet && !far && car.speed > 12 && car.surface !== SURF_OFF && Math.random() < dt * 18) {
      const amt = clamp((car.speed - 12) / 40, 0.2, 0.75);
      fx.tireSmoke(wl[0], wl[1], wl[2], car.vx, car.vz, amt, sprayCol);
      fx.tireSmoke(wr[0], wr[1], wr[2], car.vx, car.vz, amt, sprayCol);
    }
    if (!far && car.surface === SURF_OFF && car.speed > 6 && Math.random() < dt * 30) {
      fx.dust(wl[0], wl[1], wl[2], car.vx, car.vz, w.biome.dust);
      fx.dust(wr[0], wr[1], wr[2], car.vx, car.vz, w.biome.dust);
    }
    if ((car.nitroActive || car.launchBoost > 0) && !far) {
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
        buzz(Math.min(70, 10 + car.impact * 4));
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
        if (G.recording && race.state !== 'countdown') G.replayRec.sample(STEP);
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
      // motory soupeřů: hráč 2 a nejbližší auta; hlasitost podle vzdálenosti, stereo podle kamery,
      // výška podle Dopplera (přibližující se auto zní výš, vzdalující níž)
      const rivals = [];
      if (humans.length > 1) {
        const q = humans[1];
        rivals.push({ rpm: gearboxes[1].update(dt, Math.abs(q.vLong), q.controls.throttle, onGrid), kind: q.kind, vol: 1, pan: 0, pitch: 1 });
      }
      camRight.setFromMatrixColumn(camera.matrixWorld, 0);
      const near = race.cars
        .filter((c) => c !== p && !humans.includes(c))
        .map((c) => ({ c, d: Math.hypot(c.x - p.x, c.z - p.z) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 3 - rivals.length);
      for (const { c, d } of near) {
        const ux = (c.x - p.x) / Math.max(d, 0.1), uz = (c.z - p.z) / Math.max(d, 0.1);
        const pitch = clamp((343 + p.vx * ux + p.vz * uz) / (343 + c.vx * ux + c.vz * uz), 0.85, 1.2);
        rivals.push({
          rpm: onGrid ? 1100 + c.controls.throttle * 2000 : rpmForSpeed(c.speed, c.controls.throttle), kind: c.kind,
          vol: clamp(1 / (1 + d / 10), 0, 1), pan: clamp(ux * camRight.x + uz * camRight.z, -1, 1) * 0.8, pitch,
        });
      }
      audio.setDuo(humans.length > 1);

      // řazení nahoru a prskání z výfuku při ubrání plynu ve vysokých otáčkách
      const gear = gearboxes[0].gear;
      if (race.state === 'running' && gear > (G.lastGear ?? gear) && p.speed > 5) audio.shift();
      G.lastGear = gear;
      const thr = p.controls.throttle;
      if ((G.lastThrottle ?? 0) > 0.7 && thr < 0.2 && rpm > 4800 && race.state === 'running' && !p.finished) {
        audio.backfire(1 + Math.floor(Math.random() * 3));
      }
      G.lastThrottle = thr;
      const skidOf = (c) => (c.skidding ? clamp(c.slip * 3 + (c.controls.handbrake ? 0.3 : 0), 0, 1) : 0);
      audio.update({
        active: $('results').hidden,
        rpm,
        throttle: p.controls.throttle,
        speed: Math.max(...humans.map((c) => c.speed)),
        skid: Math.max(...humans.map(skidOf)),
        nitro: humans.some((c) => c.nitroActive),
        offroad: humans.some((c) => c.surface === SURF_OFF),
        rain: w.wet,
        rivals,
        kind: p.kind,
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
  } else if (G.screen === 'replay' && G.replay) {
    G.replay.update(dt);
    G.replay.updateCamera(dt, camera, rig);
    emitEffects(dt);
    refreshReplayUI();
  } else if (G.screen === 'garage') {
    // garáž: kamera u vozu hráče, ostatní auta schovaná; vůz se posune vedle panelu
    const target = w.showcase.find((c) => c.isPlayer && c.humanIndex === garage.player) || w.showcase.find((c) => c.isPlayer);
    for (const c of w.showcase) c.mesh.root.visible = c === target;
    if (target) {
      const panel = $('garage').firstElementChild;
      const wide = innerWidth > 720;
      const offX = wide ? panel.offsetWidth / innerWidth : 0;
      const offY = wide ? 0 : Math.min(0.75, 1 - panel.offsetTop / innerHeight);
      G.garageIdle = (G.garageIdle || 0) + dt;
      rig.garage(dt, target, offX, offY, G.garageIdle > 2.5);
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
  if (w.rain) w.rain.update(dt);
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
    if (w.rain) w.rain.setView(camera);
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
    if (w.rain) w.rain.setView(cam);
    const y = i === 0 ? H - h2 : 0;
    renderer.setViewport(0, y, W, h2);
    renderer.setScissor(0, y, W, h2);
    renderer.render(scene, cam);
  });
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, W, H);
}

// --- start ---------------------------------------------------------------------------

// trať ze sdíleného odkazu (#t=...) se přidá mezi vlastní
function importSharedTrack() {
  const m = /^#t=([A-Za-z0-9_-]+)$/.exec(location.hash);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  const t = decodeTrack(m[1]);
  const note = $('menu-note');
  if (!t) {
    note.textContent = 'Odkaz na trať se nepodařilo přečíst.';
    note.hidden = false;
    return;
  }
  const track = { id: 'custom-' + Date.now().toString(36), ...t };
  track.valid = checkDef(customToDef(track)).ok;
  store.saveCustom(track);
  if (track.valid) S.track = track.id;
  store.save();
  note.textContent = `Přidána trať „${track.name}“ ze sdíleného odkazu.` + (track.valid ? ' Je vybraná, stačí dát Na start.' : ' Potřebuje ještě doladit v editoru.');
  note.hidden = false;
}

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
  importSharedTrack();
  bindMenu();
  bindReplay();
  bindInstall();
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
