// Paseka – vstupní bod: renderer, svět, čas, sázení a herní smyčka.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Board, TILE_TYPES } from './world/board.js';
import { Water } from './world/water.js';
import { Sky } from './world/sky.js';
import { Clouds } from './world/clouds.js';
import { hexCorner } from './world/hex.js';
import { Grass } from './life/grass.js';
import { Flora } from './life/flora.js';
import { populate } from './life/populate.js';
import { SPECIES, PLANTABLE } from './data/species.js';
import { SEASONS, SeasonPalette } from './data/seasons.js';
import { natureMaterial, shared } from './render/nature.js';
import { Post } from './render/post.js';
import { Particles, setPointScale } from './fx/particles.js';

const $ = (id) => document.getElementById(id);
const DAY_SECONDS = 240;        // délka dne při běžném plynutí času
const LAPSE_DAY = 14;           // délka dne v časosběru
const LAPSE_SEASON = 22;        // délka jednoho ročního období v časosběru

// --- renderer a scéna -----------------------------------------------------------

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: $('scene'), antialias: false, powerPreference: 'high-performance' });
} catch (e) {
  $('loading-text').textContent = 'Prohlížeč nepodporuje WebGL, bez kterého scéna neběží. Zkus jiný prohlížeč nebo zapni hardwarovou akceleraci.';
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.5, 1200);
camera.position.set(26, 22, 30);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.6, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.enablePan = false;
controls.minDistance = 16;
controls.maxDistance = 58;
controls.minPolarAngle = 0.2;
controls.maxPolarAngle = 1.3;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.35;
controls.addEventListener('start', () => { controls.autoRotate = false; });
fitCamera();

// --- svět ---------------------------------------------------------------------

const board = new Board({ radius: 7, seed: 7 });
scene.add(board.buildMesh(natureMaterial({ vertexColors: true })));
scene.add(board.buildUnderside(natureMaterial({ vertexColors: true }, { snow: false })));

const water = new Water(board);
scene.add(water.mesh);

const grass = new Grass(board);
scene.add(grass.mesh);

const flora = new Flora(scene, 11);
populate(board, flora);

const sky = new Sky(scene);
const clouds = new Clouds(scene);
const particles = new Particles(scene, board);
const post = new Post(renderer, scene, camera);
setPointScale(window.innerHeight, renderer.getPixelRatio(), camera.fov);

// Zvýraznění políčka pod kurzorem: šestiúhelníkový prstenec.
const ring = (() => {
  const pos = [];
  for (let i = 0; i < 6; i++) {
    const [ax, az] = hexCorner(i, 0.97), [bx, bz] = hexCorner((i + 1) % 6, 0.97);
    const [cx, cz] = hexCorner(i, 0.84), [dx, dz] = hexCorner((i + 1) % 6, 0.84);
    pos.push(ax, 0, az, dx, 0, dz, bx, 0, bz, ax, 0, az, cx, 0, cz, dx, 0, dz);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false, depthTest: false, side: THREE.DoubleSide, fog: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 10;
  mesh.visible = false;
  scene.add(mesh);
  return mesh;
})();

// --- čas a roční období ---------------------------------------------------------

const palette = new SeasonPalette();
const state = {
  tod: 0.31,
  season: 1,
  seasonTarget: 1,
  playing: true,
  lapse: false,
  selected: null,
  time: 0,
};

function applyPalette() {
  board.applyColors(palette);
  flora.applySeason(palette);
  grass.applySeason(palette);
  water.applySeason(palette);
  shared.uSnow.value = palette.amounts.snow;
  shared.uWind.value = palette.amounts.wind;
}

function stepTime(dt) {
  if (state.playing) state.tod = (state.tod + dt / (state.lapse ? LAPSE_DAY : DAY_SECONDS)) % 1;
  if (state.lapse && state.playing) {
    state.season = (state.season + dt / LAPSE_SEASON) % 4;
    state.seasonTarget = state.season;
  } else {
    // Plynulý přechod k vybranému období po kratší cestě kolem roku.
    let d = (((state.seasonTarget - state.season) % 4) + 4) % 4;
    if (d > 2) d -= 4;
    const stepS = Math.sign(d) * Math.min(Math.abs(d), dt * 0.9);
    state.season = (state.season + stepS + 4) % 4;
  }
}

// --- rozhraní -------------------------------------------------------------------

const ICONS = {
  spruce: '<path fill="#2f5d3c" d="M16 3l7 9h-3.2l5.2 7h-3.8l4.8 6H6l4.8-6H7l5.2-7H9z"/><rect x="14.6" y="25" width="2.8" height="4" rx="1" fill="#6b4a32"/>',
  beech: '<rect x="14.5" y="17" width="3" height="12" rx="1.2" fill="#77706a"/><circle cx="16" cy="12" r="8.5" fill="#62a03e"/><circle cx="10.5" cy="15" r="5" fill="#5a9638"/><circle cx="21.5" cy="15" r="5" fill="#6aa844"/>',
  birch: '<rect x="14.8" y="12" width="2.4" height="17" rx="1" fill="#efece4"/><rect x="14.8" y="17" width="2.4" height="1.4" fill="#2e2a28"/><rect x="14.8" y="22" width="2.4" height="1.2" fill="#2e2a28"/><ellipse cx="16" cy="10" rx="5.5" ry="8" fill="#9cc65a"/><ellipse cx="11" cy="14" rx="3.4" ry="5" fill="#8db84e"/><ellipse cx="21" cy="13.5" rx="3.4" ry="5" fill="#a6cf62"/>',
  rowan: '<rect x="14.6" y="17" width="2.8" height="12" rx="1.2" fill="#5f544c"/><ellipse cx="16" cy="12" rx="10" ry="7.5" fill="#5a9a3a"/><circle cx="10" cy="17" r="1.6" fill="#e3262a"/><circle cx="12.4" cy="18.4" r="1.6" fill="#e3262a"/><circle cx="20.5" cy="17.5" r="1.6" fill="#e3262a"/><circle cx="22.6" cy="16" r="1.6" fill="#e3262a"/>',
  fireweed: '<path stroke="#5d8f40" stroke-width="1.6" d="M10 29V14M16 29V9M22 29V13"/><path fill="#e0559a" d="M10 6l2.4 9H7.6zM16 2l2.6 9.5h-5.2zM22 5l2.4 9.5h-4.8z"/>',
  fern: '<path fill="#5a9a3e" d="M16 28C12 20 6 17 3 18c4-3 10-1 13 10zM16 28c4-8 10-11 13-10-4-3-10-1-13 10zM16 28c-2-9-6-15-10-17 5 0 10 5 10 17zM16 28c2-9 6-15 10-17-5 0-10 5-10 17zM16 28c-1-10 0-17 0-22 1.5 5 1.5 12 0 22z"/>',
};

const bar = $('plant-bar');
const buttons = PLANTABLE.map((id, i) => {
  const s = SPECIES[id];
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'plant';
  b.setAttribute('aria-pressed', 'false');
  b.dataset.species = id;
  b.title = `${s.name} (${i + 1})`;
  b.innerHTML = `<svg viewBox="0 0 32 32" aria-hidden="true">${ICONS[s.model]}</svg><span>${s.short}</span><kbd>${i + 1}</kbd>`;
  b.addEventListener('click', () => select(state.selected === id ? null : id));
  bar.appendChild(b);
  return b;
});

function select(id) {
  state.selected = id;
  for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.species === id));
  renderer.domElement.classList.toggle('planting', !!id);
  const card = $('herbar');
  if (!id) { card.hidden = true; return; }
  const s = SPECIES[id];
  $('herbar-name').textContent = s.name;
  $('herbar-latin').textContent = s.latin;
  $('herbar-fact').textContent = s.fact;
  $('herbar-where').textContent = `Roste na: ${s.tiles.map((t) => TILE_TYPES[t].name.toLowerCase()).join(', ')}`;
  card.hidden = false;
  // Přehraje animaci karty znovu.
  card.style.animation = 'none';
  void card.offsetWidth;
  card.style.animation = '';
}

const seasonBtns = [...$('seasons').querySelectorAll('button')];
for (const b of seasonBtns) {
  b.addEventListener('click', () => {
    setLapse(false);
    state.seasonTarget = Number(b.dataset.season);
  });
}

const playBtn = $('play');
function setPlaying(on) {
  state.playing = on;
  playBtn.classList.toggle('paused', !on);
  playBtn.setAttribute('aria-label', on ? 'Pozastavit čas' : 'Spustit čas');
}
playBtn.addEventListener('click', () => setPlaying(!state.playing));

const lapseBtn = $('timelapse');
function setLapse(on) {
  state.lapse = on;
  lapseBtn.setAttribute('aria-pressed', String(on));
  if (on) setPlaying(true);
}
lapseBtn.addEventListener('click', () => setLapse(!state.lapse));

const tiltBtn = $('tilt');
tiltBtn.addEventListener('click', () => {
  const on = tiltBtn.getAttribute('aria-pressed') !== 'true';
  tiltBtn.setAttribute('aria-pressed', String(on));
  post.setTilt(on);
});

const todInput = $('tod');
todInput.addEventListener('input', () => {
  state.tod = Number(todInput.value);
  setLapse(false);
});

function updateClockUI() {
  if (document.activeElement !== todInput) todInput.value = state.tod.toFixed(3);
  const mins = Math.floor(state.tod * 24 * 60);
  $('tod-label').textContent = `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
  const active = Math.round(state.lapse ? state.season : state.seasonTarget) % 4;
  seasonBtns.forEach((b, i) => b.setAttribute('aria-checked', String(i === active)));
}

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const n = Number(e.key);
  if (n >= 1 && n <= PLANTABLE.length) select(state.selected === PLANTABLE[n - 1] ? null : PLANTABLE[n - 1]);
  else if (e.key === 'Escape') select(null);
  else if (e.key === ' ') { e.preventDefault(); setPlaying(!state.playing); }
  else if (e.key === 't' || e.key === 'T') setLapse(!state.lapse);
});

// --- výběr políčka a sázení -----------------------------------------------------

const raycaster = new THREE.Raycaster();
const pointer = { x: 0, y: 0, ndc: new THREE.Vector2(), inside: false, dirty: false, downX: 0, downY: 0, down: false };
let hover = null;
const tip = $('tip');

const canvas = renderer.domElement;
canvas.addEventListener('pointermove', (e) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.inside = true;
  pointer.dirty = true;
});
canvas.addEventListener('pointerleave', () => {
  pointer.inside = false;
  pointer.dirty = true;
});
canvas.addEventListener('pointerdown', (e) => {
  pointer.down = true;
  pointer.downX = e.clientX;
  pointer.downY = e.clientY;
});
canvas.addEventListener('pointerup', (e) => {
  if (!pointer.down) return;
  pointer.down = false;
  if (Math.hypot(e.clientX - pointer.downX, e.clientY - pointer.downY) > 6) return;
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.inside = true;
  pick();
  if (hover && state.selected) plant(hover.tile, hover.point);
});

function pick() {
  pointer.dirty = false;
  hover = null;
  if (pointer.inside) {
    pointer.ndc.set((pointer.x / window.innerWidth) * 2 - 1, -(pointer.y / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer.ndc, camera);
    const hit = raycaster.intersectObject(board.mesh, false)[0];
    const tile = hit && board.tileAt(hit.point.x, hit.point.z);
    if (tile) hover = { tile, point: hit.point };
  }
  updateHover();
}

function updateHover() {
  if (!hover) {
    ring.visible = false;
    tip.hidden = true;
    return;
  }
  const t = hover.tile;
  const problem = state.selected ? flora.canPlant(board, t, state.selected) : null;
  ring.visible = true;
  ring.position.set(t.x, (t.type === 'voda' ? 0.43 : t.h) + 0.015, t.z);
  ring.material.color.set(problem ? '#ffb0a0' : '#ffffff');
  tip.hidden = false;
  tip.innerHTML = `<b>${TILE_TYPES[t.type].name}</b> · vlhkost ${Math.round(t.moisture * 100)} %`
    + (problem ? `<br><span class="bad">${problem}</span>` : '');
  tip.style.left = `${pointer.x}px`;
  tip.style.top = `${pointer.y}px`;
}

function plant(tile, point) {
  const id = state.selected;
  if (flora.canPlant(board, tile, id)) return;
  const p = flora.place(board, tile, id, { x: point.x, z: point.z });
  if (!p) return;
  particles.burst.spawn(p.x, p.y, p.z, SPECIES[id].kind === 'tree' ? 34 : 18);
  $('hint').classList.add('gone');
  updateHover();
}

// --- smyčka ---------------------------------------------------------------------

function fitCamera() {
  // Na výšku rozšíříme zorný úhel a couvneme tak, aby se ostrov vešel na šířku.
  const aspect = window.innerWidth / window.innerHeight;
  camera.fov = aspect < 1 ? 42 : 30;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
  const hHalf = Math.atan(Math.tan(vHalf) * aspect);
  const dist = Math.max(13 / Math.tan(hHalf), 11 / Math.tan(vHalf));
  controls.maxDistance = Math.max(58, dist * 1.25);
  const dir = camera.position.clone().sub(controls.target).normalize();
  camera.position.copy(controls.target).addScaledVector(dir, dist);
}

window.addEventListener('resize', () => {
  fitCamera();
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight);
  setPointScale(window.innerHeight, renderer.getPixelRatio(), camera.fov);
});

const clock = new THREE.Clock();
let first = true;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  state.time += dt;
  stepTime(dt);
  if (palette.set(state.season)) applyPalette();

  shared.uTime.value = state.time;
  sky.update(state.tod, palette, state.time);
  renderer.toneMappingExposure = 1.05 + sky.darkness * 0.45;
  clouds.update(dt, state.time, sky);
  flora.update(dt, palette);
  particles.update(dt, state.time, palette, sky);

  if (pointer.dirty) pick();
  if (ring.visible) ring.material.opacity = 0.45 + Math.sin(state.time * 4) * 0.15;

  controls.update();
  post.render(state.time);
  updateClockUI();

  if (first) {
    first = false;
    $('loading').classList.add('done');
  }
}

renderer.setAnimationLoop(frame);

// Pro ladění z konzole.
window.paseka = { state, board, flora, palette, SEASONS, renderer, camera, controls };
