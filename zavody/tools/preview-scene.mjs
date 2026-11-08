// Pohled shora na vygenerovanou scénu, čte jen js/tracks-<město>.js a data/<město>.json.
// Použití: node preview-scene.mjs [město]   (píše data/<město>/loops/scena-*.svg)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildCenterline } from '../js/trackmath.js';
import { loadCity, loadTrack } from './lib/city.mjs';

const ctx = await loadCity();
const TRACK = await loadTrack(ctx);
if (!TRACK) throw new Error(`Trať ${ctx.city.name} ještě není vygenerovaná (node osm2track.mjs ${ctx.city.id})`);
const scene = JSON.parse(readFileSync(ctx.scene, 'utf8'));
const cl = buildCenterline(TRACK);
const OUT = join(ctx.data, 'loops');
mkdirSync(OUT, { recursive: true });
const AREA = { forest: '#b9d6a2', park: '#cfe6b8', grass: '#dcebc6', field: '#eee7c4', cemetery: '#c9dcb8', allotments: '#d9e4b4', pitch: '#bfe0b0' };

function render(name, x0, x1, z0, z1, px) {
  const W = px, S = W / (x1 - x0), H = Math.round((z1 - z0) * S);
  const X = (v) => +((v / 10 - x0) * S).toFixed(1), Y = (v) => +((v / 10 - z0) * S).toFixed(1);
  const list = (p) => {
    const o = [];
    for (let i = 0; i < p.length; i += 2) o.push(`${X(p[i])},${Y(p[i + 1])}`);
    return o.join(' ');
  };
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Helvetica,Arial,sans-serif"><rect width="${W}" height="${H}" fill="#eef0e4"/>`];
  for (const a of scene.areas) out.push(`<polygon points="${list(a.slice(1))}" fill="${AREA[a[0]] ?? '#ddd'}"/>`);
  for (const a of scene.paved) out.push(`<polygon points="${list(a.slice(1))}" fill="${a[0] === 'square' ? '#d9d2c4' : '#cfcac2'}"/>`);
  for (const w of scene.water) out.push(`<polygon points="${list(w.p)}" fill="#8fc3e6"/>`);
  for (const l of scene.streams) out.push(`<polyline points="${list(l)}" fill="none" stroke="#8fc3e6" stroke-width="${Math.max(1, S * 1.5)}"/>`);
  for (const l of scene.paths) out.push(`<polyline points="${list(l)}" fill="none" stroke="#c9bfa8" stroke-width="${Math.max(0.6, S * 1.6)}"/>`);
  for (const l of scene.streets) out.push(`<polyline points="${list(l.slice(1))}" fill="none" stroke="#9b9a96" stroke-linecap="round" stroke-width="${Math.max(1, (l[0] / 10) * S)}"/>`);
  for (const l of scene.barriers) out.push(`<polyline points="${list(l.slice(1))}" fill="none" stroke="${['#7d6a58', '#7d6a58', '#99938a', '#5e8a4e'][l[0]]}" stroke-width="${Math.max(0.8, S * 0.5)}"/>`);
  // silnice podle profilu šířek
  const widthAt = (s) => {
    let w = TRACK.widths[0][1];
    for (const [from, v] of TRACK.widths) if (s >= from) w = v;
    return w;
  };
  const left = [], right = [];
  for (let k = 0; k < cl.N; k += 2) {
    const hw = (widthAt(cl.s[k]) + 2 * TRACK.runoff * 0) / 2;
    left.push(`${X((cl.px[k] + cl.rx[k] * hw) * 10)},${Y((cl.pz[k] + cl.rz[k] * hw) * 10)}`);
    right.push(`${X((cl.px[k] - cl.rx[k] * hw) * 10)},${Y((cl.pz[k] - cl.rz[k] * hw) * 10)}`);
  }
  out.push(`<polygon points="${left.join(' ')}" fill="none" stroke="#3c3f45" stroke-width="1.5"/><polygon points="${right.join(' ')}" fill="none" stroke="#3c3f45" stroke-width="1.5"/>`);
  const axis = [];
  for (let k = 0; k < cl.N; k += 2) axis.push(`${X(cl.px[k] * 10)},${Y(cl.pz[k] * 10)}`);
  out.push(`<polygon points="${axis.join(' ')}" fill="none" stroke="#3c3f45" stroke-width="${Math.max(3, 12 * S)}" stroke-linejoin="round"/>`);
  out.push(`<polygon points="${axis.join(' ')}" fill="none" stroke="#f2d24a" stroke-width="1" stroke-dasharray="6 6"/>`);
  for (const b of scene.buildings) out.push(`<polygon points="${list(b.slice(5))}" fill="${scene.palette.roof[b[4]]}" stroke="#00000030" stroke-width="0.4"/>`);
  for (const l of scene.landmarks) out.push(`<polygon points="${list(l.p)}" fill="#7a1fd0" stroke="#fff" stroke-width="1"/>`);
  for (let i = 0; i < scene.lamps.length; i += 2) out.push(`<circle cx="${X(scene.lamps[i])}" cy="${Y(scene.lamps[i + 1])}" r="${Math.max(1.4, S)}" fill="#e2a100"/>`);
  for (let i = 0; i < scene.trees.length; i += 2) out.push(`<circle cx="${X(scene.trees[i])}" cy="${Y(scene.trees[i + 1])}" r="${Math.max(1.6, S * 2)}" fill="#3f7a35"/>`);
  out.push(`<circle cx="${X(0)}" cy="${Y(0)}" r="9" fill="#111" stroke="#fff" stroke-width="3"/>`);
  out.push('</svg>');
  writeFileSync(join(OUT, `scena-${name}.svg`), out.join(''));
}

// výřezy z nastavení města, jinak celá výšková mřížka
const d = scene.dem;
const views = ctx.city.sceneViews ?? [{ name: 'celek', x0: d.x0, x1: d.x0 + (d.nx - 1) * d.cell, z0: d.z0, z1: d.z0 + (d.nz - 1) * d.cell }];
for (const v of views) render(v.name, v.x0, v.x1, v.z0, v.z1, 1600);
