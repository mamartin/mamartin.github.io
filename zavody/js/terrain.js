// Terén: výšková mřížka, která u trati klesne těsně pod krajnici
// a dál od ní přechází v kopce / kaňon / rovinu města.
import * as THREE from 'three';
import { Noise2D, smoothstep, lerp, clamp } from './rng.js';

export class Terrain {
  constructor(track, biome, opts = {}) {
    this.track = track;
    this.biome = biome;
    const cell = (this.cell = opts.cell ?? 8);
    const margin = opts.margin ?? 520;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let k = 0; k < track.N; k++) {
      minX = Math.min(minX, track.px[k]);
      maxX = Math.max(maxX, track.px[k]);
      minZ = Math.min(minZ, track.pz[k]);
      maxZ = Math.max(maxZ, track.pz[k]);
    }
    this.trackBounds = { minX, maxX, minZ, maxZ };
    this.x0 = Math.floor((minX - margin) / cell) * cell;
    this.z0 = Math.floor((minZ - margin) / cell) * cell;
    this.nx = Math.ceil((maxX + margin - this.x0) / cell) + 1;
    this.nz = Math.ceil((maxZ + margin - this.z0) / cell) + 1;
    this.lake = opts.lake;
    this.noise = new Noise2D(opts.seed ?? 7);
    this.noise2 = new Noise2D((opts.seed ?? 7) + 101);
    this.computeDistance();
    this.computeHeights(opts);
  }

  computeDistance() {
    const { nx, nz, cell, x0, z0, track } = this;
    const V = nx * nz;
    const dist = new Float32Array(V).fill(1e9);
    const near = new Int32Array(V);
    // hrubý odhad pro celou mřížku (každý 6. vzorek)
    for (let j = 0; j < nz; j++) {
      const z = z0 + j * cell;
      for (let i = 0; i < nx; i++) {
        const x = x0 + i * cell;
        let best = 1e18, bk = 0;
        for (let k = 0; k < track.N; k += 6) {
          const dx = x - track.px[k], dz = z - track.pz[k];
          const d = dx * dx + dz * dz;
          if (d < best) { best = d; bk = k; }
        }
        const v = j * nx + i;
        dist[v] = Math.sqrt(best);
        near[v] = bk;
      }
    }
    // přesně v okolí trati
    const R = 90;
    const rc = Math.ceil(R / cell);
    for (let k = 0; k < track.N; k++) {
      const ci = Math.round((track.px[k] - x0) / cell);
      const cj = Math.round((track.pz[k] - z0) / cell);
      for (let j = Math.max(0, cj - rc); j <= Math.min(nz - 1, cj + rc); j++) {
        const z = z0 + j * cell;
        for (let i = Math.max(0, ci - rc); i <= Math.min(nx - 1, ci + rc); i++) {
          const x = x0 + i * cell;
          const d = Math.hypot(x - track.px[k], z - track.pz[k]);
          const v = j * nx + i;
          if (d < dist[v]) { dist[v] = d; near[v] = k; }
        }
      }
    }
    this.dist = dist;
    this.near = near;
  }

  computeHeights(opts) {
    const { nx, nz, cell, x0, z0, track, biome } = this;
    const V = nx * nz;
    const h = new Float32Array(V);
    let meanY = 0;
    for (let k = 0; k < track.N; k++) meanY += track.py[k];
    meanY /= track.N;
    this.meanY = meanY;
    const edge = track.edge;
    const b = this.trackBounds;
    const lake = opts.lake;
    for (let j = 0; j < nz; j++) {
      const z = z0 + j * cell;
      for (let i = 0; i < nx; i++) {
        const x = x0 + i * cell;
        const v = j * nx + i;
        const d = this.dist[v];
        const k = this.near[v];
        const ty = track.py[k];
        const low = ty - Math.abs(track.tanBank[k]) * edge - 0.7;
        const base = lerp(ty, meanY, smoothstep(50, 260, d));
        // vzdálenost od obdélníku trati – pro prstenec hor v dálce
        const bx = Math.max(b.minX - x, 0, x - b.maxX);
        const bz = Math.max(b.minZ - z, 0, z - b.maxZ);
        const dBox = Math.hypot(bx, bz);
        const far = base + this.biomeHeight(x, z, d, dBox);
        const w = smoothstep(edge + 3, edge + 55, d);
        h[v] = lerp(low, far, w);
      }
    }
    this.h = h;
    if (lake) this.carveLake(lake);
  }

  // jezero: okolí srovnat do roviny těsně nad hladinou a uprostřed vyhloubit dno
  carveLake(lake) {
    const { nx, nz, cell, x0, z0, h } = this;
    const r = lake.r;
    let sum = 0, n = 0;
    for (let a = 0; a < 48; a++) {
      const ang = (a / 48) * Math.PI * 2;
      for (const f of [1.15, 1.35, 1.55]) {
        sum += this.heightAt(lake.x + Math.cos(ang) * r * f, lake.z + Math.sin(ang) * r * f);
        n++;
      }
    }
    const level = sum / n;
    this.waterY = level;
    for (let j = 0; j < nz; j++) {
      const z = z0 + j * cell;
      for (let i = 0; i < nx; i++) {
        const x = x0 + i * cell;
        const dl = Math.hypot(x - lake.x, z - lake.z);
        if (dl > r * 1.7) continue;
        const v = j * nx + i;
        let hv = lerp(h[v], level + 0.7, smoothstep(r * 1.7, r * 1.08, dl));
        hv = lerp(hv, level - 4.5, smoothstep(r * 1.0, r * 0.62, dl));
        h[v] = hv;
      }
    }
  }

  biomeHeight(x, z, d, dBox) {
    const n = this.noise;
    const edge = this.track.edge;
    if (this.biome === 'forest') {
      const ramp = smoothstep(edge + 6, 220, d);
      const hills = (n.fbm(x / 170, z / 170, 4) * 0.5 + 0.5) * 34 * ramp;
      const mountains = smoothstep(120, 520, dBox) * (70 + 60 * n.fbm(x / 300 + 9, z / 300, 3));
      return hills + mountains + n.noise(x / 23, z / 23) * 1.2 * ramp;
    }
    if (this.biome === 'canyon') {
      const n1 = n.fbm(x / 210, z / 210, 3);
      const walls = smoothstep(edge + 14, edge + 50, d) * (26 + 22 * (n1 * 0.5 + 0.5));
      const mesas = smoothstep(0.02, 0.14, n1) * 30 * smoothstep(edge + 30, 180, d);
      const ring = smoothstep(100, 450, dBox) * 70;
      let hv = walls + mesas + ring;
      // terasy (vrstvy horniny)
      const step = 7;
      const f = hv / step;
      const fi = Math.floor(f);
      hv = (fi + smoothstep(0.55, 1, f - fi)) * step;
      return hv + this.noise2.noise(x / 17, z / 17) * 0.8 * smoothstep(edge, edge + 30, d);
    }
    // město: rovina
    return -0.3;
  }

  heightAt(x, z) {
    const fx = (x - this.x0) / this.cell, fz = (z - this.z0) / this.cell;
    const i = clamp(Math.floor(fx), 0, this.nx - 2), j = clamp(Math.floor(fz), 0, this.nz - 2);
    const u = clamp(fx - i, 0, 1), w = clamp(fz - j, 0, 1);
    const h = this.h, nx = this.nx;
    const a = h[j * nx + i], b = h[j * nx + i + 1], c = h[(j + 1) * nx + i], d = h[(j + 1) * nx + i + 1];
    // stejná diagonála jako v meshi (a-c-b / b-c-d)
    if (u + w <= 1) return a + (b - a) * u + (c - a) * w;
    return d + (c - d) * (1 - u) + (b - d) * (1 - w);
  }

  distAt(x, z) {
    const i = clamp(Math.round((x - this.x0) / this.cell), 0, this.nx - 1);
    const j = clamp(Math.round((z - this.z0) / this.cell), 0, this.nz - 1);
    return this.dist[j * this.nx + i];
  }

  buildMesh(palette) {
    const { nx, nz, cell, x0, z0, h } = this;
    const V = nx * nz;
    const pos = new Float32Array(V * 3);
    const col = new Float32Array(V * 3);
    const c = new THREE.Color();
    const cA = new THREE.Color(palette.groundA), cB = new THREE.Color(palette.groundB);
    const cC = new THREE.Color(palette.groundC), cRock = new THREE.Color(palette.rock);
    const cNear = new THREE.Color(palette.nearTrack ?? palette.groundA);
    const cShore = new THREE.Color(palette.shore ?? palette.groundC);
    const lake = this.lake;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const v = j * nx + i;
        const x = x0 + i * cell, z = z0 + j * cell;
        pos[v * 3] = x;
        pos[v * 3 + 1] = h[v];
        pos[v * 3 + 2] = z;
        // sklon
        const hx = h[j * nx + Math.min(nx - 1, i + 1)] - h[j * nx + Math.max(0, i - 1)];
        const hz = h[Math.min(nz - 1, j + 1) * nx + i] - h[Math.max(0, j - 1) * nx + i];
        const slope = Math.hypot(hx, hz) / (2 * cell);
        const n1 = this.noise.noise(x / 40, z / 40) * 0.5 + 0.5;
        const n2 = this.noise2.noise(x / 9, z / 9) * 0.5 + 0.5;
        if (this.biome === 'canyon') {
          const band = Math.sin(h[v] * 0.9) * 0.5 + 0.5;
          c.copy(cA).lerp(cB, band * 0.8);
          c.lerp(cC, n1 * 0.35);
          c.lerp(cRock, smoothstep(0.5, 1.2, slope) * 0.8);
        } else if (this.biome === 'city') {
          c.copy(cA).lerp(cB, n2 * 0.4);
        } else {
          c.copy(cA).lerp(cB, n1);
          c.lerp(cC, n2 * 0.3);
          c.lerp(cRock, smoothstep(0.6, 1.1, slope) * (0.55 + 0.45 * n2));
          c.lerp(cRock.clone().multiplyScalar(1.4), smoothstep(90, 140, h[v]) * 0.7);
        }
        const d = this.dist[v];
        c.lerp(cNear, (1 - smoothstep(this.track.edge, this.track.edge + 16, d)) * 0.6);
        if (lake) {
          const dl = Math.hypot(x - lake.x, z - lake.z);
          c.lerp(cShore, smoothstep(lake.r * 1.16, lake.r * 1.02, dl));
        }
        const shade = 0.92 + n2 * 0.16;
        col[v * 3] = c.r * shade;
        col[v * 3 + 1] = c.g * shade;
        col[v * 3 + 2] = c.b * shade;
      }
    }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let t = 0;
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, cc = a + nx, d = cc + 1;
        idx[t++] = a; idx[t++] = cc; idx[t++] = b;
        idx[t++] = b; idx[t++] = cc; idx[t++] = d;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: palette.flat ?? true });
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    return mesh;
  }
}
