// Limity testu na jednom místě.
// Výkon: 20 bodů podél Dobříše, kamera za autem, jedno vykreslení se stíny (kvalita Vysoká, 16:9).
// Stav 3. 11. 2026 tímto měřením: průměr 195 volání / 356 tis. trojúhelníků, maximum 375 / 537 tis.
// (v 3,8 km, centrum u startu); limity jsou asi o 15 % výš.
export const PERF = {
  avgCalls: 225,
  avgTriangles: 410_000,
  maxCalls: 430,
  maxTriangles: 620_000,
};

// Závody autopilotem: počet kol, zrychlení času a nejlepší kolo hráče jako průměrná rychlost v km/h.
export const RACE = {
  laps: 2,
  timeScale: 100,
  lapSpeed: { min: 45, max: 200 },
  // nejdéle jak dlouho (v čase hry) smí závod trvat, než se prohlásí za zaseknutý: kola × délka / rychlost
  slowestKmh: 15,
};

// Tratě, které se jedou: Dobříš po směru i obráceně a jedna vymyšlená trať.
export const RACES = [
  { track: 'dobris', reverse: false },
  { track: 'dobris', reverse: true },
  { track: 'sumava', reverse: false },
];

// Kolik bodů podél Dobříše se měří.
export const PERF_POINTS = 20;
