// Výběr města pro nástroje trati. Nastavení každého města je v tools/cities/<id>.mjs,
// surová data v tools/data/<id>/, výstup do hry v js/tracks-<id>.js a data/<id>.json.
// Město je první argument příkazu, bez něj Dobříš.
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const TOOLS = join(dirname(fileURLToPath(import.meta.url)), '..');
export const GAME = join(TOOLS, '..');
const CITIES = join(TOOLS, 'cities');
export const DEFAULT_CITY = 'dobris';

export const cityIds = () => readdirSync(CITIES).filter((f) => f.endsWith('.mjs')).map((f) => f.slice(0, -4));

// { city, args (bez jména města), data (složka surových dat), track, scene (cesty výstupu) }
export async function loadCity(argv = process.argv.slice(2)) {
  const ids = cityIds();
  const id = argv.find((a) => ids.includes(a)) ?? DEFAULT_CITY;
  const city = (await import(pathToFileURL(join(CITIES, `${id}.mjs`)).href)).default;
  if (city.id !== id) throw new Error(`cities/${id}.mjs má id ${city.id}`);
  return {
    city,
    args: argv.filter((a) => a !== id),
    data: join(TOOLS, 'data', id),
    loops: join(CITIES, `${id}-loops.json`),
    track: join(GAME, 'js', `tracks-${id}.js`),
    scene: join(GAME, 'data', `${id}.json`),
  };
}

// vygenerovaná definice trati města (js/tracks-<id>.js), null když ještě není
export async function loadTrack(ctx) {
  if (!existsSync(ctx.track)) return null;
  return (await import(pathToFileURL(ctx.track).href))[ctx.city.exportName];
}
