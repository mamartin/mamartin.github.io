// Minimální čtečka PNG (8 bitů, RGB/RGBA/šedá, bez prokládání) pro dlaždice ortofota; bez závislostí.
import { inflateSync } from 'node:zlib';

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

// bajty souboru -> { w, h, rgb: Uint8Array w*h*3 }
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('png: není PNG');
  let at = 8, w = 0, h = 0, type = 0, depth = 0, interlace = 0, palette = null;
  const idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const kind = buf.toString('latin1', at + 4, at + 8);
    const body = buf.subarray(at + 8, at + 8 + len);
    if (kind === 'IHDR') {
      w = body.readUInt32BE(0); h = body.readUInt32BE(4);
      depth = body[8]; type = body[9]; interlace = body[12];
    } else if (kind === 'PLTE') palette = body;
    else if (kind === 'IDAT') idat.push(body);
    else if (kind === 'IEND') break;
    at += 12 + len;
  }
  if (depth !== 8 || interlace) throw new Error(`png: nepodporovaný formát (hloubka ${depth}, prokládání ${interlace})`);
  const ch = type === 3 ? 1 : CHANNELS[type];
  if (!ch) throw new Error(`png: nepodporovaný typ barvy ${type}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = y * stride, up = row - stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? px[row + i - ch] : 0;
      const b = y ? px[up + i] : 0;
      const c = i >= ch && y ? px[up + i - ch] : 0;
      let v = src[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[row + i] = v & 255;
    }
  }
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    if (type === 3) {
      const k = px[i] * 3;
      rgb[i * 3] = palette[k]; rgb[i * 3 + 1] = palette[k + 1]; rgb[i * 3 + 2] = palette[k + 2];
    } else if (ch < 3) rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = px[i * ch];
    else for (let c = 0; c < 3; c++) rgb[i * 3 + c] = px[i * ch + c];
  }
  return { w, h, rgb };
}
