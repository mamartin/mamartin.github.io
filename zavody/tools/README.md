# Nástroje pro trať Dobříš

Převádí skutečnou Dobříš na trať hry. Hra tyhle skripty nepotřebuje, slouží jen k přegenerování dat.
Spouští se v této složce, potřebují Node 20+ a příkaz `unzip`.

```bash
npm install                # laz-perf na čtení výškopisu
node fetch-data.mjs        # OSM a DMR 5G do data/ (necommituje se)
node osm2track.mjs         # vygeneruje ../js/tracks-dobris.js a ../data/dobris.json
node check-scene.mjs       # ověří vygenerované soubory
```

`node fetch-data.mjs osm` nebo `dmr` stáhne jen část dat. Průzkum okruhů je v `loops.mjs` a `preview.mjs`
(průjezdní body v `loops.json`), pohled shora na hotovou scénu dá `preview-scene.mjs`.

## Zdroje dat

- **OpenStreetMap** přes Overpass API, licence ODbL 1.0. `data/dobris.json` je odvozená databáze, proto je označená ODbL.
  Ve hře musí být uvedeno „Mapová data © přispěvatelé OpenStreetMap“.
- **DMR 5G © ČÚZK**, CC BY 4.0, stahování po listech LAZ přes ATOM službu (`atom.cuzk.gov.cz`).
  Bodové čtení z ImageServeru ČÚZK vrací 403, proto listy. Data jsou převzorkovaná a vyhlazená.
- Ortofoto a panoramata jsou jen vizuální předloha, nic z nich se do hry nekopíruje.

## Formát `data/dobris.json`

Souřadnice jsou herní (x na východ, z na jih, počátek na startu) v decimetrech jako celá čísla, výšky v dm nad nejnižším bodem trati.

- `dem`: výšková mřížka, `h[j * nx + i]`
- `buildings`: `[stěny, střecha, tvar, barva fasády, barva střechy, x, z, x, z, …]`; tvar 0 sedlová, 1 valbová, 2 plochá, 3 stanová, 4 pultová
- `landmarks`: půdorysy ručně modelovaných dominant, `moved` říká, o kolik metrů se odsunuly od silnice; modely jsou v `js/landmarks.js`, předlohou jsou fotky z Wikimedia Commons, nic se z nich nekopíruje
- `areas`, `paved`: `[druh, x, z, …]`; `water`: `{ name, level, p }`
- `streets`: `[šířka, x, z, …]`; `barriers`: `[typ, x, z, …]`; typ 0 zeď, 1 opěrná zeď, 2 plot, 3 živý plot
- `paths`, `streams`, `treeRows`: čáry; `lamps`, `trees`: dvojice x, z, stejně `statues` (sochy z OSM)
- `chimneys`: trojice x, z, výška (komíny z OSM)
