// Tribuna u startu: diváci (pohyb počítá vertex shader, takže stojí jen pár uniformů), bába s buchtou a oslavy.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp } from './rng.js';

const STAND_LEN = 70;
const ROWS = 7;
const GRANNY_Z = -8; // vedle startovního roštu, ať ji jde vidět už při odpočtu
const seatX = (r) => -(1.2 + r * 1.6) + 0.05;
const seatY = (r) => 0.9 + r * 0.9 + 0.3;
const ni = (g) => (g.index ? g.toNonIndexed() : g);

// strana s víc místem
function standSide(track, terrain) {
  const probe = (side) => {
    const p = track.pointS(0, side * (track.edge + 30));
    return terrain.distAt(p[0], p[2]);
  };
  return probe(1) >= probe(-1) ? 1 : -1;
}

// půdorys tribuny se střechou a rezervou na koruny stromů
export function standArea(track, terrain) {
  const side = standSide(track, terrain);
  const base = track.pointS(-10, side * (track.edge + 3));
  const sin = Math.sin(track.hd[0]), cos = Math.cos(track.hd[0]);
  return (x, z) => {
    const dx = x - base[0], dz = z - base[2];
    const away = -side * (dx * cos - dz * sin); // od trati
    return Math.abs(dx * sin + dz * cos) < STAND_LEN / 2 + 7 && away > -3 && away < 21;
  };
}

// --- diváci -----------------------------------------------------------------

const PART = { shirt: 0, skin: 1, hair: 2, legs: 3, flag: 4 };

function tagged(geo, part, arm = 0) {
  const g = ni(geo);
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
  g.setAttribute('aArm', new THREE.BufferAttribute(new Float32Array(n).fill(arm), 1));
  return g;
}

// list vlajky natočený šikmo, aby byl vidět z trati; dvě strany místo oboustranného materiálu
function flagGeometry(back) {
  return new THREE.PlaneGeometry(0.62, 0.36, 3, 1).rotateY(back).translate(0.31, -0.42, 0).rotateY(-0.8).translate(0.02, 0, 0.21);
}

// sedící postava čelem k trati (+x), počátek na sedáku
function spectatorGeometry(detail) {
  const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const parts = [
    tagged(new THREE.CylinderGeometry(0.15, 0.19, 0.5, 6).translate(0, 0.27, 0), PART.shirt),
    tagged(new THREE.SphereGeometry(0.125, 7, 5).translate(0, 0.66, 0), PART.skin),
    tagged(new THREE.SphereGeometry(0.135, 7, 3, 0, Math.PI * 2, 0, 1.5).rotateZ(0.35).translate(-0.015, 0.67, 0), PART.hair),
  ];
  if (detail) {
    for (const s of [1, -1]) {
      parts.push(
        tagged(box(0.09, 0.27, 0.09, 0.02, 0.37, s * 0.21), PART.shirt, s),
        tagged(box(0.075, 0.17, 0.075, 0.02, 0.15, s * 0.21), PART.skin, s),
        tagged(box(0.36, 0.13, 0.13, 0.17, 0.03, s * 0.1), PART.legs),
        tagged(box(0.12, 0.42, 0.12, 0.34, -0.17, s * 0.1), PART.legs),
      );
    }
    // vlajka v pravé ruce; kdo žádnou nemá, tomu shader tyto vrcholy smrskne
    parts.push(
      tagged(box(0.02, 0.8, 0.02, 0.02, -0.2, 0.21), PART.legs, 1),
      tagged(flagGeometry(0), PART.flag, 1),
      tagged(flagGeometry(Math.PI), PART.flag, 1),
    );
  }
  return mergeGeometries(parts);
}

const crowdShaderHead = /* glsl */ `
  attribute float aPart;
  attribute float aArm;
  attribute vec3 aSkin;
  attribute vec3 aHair;
  attribute vec3 aSeat; // poloha podél tribuny, fáze, vlajka
  uniform float uTime;
  uniform float uWave;
  uniform float uWaveOn;
  uniform float uCheer;
`;

const crowdShaderPose = /* glsl */ `
  vec3 transformed = vec3(position);
  float wave = (aSeat.x - uWave) / 4.5;
  float jump = uCheer * (0.5 + 0.5 * sin(uTime * 9.0 + aSeat.y * 6.283));
  float up = max(uWaveOn * exp(-wave * wave), jump);
  float flag = aSeat.z;
  bool flagPart = aPart > 3.5 || (aPart > 2.5 && aArm != 0.0);
  if (flagPart) {
    transformed *= flag;
    if (aPart > 3.5) transformed.z += sin(uTime * 7.0 + transformed.x * 7.0 + aSeat.y * 6.283) * 0.07 * flag;
  }
  if (aArm != 0.0) {
    // paže se zvedá kolem ramene; s vlajkou je pravá ruka nahoře pořád
    float raise = max(up, flag * step(0.0, aArm) * (0.8 + 0.1 * sin(uTime * 3.0 + aSeat.y * 6.283)));
    float a = raise * 2.85 * aArm;
    float c = cos(a), s = sin(a);
    vec2 p = transformed.zy - vec2(aArm * 0.21, 0.5);
    transformed.zy = vec2(aArm * 0.21, 0.5) + vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  }
  transformed.y += up * 0.3 + sin(uTime * 2.1 + aSeat.y * 6.283) * 0.012;
  transformed.z += sin(uTime * 1.3 + aSeat.y * 11.0) * 0.02;
`;

const crowdShaderColor = /* glsl */ `
  #include <color_vertex>
  if (aPart > 0.5 && aPart < 1.5) vColor = aSkin;
  else if (aPart > 1.5 && aPart < 2.5) vColor = aHair;
  else if (aPart > 2.5 && aPart < 3.5) vColor = vec3(0.08, 0.09, 0.13);
`;

function buildCrowd(rng, len, quality) {
  const detail = quality !== 'low';
  const perRow = 60;
  const geo = spectatorGeometry(detail);
  const max = ROWS * perRow;
  const seat = new Float32Array(max * 3), skin = new Float32Array(max * 3), hair = new Float32Array(max * 3);
  const uniforms = { uTime: { value: 0 }, uWave: { value: 0 }, uWaveOn: { value: 0 }, uCheer: { value: 0 } };
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = crowdShaderHead + sh.vertexShader
      .replace('#include <begin_vertex>', crowdShaderPose)
      .replace('#include <color_vertex>', crowdShaderColor);
  };
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  const shirts = ['#d7263d', '#f2c230', '#2c6fd1', '#ffffff', '#1f9d55', '#f07b2c', '#222222', '#b14fc5'];
  const skins = ['#f2c7a5', '#e6b48c', '#c98f63', '#8d5a3a', '#f5d4bb'];
  const hairs = ['#2a1b12', '#5b3a1e', '#a6702f', '#101010', '#c9c4bb', '#d7263d'];
  let i = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let j = 0; j < perRow; j++) {
      if (rng.chance(quality === 'low' ? 0.5 : 0.25)) continue;
      const z = -len / 2 + 1 + j * ((len - 2) / perRow) + rng.range(-0.2, 0.2);
      if (r === 0 && Math.abs(z - GRANNY_Z) < 1) continue;
      m.makeRotationY(rng.range(-0.25, 0.25));
      m.setPosition(seatX(r), seatY(r), z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.set(rng.pick(shirts)));
      seat.set([z + r * 2.2, rng.next(), rng.chance(0.09) ? 1 : 0], i * 3);
      c.set(rng.pick(skins)).toArray(skin, i * 3);
      c.set(rng.pick(hairs)).toArray(hair, i * 3);
      i++;
    }
  }
  mesh.count = i;
  geo.setAttribute('aSeat', new THREE.InstancedBufferAttribute(seat, 3));
  geo.setAttribute('aSkin', new THREE.InstancedBufferAttribute(skin, 3));
  geo.setAttribute('aHair', new THREE.InstancedBufferAttribute(hair, 3));
  mesh.computeBoundingSphere();
  mesh.boundingSphere.radius += 2;
  return { mesh, uniforms };
}

// --- bába --------------------------------------------------------------------

function vertexPainted(geo, hex) {
  const g = ni(geo);
  g.deleteAttribute('uv');
  const c = new THREE.Color(hex), n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(col, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function bunGeometry() {
  return mergeGeometries([
    vertexPainted(new THREE.SphereGeometry(0.22, 9, 6).scale(1.2, 0.72, 1), '#d9933f'),
    vertexPainted(new THREE.SphereGeometry(0.2, 9, 4, 0, Math.PI * 2, 0, 1).scale(1.2, 0.74, 1).translate(0, 0.012, 0), '#a8622a'),
    vertexPainted(new THREE.SphereGeometry(0.055, 6, 4).translate(0.03, 0.17, 0.02), '#f6e8c8'),
  ]);
}

const paintedMat = () => new THREE.MeshLambertMaterial({ vertexColors: true });

// stojí v první řadě a mává buchtou, ať ji jde z trati poznat
function buildGranny() {
  const body = new THREE.Group();
  const still = mergeGeometries([
    vertexPainted(new THREE.CylinderGeometry(0.17, 0.33, 0.92, 8).translate(0, 0.46, 0), '#3f6e9c'),
    vertexPainted(new THREE.CylinderGeometry(0.2, 0.2, 0.3, 8).translate(0.02, 0.56, 0), '#f4efe3'),
    vertexPainted(new THREE.SphereGeometry(0.15, 8, 6).translate(0.02, 1.06, 0), '#f0c6a6'),
    // šátek uvázaný pod bradou
    vertexPainted(new THREE.SphereGeometry(0.175, 8, 5, 0, Math.PI * 2, 0, 1.75).rotateZ(0.4).translate(-0.015, 1.07, 0), '#d7263d'),
    vertexPainted(new THREE.ConeGeometry(0.1, 0.16, 4).translate(-0.17, 0.95, 0), '#d7263d'),
    vertexPainted(new THREE.BoxGeometry(0.08, 0.34, 0.08).translate(0, 0.62, -0.26), '#3f6e9c'),
  ]);
  const torso = new THREE.Mesh(still, paintedMat());
  body.add(torso);
  const arm = new THREE.Group();
  arm.position.set(0.02, 0.8, 0.22);
  const sleeve = new THREE.Mesh(vertexPainted(new THREE.BoxGeometry(0.09, 0.46, 0.09).translate(0, 0.21, 0), '#3f6e9c'), torso.material);
  const bun = new THREE.Mesh(bunGeometry(), torso.material);
  bun.position.y = 0.55;
  bun.scale.setScalar(1.25);
  arm.add(sleeve, bun);
  body.add(arm);
  body.scale.setScalar(1.25);
  return { body, arm, bun };
}

function bannerTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#f4efe3';
  g.fillRect(0, 0, 1024, 128);
  g.fillStyle = '#b3261e';
  g.fillRect(0, 8, 1024, 6);
  g.fillRect(0, 114, 1024, 6);
  g.font = 'italic 700 80px "Chakra Petch", "Arial Narrow", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('BÁBINY BUCHTY', 512, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// --- konfety -----------------------------------------------------------------

const CONFETTI_TIME = 5;

// let počítá vertex shader, takže za běhu stojí jediný draw call a mimo oslavu nic
class Confetti {
  constructor(count, rng) {
    const geo = new THREE.PlaneGeometry(0.2, 0.28);
    const drop = new Float32Array(count * 3), spin = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * 15;
      drop.set([Math.cos(a) * r, Math.sin(a) * r, rng.range(0, 1.7)], i * 3);
      spin.set([rng.range(5, 12), rng.range(0, 6.28), rng.range(0.25, 0.9)], i * 3);
    }
    geo.setAttribute('aDrop', new THREE.InstancedBufferAttribute(drop, 3));
    geo.setAttribute('aSpin', new THREE.InstancedBufferAttribute(spin, 3));
    this.uniforms = { uT: { value: 0 }, uCenter: { value: new THREE.Vector3() } };
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = `
        attribute vec3 aDrop; // x, z, zpoždění
        attribute vec3 aSpin; // rychlost, fáze, houpání
        uniform float uT;
        uniform vec3 uCenter;
      ` + sh.vertexShader
        .replace('#include <color_vertex>', `
          float ct = max(0.0, uT - aDrop.z);
          float ca = ct * aSpin.x + aSpin.y;
          #include <color_vertex>
          vColor *= 0.55 + 0.45 * abs(cos(ca));
        `)
        .replace('#include <begin_vertex>', `
          float h = 13.0 - ct * 4.2;
          vec3 transformed = vec3(position) * step(0.001, ct) * step(0.0, h);
          transformed.yz = mat2(cos(ca), sin(ca), -sin(ca), cos(ca)) * transformed.yz;
          transformed.xz = mat2(cos(aSpin.y), sin(aSpin.y), -sin(aSpin.y), cos(aSpin.y)) * transformed.xz;
          transformed += uCenter + vec3(aDrop.x + sin(ct * 1.9 + aSpin.y) * aSpin.z, h, aDrop.y + cos(ct * 1.6 + aSpin.y) * aSpin.z);
        `);
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    const m = new THREE.Matrix4(), c = new THREE.Color();
    const colors = ['#ff4034', '#ffcc1a', '#3399ff', '#33e666', '#ffffff', '#cc4dff'];
    for (let i = 0; i < count; i++) {
      this.mesh.setMatrixAt(i, m);
      this.mesh.setColorAt(i, c.set(colors[i % colors.length]));
    }
    this.car = null;
  }

  fire(car) {
    this.car = car;
    this.uniforms.uT.value = 0;
    this.follow();
    this.mesh.visible = true;
  }

  // auto po cíli ještě dojíždí: déšť drží před ním, jinak by zůstal za kamerou
  follow() {
    const c = this.car;
    this.uniforms.uCenter.value.set(c.x + c.vx * 0.5, c.y, c.z + c.vz * 0.5);
  }

  stop() {
    this.car = null;
    this.mesh.visible = false;
  }

  update(dt) {
    if (!this.car) return;
    const u = this.uniforms;
    u.uT.value += dt;
    this.follow();
    if (u.uT.value > CONFETTI_TIME) this.stop();
  }
}

// --- tribuna -----------------------------------------------------------------

const FLASH_LIFE = 0.13;

export class Stand {
  constructor(track, terrain, rng, quality) {
    const side = standSide(track, terrain);
    this.rng = rng;
    this.time = 0;
    this.cheerTimer = 0;
    this.flashAcc = 0;
    this.bunFlight = null;
    this.root = new THREE.Group();
    const group = new THREE.Group();
    this.group = group;
    const base = track.pointS(-10, side * (track.edge + 3));
    group.position.set(base[0], base[1] - 0.3, base[2]);
    // lokální +z = směr trati, lokální -x = pravá strana trati; řady stoupají do -x
    group.rotation.y = track.hd[0];
    const len = STAND_LEN;
    const concrete = new THREE.MeshLambertMaterial({ color: 0x9aa0a6 });
    const seatsMat = new THREE.MeshLambertMaterial({ color: 0x2f5fa8 });
    const parts = [];
    for (let r = 0; r < ROWS; r++) {
      const g = new THREE.BoxGeometry(1.6, 0.9 + r * 0.9, len);
      g.translate(-(1.2 + r * 1.6), (0.9 + r * 0.9) / 2, 0);
      parts.push(g);
    }
    const stand = new THREE.Mesh(mergeGeometries(parts), concrete);
    stand.castShadow = stand.receiveShadow = true;
    // pro levou stranu tribunu zrcadlíme
    const flip = new THREE.Group();
    this.flip = flip;
    flip.scale.x = side > 0 ? 1 : -1;
    flip.add(stand);
    // sedačky (tenké pruhy)
    const seatParts = [];
    for (let r = 0; r < ROWS; r++) {
      const g = new THREE.BoxGeometry(0.5, 0.35, len - 1);
      g.translate(-(1.2 + r * 1.6) + 0.35, 0.9 + r * 0.9 + 0.15, 0);
      seatParts.push(g);
    }
    flip.add(new THREE.Mesh(mergeGeometries(seatParts), seatsMat));
    const crowd = buildCrowd(rng, len, quality);
    this.uniforms = crowd.uniforms;
    flip.add(crowd.mesh);
    // střecha
    const roofH = 0.9 + ROWS * 0.9 + 3.2;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(ROWS * 1.6 + 2.5, 0.35, len + 2), new THREE.MeshLambertMaterial({ color: 0xe8e8e8 }));
    roof.position.set(-(ROWS * 1.6) / 2 - 0.4, roofH, 0);
    roof.castShadow = true;
    flip.add(roof);
    const postGeo = new THREE.BoxGeometry(0.3, roofH, 0.3);
    for (let z = -len / 2; z <= len / 2; z += len / 5) {
      const post = new THREE.Mesh(postGeo, concrete);
      post.position.set(-0.4, roofH / 2, z);
      flip.add(post);
    }
    // bába a její transparent pod střechou (text nezrcadlíme, proto mimo flip)
    this.granny = buildGranny();
    this.granny.body.position.set(-0.8, 1.2, GRANNY_Z);
    flip.add(this.granny.body);
    group.add(flip);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(14, 1.75), new THREE.MeshLambertMaterial({ map: bannerTexture() }));
    banner.position.set(side * 0.9, roofH - 0.7, GRANNY_Z);
    banner.rotation.y = (side * Math.PI) / 2;
    group.add(banner);
    // buchta v letu
    this.bun = new THREE.Mesh(this.granny.bun.geometry, this.granny.bun.material);
    this.bun.scale.setScalar(1.8);
    this.bun.visible = false;
    this.confetti = new Confetti(quality === 'low' ? 160 : 420, rng);
    this.root.add(group, this.bun, this.confetti.mesh);
  }

  // nový závod: bába má zase buchtu a tribuna je v klidu
  reset() {
    this.cheerTimer = 0;
    this.bunFlight = null;
    this.confetti.stop();
    this.bun.visible = false;
    this.granny.bun.visible = true;
  }

  // závěrečná oslava: fanoušci vstanou, cvakají foťáky a kolem auta prší konfety
  celebrate(car, seconds) {
    this.cheerTimer = seconds;
    this.confetti.fire(car);
  }

  // bába hodí buchtu na auto vítěze; onHit se zavolá při dopadu
  throwBun(car, onHit) {
    this.granny.bun.getWorldPosition(this.bun.position);
    this.granny.bun.visible = false;
    this.bun.visible = true;
    this.bunFlight = { t: 0, car, onHit, x: this.bun.position.x, y: this.bun.position.y, z: this.bun.position.z };
  }

  flash(effects) {
    const rng = this.rng;
    const r = Math.floor(rng.range(0, ROWS));
    const p = new THREE.Vector3(seatX(r), seatY(r) + 0.7, rng.range(-STAND_LEN / 2, STAND_LEN / 2));
    this.flip.localToWorld(p);
    effects.glow.emit(p.x, p.y, p.z, 0, 0, 0, FLASH_LIFE, 2.4, 0.5, 1, 0.97, 0.9, 1, 0, 0);
  }

  // race = běžící závod, mimo něj null
  update(dt, race, effects) {
    const u = this.uniforms;
    this.time += dt;
    u.uTime.value = this.time;
    // vlna běží stále dokola; je vidět, jen když některý hráč vede
    const leading = race && race.state === 'running' && race.cars.length > 1 && race.players.some((c) => c.place === 1 && !c.finished);
    u.uWaveOn.value += ((leading ? 1 : 0) - u.uWaveOn.value) * Math.min(1, dt * 3);
    u.uWave.value = ((this.time * 25) % 125) - 52;
    this.cheerTimer = Math.max(0, this.cheerTimer - dt);
    u.uCheer.value += ((this.cheerTimer > 0 ? 1 : 0) - u.uCheer.value) * Math.min(1, dt * 4);
    // foťáky: záplava v cíli, pár blesků pro vedoucího
    const rate = this.cheerTimer > 0 ? 26 : u.uWaveOn.value > 0.5 ? 3 : 0;
    this.flashAcc += rate * dt;
    while (this.flashAcc >= 1) {
      this.flashAcc -= 1;
      this.flash(effects);
    }
    this.granny.arm.rotation.x = 0.75 + Math.sin(this.time * 7) * (this.cheerTimer > 0 || leading ? 0.45 : 0.25);
    this.confetti.update(dt);
    const b = this.bunFlight;
    if (!b) return;
    if (!race) {
      this.reset();
      return;
    }
    b.t = Math.min(1, b.t + dt / 1.05);
    const t = b.t, car = b.car;
    this.bun.position.set(b.x + (car.x - b.x) * t, b.y + (car.y + 1.1 - b.y) * t + Math.sin(t * Math.PI) * 11, b.z + (car.z - b.z) * t);
    this.bun.rotation.x += dt * 11;
    this.bun.rotation.z += dt * 7;
    if (t >= 1) {
      this.bunFlight = null;
      this.bun.visible = false;
      b.onHit();
    }
  }
}

// --- sněhuláci -------------------------------------------------------------------

const TURN_RANGE = 75;
const TURN_MAX = 1.7; // víc hlava nedovolí

// hlavy se otáčejí za autem; items = { x, y, z, ry, s } každého sněhuláka
export class SnowmanHeads {
  constructor(geo, mat, items) {
    this.items = items.map((it) => ({ ...it, turn: 0 }));
    this.mesh = new THREE.InstancedMesh(geo, mat, items.length);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.matrix = new THREE.Matrix4();
    this.items.forEach((it, i) => this.write(it, i));
  }

  write(it, i) {
    this.matrix.makeRotationY(it.ry + it.turn).scale(new THREE.Vector3(it.s, it.s, it.s)).setPosition(it.x, it.y, it.z);
    this.mesh.setMatrixAt(i, this.matrix);
  }

  update(dt, x, z) {
    let moved = false;
    const k = Math.min(1, dt * 6);
    this.items.forEach((it, i) => {
      const dx = x - it.x, dz = z - it.z;
      let want = 0;
      if (dx * dx + dz * dz < TURN_RANGE * TURN_RANGE) {
        let d = Math.atan2(dx, dz) - it.ry;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        want = clamp(d, -TURN_MAX, TURN_MAX);
      }
      if (Math.abs(want - it.turn) < 0.002) return;
      it.turn += (want - it.turn) * k;
      this.write(it, i);
      moved = true;
    });
    if (moved) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
