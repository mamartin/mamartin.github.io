// Převede listy DMR 5G (LAZ) na pravidelnou výškovou mřížku v S-JTSK.
// Použití: node laz2grid.mjs <vystup.bin> <list1.laz> [list2.laz ...]
// Výstup: bin (Float32, řádky od severu) + stejnojmenný .json s popisem mřížky.

import { readFileSync, writeFileSync } from 'node:fs';
import { createLazPerf } from 'laz-perf';

const CELL = 4; // metry

function readHeader(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const major = dv.getUint8(24), minor = dv.getUint8(25);
  const count = major === 1 && minor >= 4 ? Number(dv.getBigUint64(247, true)) : dv.getUint32(107, true);
  return {
    count,
    recordLength: dv.getUint16(105, true),
    scale: [dv.getFloat64(131, true), dv.getFloat64(139, true), dv.getFloat64(147, true)],
    offset: [dv.getFloat64(155, true), dv.getFloat64(163, true), dv.getFloat64(171, true)],
    max: [dv.getFloat64(179, true), dv.getFloat64(195, true), dv.getFloat64(211, true)],
    min: [dv.getFloat64(187, true), dv.getFloat64(203, true), dv.getFloat64(219, true)],
  };
}

const [out, ...files] = process.argv.slice(2);
if (!out || !files.length) {
  console.error('Použití: node laz2grid.mjs <vystup.bin> <list1.laz> [list2.laz ...]');
  process.exit(1);
}

const Laz = await createLazPerf();
const headers = files.map((f) => readHeader(readFileSync(f)));
const minX = Math.floor(Math.min(...headers.map((h) => h.min[0])) / CELL) * CELL;
const minY = Math.floor(Math.min(...headers.map((h) => h.min[1])) / CELL) * CELL;
const maxX = Math.ceil(Math.max(...headers.map((h) => h.max[0])) / CELL) * CELL;
const maxY = Math.ceil(Math.max(...headers.map((h) => h.max[1])) / CELL) * CELL;
const nx = Math.round((maxX - minX) / CELL) + 1;
const ny = Math.round((maxY - minY) / CELL) + 1;
const sum = new Float64Array(nx * ny);
const cnt = new Uint16Array(nx * ny);

let total = 0;
for (const f of files) {
  const buf = readFileSync(f);
  const h = readHeader(buf);
  const filePtr = Laz._malloc(buf.byteLength);
  Laz.HEAPU8.set(buf, filePtr);
  const zip = new Laz.LASZip();
  zip.open(filePtr, buf.byteLength);
  const dataPtr = Laz._malloc(h.recordLength);
  for (let i = 0; i < h.count; i++) {
    zip.getPoint(dataPtr);
    const dv = new DataView(Laz.HEAPU8.buffer, dataPtr, h.recordLength);
    const x = dv.getInt32(0, true) * h.scale[0] + h.offset[0];
    const y = dv.getInt32(4, true) * h.scale[1] + h.offset[1];
    const z = dv.getInt32(8, true) * h.scale[2] + h.offset[2];
    const c = Math.round((x - minX) / CELL);
    const r = Math.round((maxY - y) / CELL);
    if (c < 0 || c >= nx || r < 0 || r >= ny) continue;
    sum[r * nx + c] += z;
    cnt[r * nx + c]++;
  }
  total += h.count;
  zip.delete();
  Laz._free(dataPtr);
  Laz._free(filePtr);
  console.log(`${f}: ${h.count} bodů, x ${h.min[0].toFixed(0)}..${h.max[0].toFixed(0)}, y ${h.min[1].toFixed(0)}..${h.max[1].toFixed(0)}, z ${h.min[2].toFixed(1)}..${h.max[2].toFixed(1)}`);
}

// prázdné buňky doplní šířením od sousedů (body DMR nejsou v mřížce, hustota kolísá)
let grid = new Float32Array(nx * ny).fill(NaN);
let filled = 0;
for (let i = 0; i < grid.length; i++) if (cnt[i]) { grid[i] = sum[i] / cnt[i]; filled++; }
console.log(`celkem ${total} bodů, buňka ${CELL} m, mřížka ${nx}×${ny}, pokrytí ${((filled / grid.length) * 100).toFixed(1)} %`);
for (let pass = 0, missing = 1; missing && pass < 400; pass++) {
  const next = grid.slice();
  missing = 0;
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
    const i = r * nx + c;
    if (!Number.isNaN(grid[i])) continue;
    let s = 0, n = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= ny || cc < 0 || cc >= nx) continue;
      const v = grid[rr * nx + cc];
      if (!Number.isNaN(v)) { s += v; n++; }
    }
    if (n) next[i] = s / n;
    else missing++;
  }
  grid = next;
}

writeFileSync(out, Buffer.from(grid.buffer));
writeFileSync(out.replace(/\.bin$/, '') + '.json', JSON.stringify({ minX, maxX, minY, maxY, nx, ny, cell: CELL }, null, 1));
