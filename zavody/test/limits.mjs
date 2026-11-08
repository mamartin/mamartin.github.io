// Limity testu na jednom místě.
// Výkon: 20 bodů podél Dobříše, kamera za autem, jedno vykreslení se stíny (kvalita Vysoká, 16:9).
// Stav 3. 11. 2026 tímto měřením po zlevnění vykreslování (čtverce terénu a trati, stupně podrobnosti):
// průměr 194 volání / 223 tis. trojúhelníků, maximum 384 / 356 tis. (volání v 3,8 km, centrum u startu);
// limity jsou asi o 15 % výš, u volání zůstaly původní (počet volání se nezměnil).
export const PERF = {
  avgCalls: 225,
  avgTriangles: 260_000,
  maxCalls: 430,
  maxTriangles: 410_000,
};

// Závody autopilotem: počet kol, zrychlení času a nejlepší kolo hráče jako průměrná rychlost v km/h.
export const RACE = {
  laps: 2,
  timeScale: 100,
  lapSpeed: { min: 45, max: 200 },
  // nejdéle jak dlouho (v čase hry) smí závod trvat, než se prohlásí za zaseknutý: kola × délka / rychlost
  slowestKmh: 15,
};

// Tratě, které se jedou: Dobříš po směru i obráceně, Příbram a jedna vymyšlená trať.
export const RACES = [
  { track: 'dobris', reverse: false },
  { track: 'dobris', reverse: true },
  { track: 'pribram', reverse: false },
  { track: 'sumava', reverse: false },
];

// Kolik bodů podél Dobříše se měří.
export const PERF_POINTS = 20;
