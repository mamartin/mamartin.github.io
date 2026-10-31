// Trať: středová čára + dotazy pro fyziku/AI + 3D geometrie silnice.
import * as THREE from 'three';
import { buildCenterline, smoothCircular, Cut } from './trackmath.js';
import { clamp, angleDiff, RNG } from './rng.js';
import { BIOMES, WET_GRIP } from './biomes.js';

export const SURF_ROAD = 0, SURF_CURB = 1, SURF_OFF = 2;

export class Track {
  constructor(def) {
    this.def = def;
    this.hw = def.width / 2;
    this.runoff = def.runoff;
    this.edge = this.hw + this.runoff;
    this.curbW = 1.3;
    Object.assign(this, buildCenterline(def));
    this.tanBank = Float32Array.from(this.bank, Math.tan);
    this.curbMask = this.computeCurbs();
    this.buildRacingLine();
    // AI počítá s přilnavostí povrchu (na sněhu jede opatrněji)
    this.roadGrip = (BIOMES[def.biome]?.roadGrip ?? 1) * (def.wet ? WET_GRIP : 1);
    this.speedProfile = this.computeSpeedProfile(22 * this.roadGrip, 19 * this.roadGrip, 60);
    this.profiles = new Map([['car', this.speedProfile]]);
    this.cuts = def.cut ? [new Cut(this, def.cut)] : [];
    this.tunnels = (def.tunnels || []).map(([from, to]) => {
      const a = this.project(from[0], from[1], -1, {}).s, b = this.project(to[0], to[1], -1, {}).s;
      const fwd = ((b - a + this.L) % this.L) < this.L / 2;
      const s0 = fwd ? a : b;
      return { s0, len: (fwd ? b - a + this.L : a - b + this.L) % this.L };
    });
  }

  // mezera ve svodidle pro zkratku (null = plné svodidlo)
  cutAt(s, side) {
    for (const c of this.cuts) if (c.inGap(s, side)) return c;
    return null;
  }

  inTunnel(s) {
    return this.tunnels.some((t) => ((s - t.s0 + this.L) % this.L) < t.len);
  }

  // rychlostní profil pro jiný typ vozu: přilnavost a maximálka poměrem k autu
  speedProfileFor(kind, gripMul = 1, vmaxMul = 1) {
    if (!this.profiles.has(kind)) {
      this.profiles.set(kind, this.computeSpeedProfile(22 * this.roadGrip * gripMul, 19 * this.roadGrip, 60 * vmaxMul));
    }
    return this.profiles.get(kind);
  }

  // --- dotazy -------------------------------------------------------------

  // Najde nejbližší místo na trati. hint = index z minula (lokální hledání).
  project(x, z, hint = -1, out = {}) {
    const N = this.N, px = this.px, pz = this.pz;
    let best = 0, bestD = Infinity;
    if (hint < 0) {
      for (let k = 0; k < N; k++) {
        const dx = x - px[k], dz = z - pz[k];
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = k; }
      }
    } else {
      for (let o = -40; o <= 40; o++) {
        const k = (hint + o + N) % N;
        const dx = x - px[k], dz = z - pz[k];
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = k; }
      }
    }
    // zpřesnění na úsečce best -> best+1, případně best-1 -> best
    let i0 = best, i1 = (best + 1) % N;
    let u = this.segU(i0, i1, x, z);
    if (u < 0) {
      i0 = (best - 1 + N) % N;
      i1 = best;
      u = this.segU(i0, i1, x, z);
    }
    u = clamp(u, 0, 1);
    this.fillAt(i0, i1, u, out);
    const lat = (x - out.cx) * out.rx + (z - out.cz) * out.rz;
    out.lat = lat;
    out.y = out.cy + lat * out.tanBank;
    return out;
  }

  segU(i0, i1, x, z) {
    const ax = this.px[i0], az = this.pz[i0];
    const dx = this.px[i1] - ax, dz = this.pz[i1] - az;
    const l2 = dx * dx + dz * dz || 1;
    return ((x - ax) * dx + (z - az) * dz) / l2;
  }

  fillAt(i0, i1, u, out) {
    const s0 = this.s[i0];
    const s1 = i1 === 0 ? this.L : this.s[i1];
    out.i = i0;
    out.u = u;
    out.s = s0 + (s1 - s0) * u;
    out.cx = this.px[i0] + (this.px[i1] - this.px[i0]) * u;
    out.cy = this.py[i0] + (this.py[i1] - this.py[i0]) * u;
    out.cz = this.pz[i0] + (this.pz[i1] - this.pz[i0]) * u;
    out.hd = this.hd[i0] + angleDiff(this.hd[i0], this.hd[i1]) * u;
    out.rx = -Math.cos(out.hd);
    out.rz = Math.sin(out.hd);
    out.tanBank = this.tanBank[i0] + (this.tanBank[i1] - this.tanBank[i0]) * u;
    out.bank = Math.atan(out.tanBank);
    out.grade = this.grade[i0] + (this.grade[i1] - this.grade[i0]) * u;
    out.kappa = this.kappaS[i0];
    return out;
  }

  indexAt(s) {
    s = ((s % this.L) + this.L) % this.L;
    let k = Math.min(this.N - 1, Math.floor(s / this.step));
    while (k > 0 && this.s[k] > s) k--;
    while (k < this.N - 1 && this.s[k + 1] <= s) k++;
    return k;
  }

  // Bod na trati ve vzdálenosti s s bočním offsetem lat.
  sampleAt(s, lat = 0, out = {}) {
    s = ((s % this.L) + this.L) % this.L;
    const i0 = this.indexAt(s);
    const i1 = (i0 + 1) % this.N;
    const s1 = i1 === 0 ? this.L : this.s[i1];
    const u = (s - this.s[i0]) / (s1 - this.s[i0] || 1);
    this.fillAt(i0, i1, clamp(u, 0, 1), out);
    out.x = out.cx + out.rx * lat;
    out.z = out.cz + out.rz * lat;
    out.lat = lat;
    out.y = out.cy + lat * out.tanBank;
    return out;
  }

  surfaceAt(lat) {
    const a = Math.abs(lat);
    if (a <= this.hw) return SURF_ROAD;
    if (a <= this.hw + this.curbW) return SURF_CURB;
    return SURF_OFF;
  }

  // --- AI data ------------------------------------------------------------

  buildRacingLine() {
    const N = this.N;
    const kw = smoothCircular(this.kappa, 16);
    const A = new Float64Array(N);
    for (let k = 0; k < N; k++) A[k] = clamp(kw[k] * 55, -1, 1);
    const W = this.hw - 2.3;
    const shift = Math.round(34 / this.step);
    const line = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      const a = A[k];
      const ahead = A[(k + shift) % N];
      const behind = A[(k - shift + N) % N];
      const free = 1 - Math.abs(a);
      line[k] = clamp(-a * W + 0.55 * free * (ahead + behind) * W, -W, W);
    }
    this.racingLat = Float32Array.from(smoothCircular(line, 10));
  }

  // Maximální rychlost v každém bodě s ohledem na zatáčky a brzdnou dráhu.
  computeSpeedProfile(grip, brake, vmax) {
    const N = this.N;
    const k3 = smoothCircular(this.kappa, 4);
    const v = new Float32Array(N);
    for (let k = 0; k < N; k++) v[k] = Math.min(vmax, Math.sqrt(grip / Math.max(Math.abs(k3[k]), 1e-4)));
    for (let pass = 0; pass < 2; pass++) {
      for (let k = N - 1; k >= 0; k--) {
        const n = (k + 1) % N;
        const lim = Math.sqrt(v[n] * v[n] + 2 * brake * this.step);
        if (lim < v[k]) v[k] = lim;
      }
    }
    return v;
  }

  computeCurbs() {
    const N = this.N;
    const mask = new Uint8Array(N);
    for (let k = 0; k < N; k++) mask[k] = Math.abs(this.kappaS[k]) > 0.0065 ? 1 : 0;
    // roztáhni obrubníky trochu před a za zatáčku
    const grow = 5;
    const out = new Uint8Array(N);
    for (let k = 0; k < N; k++) {
      if (!mask[k]) continue;
      for (let o = -grow; o <= grow; o++) out[(k + o + N) % N] = 1;
    }
    return out;
  }

  // --- geometrie ------------------------------------------------------------

  point(k, lat, dy = 0, target = [0, 0, 0]) {
    target[0] = this.px[k] + this.rx[k] * lat;
    target[1] = this.py[k] + lat * this.tanBank[k] + dy;
    target[2] = this.pz[k] + this.rz[k] * lat;
    return target;
  }

  pointS(s, lat, dy = 0) {
    const o = this.sampleAt(s, lat, this._tmpS || (this._tmpS = {}));
    return [o.x, o.y + dy, o.z];
  }

  buildMeshes(style, anisotropy = 4, quality = 'high') {
    const group = new THREE.Group();
    group.name = 'track';
    const N = this.N;
    const hw = this.hw, edge = this.edge, cw = this.curbW;

    // Silnice
    const { map: roadTex, surface } = makeRoadTextures(style, quality);
    roadTex.anisotropy = anisotropy;
    const road = new StripBuilder();
    const tile = ROAD_TILE;
    for (let k = 0; k < N; k++) {
      const n = (k + 1) % N;
      const v0 = this.s[k] / tile;
      const v1 = (n === 0 ? this.L : this.s[n]) / tile;
      road.quad(
        this.point(k, -hw), this.point(k, hw), this.point(n, hw), this.point(n, -hw),
        null,
        [0, v0, 1, v0, 1, v1, 0, v1],
      );
    }
    const roadMat = this.roadMaterial(style, roadTex, surface, anisotropy);
    const roadMesh = new THREE.Mesh(road.build(), roadMat);
    roadMesh.receiveShadow = true;
    group.add(roadMesh, this.buildRubber());

    // Obrubníky (jen v zatáčkách) – červenobílé pruhy
    const curb = new StripBuilder();
    const cA = new THREE.Color(style.curbA), cB = new THREE.Color(style.curbB);
    for (let k = 0; k < N; k++) {
      const n = (k + 1) % N;
      if (!this.curbMask[k]) continue;
      const c = Math.floor(this.s[k] / 3) % 2 ? cA : cB;
      for (const side of [-1, 1]) {
        const a = side * hw, b = side * (hw + cw);
        const q = side > 0
          ? [this.point(k, a, 0.02), this.point(k, b, 0.07), this.point(n, b, 0.07), this.point(n, a, 0.02)]
          : [this.point(k, b, 0.07), this.point(k, a, 0.02), this.point(n, a, 0.02), this.point(n, b, 0.07)];
        curb.quad(q[0], q[1], q[2], q[3], c);
      }
    }
    if (curb.count) {
      const m = new THREE.Mesh(curb.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
      m.receiveShadow = true;
      group.add(m);
    }

    // Krajnice (tráva / písek / chodník) až ke svodidlům + zástěra dolů
    const sh = new StripBuilder();
    const shA = new THREE.Color(style.shoulderA), shB = new THREE.Color(style.shoulderB);
    const skirt = new THREE.Color(style.shoulderA).multiplyScalar(0.6);
    for (let k = 0; k < N; k++) {
      const n = (k + 1) % N;
      const col = Math.floor(this.s[k] / 5) % 2 ? shA : shB;
      for (const side of [-1, 1]) {
        const inner = this.curbMask[k] && this.curbMask[n] ? hw + cw : hw;
        const a = side * inner, b = side * edge;
        if (side > 0) sh.quad(this.point(k, a), this.point(k, b), this.point(n, b), this.point(n, a), col);
        else sh.quad(this.point(k, b), this.point(k, a), this.point(n, a), this.point(n, b), col);
        // zástěra na vnějším okraji, aby nebyla vidět mezera k terénu
        const e = side * edge;
        if (side > 0) sh.quad(this.point(k, e), this.point(k, e, -3), this.point(n, e, -3), this.point(n, e), skirt);
        else sh.quad(this.point(k, e, -3), this.point(k, e), this.point(n, e), this.point(n, e, -3), skirt);
      }
    }
    const shMesh = new THREE.Mesh(sh.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    shMesh.receiveShadow = true;
    group.add(shMesh);

    // Svodidla
    group.add(this.buildBarriers(style));

    // Start / cíl: šachovnice přes silnici
    const chk = new StripBuilder();
    chk.quad(this.point(N - 1, -hw, 0.03), this.point(N - 1, hw, 0.03), this.point(1, hw, 0.03), this.point(1, -hw, 0.03), null,
      [0, 0, 1, 0, 1, 1, 0, 1]);
    const chkMesh = new THREE.Mesh(chk.build(), new THREE.MeshLambertMaterial({ map: makeCheckerTexture(16, 2) }));
    chkMesh.receiveShadow = true;
    group.add(chkMesh);

    // Startovní pozice (bílé značky)
    const grid = new StripBuilder();
    const white = new THREE.Color(0xe8e8e8);
    for (let slot = 0; slot < 6; slot++) {
      const g = this.gridSlot(slot);
      const f0 = g.s + 2.7, f1 = g.s + 3.0;
      grid.quad(this.pointS(f0, g.lat - 1.3, 0.025), this.pointS(f0, g.lat + 1.3, 0.025),
        this.pointS(f1, g.lat + 1.3, 0.025), this.pointS(f1, g.lat - 1.3, 0.025), white);
      for (const side of [-1.3, 1.1]) {
        grid.quad(this.pointS(g.s - 1, g.lat + side, 0.025), this.pointS(g.s - 1, g.lat + side + 0.2, 0.025),
          this.pointS(f0, g.lat + side + 0.2, 0.025), this.pointS(f0, g.lat + side, 0.025), white);
      }
    }
    group.add(new THREE.Mesh(grid.build(), new THREE.MeshLambertMaterial({ vertexColors: true })));

    group.add(this.buildGantry(style));
    return group;
  }

  // Startovní rošt: dvě řady, střídavě vlevo / vpravo, 8 m od sebe.
  gridSlot(slot) {
    const row = slot;
    const lat = (slot % 2 === 0 ? -1 : 1) * Math.min(3.6, this.hw - 2.2);
    return { s: this.L - 9 - row * 7, lat };
  }

  buildBarriers(style) {
    const N = this.N, edge = this.edge;
    const b = new StripBuilder();
    const type = style.barrier;
    const h = type === 'rail' ? 0.85 : type === 'wall' ? 1.15 : 0.95;
    const bottom = type === 'rail' ? 0.45 : -2.5;
    const t = type === 'rail' ? 0.12 : type === 'wall' ? 0.45 : 0.6;
    const colA = new THREE.Color(style.barrierA), colB = new THREE.Color(style.barrierB);
    const top = new THREE.Color(style.barrierTop ?? style.barrierA);
    const period = style.barrierPeriod ?? 3;
    for (let k = 0; k < N; k++) {
      const n = (k + 1) % N;
      const seg = Math.floor(this.s[k] / (period * 2));
      const col = seg % 2 ? colA : colB;
      for (const side of [-1, 1]) {
        if (this.cutAt(this.s[k], side)) continue;
        const li = side * (edge + 0.05), lo = side * (edge + 0.05 + t);
        // vnitřní líc
        const q1 = [this.point(k, li, bottom), this.point(k, li, h), this.point(n, li, h), this.point(n, li, bottom)];
        // vrch
        const q2 = [this.point(k, li, h), this.point(k, lo, h), this.point(n, lo, h), this.point(n, li, h)];
        // vnější líc
        const q3 = [this.point(k, lo, h), this.point(k, lo, bottom), this.point(n, lo, bottom), this.point(n, lo, h)];
        if (side > 0) {
          b.quad(q1[0], q1[1], q1[2], q1[3], col);
          b.quad(q2[0], q2[1], q2[2], q2[3], top);
          b.quad(q3[0], q3[1], q3[2], q3[3], col);
        } else {
          b.quad(q1[3], q1[2], q1[1], q1[0], col);
          b.quad(q2[3], q2[2], q2[1], q2[0], top);
          b.quad(q3[3], q3[2], q3[1], q3[0], col);
        }
      }
    }
    const group = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: type === 'rail' ? THREE.DoubleSide : THREE.FrontSide });
    const mesh = new THREE.Mesh(b.build(), mat);
    mesh.castShadow = type !== 'rail';
    mesh.receiveShadow = true;
    group.add(mesh);

    if (type === 'rail') {
      // sloupky svodidel
      const every = 2;
      const count = Math.ceil(N / every) * 2;
      const geo = new THREE.BoxGeometry(0.12, 1.3, 0.12);
      geo.translate(0, 0.25, 0);
      const posts = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: style.postColor ?? 0x8a8f96 }), count);
      const m = new THREE.Matrix4();
      const p = [0, 0, 0];
      let i = 0;
      for (let k = 0; k < N; k += every) {
        for (const side of [-1, 1]) {
          if (this.cutAt(this.s[k], side)) continue;
          this.point(k, side * (edge + 0.2), 0, p);
          m.makeRotationY(this.hd[k]);
          m.setPosition(p[0], p[1], p[2]);
          posts.setMatrixAt(i++, m);
        }
      }
      posts.count = i;
      posts.computeBoundingSphere();
      group.add(posts);
    }
    return group;
  }

  buildGantry(style) {
    const g = new THREE.Group();
    const k = 0;
    const span = this.edge + 1.4;
    const metal = new THREE.MeshLambertMaterial({ color: style.gantry ?? 0x2b3140 });
    const pillarGeo = new THREE.BoxGeometry(0.8, 7.4, 0.8);
    for (const side of [-1, 1]) {
      const p = this.point(k, side * span);
      const pillar = new THREE.Mesh(pillarGeo, metal);
      pillar.position.set(p[0], p[1] + 3.5, p[2]);
      pillar.rotation.y = this.hd[k];
      pillar.castShadow = true;
      g.add(pillar);
    }
    const c = this.point(k, 0);
    const beam = new THREE.Group();
    beam.position.set(c[0], c[1] + 6.6, c[2]);
    beam.rotation.y = this.hd[k];
    const beamMesh = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.8, 1.6, 0.7), metal);
    beamMesh.castShadow = true;
    beam.add(beamMesh);
    const bannerTex = makeBannerTexture(style);
    const bannerMat = new THREE.MeshBasicMaterial({ map: bannerTex, toneMapped: false });
    for (const dir of [-1, 1]) {
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(span * 2 - 1, 1.3), bannerMat);
      banner.position.z = dir * 0.36;
      banner.rotation.y = dir > 0 ? 0 : Math.PI;
      banner.position.y = 0;
      beam.add(banner);
    }
    // startovní světla (5 kusů) nad tratí, svítí směrem k autům (za čarou)
    this.startLights = [];
    const lightGeo = new THREE.CircleGeometry(0.32, 20);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.0, 0.4), new THREE.MeshLambertMaterial({ color: 0x111317 }));
    housing.position.set(0, -1.35, -0.2);
    beam.add(housing);
    for (let i = 0; i < 5; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x220806, toneMapped: false });
      const l = new THREE.Mesh(lightGeo, mat);
      l.position.set((i - 2) * 0.88, -1.35, -0.41);
      l.rotation.y = Math.PI;
      beam.add(l);
      this.startLights.push(mat);
    }
    g.add(beam);
    return g;
  }

  // mokrý asfalt se leskne (odráží oblohu), suchý je matný; na vysoké kvalitě má hrubší zrno a kaluže
  roadMaterial(style, map, surface, anisotropy) {
    if (!surface) {
      return style.wet
        ? new THREE.MeshStandardMaterial({ map, color: 0xffffff, roughness: 0.3, metalness: 0.2 })
        : new THREE.MeshLambertMaterial({ map, color: 0xffffff });
    }
    surface.anisotropy = anisotropy;
    const mat = new THREE.MeshStandardMaterial({
      map, roughnessMap: surface, bumpMap: surface, bumpScale: style.wet ? 0.5 : 1.2, roughness: 1, metalness: 0, envMapIntensity: style.wet ? 0.95 : 0.42,
    });
    // odrazy na obrazovce poznají silnici podle hrubosti uložené v alfa kanálu
    if (style.wet) {
      mat.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n gl_FragColor.a = roughnessFactor;');
      };
    }
    return mat;
  }

  // zajetá guma: dvě tmavé stopy po ideální stopě přes zatáčky, s nájezdem a výjezdem
  buildRubber() {
    const N = this.N;
    const wid = Array.from(this.kappaS, (kappa) => clamp((Math.abs(kappa) - 0.004) / 0.012, 0, 1));
    const lat = this.racingLat, amount = smoothCircular(wid, Math.round(9 / this.step));
    const strip = new StripBuilder();
    for (let k = 0; k < N; k++) {
      const n = (k + 1) % N;
      const wa = 1.5 * Math.min(1, amount[k] * 2.5), wb = 1.5 * Math.min(1, amount[n] * 2.5);
      if (wa < 0.05 && wb < 0.05) continue;
      const v0 = this.s[k] / 6, v1 = v0 + this.step / 6;
      strip.quad(
        this.point(k, lat[k] - wa, 0.012), this.point(k, lat[k] + wa, 0.012),
        this.point(n, lat[n] + wb, 0.012), this.point(n, lat[n] - wb, 0.012),
        null, [0, v0, 1, v0, 1, v1, 0, v1],
      );
    }
    const mesh = new THREE.Mesh(strip.build(), new THREE.MeshBasicMaterial({
      color: 0x08080a, map: makeRubberTexture(), transparent: true, opacity: 0.34, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    }));
    mesh.renderOrder = 1;
    return mesh;
  }

  setStartLights(n, green = false) {
    if (!this.startLights) return;
    this.startLights.forEach((m, i) => {
      if (green) m.color.setHex(0x19ff5a).multiplyScalar(3);
      else if (i < n) m.color.setHex(0xff2211).multiplyScalar(3.5);
      else m.color.setHex(0x220806);
    });
  }
}

// --- pomocné stavění geometrie ----------------------------------------------

export class StripBuilder {
  constructor() {
    this.pos = [];
    this.col = [];
    this.uv = [];
    this.count = 0;
  }
  // a, b, c, d proti směru hodinových ručiček při pohledu zvrchu (lícem nahoru / ven)
  quad(a, b, c, d, color, uv) {
    this.pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    const cr = color ? color.r : 1, cg = color ? color.g : 1, cb = color ? color.b : 1;
    for (let i = 0; i < 6; i++) this.col.push(cr, cg, cb);
    if (uv) this.uv.push(uv[0], uv[1], uv[2], uv[3], uv[4], uv[5], uv[0], uv[1], uv[4], uv[5], uv[6], uv[7]);
    else for (let i = 0; i < 12; i++) this.uv.push(0);
    this.count++;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

const ROAD_TILE = 32; // metrů asfaltu na jedno opakování textury
const ROAD_W = { low: 256, medium: 512, high: 1024, ultra: 1024 };

// zrno přes celý obrázek; kamínky dělá vzácný větší výkyv
function grain(g, W, H, fn) {
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  let seed = 12345;
  for (let i = 0; i < d.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    fn(d, i, (seed >>> 24) / 127.5 - 1);
  }
  g.putImageData(img, 0, 0);
}

function roadPatches(rng) {
  // v podílech šířky a délky dlaždice, od švu dlaždice dál
  return Array.from({ length: 4 }, () => {
    const w = rng.range(0.12, 0.26), h = rng.range(0.02, 0.05);
    return { x: rng.range(0.06, 0.94 - w), y: rng.range(0.02, 0.96 - h), w, h };
  });
}

function roadPuddles(rng) {
  return Array.from({ length: 16 }, () => {
    // kaluže se drží v kolejích a u krajů
    const lane = rng.pick([0.1, 0.3, 0.7, 0.9]);
    return { x: lane + rng.range(-0.05, 0.05), y: rng.range(0.06, 0.94), rx: rng.range(0.04, 0.1), ry: rng.range(0.015, 0.05) };
  });
}

function softEllipse(g, x, y, rx, ry, inner, outer) {
  g.save();
  g.translate(x, y);
  g.scale(rx, ry);
  const grd = g.createRadialGradient(0, 0, 0.2, 0, 0, 1);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.beginPath();
  g.arc(0, 0, 1, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function makeRoadTextures(style, quality) {
  const W = ROAD_W[quality] ?? 512, H = W * 2, k = W / 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = style.asphalt;
  g.fillRect(0, 0, W, H);
  const rng = new RNG(99);
  // velké skvrny, aby se dlaždice neopakovala nápadně
  for (let i = 0; i < 70; i++) {
    const light = rng.chance(0.45);
    softEllipse(g, rng.range(0, W), rng.range(0, H), rng.range(30, 90) * k, rng.range(40, 160) * k, light ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.07)', 'rgba(0,0,0,0)');
  }
  // zalátané výtluky
  const patches = roadPatches(rng);
  for (const p of patches) {
    g.fillStyle = 'rgba(0,0,0,0.08)';
    g.fillRect(p.x * W, p.y * H, p.w * W, p.h * H);
    g.strokeStyle = 'rgba(8,8,10,0.2)';
    g.lineWidth = 0.8 * k;
    g.strokeRect(p.x * W, p.y * H, p.w * W, p.h * H);
  }
  // praskliny
  g.strokeStyle = 'rgba(6,6,8,0.5)';
  for (let i = 0; i < 14; i++) {
    let x = rng.range(0.1, 0.9) * W, y = rng.range(0.03, 0.95) * H;
    g.lineWidth = rng.range(0.4, 0.9) * k;
    g.beginPath();
    g.moveTo(x, y);
    for (let j = 0, n = rng.int(4, 9); j < n; j++) {
      x += rng.range(-9, 9) * k;
      y = Math.min(H - 4, y + rng.range(4, 14) * k);
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // tmavší stopa uprostřed jízdních pruhů
  const grd = g.createLinearGradient(0, 0, W, 0);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(0.3, 'rgba(0,0,0,0.12)');
  grd.addColorStop(0.5, 'rgba(0,0,0,0.02)');
  grd.addColorStop(0.7, 'rgba(0,0,0,0.12)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  // kaluže jsou tmavší než mokrý asfalt kolem
  const puddles = style.wet ? roadPuddles(rng) : [];
  for (const p of puddles) softEllipse(g, p.x * W, p.y * H, p.rx * W, p.ry * H, 'rgba(0,0,0,0.4)', 'rgba(0,0,0,0)');
  grain(g, W, H, (d, i, v) => {
    const a = Math.abs(v) > 0.93 ? v * 46 : v * 11;
    d[i] += a;
    d[i + 1] += a;
    d[i + 2] += a;
  });
  // krajní čáry
  g.fillStyle = style.lineColor ?? '#e9e6dc';
  g.fillRect(5 * k, 0, 7 * k, H);
  g.fillRect(W - 12 * k, 0, 7 * k, H);
  if (style.centerLine) {
    g.fillStyle = style.centerLine;
    for (let i = 0; i < 4; i++) g.fillRect(W / 2 - 3 * k, (i * H) / 4, 6 * k, H * 0.225);
  }
  // barva čar je místy sjetá
  g.fillStyle = style.asphalt;
  for (let i = 0; i < 240 * k; i++) {
    const x = rng.chance(0.5) ? rng.range(5, 12) : 256 - rng.range(5, 12);
    g.globalAlpha = rng.range(0.1, 0.4);
    g.fillRect(x * k, rng.range(0, H), rng.range(1, 3) * k, rng.range(1, 5) * k);
  }
  g.globalAlpha = 1;
  const map = new THREE.CanvasTexture(c);
  map.wrapS = THREE.ClampToEdgeWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  if (quality !== 'high' && quality !== 'ultra') return { map, surface: null };

  // povrch: červená = výška zrna, zelená = hrubost
  const SW = 512, SH = 1024;
  const sc = document.createElement('canvas');
  sc.width = SW;
  sc.height = SH;
  const sg = sc.getContext('2d', { willReadFrequently: true });
  sg.fillStyle = `rgb(128,${style.wet ? 84 : 224},0)`;
  sg.fillRect(0, 0, SW, SH);
  if (!style.wet) {
    // vyjeté pruhy se lesknou víc než zbytek
    const band = sg.createLinearGradient(0, 0, SW, 0);
    for (const [t, a] of [[0.12, 0], [0.3, 0.5], [0.46, 0], [0.54, 0], [0.7, 0.5], [0.88, 0]]) band.addColorStop(t, `rgba(128,170,0,${a})`);
    sg.fillStyle = band;
    sg.fillRect(0, 0, SW, SH);
  }
  for (const p of patches) {
    sg.fillStyle = `rgb(112,${style.wet ? 60 : 200},0)`;
    sg.fillRect(p.x * SW, p.y * SH, p.w * SW, p.h * SH);
  }
  for (const p of puddles) softEllipse(sg, p.x * SW, p.y * SH, p.rx * SW, p.ry * SH, 'rgba(128,44,0,0.8)', 'rgba(128,44,0,0)');
  grain(sg, SW, SH, (d, i, v) => {
    // v kaluži je hladina hladká
    const calm = style.wet ? Math.min(1, d[i + 1] / 70) : 1;
    d[i] += v * 70 * calm;
    d[i + 1] += v * (style.wet ? 14 : 26) * calm;
  });
  const surface = new THREE.CanvasTexture(sc);
  surface.wrapS = THREE.ClampToEdgeWrapping;
  surface.wrapT = THREE.RepeatWrapping;
  return { map, surface };
}

function makeRubberTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d');
  const rng = new RNG(7);
  // dvě stopy kol, po délce roztřepené
  for (let i = 0; i < 90; i++) {
    const x = (rng.chance(0.5) ? 14 : 50) + rng.range(-9, 9);
    g.fillStyle = `rgba(255,255,255,${rng.range(0.06, 0.3)})`;
    g.fillRect(x, rng.range(-30, 128), rng.range(1, 3), rng.range(40, 128));
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCheckerTexture(nx, ny) {
  const c = document.createElement('canvas');
  c.width = nx * 16;
  c.height = ny * 16;
  const g = c.getContext('2d');
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#f2f2f2';
      g.fillRect(x * 16, y * 16, 16, 16);
    }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeBannerTexture(style) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = style.bannerBg ?? '#10223f';
  g.fillRect(0, 0, 1024, 96);
  // šachovnice po stranách
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 6; x++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#f2f2f2';
      g.fillRect(x * 24, y * 24, 24, 24);
      g.fillRect(1024 - 144 + x * 24, y * 24, 24, 24);
    }
  g.fillStyle = '#ffffff';
  g.font = 'italic 700 62px "Chakra Petch", "Arial Narrow", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('TURBO OKRUH', 512, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
