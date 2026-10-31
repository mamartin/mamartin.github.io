// Sdílení ghost jízdy odkazem (#g=...): kamarád pak v časovce jede proti tvému nejlepšímu kolu.
// Poloha se ukládá po centimetrech jako rozdíly mezi snímky (malá čísla), zabalená kompresí.

const KEY = 'turbo-okruh-sghost-';

const b64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64 = (str) => {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

async function pipe(bytes, Stream, format) {
  const stream = new Blob([bytes]).stream().pipeThrough(new Stream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
const canZip = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

// ghost = { time, rate, frames: [x, y, z, hd, ...] }
export async function encodeGhost(trackId, kind, name, ghost) {
  const f = ghost.frames;
  const n = f.length / 4;
  const buf = new DataView(new ArrayBuffer(16 + Math.max(0, n - 1) * 8));
  const q = (i) => [Math.round(f[i] * 100), Math.round(f[i + 1] * 100), Math.round(f[i + 2] * 100), Math.round(f[i + 3] * 1000)];
  let prev = q(0);
  prev.forEach((v, j) => buf.setInt32(j * 4, v));
  for (let k = 1; k < n; k++) {
    const cur = q(k * 4);
    for (let j = 0; j < 4; j++) buf.setInt16(16 + (k - 1) * 8 + j * 2, Math.max(-32768, Math.min(32767, cur[j] - prev[j])));
    prev = cur;
  }
  let bytes = new Uint8Array(buf.buffer);
  const zip = canZip;
  if (zip) bytes = await pipe(bytes, CompressionStream, 'deflate-raw');
  const head = b64(new TextEncoder().encode(JSON.stringify({ t: trackId, k: kind, n: name, ms: Math.round(ghost.time * 1000), r: ghost.rate })));
  return `${head}.${zip ? 'z' : 'r'}${b64(bytes)}`;
}

export async function decodeGhost(str) {
  const [head, data] = str.split('.');
  const h = JSON.parse(new TextDecoder().decode(unb64(head)));
  let bytes = unb64(data.slice(1));
  if (data[0] === 'z') bytes = await pipe(bytes, DecompressionStream, 'deflate-raw');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const cur = [0, 1, 2, 3].map((j) => view.getInt32(j * 4));
  const frames = [];
  const push = () => frames.push(cur[0] / 100, cur[1] / 100, cur[2] / 100, cur[3] / 1000);
  push();
  for (let o = 16; o + 8 <= bytes.length; o += 8) {
    for (let j = 0; j < 4; j++) cur[j] += view.getInt16(o + j * 2);
    push();
  }
  return { trackId: h.t, kind: h.k, name: h.n || 'Kamarád', ghost: { time: h.ms / 1000, rate: h.r || 20, frames } };
}

export function sharedGhost(trackId) {
  try {
    return JSON.parse(localStorage.getItem(KEY + trackId) || 'null');
  } catch {
    return null;
  }
}

export function saveSharedGhost(trackId, name, ghost) {
  try {
    localStorage.setItem(KEY + trackId, JSON.stringify({ name, ...ghost }));
  } catch {
    /* plné úložiště: ghost se jen nepamatuje */
  }
}
