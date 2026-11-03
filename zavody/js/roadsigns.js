// Dopravní značky a zastávky z OSM (rozmístění a natočení dělá tools/osm2track.mjs).
// Všechny desky jsou v jedné textuře, takže značky stojí dvě volání kreslení: desky a sloupky.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { colored } from './scenery.js';
import { part, vertex } from './mass.js';

export const SIGN = { GIVE_WAY: 0, STOP: 1, MAXSPEED: 2, CITY: 3, BUS: 4, SIGNALS: 5, CAMERA: 6 };

const RED = '#c8202a', BLUE = '#1f4f9c', INK = '#1b1c1e';

function word(ctx, text, x, y, size, color = INK, max = 1e9) {
  ctx.fillStyle = color;
  ctx.font = `bold ${size}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y, max);
}

// deska: rozměr v metrech, výška spodní hrany nad zemí, rozměr v atlasu (px) a kresba
function plateOf(kind, value, names) {
  switch (kind) {
    case SIGN.GIVE_WAY: return { w: 0.9, h: 0.8, y: 1.9, px: [128, 112], draw: (ctx) => {
      ctx.fillStyle = RED;
      ctx.beginPath(); ctx.moveTo(2, 2); ctx.lineTo(126, 2); ctx.lineTo(64, 110); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(22, 14); ctx.lineTo(106, 14); ctx.lineTo(64, 87); ctx.fill();
    } };
    case SIGN.STOP: return { w: 0.75, h: 0.75, y: 1.9, px: [128, 128], draw: (ctx) => {
      ctx.fillStyle = RED;
      ctx.beginPath();
      for (let k = 0; k < 8; k++) ctx.lineTo(64 + 63 * Math.cos(((k + 0.5) * Math.PI) / 4), 64 + 63 * Math.sin(((k + 0.5) * Math.PI) / 4));
      ctx.fill();
      word(ctx, 'STOP', 64, 66, 38, '#fff');
    } };
    case SIGN.MAXSPEED: return { w: 0.7, h: 0.7, y: 1.9, px: [128, 128], draw: (ctx) => {
      ctx.fillStyle = RED;
      ctx.beginPath(); ctx.arc(64, 64, 63, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(64, 64, 50, 0, Math.PI * 2); ctx.fill();
      word(ctx, String(value), 64, 68, 52);
    } };
    case SIGN.CITY: return { w: 1.7, h: 0.75, y: 1.5, px: [256, 112], draw: (ctx) => {
      ctx.fillStyle = INK; ctx.fillRect(0, 0, 256, 112);
      ctx.fillStyle = '#fff'; ctx.fillRect(7, 7, 242, 98);
      word(ctx, names[value] ?? '', 128, 58, 46, INK, 226);
    } };
    case SIGN.BUS: return { w: 1.0, h: 0.5, y: 2.0, px: [256, 128], draw: (ctx) => {
      // obecná deska zastávky: piktogram autobusu a jméno zastávky z OSM
      ctx.fillStyle = BLUE; ctx.fillRect(0, 0, 256, 128);
      ctx.fillStyle = '#fff'; ctx.fillRect(6, 6, 244, 116);
      ctx.fillStyle = INK; ctx.fillRect(16, 30, 70, 46);
      ctx.fillStyle = '#fff'; ctx.fillRect(22, 36, 58, 18);
      ctx.fillStyle = INK;
      ctx.beginPath(); ctx.arc(32, 80, 8, 0, Math.PI * 2); ctx.arc(70, 80, 8, 0, Math.PI * 2); ctx.fill();
      const [town, stop] = (names[value] ?? '').split(/,\s*/);
      word(ctx, stop ? town : 'Zastávka', 168, 40, 24, INK, 150);
      word(ctx, stop ?? town ?? '', 168, 82, 26, INK, 150);
    } };
    case SIGN.SIGNALS: return { w: 0.38, h: 0.95, y: 2.5, px: [52, 128], draw: (ctx) => {
      ctx.fillStyle = '#26282b'; ctx.fillRect(0, 0, 52, 128);
      ['#d2312b', '#e3a92a', '#3fae4f'].forEach((c, k) => {
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.arc(26, 22 + k * 42, 15, 0, Math.PI * 2); ctx.fill();
      });
    } };
    default: return { w: 0.5, h: 0.36, y: 3.2, px: [128, 92], draw: (ctx) => { // radar
      ctx.fillStyle = '#9aa0a6'; ctx.fillRect(0, 0, 128, 92);
      ctx.fillStyle = '#26282b';
      ctx.beginPath(); ctx.arc(64, 46, 26, 0, Math.PI * 2); ctx.fill();
    } };
  }
}

// atlas: desky v řádcích, každá jednou bez ohledu na počet značek
function atlas(plates, anisotropy) {
  const W = 512;
  let x = 0, y = 0, row = 0;
  for (const p of plates.values()) {
    if (x + p.px[0] > W) { x = 0; y += row; row = 0; }
    p.at = [x, y];
    x += p.px[0] + 2;
    row = Math.max(row, p.px[1] + 2);
  }
  const c = document.createElement('canvas');
  c.width = W;
  c.height = THREE.MathUtils.ceilPowerOfTwo(Math.max(1, y + row));
  const ctx = c.getContext('2d');
  for (const p of plates.values()) {
    ctx.save();
    ctx.translate(...p.at);
    ctx.beginPath(); ctx.rect(0, 0, ...p.px); ctx.clip();
    p.draw(ctx);
    ctx.restore();
    p.uv = [p.at[0] / W, (p.at[0] + p.px[0]) / W, 1 - (p.at[1] + p.px[1]) / c.height, 1 - p.at[1] / c.height];
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

// inHouse(x, z): bod leží v budově (posunutá značka by v ní zmizela)
export function buildRoadSigns(town, track, terrain, anisotropy, inHouse) {
  const group = new THREE.Group();
  group.name = 'road-signs';
  const items = town.signs.filter((s) => !terrain.keepOut(s.x, s.z) && terrain.distAt(s.x, s.z) > track.edge + 0.4 && !inHouse(s.x, s.z));
  if (!items.length) return group;
  const plates = new Map();
  for (const s of items) {
    const key = `${s.kind}:${s.value}`;
    if (!plates.has(key)) plates.set(key, plateOf(s.kind, s.value, town.signNames));
  }
  const map = atlas(plates, anisotropy);
  const faces = part(), poles = [];
  const front = new THREE.Color('#ffffff'), back = new THREE.Color('#5a5d61');
  for (const s of items) {
    const p = plates.get(`${s.kind}:${s.value}`);
    const ground = terrain.heightAt(s.x, s.z);
    const nx = Math.sin(s.ry), nz = Math.cos(s.ry); // normála líce
    const ax = nz, az = -nx; // vodorovně po desce, zleva doprava při pohledu na líc
    const y0 = ground + p.y, y1 = y0 + p.h, hw = p.w / 2;
    const at = (u, y, off) => [s.x + ax * u + nx * off, y, s.z + az * u + nz * off];
    const [u0, u1, v0, v1] = p.uv;
    const a = at(-hw, y0, 0.03), b = at(-hw, y1, 0.03), c = at(hw, y1, 0.03), d = at(hw, y0, 0.03);
    const n = [nx, 0, nz];
    vertex(faces, a, n, front, u0, v0); vertex(faces, d, n, front, u1, v0); vertex(faces, c, n, front, u1, v1);
    vertex(faces, a, n, front, u0, v0); vertex(faces, c, n, front, u1, v1); vertex(faces, b, n, front, u0, v1);
    // rub je šedý, tvar mu dá průhlednost textury
    const A = at(-hw, y0, 0.01), B = at(-hw, y1, 0.01), C = at(hw, y1, 0.01), D = at(hw, y0, 0.01);
    const m = [-nx, 0, -nz];
    vertex(faces, A, m, back, u0, v0); vertex(faces, C, m, back, u1, v1); vertex(faces, D, m, back, u1, v0);
    vertex(faces, A, m, back, u0, v0); vertex(faces, B, m, back, u0, v1); vertex(faces, C, m, back, u1, v1);
    // značka obce stojí na dvou sloupcích, ostatní na jednom
    for (const u of s.kind === SIGN.CITY ? [-hw * 0.7, hw * 0.7] : [0]) {
      const top = y1 - 0.05, len = top - ground + 0.3;
      poles.push(colored(new THREE.CylinderGeometry(0.04, 0.045, len, 6).toNonIndexed()
        .translate(s.x + ax * u - nx * 0.02, ground - 0.3 + len / 2, s.z + az * u - nz * 0.02), '#8d9399'));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(faces.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(faces.nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(faces.col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(faces.uv, 2));
  group.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map, vertexColors: true, alphaTest: 0.5 })));
  group.add(new THREE.Mesh(mergeGeometries(poles), new THREE.MeshLambertMaterial({ vertexColors: true })));
  return group;
}
