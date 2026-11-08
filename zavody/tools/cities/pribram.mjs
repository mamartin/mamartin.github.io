// Nastavení trati Příbram pro nástroje (fetch-data, loops, preview, osm2track, check-scene).
// Rozpracované: okruh, start a tribuna se vyberou podle průzkumu (loops.mjs, preview.mjs).

export default {
  id: 'pribram',
  name: 'Příbram',
  exportName: 'PRIBRAM',
  subtitle: 'Náměstí T. G. Masaryka a Svatá Hora, skutečné ulice',
  seed: 2611,

  // --- stahování (fetch-data.mjs) ---
  // centrum, Svatá Hora a Březové Hory s rezervou pro kulisy (400 m) a výškovou mřížku (560 m)
  bbox: '49.664,13.955,49.712,14.052',
  sheets: ['PRIB00', 'PRIB01', 'PRIB02', 'PRIB10', 'PRIB11', 'PRIB12', 'PRIB20', 'PRIB21', 'PRIB22'], // listy DMR 5G / DMP 1G
  obec: 539911, // kód obce v RÚIAN
  townHallNames: 'radnice|Radnice|[Mm]ěstský úřad|[Mm]ěsto Příbram',

  // --- osa trati ---
  survey: [49.6885, 14.009], // náměstí T. G. Masaryka
  loop: 'B', // Březové Hory: nejmírnější stoupání a nejdelší rovinka, kolem dolů a přes náměstí (průzkum 8. 11. 2026)
  start: [-856, 258], // v souřadnicích pribram-loops.json: rovinka Husovy mezi Plzeňskou a Březovými Horami, jede se na jihozápad
  stand: 320, // tribuna na volném místě vpravo za startem na Husově (nezakryje žádný dům)

  // --- centrum: osa náměstí T. G. Masaryka od jihu na sever; okolní domy mají pestřejší fasády, na náměstí je obrubník ---
  centre: [[49.68735, 14.00905], [49.68863, 14.00887]],
  urban: { start: 0, centre: 60 },

  // --- dominanty: OSM id budovy -> id ručního modelu v js/landmarks.js ---
  landmarks: {
    20255512: 'sh-ambit', 192151269: 'sh-bazilika',
    1246102801: 'sh-kaple-plzenska', 1246102802: 'sh-kaple-breznicka', 1246102803: 'sh-kaple-prazska', 1246102804: 'sh-kaple-mnisecka',
  },
  requiredLandmarks: ['sh-ambit', 'sh-bazilika'],
  // Svatá Hora je 650 m od trati, za dosahem kulis: areál s okolím je ve scéně navíc, aby byl vidět v dálce
  far: [{ name: 'Svatá Hora', at: [49.685, 14.0176], r: 200 }],
  maxSceneKb: 650, // hustá zástavba podél 4,2 km a areál Svaté Hory navíc (gzip zhruba čtvrtina)

  // --- náhledy ---
  preview: {
    center: 'auto',
    profileFrom: 'od prvního průjezdního bodu',
    labels: [
      { name: 'Svatá Hora', at: [49.685, 14.0176], dy: 22, dx: 10 },
      { name: 'Sv. Jakub', at: [49.6887, 14.0098], dy: -14, dx: 10 },
      { name: 'Radnice', at: [49.6892, 14.0106], dy: -12, dx: -70 },
      { name: 'Svatohorské schody', at: [49.6864, 14.0147], dy: -10, dx: 10 },
      { name: 'Důl Anna', at: [49.6876, 13.9942], dy: -12, dx: 10 },
      { name: 'Důl Prokop', at: [49.6854, 13.9953], dy: 18, dx: 10 },
      { name: 'Ševčinský důl', at: [49.6833, 13.9869], dy: 18, dx: -40 },
      { name: 'Sv. Vojtěch', at: [49.6832, 13.9899], dy: -10, dx: 10 },
    ],
  },
};
