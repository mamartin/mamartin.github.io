// Nastavení trati Dobříš pro nástroje (fetch-data, loops, preview, osm2track, check-scene).
// Co tu je, je ruční volba nebo oprava dat; ostatní je obecné v osm2track.mjs.

export default {
  id: 'dobris',
  name: 'Dobříš',
  exportName: 'DOBRIS',
  subtitle: 'Mírové náměstí, zámek a Pražská, skutečné ulice',
  seed: 2263,

  // --- stahování (fetch-data.mjs) ---
  bbox: '49.760,14.135,49.800,14.205',
  sheets: ['DOBR66', 'DOBR67', 'DOBR56', 'DOBR57'], // listy DMR 5G / DMP 1G
  obec: 540111, // kód obce v RÚIAN
  townHallNames: 'radnice|Radnice|[Mm]ěstský úřad|[Mm]ěsto Dobříš',

  // --- osa trati ---
  survey: [49.7815, 14.1745], // střed průzkumu okruhů (souřadnice loops.json)
  loop: 'A',
  start: [-140, -8], // v souřadnicích loops.json: rovný kus Pražské za radnicí, jede se na východ
  stand: 1020, // tribuna na louce u Pražské, kde nic nezakryje (na startu by schovala obchody)

  // --- dominanty: OSM id budovy -> id ručního modelu v js/landmarks.js ---
  landmarks: {
    49589320: 'zamek', 49589317: 'trojice', 49589363: 'kriz', 30103766: 'radnice', 48876694: 'synagoga', 30103752: 'vargac', 49589359: 'oranzerie',
  },
  requiredLandmarks: ['zamek', 'trojice', 'kriz', 'radnice', 'synagoga', 'vargac'],

  // --- centrum: osa náměstí od západu na východ; podle ní barvy fasád a obrubník místo svodidla ---
  centre: [[49.7811, 14.1672], [49.7813, 14.1717]],
  urban: { start: 140, centre: 50 }, // m od startu, m od osy náměstí
  markings: true, // značení, kostky, semafory na přechodech a ostrůvky kruhových objezdů podle OSM
  parcels: true, // zpevněné dvory, ploty zahrad k ulici a podlaží pro okna podle katastru (RÚIAN)
  // vlastní palety fasád podle panoramat: u startu bílé a krémové domy, východ náměstí světle modrý, krémový a žlutý
  walls: {
    start: ['#f3efe6', '#efe7d6', '#f1e3c6', '#ece6d8'],
    squareEast: ['#c7d3dc', '#bccfdd', '#f1e3c6', '#efe0b0', '#e9c46a', '#f0d9a8'],
  },
  // která vlastní paleta platí pro dům v bodě x, z; c = poloha vůči ose centra (t 0–1, d kolmo)
  facadeZone: (x, z, c) => (Math.hypot(x, z) < 75 ? 'start' : c.t > 0.55 && c.d < 45 ? 'squareEast' : null),

  // --- ruční doplňky dat ---
  lawns: [1314555286, 1314555287], // trávníky před radnicí: stromy v OSM nejsou, na fotkách náměstí ano
  gardens: ['Francouzský park'], // tvarovaný parter místo parku
  squareStreet: 'Mírové náměstí', // náměstí nemá v OSM plochu: obrys dá obal jeho ulic
  extraTrees: [-930, -80, -820, -90], // před průčelím radnice (dm): v OSM nejsou, na fotkách ano

  // --- náhledy (preview.mjs, preview-scene.mjs) ---
  preview: {
    center: [-325, 40],
    profileFrom: 'od západního konce Mírového náměstí',
    labels: [
      { name: 'Zámek', at: [49.7815667, 14.1789113], dy: 22, dx: 10 },
      { name: 'Radnice', building: (t) => t.amenity === 'townhall' && t['addr:street'] === 'Mírové náměstí', dy: -12, dx: -30 },
      { name: 'Nejsv. Trojice', at: [49.7821357, 14.1778341], dy: -14, dx: -60 },
      { name: 'Sv. Kříž', at: [49.7832485, 14.1810164], dy: -8, dx: 10 },
      { name: 'Bývalá synagoga', at: [49.781337, 14.167355], dy: -14, dx: -96 },
      { name: 'Francouzský park', at: [49.7802809, 14.179386], dy: 4, dx: 12 },
      { name: 'Anglický park', at: [49.7770822, 14.1799325], dy: 4, dx: 10 },
      { name: 'Zimní stadion', at: [49.777002, 14.1743546], dy: 4, dx: 10 },
      { name: 'Koryto', at: [49.7846616, 14.1775276], dy: 4, dx: 10 },
      { name: 'Huťský rybník', at: [49.7811944, 14.1882824], dy: 4, dx: -40 },
      { name: 'Papež', at: [49.7890954, 14.170825], dy: 4, dx: 10 },
    ],
  },
  sceneViews: [
    { name: 'celek', x0: -1050, x1: 1300, z0: -1250, z1: 580 },
    { name: 'centrum', x0: -420, x1: 640, z0: -300, z1: 260 },
  ],

  // --- kontroly navíc (check-scene.mjs): světové strany podle známých míst ---
  check({ ok, game, scene, cl }) {
    ok(Math.sin(cl.hd[0]) > 0.9, `směr na startu míří na východ (sin hd = ${Math.sin(cl.hd[0]).toFixed(2)})`);
    // zrcadlení by přehodilo zámek a rybník Papež
    const zamek = game(49.7815667, 14.1789113), papez = game(49.7890954, 14.170825), mirove = game(49.7811, 14.168);
    ok(zamek[0] > 0 && mirove[0] < 0, `zámek je východně od startu, Mírové náměstí západně (x ${zamek[0].toFixed(0)} / ${mirove[0].toFixed(0)})`);
    ok(papez[1] < 0, `rybník Papež je severně, tedy záporné z (${papez[1].toFixed(0)})`);
    const p = scene.landmarks.find((l) => l.id === 'zamek').p;
    let x = 0, z = 0;
    for (let i = 0; i < p.length; i += 2) { x += p[i]; z += p[i + 1]; }
    const lz = [x / (p.length / 2) / 10, z / (p.length / 2) / 10];
    const dist = Math.hypot(lz[0] - zamek[0], lz[1] - zamek[1]);
    ok(dist < 40, `půdorys zámku sedí na známou polohu (rozdíl ${dist.toFixed(0)} m)`);
  },
};
