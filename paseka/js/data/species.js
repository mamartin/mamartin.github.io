// Druhy rostlin a prvků krajiny. Nový druh = nový záznam + model v life/models.js.
//   kind    'tree' zabírá slot pro strom, 'small' se vejde kamkoli (max. SMALL_PER_TILE)
//   tiles   typy políček, kam ho hráč smí zasadit
//   scale   rozsah velikosti dospělé rostliny
//   grow    doba růstu v sekundách (v prototypu jen animace)
//   plant   pořadí v liště pro sázení (chybí = nedá se zasadit ručně)

export const SMALL_PER_TILE = 6;

export const SPECIES = {
  smrk: {
    name: 'Smrk ztepilý', short: 'Smrk', latin: 'Picea abies',
    model: 'spruce', kind: 'tree', tiles: ['louka', 'les', 'paseka', 'skala'],
    scale: [0.75, 1.15], grow: 2.6, plant: 1,
    fact: 'Na Šumavě roste přirozeně hlavně ve vyšších polohách. Ve stejnověkých smrkových monokulturách se snadno přemnoží kůrovec.',
  },
  buk: {
    name: 'Buk lesní', short: 'Buk', latin: 'Fagus sylvatica',
    model: 'beech', kind: 'tree', tiles: ['louka', 'les', 'paseka'],
    scale: [0.8, 1.15], grow: 3, plant: 2,
    fact: 'Kdysi nejrozšířenější strom našich lesů. Snese hluboký stín, a proto nejlépe odrůstá pod ochranou jiných stromů.',
  },
  briza: {
    name: 'Bříza bělokorá', short: 'Bříza', latin: 'Betula pendula',
    model: 'birch', kind: 'tree', tiles: ['louka', 'les', 'paseka', 'skala'],
    scale: [0.75, 1.1], grow: 1.8, plant: 3,
    fact: 'Pionýrská dřevina: lehká semena roznáší vítr daleko a bříza obsadí holinu mezi prvními. Mladým bukům a jedlím pak dělá stín.',
  },
  jerab: {
    name: 'Jeřáb ptačí', short: 'Jeřáb', latin: 'Sorbus aucuparia',
    model: 'rowan', kind: 'tree', tiles: ['louka', 'les', 'paseka', 'skala'],
    scale: [0.8, 1.1], grow: 2.2, plant: 4,
    fact: 'Červené plody jsou zimní potravou drozdů a brkoslavů. Ptáci pak roznášejí jeho semena po celé krajině.',
  },
  vrbovka: {
    name: 'Vrbovka úzkolistá', short: 'Vrbovka', latin: 'Chamaenerion angustifolium',
    model: 'fireweed', kind: 'small', tiles: ['louka', 'paseka', 'les'],
    scale: [0.85, 1.2], grow: 1.2, plant: 5,
    fact: 'Na pasekách a spáleništích vykvete do růžova jako jedna z prvních. Je vydatným zdrojem nektaru pro včely.',
  },
  kapradi: {
    name: 'Kapraď samec', short: 'Kapraď', latin: 'Dryopteris filix-mas',
    model: 'fern', kind: 'small', tiles: ['les', 'paseka', 'skala'],
    scale: [0.85, 1.25], grow: 1.4, plant: 6,
    fact: 'Nekvete, množí se výtrusy ze spodní strany listů. Má ráda vlhký a stinný lesní podrost.',
  },
  sous: {
    name: 'Souš', short: 'Souš', latin: 'odumřelý smrk',
    model: 'snag', kind: 'tree', scale: [0.85, 1.15], grow: 1,
    fact: 'Odumřelý strom není odpad. V mrtvém dřevě žijí stovky druhů hmyzu a hub a datli v něm tesají dutiny.',
  },
  parez: {
    name: 'Pařez', short: 'Pařez', latin: '',
    model: 'stump', kind: 'small', scale: [0.8, 1.2], grow: 1,
    fact: 'Pomalu ho rozkládají houby a hmyz. Za pár let z něj zbude humus pro nové stromky.',
  },
  kamen: {
    name: 'Kámen', short: 'Kámen', latin: '',
    model: 'rock', kind: 'small', scale: [0.7, 1.3], grow: 1,
    fact: 'Na prosluněných kamenech se vyhřívají ještěrky, ve stínu pod nimi roste mech.',
  },
  muchomurka: {
    name: 'Muchomůrka červená', short: 'Muchomůrka', latin: 'Amanita muscaria',
    model: 'mushroom', kind: 'small', scale: [0.9, 1.3], grow: 1,
    fact: 'Prorůstá kořeny stromů a vyměňuje si s nimi živiny. Bez takových hub by les nerostl. Je jedovatá.',
  },
};

export const PLANTABLE = Object.entries(SPECIES)
  .filter(([, s]) => s.plant)
  .sort((a, b) => a[1].plant - b[1].plant)
  .map(([id]) => id);
