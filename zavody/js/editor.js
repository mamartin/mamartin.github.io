// Editor vlastních tratí: 2D mapa s body, průběžná kontrola geometrie, uložení.
import { buildCenterline, validateCenterline, randomTrackDef } from './trackmath.js';
import { BIOMES } from './biomes.js';
import { clamp, hashString } from './rng.js';

const SIZES = {
  forest: { width: 16, runoff: 7, maxBank: 0.07 },
  canyon: { width: 18, runoff: 8, maxBank: 0.06 },
  winter: { width: 15, runoff: 6, maxBank: 0.06 },
  city: { width: 14, runoff: 3, maxBank: 0.015, smooth: 2 },
};

const DEFAULT_POINTS = [
  [-230, 10, 0, 60], [-140, -150, 4, 55], [110, -170, 10, 60], [250, -40, 8, 55], [170, 130, 3, 45], [-90, 150, 0, 55],
];

// Uložená trať -> definice pro hru. Start leží uprostřed nejdelší rovinky.
export function customToDef(t) {
  const size = SIZES[t.biome] || SIZES.forest;
  const pts = t.points.map((p) => [p[0], p[1], p[2] || 0, p[3] || 40]);
  const n = pts.length;
  let best = 0, bestLen = -1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l > bestLen) {
      bestLen = l;
      best = i;
    }
  }
  const a = pts[best], b = pts[(best + 1) % n];
  const ordered = [[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, 0]];
  for (let i = 1; i <= n; i++) ordered.push(pts[(best + i) % n]);
  return {
    id: t.id,
    name: t.name || 'Vlastní trať',
    subtitle: `${BIOMES[t.biome]?.name ?? 'Les'} · vlastní`,
    biome: t.biome in SIZES ? t.biome : 'forest',
    ...size,
    seed: hashString(t.id) % 100000,
    points: ordered,
    custom: true,
  };
}

// Kontrola geometrie s lidsky čitelnou zprávou a místy problémů.
export function checkDef(def) {
  const cl = buildCenterline(def);
  const hw = def.width / 2;
  const v = validateCenterline(cl, hw, def.runoff);
  const edge = hw + def.runoff;
  const problems = [];
  let message = '';
  if (v.length < 700) message = `Trať je moc krátká (${Math.round(v.length)} m, potřeba aspoň 700 m).`;
  else if (v.length > 6000) message = 'Trať je moc dlouhá (víc než 6 km).';
  else if (v.minRadius <= edge + 2) {
    message = `Zatáčka je moc ostrá: poloměr ${Math.round(v.minRadius)} m, potřeba aspoň ${Math.ceil(edge + 3)} m. Zvětši poloměr nebo body oddal.`;
    let k = 0, m = 0;
    for (let i = 0; i < cl.N; i++) if (Math.abs(cl.kappa[i]) > m) { m = Math.abs(cl.kappa[i]); k = i; }
    problems.push([cl.px[k], cl.pz[k]]);
  } else if (v.minSeparation <= edge * 2 + 6) {
    message = 'Dva úseky trati jsou moc blízko nebo se kříží. Roztáhni je od sebe.';
    for (const k of v.worstPair) problems.push([cl.px[k], cl.pz[k]]);
  } else if (v.maxGrade >= 0.16) {
    message = `Stoupání je moc prudké (${Math.round(v.maxGrade * 100)} %, nejvýš 15 %). Zmenši rozdíly výšek.`;
    let k = 0, m = 0;
    for (let i = 0; i < cl.N; i++) if (Math.abs(cl.grade[i]) > m) { m = Math.abs(cl.grade[i]); k = i; }
    problems.push([cl.px[k], cl.pz[k]]);
  }
  return { ok: !message, message, problems, length: v.length, minRadius: v.minRadius, maxGrade: v.maxGrade, cl };
}

export class TrackEditor {
  constructor({ store, onDrive, onExit }) {
    this.store = store;
    this.onDrive = onDrive;
    this.onExit = onExit;
    this.root = document.getElementById('editor');
    this.canvas = document.getElementById('ed-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.el = (id) => document.getElementById(id);
    this.sel = -1;
    this.view = { cx: 0, cz: 0, zoom: 1 };
    this.bind();
  }

  // --- otevření / zavření ---

  open(track) {
    if (track) this.track = JSON.parse(JSON.stringify(track));
    else {
      const n = this.store.custom.length + 1;
      this.track = { id: 'custom-' + Date.now().toString(36), name: `Moje trať ${n}`, biome: 'forest', points: DEFAULT_POINTS.map((p) => [...p]) };
    }
    this.sel = -1;
    this.confirmDelete = false;
    this.root.hidden = false;
    this.el('ed-name').value = this.track.name;
    this.el('ed-delete').textContent = 'Smazat trať';
    this.userView = false;
    this.resize();
    this.fit();
    this.changed(false);
  }

  close() {
    this.root.hidden = true;
  }

  get isOpen() {
    return !this.root.hidden;
  }

  save() {
    this.track.name = (this.el('ed-name').value || '').trim() || 'Vlastní trať';
    this.track.valid = this.check.ok;
    this.store.saveCustom(this.track);
  }

  // --- ovládání ---

  bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.down(e));
    c.addEventListener('pointermove', (e) => this.move(e));
    c.addEventListener('pointerup', (e) => this.up(e));
    c.addEventListener('pointercancel', (e) => this.up(e));
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [sx, sy] = this.local(e);
      this.zoomAt(sx, sy, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    window.addEventListener('resize', () => this.isOpen && this.resize());
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen || e.target.tagName === 'INPUT') return;
      if ((e.code === 'Delete' || e.code === 'Backspace') && this.sel >= 0) {
        e.preventDefault();
        this.deletePoint(this.sel);
      }
      if (e.code === 'Escape') {
        this.sel = -1;
        this.changed(false);
      }
    });
    for (const b of this.el('ed-biome').children) {
      b.addEventListener('click', () => {
        this.track.biome = b.dataset.biome;
        this.changed();
      });
    }
    this.el('ed-name').addEventListener('input', () => this.save());
    this.el('ed-r').addEventListener('input', (e) => this.setPoint({ r: +e.target.value }));
    this.el('ed-h').addEventListener('input', (e) => this.setPoint({ h: +e.target.value }));
    this.el('ed-pt-del').addEventListener('click', () => this.deletePoint(this.sel));
    this.el('ed-random').addEventListener('click', () => {
      const pts = randomTrackDef(Math.floor(Math.random() * 1e9)).slice(1);
      this.track.points = pts.map((p) => [Math.round(p[0]), Math.round(p[1]), Math.round(p[2]), Math.round(p[3])]);
      this.sel = -1;
      this.fit();
      this.changed();
    });
    this.el('ed-reverse').addEventListener('click', () => {
      this.track.points.reverse();
      this.sel = -1;
      this.changed();
    });
    this.el('ed-zoom-in').addEventListener('click', () => this.zoomAt(this.w / 2, this.h / 2, 1.25));
    this.el('ed-zoom-out').addEventListener('click', () => this.zoomAt(this.w / 2, this.h / 2, 0.8));
    this.el('ed-fit').addEventListener('click', () => {
      this.userView = false;
      this.fit();
      this.draw();
    });
    this.el('ed-back').addEventListener('click', () => {
      this.save();
      this.close();
      this.onExit(this.track);
    });
    this.el('ed-delete').addEventListener('click', () => {
      if (!this.confirmDelete) {
        this.confirmDelete = true;
        this.el('ed-delete').textContent = 'Opravdu smazat?';
        clearTimeout(this.confirmTimer);
        this.confirmTimer = setTimeout(() => {
          this.confirmDelete = false;
          this.el('ed-delete').textContent = 'Smazat trať';
        }, 3000);
        return;
      }
      this.store.deleteCustom(this.track.id);
      this.close();
      this.onExit(null, this.track.id);
    });
    this.el('ed-drive').addEventListener('click', () => {
      if (!this.check.ok) {
        const st = this.el('ed-status');
        st.classList.remove('shake');
        void st.offsetWidth;
        st.classList.add('shake');
        return;
      }
      this.save();
      this.close();
      this.onDrive(this.track);
    });
  }

  // pozice ukazatele v souřadnicích plátna (CSS px)
  local(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  toWorld(sx, sy) {
    const v = this.view;
    return [(sx - this.w / 2) / v.zoom + v.cx, (sy - this.h / 2) / v.zoom + v.cz];
  }

  toScreen(x, z) {
    const v = this.view;
    return [(x - v.cx) * v.zoom + this.w / 2, (z - v.cz) * v.zoom + this.h / 2];
  }

  hitPoint(sx, sy) {
    let best = -1, bd = 16 * 16;
    this.track.points.forEach((p, i) => {
      const [x, y] = this.toScreen(p[0], p[1]);
      const d = (x - sx) ** 2 + (y - sy) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  // nejbližší úsečka řídicího polygonu (pro vložení bodu)
  nearestSegment(x, z) {
    const pts = this.track.points;
    let best = 0, bd = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      const d = Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return { index: best, dist: bd };
  }

  down(e) {
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* syntetické nebo už ukončené ukazatele */
    }
    const [sx, sy] = this.local(e);
    const hit = this.hitPoint(sx, sy);
    const [x, z] = this.toWorld(sx, sy);
    if (hit >= 0) {
      this.sel = hit;
      this.drag = { type: 'point', index: hit, moved: false };
    } else {
      const seg = this.nearestSegment(x, z);
      if (seg.dist * this.view.zoom < 60) {
        // nový bod na nejbližší úsečce
        const prev = this.track.points[seg.index];
        this.track.points.splice(seg.index + 1, 0, [Math.round(x), Math.round(z), prev[2] || 0, 45]);
        this.sel = seg.index + 1;
        this.drag = { type: 'point', index: this.sel, moved: true };
        this.changed();
      } else {
        this.sel = -1;
        this.drag = { type: 'pan', sx, sy, cx: this.view.cx, cz: this.view.cz };
        this.changed(false);
      }
    }
  }

  move(e) {
    const [ex, ey] = this.local(e);
    if (!this.drag) {
      this.canvas.style.cursor = this.hitPoint(ex, ey) >= 0 ? 'grab' : 'crosshair';
      return;
    }
    if (this.drag.type === 'point') {
      const [x, z] = this.toWorld(ex, ey);
      const p = this.track.points[this.drag.index];
      p[0] = Math.round(x);
      p[1] = Math.round(z);
      this.drag.moved = true;
      this.changed(false);
    } else {
      const d = this.drag;
      this.userView = true;
      this.view.cx = d.cx - (ex - d.sx) / this.view.zoom;
      this.view.cz = d.cz - (ey - d.sy) / this.view.zoom;
      this.draw();
    }
  }

  up() {
    if (this.drag && this.drag.type === 'point' && this.drag.moved) this.changed();
    this.drag = null;
  }

  zoomAt(sx, sy, f) {
    this.userView = true;
    const [x, z] = this.toWorld(sx, sy);
    this.view.zoom = clamp(this.view.zoom * f, 0.15, 4);
    // bod pod kurzorem zůstane na místě
    this.view.cx = x - (sx - this.w / 2) / this.view.zoom;
    this.view.cz = z - (sy - this.h / 2) / this.view.zoom;
    this.draw();
  }

  setPoint(vals) {
    const p = this.track.points[this.sel];
    if (!p) return;
    if (vals.r != null) p[3] = vals.r;
    if (vals.h != null) p[2] = vals.h;
    this.changed();
  }

  deletePoint(i) {
    if (i < 0 || this.track.points.length <= 4) {
      this.el('ed-status').textContent = 'Trať potřebuje aspoň 4 body.';
      return;
    }
    this.track.points.splice(i, 1);
    this.sel = -1;
    this.changed();
  }

  // přepočítá trať; persist = uložit rozpracovaný stav
  changed(persist = true) {
    const def = customToDef(this.track);
    this.def = def;
    this.check = checkDef(def);
    if (persist) this.save();
    this.updatePanel();
    this.draw();
  }

  updatePanel() {
    const ch = this.check;
    const st = this.el('ed-status');
    const km = (ch.length / 1000).toFixed(2).replace('.', ',');
    st.innerHTML = `<span class="ed-stats">${km} km · poloměr min. ${Math.round(ch.minRadius)} m · stoupání max. ${Math.round(ch.maxGrade * 100)} %</span>` +
      (ch.ok ? '<span class="ed-ok">Trať je připravená na závod.</span>' : `<span class="ed-err">${ch.message}</span>`);
    this.el('ed-drive').classList.toggle('disabled', !ch.ok);
    for (const b of this.el('ed-biome').children) b.setAttribute('aria-checked', String(b.dataset.biome === this.track.biome));
    const box = this.el('ed-point');
    const p = this.track.points[this.sel];
    box.hidden = !p;
    if (p) {
      this.el('ed-pt-index').textContent = `${this.sel + 1} z ${this.track.points.length}`;
      this.el('ed-r').value = p[3];
      this.el('ed-r-val').textContent = `${p[3]} m`;
      this.el('ed-h').value = p[2];
      this.el('ed-h-val').textContent = `${p[2]} m`;
    }
  }

  // --- kreslení ---

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(10, r.width);
    this.h = Math.max(10, r.height);
    this.dpr = dpr;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    // dokud uživatel mapou nehýbal, drž celou trať v záběru
    if (!this.userView && this.track) this.fit();
    if (this.check) this.draw();
  }

  fit() {
    const pts = this.track.points;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minZ = Math.min(minZ, p[1]);
      maxZ = Math.max(maxZ, p[1]);
    }
    const pad = 80;
    this.view.cx = (minX + maxX) / 2;
    this.view.cz = (minZ + maxZ) / 2;
    this.view.zoom = clamp(Math.min(this.w / (maxX - minX + pad * 2), this.h / (maxZ - minZ + pad * 2)), 0.15, 4);
  }

  draw() {
    const g = this.ctx;
    const { w, h, dpr } = this;
    if (!this.check) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0d1628';
    g.fillRect(0, 0, w, h);
    this.drawGrid(g);
    const cl = this.check.cl;
    const def = this.def;
    const biome = BIOMES[def.biome];
    const zoom = this.view.zoom;
    const path = () => {
      g.beginPath();
      for (let k = 0; k <= cl.N; k++) {
        const [x, y] = this.toScreen(cl.px[k % cl.N], cl.pz[k % cl.N]);
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
    };
    g.lineJoin = g.lineCap = 'round';
    // krajnice a silnice
    path();
    g.strokeStyle = biome.track.shoulderA;
    g.globalAlpha = 0.55;
    g.lineWidth = Math.max(3, (def.width + def.runoff * 2) * zoom);
    g.stroke();
    g.globalAlpha = 1;
    path();
    g.strokeStyle = '#4a4f59';
    g.lineWidth = Math.max(2, def.width * zoom);
    g.stroke();
    path();
    g.setLineDash([6, 8]);
    g.strokeStyle = 'rgba(243,245,248,0.35)';
    g.lineWidth = 1;
    g.stroke();
    g.setLineDash([]);
    // šipky směru jízdy
    const every = Math.max(1, Math.round(160 / cl.step));
    g.fillStyle = 'rgba(243,245,248,0.8)';
    for (let k = every; k < cl.N; k += every) {
      const [x, y] = this.toScreen(cl.px[k], cl.pz[k]);
      const a = Math.atan2(Math.cos(cl.hd[k]), Math.sin(cl.hd[k]));
      g.save();
      g.translate(x, y);
      g.rotate(a);
      g.beginPath();
      g.moveTo(6, 0);
      g.lineTo(-4, 4.5);
      g.lineTo(-4, -4.5);
      g.closePath();
      g.fill();
      g.restore();
    }
    // start
    const [sx, sy] = this.toScreen(cl.px[0], cl.pz[0]);
    const half = Math.max(8, (def.width / 2) * zoom);
    g.save();
    g.translate(sx, sy);
    g.rotate(Math.atan2(cl.rz[0], cl.rx[0]));
    for (let i = -3; i < 3; i++) {
      g.fillStyle = i % 2 ? '#111' : '#f2f2f2';
      g.fillRect((i / 3) * half, -3, half / 3, 6);
    }
    g.restore();
    // řídicí polygon a body
    const pts = this.track.points;
    g.beginPath();
    pts.forEach((p, i) => {
      const [x, y] = this.toScreen(p[0], p[1]);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.closePath();
    g.setLineDash([3, 5]);
    g.strokeStyle = 'rgba(255,194,26,0.45)';
    g.lineWidth = 1;
    g.stroke();
    g.setLineDash([]);
    g.font = '600 11px "Barlow Semi Condensed", sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    pts.forEach((p, i) => {
      const [x, y] = this.toScreen(p[0], p[1]);
      const selected = i === this.sel;
      g.beginPath();
      g.arc(x, y, selected ? 9 : 7, 0, Math.PI * 2);
      g.fillStyle = selected ? '#ffc21a' : '#f3f5f8';
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = '#0d1628';
      g.stroke();
      if (p[2]) {
        g.fillStyle = 'rgba(243,245,248,0.8)';
        g.fillText(`${p[2] > 0 ? '+' : ''}${p[2]} m`, x + 12, y - 10);
      }
    });
    // problémy
    for (const [px, pz] of this.check.problems) {
      const [x, y] = this.toScreen(px, pz);
      g.beginPath();
      g.arc(x, y, 18, 0, Math.PI * 2);
      g.strokeStyle = '#ff5446';
      g.lineWidth = 3;
      g.stroke();
      g.fillStyle = '#ff5446';
      g.font = '700 16px "Chakra Petch", sans-serif';
      g.textAlign = 'center';
      g.fillText('!', x, y + 1);
    }
  }

  drawGrid(g) {
    const { w, h } = this;
    const zoom = this.view.zoom;
    const step = zoom > 1.2 ? 25 : zoom > 0.4 ? 50 : 100;
    const [x0, z0] = this.toWorld(0, 0);
    const [x1, z1] = this.toWorld(w, h);
    g.lineWidth = 1;
    for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) {
      const [sx] = this.toScreen(x, 0);
      g.strokeStyle = x % (step * 5) === 0 ? 'rgba(243,245,248,0.1)' : 'rgba(243,245,248,0.045)';
      g.beginPath();
      g.moveTo(sx, 0);
      g.lineTo(sx, h);
      g.stroke();
    }
    for (let z = Math.floor(z0 / step) * step; z <= z1; z += step) {
      const [, sy] = this.toScreen(0, z);
      g.strokeStyle = z % (step * 5) === 0 ? 'rgba(243,245,248,0.1)' : 'rgba(243,245,248,0.045)';
      g.beginPath();
      g.moveTo(0, sy);
      g.lineTo(w, sy);
      g.stroke();
    }
    // měřítko
    const len = step * 2;
    const px = len * zoom;
    g.strokeStyle = 'rgba(243,245,248,0.7)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(16, h - 18);
    g.lineTo(16 + px, h - 18);
    g.stroke();
    g.fillStyle = 'rgba(243,245,248,0.7)';
    g.font = '600 12px "Barlow Semi Condensed", sans-serif';
    g.textAlign = 'left';
    g.fillText(`${len} m`, 16, h - 30);
  }
}
