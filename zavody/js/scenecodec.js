// Binární formát kulis města (data/<město>.bin), společný pro hru i nástroje. Obsah je stejný jako dřívější JSON
// (decimetry jako celá čísla), jen velká pole celých čísel jdou mimo JSON jako proudy rozdílů:
//   'TOSC', verze, délka hlavičky, hlavička (JSON kostra scény se zástupci {$: druh}), proud čísel.
// Čísla jsou zigzag varinty rozdílů od předpovědi: výšková mřížka od roviny sousedů, obrysy od předchozího bodu
// (i přes hranici záznamu, domy v bloku leží u sebe), řady bodů od stejného sloupce předchozí n-tice.
// Celý soubor je ještě zabalený gzipem; hra ho rozbalí přes DecompressionStream.

const MAGIC = [0x54, 0x4f, 0x53, 0x43]; // TOSC
const VERSION = 1;

// Záznamy [předpona řetězců…, hlava celých čísel…, x, z, x, z, …]: počet čísel hlavy, která se nepočítají jako body.
const RECORDS = { buildings: 5, areas: 0, paved: 0, streets: 1, paths: 0, streams: 0, treeRows: 0, barriers: 1 };
// Ploché řady n-tic: délka n-tice (rozdíl se bere od stejného sloupce předchozí n-tice).
const ROWS = { lamps: 2, trees: 2, statues: 2, canopy: 4, cars: 3, signs: 5, buses: 3, levels: 2, facades: 2, shops: 1 };

class Writer {
  constructor() { this.buf = new Uint8Array(1 << 16); this.n = 0; }
  byte(b) {
    if (this.n === this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.n++] = b;
  }
  uint(v) {
    if (!(v >= 0) || !Number.isSafeInteger(v)) throw new Error(`scéna: ${v} není nezáporné celé číslo`);
    while (v >= 128) { this.byte((v % 128) | 128); v = Math.floor(v / 128); }
    this.byte(v);
  }
  int(v) {
    if (!Number.isSafeInteger(v)) throw new Error(`scéna: ${v} není celé číslo`);
    this.uint(v >= 0 ? v * 2 : -v * 2 - 1);
  }
  bytes() { return this.buf.subarray(0, this.n); }
}

class Reader {
  constructor(bytes, at = 0) { this.b = bytes; this.i = at; }
  uint() {
    let v = 0, mul = 1, b;
    do {
      if (this.i >= this.b.length) throw new Error('scéna: soubor je useknutý');
      b = this.b[this.i++];
      v += (b & 127) * mul;
      mul *= 128;
    } while (b & 128);
    return v;
  }
  int() {
    const u = this.uint();
    return u % 2 ? -(u + 1) / 2 : u / 2;
  }
}

// výšková mřížka: předpověď z levého, horního a levého horního souseda (rovina)
function writeGrid(w, h, nx) {
  for (let k = 0; k < h.length; k++) {
    const i = k % nx, j = (k - i) / nx;
    const p = i && j ? h[k - 1] + h[k - nx] - h[k - nx - 1] : i ? h[k - 1] : j ? h[k - nx] : 0;
    w.int(h[k] - p);
  }
}
function readGrid(r, n, nx) {
  const h = new Array(n);
  for (let k = 0; k < n; k++) {
    const i = k % nx, j = (k - i) / nx;
    const p = i && j ? h[k - 1] + h[k - nx] - h[k - nx - 1] : i ? h[k - 1] : j ? h[k - nx] : 0;
    h[k] = p + r.int();
  }
  return h;
}

function writeRecords(w, list, head) {
  let px = 0, pz = 0;
  const pre = [];
  for (const rec of list) {
    let s = 0;
    while (s < rec.length && typeof rec[s] === 'string') s++;
    pre.push(s ? rec.slice(0, s) : null);
    const n = rec.length - s;
    w.uint(n);
    const h = Math.min(head, n);
    for (let i = 0; i < h; i++) w.int(rec[s + i]);
    let i = s + h;
    for (; i + 1 < rec.length; i += 2) {
      w.int(rec[i] - px); w.int(rec[i + 1] - pz);
      px = rec[i]; pz = rec[i + 1];
    }
    if (i < rec.length) w.int(rec[i]);
  }
  const strings = pre.some(Boolean);
  return { $: 'rec', n: list.length, head, ...(strings ? { pre } : {}) };
}
function readRecords(r, ph) {
  let px = 0, pz = 0;
  const out = new Array(ph.n);
  for (let k = 0; k < ph.n; k++) {
    const n = r.uint();
    const rec = ph.pre?.[k] ? [...ph.pre[k]] : [];
    const h = Math.min(ph.head, n);
    for (let i = 0; i < h; i++) rec.push(r.int());
    let i = h;
    for (; i + 1 < n; i += 2) {
      px += r.int(); pz += r.int();
      rec.push(px, pz);
    }
    if (i < n) rec.push(r.int());
    out[k] = rec;
  }
  return out;
}

function writeRows(w, a, d) {
  for (let i = 0; i < a.length; i++) w.int(i >= d ? a[i] - a[i - d] : a[i]);
  return { $: 'rows', n: a.length, d };
}
function readRows(r, ph) {
  const a = new Array(ph.n);
  for (let i = 0; i < ph.n; i++) a[i] = (i >= ph.d ? a[i - ph.d] : 0) + r.int();
  return a;
}

// záznam: nejdřív řetězce (druh plochy), pak jen celá čísla
const isRecord = (rec) => {
  if (!Array.isArray(rec)) return false;
  let i = 0;
  while (i < rec.length && typeof rec[i] === 'string') i++;
  for (; i < rec.length; i++) if (!Number.isInteger(rec[i])) return false;
  return true;
};
const isRecordList = (v) => Array.isArray(v) && v.every(isRecord);
const isIntList = (v) => Array.isArray(v) && v.every(Number.isInteger);

// scéna (objekt jako z dřívějšího JSON) -> bajty bez komprese
export function encodeScene(scene) {
  const w = new Writer();
  const head = {};
  for (const [key, value] of Object.entries(scene)) {
    if (key === 'dem' && isIntList(value?.h)) {
      head.dem = { ...value, h: { $: 'grid', n: value.h.length } };
      writeGrid(w, value.h, value.nx);
    } else if (key in RECORDS && isRecordList(value)) head[key] = writeRecords(w, value, RECORDS[key]);
    else if (key in ROWS && isIntList(value)) head[key] = writeRows(w, value, ROWS[key]);
    else head[key] = value;
  }
  const json = new TextEncoder().encode(JSON.stringify(head));
  const out = new Writer();
  for (const b of MAGIC) out.byte(b);
  out.byte(VERSION);
  out.uint(json.length);
  for (const b of json) out.byte(b);
  const body = w.bytes();
  const all = new Uint8Array(out.n + body.length);
  all.set(out.bytes());
  all.set(body, out.n);
  return all;
}

// bajty bez komprese -> scéna; pořadí zástupců v hlavičce je pořadí proudů
export function decodeScene(bytes) {
  if (!MAGIC.every((b, i) => bytes[i] === b)) throw new Error('scéna: neznámý formát souboru');
  if (bytes[4] !== VERSION) throw new Error(`scéna: verze ${bytes[4]} není podporovaná`);
  const r = new Reader(bytes, 5);
  const len = r.uint();
  const head = JSON.parse(new TextDecoder().decode(bytes.subarray(r.i, r.i + len)));
  r.i += len;
  const scene = {};
  for (const [key, value] of Object.entries(head)) {
    if (value?.$ === 'rec') scene[key] = readRecords(r, value);
    else if (value?.$ === 'rows') scene[key] = readRows(r, value);
    else if (key === 'dem' && value?.h?.$ === 'grid') scene.dem = { ...value, h: readGrid(r, value.h.n, value.nx) };
    else scene[key] = value;
  }
  if (r.i !== bytes.length) throw new Error('scéna: po datech zbyly bajty');
  return scene;
}

export const isGzip = (b) => b[0] === 0x1f && b[1] === 0x8b;

// hra: stažený soubor (gzip, nebo už rozbalený serverem) -> scéna
export async function readScene(buffer) {
  let bytes = new Uint8Array(buffer);
  if (isGzip(bytes)) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return decodeScene(bytes);
}
