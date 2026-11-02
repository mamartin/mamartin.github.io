# Nástroje pro trať Dobříš

Převádí skutečnou Dobříš na trať hry. Hra tyhle skripty nepotřebuje, slouží jen k přegenerování dat.
Spouští se v této složce, potřebují Node 20+ a příkaz `unzip`.

```bash
npm install                # laz-perf na čtení výškopisu
node fetch-data.mjs        # OSM, DMR 5G a RÚIAN do data/ (necommituje se)
node osm2track.mjs         # vygeneruje ../js/tracks-dobris.js a ../data/dobris.json
node check-scene.mjs       # ověří vygenerované soubory
```

`node fetch-data.mjs osm`, `dmr` nebo `ruian` stáhne jen část dat. Průzkum okruhů je v `loops.mjs` a `preview.mjs`
(průjezdní body v `loops.json`), pohled shora na hotovou scénu dá `preview-scene.mjs`.

## Zdroje dat

- **OpenStreetMap** přes Overpass API, licence ODbL 1.0. `data/dobris.json` je odvozená databáze, proto je označená ODbL.
  Ve hře musí být uvedeno „Mapová data © přispěvatelé OpenStreetMap“.
- **DMR 5G © ČÚZK**, CC BY 4.0, stahování po listech LAZ přes ATOM službu (`atom.cuzk.gov.cz`).
  Bodové čtení z ImageServeru ČÚZK vrací 403, proto listy. Data jsou převzorkovaná a vyhlazená.
- **RÚIAN © ČÚZK**, CC BY 4.0: výměnný formát VFR obce Dobříš (kód 540111) z `vdp.cuzk.gov.cz`, bere se z něj jen počet podlaží stavebních objektů.
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
- `cars`: trojice x, z, směr v setinách radiánu (zaparkovaná auta v plochách parkovišť)

V `js/tracks-dobris.js` jsou navíc `stand` (bod ve světě, u kterého stojí tribuna) a `sett` (úseky s kostkami podle `surface=sett`, od a do jako body ve světě). Body místo metrů od startu sedí i na obrácené trati.

## Odchylky od skutečnosti

Co ve hře neodpovídá skutečné Dobříši a proč. Ostatní (osa ulic, půdorysy, reliéf) je z dat.

**Trať a ulice**

- Osa trati je vyhlazená, aby se dala projet: roh Pražské a U Pivovaru je ujetý až o 15 m, nejostřejší zatáčky mají poloměr 15 m.
- Šířky ulic jsou odhad podle kategorie, v OSM skoro chybí.
- Podél celé trati vede svodidlo a výběh 3 m. Boční ulice proto u svodidla končí, trať je od běžného provozu oddělená.
- Silnice je širší než skutečná, takže stromořadí, zdi a ploty, které podle OSM stojí u skutečné vozovky, jsou odsunuté za výběh.
- Tribuna stojí na louce u Pražské asi kilometr za startem, na startu by zakryla obchodní pavilon. Reklamní tabule jsou jako na ostatních tratích hry, v Dobříši nic takového není.

**Budovy**

- 77 domů u trati je oříznutých, nejvýš o 9 m, aby nezasahovaly do výběhu.
- 61 drobných staveb je vynechaných kvůli velikosti, dalších 7 po oříznutí příliš zmenšilo a 3 ustoupily dominantám.
- Bývalá synagoga je odsunutá o 11,7 m od silnice.
- Počet podlaží je u 1426 z 2488 domů z aktuálního RÚIAN (podle `ref:ruian:building`, jinak podle polohy), u ostatních z OSM, jinak odhad podle typu a půdorysu. Stěna má 3 m na podlaží. RÚIAN počítá i obytné podkroví, takže některé domy můžou mít okap o patro výš.
- Tvary střech jsou odhad (v OSM má tvar střechy 1 z 4807 budov). Věžáky, haly a garáže mají ploché střechy.
- Věžák u Pražské má v OSM 15 podlaží a výšku 60 m, ta podlažím neodpovídá; ve hře má 45 m (15 × 3 m). Kde je výška v OSM přes 3,6 m na podlaží, platí podlaží.
- Barvy fasád a střech jsou z palety, ne podle konkrétních domů. U startu a na východě Mírového náměstí jsou palety podle panoramat (bílá a krémová, resp. světle modrá, krémová a žlutá), na domy se ale rozdělují náhodně.

**Dominanty**

- Modely jsou ruční podle fotek z Wikimedia Commons, proporce sedí, detail ne. Přízemí a parter jsou přibližné.
- Zámecké střechy jsou kvádry křídel, tvarované tisy ve francouzském parku jsou odvozené z fotek.
- Zámek má světle lososovou omítku s bílými lizénami podle fotek a panoramat, OSM uvádí `burlywood`.
- Štěrk na nádvoří a předzámčí je ohraničený ručně v `js/landmarks.js` (`CASTLE_GRAVEL`), trávníky, parter a socha na nádvoří jsou z OSM.

**Náměstí a zeleň**

- Mírové náměstí nemá v OSM plochu, obrys dlažby je obal jeho ulic.
- Stromy na trávnících u radnice a dva před jejím průčelím v OSM nejsou, doplněné jsou podle fotek.
- OSM zná jen 42 lamp a 43 stromů: lampy podél trati a stromy v lesích, parcích a zahradách jsou rozmístěné procedurálně, skutečné polohy nemají.
- Na Mírovém náměstí jsou místo běžných lamp historické se dvěma koulemi jako na panoramatech, polohy jsou ale procedurální. Stromy podél náměstí z panoramat doplněné nejsou, v OSM chybí a odhadovat jejich polohy by bylo vymýšlení.
- Les do 60 m od trati je hustší a ze 4/5 listnatý jako na ortofotu u Pražské (zámecký park), OSM druh dřevin skoro neuvádí. Dál od trati převažují smrky.
- Zaparkovaná auta stojí jen v plochách parkovišť z OSM (řady podle `orientation`, nejvýš `capacity`, obsazenost asi 65 %). Stání podél ulic OSM nezná a stání, která padnou do širšího výběhu trati, odpadají.
