// Sezóna: série závodů s pevnými podmínkami. Každý závod má tři cíle, za každý splněný cíl je
// hvězda a hvězdy odemykají další série a nové laky a designy v garáži.
export const SERIES = [
  {
    name: 'Nováček', need: 0, events: [
      { id: 's1', track: 'sumava', laps: 2, difficulty: 'easy', rival: 'Lance Stroll', place: 3, drift: 2 },
      { id: 's2', track: 'kanon', laps: 2, difficulty: 'easy', rival: 'Valtteri Bottas', place: 2, drift: 2 },
      { id: 's3', track: 'mesto', laps: 2, difficulty: 'medium', rival: 'Franco Colapinto', place: 3, drift: 3 },
      { id: 's4', track: 'serpentiny', laps: 2, difficulty: 'medium', rival: 'Sergio Pérez', place: 3, drift: 3 },
    ],
  },
  {
    name: 'Profík', need: 6, events: [
      { id: 's5', track: 'sumava~r', laps: 3, difficulty: 'medium', rival: 'Pierre Gasly', place: 2, drift: 4 },
      { id: 's6', track: 'kanon', laps: 3, difficulty: 'medium', rain: true, rival: 'Esteban Ocon', place: 2, drift: 4 },
      { id: 's7', track: 'mesto~r', laps: 3, difficulty: 'medium', rival: 'Alex Albon', place: 1, drift: 5 },
      { id: 's8', track: 'serpentiny~r', laps: 3, difficulty: 'hard', weapons: false, rival: 'Carlos Sainz', place: 4, drift: 5 },
    ],
  },
  {
    name: 'Mistr', need: 15, events: [
      { id: 's9', track: 'kanon~r', laps: 3, difficulty: 'hard', rival: 'Fernando Alonso', place: 3, drift: 6 },
      { id: 's10', track: 'mesto', laps: 3, difficulty: 'hard', rain: true, rival: 'George Russell', place: 3, drift: 6 },
      { id: 's11', track: 'sumava', laps: 4, difficulty: 'hard', rain: true, weapons: false, rival: 'Charles Leclerc', place: 2, drift: 8 },
      { id: 's12', track: 'serpentiny', laps: 4, difficulty: 'expert', rival: 'Max Verstappen', place: 3, drift: 8 },
    ],
  },
];

export const SEASON_EVENTS = SERIES.flatMap((s) => s.events);
export const seasonEvent = (id) => SEASON_EVENTS.find((e) => e.id === id) || SEASON_EVENTS[0];
export const seriesOf = (ev) => SERIES.find((s) => s.events.includes(ev));

// odměny za hvězdy; kdo je jednou získá, tomu zůstanou
export const UNLOCKS = [
  { stars: 3, design: { name: 'Kobalt', color: 0x1b2a6b, accent: 0x6ec6f0, livery: { wings: 0x6ec6f0, rims: 0xf2f2ee, finish: 'metal' } } },
  { stars: 6, finish: 'pearl', name: 'Perleť' },
  { stars: 10, design: { name: 'Karbon', color: 0x24272c, accent: 0xd7263d, livery: { wings: 0x16181d, rims: 0xd7263d, trim: 0x16181d, finish: 'matte' } } },
  { stars: 15, design: { name: 'Tyrkys', color: 0x11aa99, accent: 0xf2f2ee, livery: { wings: 0xf2f2ee, rims: 0xf2f2ee, finish: 'pearl' } } },
  { stars: 20, finish: 'chrome', name: 'Chrom' },
  { stars: 26, design: { name: 'Neon', color: 0xe85d9c, accent: 0x8fd42a, livery: { wings: 0x8fd42a, rims: 0x1d1f24, trim: 0x1d1f24, finish: 'pearl' } } },
  { stars: 36, design: { name: 'Mistr sezóny', color: 0xd4a72c, accent: 0x16181d, livery: { wings: 0x16181d, rims: 0x16181d, plate: 0xd4a72c, finish: 'chrome' } } },
];
export const unlockName = (u) => (u.design ? `design ${u.design.name}` : `lak ${u.name}`);

const bits = (m) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1);
export const eventMask = (store, id) => store.season.done?.[id] || 0;
export const eventStars = (store, id) => bits(eventMask(store, id));
export const totalStars = (store) => SEASON_EVENTS.reduce((n, e) => n + eventStars(store, e.id), 0);
export const seriesOpen = (store, s) => totalStars(store) >= s.need;
export const eventOpen = (store, ev) => seriesOpen(store, seriesOf(ev));

// splněné cíle se sčítají napříč pokusy; vrací masku po uložení
export function submitEvent(store, id, mask) {
  store.season.done ??= {};
  store.season.done[id] = eventMask(store, id) | mask;
  store.save();
  return store.season.done[id];
}

// tři cíle závodu v pořadí bitů masky: umístění, mini-turba, rival
export function goals(ev, rival) {
  return [
    { text: ev.place === 1 ? 'Vyhraj závod' : `Dojeď nejhůř ${ev.place}.` },
    { text: `Aspoň ${ev.drift} mini-turba` },
    { text: `Poraz rivala: ${rival}` },
  ];
}

export const starsHtml = (n, of = 3) => `<span class="stars" aria-label="${n} z ${of} hvězd">${'★'.repeat(n)}<i>${'★'.repeat(of - n)}</i></span>`;
