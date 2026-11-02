// Stavební objekty z RÚIAN (výměnný formát VFR, otevřená data ČÚZK): obrys v S-JTSK a počet podlaží.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pointInRing } from './poly.mjs';

// vrací [{ code, levels, ring: [[e, n], …], box: [e0, n0, e1, n1] }]; bez souboru prázdné pole
export function loadRuian(dir) {
  if (!existsSync(dir)) return [];
  const file = readdirSync(dir).filter((f) => f.endsWith('.xml')).sort().pop(); // nejnovější měsíc
  if (!file) return [];
  const xml = readFileSync(join(dir, file), 'utf8');
  const out = [];
  for (const so of xml.split('<vf:StavebniObjekt ').slice(1)) {
    const levels = +(so.match(/<soi:PocetPodlazi>(\d+)</)?.[1] ?? 0);
    const pos = so.match(/<soi:OriginalniHranice>[\s\S]*?<gml:exterior>[\s\S]*?<gml:posList>([^<]+)</)?.[1];
    if (!levels || !pos) continue;
    const v = pos.trim().split(/\s+/).map(Number);
    const ring = [];
    for (let i = 0; i + 1 < v.length; i += 2) ring.push([v[i], v[i + 1]]);
    const es = ring.map((p) => p[0]), ns = ring.map((p) => p[1]);
    out.push({ code: +so.match(/<soi:Kod>(\d+)</)[1], levels, ring, box: [Math.min(...es), Math.min(...ns), Math.max(...es), Math.max(...ns)] });
  }
  return out;
}

// stavební objekt, do kterého padne bod [e, n]
export function ruianAt(objects, e, n) {
  return objects.find((o) => e >= o.box[0] && e <= o.box[2] && n >= o.box[1] && n <= o.box[3] && pointInRing(e, n, o.ring));
}
