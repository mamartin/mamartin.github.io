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
- `areas`, `paved`: `[druh, x, z, …]`, druh `lawn` je trávník se stromy u radnice; `water`: `{ name, level, p }`
- `streets`: `[šířka, x, z, …]`; `barriers`: `[typ, x, z, …]`; typ 0 zeď, 1 opěrná zeď, 2 plot, 3 živý plot
- `paths`, `streams`, `treeRows`: čáry; `lamps`, `trees`: dvojice x, z, stejně `statues` (sochy z OSM)
- `chimneys`: trojice x, z, výška (komíny z OSM)

## Odchylky od skutečnosti

Co ve hře neodpovídá skutečné Dobříši a proč. Ostatní (osa ulic, půdorysy, reliéf) je z dat.

**Trať a ulice**

- Osa trati je vyhlazená, aby se dala projet: roh Pražské a U Pivovaru je ujetý až o 15 m, nejostřejší zatáčky mají poloměr 15 m.
- Šířky ulic jsou odhad podle kategorie, v OSM skoro chybí.
- Podél celé trati vede svodidlo a výběh 3 m. Boční ulice proto u svodidla končí, trať je od běžného provozu oddělená.
- Na startu stojí tribuna a reklamní tabule jako na ostatních tratích hry, v Dobříši nic takového není.

**Budovy**

- 77 domů u trati je oříznutých, nejvýš o 9 m, aby nezasahovaly do výběhu.
- 61 drobných staveb je vynechaných kvůli velikosti, dalších 7 po oříznutí příliš zmenšilo a 3 ustoupily dominantám.
- Bývalá synagoga je odsunutá o 11,7 m od silnice.
- Výšky a tvary střech jsou odhad podle typu a půdorysu (v OSM má výšku 13 a tvar střechy 1 z 4807 budov). Věžáky, haly a garáže mají ploché střechy.
- Výška věžáků je podle OSM (15 podlaží, 60 m), jinde neověřená.
- Barvy fasád a střech jsou z palety, ne podle konkrétních domů.

**Dominanty**

- Modely jsou ruční podle fotek z Wikimedia Commons, proporce sedí, detail ne. Přízemí a parter jsou přibližné.
- Zámecké střechy jsou kvádry křídel, tvarované tisy ve francouzském parku jsou odvozené z fotek.
- Zámek má lososovou barvu podle fotek, OSM uvádí `burlywood`.

**Náměstí a zeleň**

- Mírové náměstí nemá v OSM plochu, obrys dlažby je obal jeho ulic.
- Stromy na trávnících u radnice a dva před jejím průčelím v OSM nejsou, doplněné jsou podle fotek.
- OSM zná jen 42 lamp a 43 stromů: lampy podél trati a stromy v lesích, parcích a zahradách jsou rozmístěné procedurálně, skutečné polohy nemají.
