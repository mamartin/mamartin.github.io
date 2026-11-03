# Nástroje pro trať Dobříš

Převádí skutečnou Dobříš na trať hry. Hra tyhle skripty nepotřebuje, slouží jen k přegenerování dat.
Spouští se v této složce, potřebují Node 20+ a příkaz `unzip`.

```bash
npm install                # laz-perf na čtení výškopisu
node fetch-data.mjs        # OSM, DMR 5G, DMP 1G a RÚIAN do data/ (necommituje se)
node osm2track.mjs         # vygeneruje ../js/tracks-dobris.js a ../data/dobris.json
node check-scene.mjs       # ověří vygenerované soubory
```

`node fetch-data.mjs osm`, `dmr`, `dmp` nebo `ruian` stáhne jen část dat, jméno dotazu (třeba `osm_shops`) jen ten dotaz. Průzkum okruhů je v `loops.mjs` a `preview.mjs`
(průjezdní body v `loops.json`), pohled shora na hotovou scénu dá `preview-scene.mjs`.

## Zdroje dat

- **OpenStreetMap** přes Overpass API, licence ODbL 1.0. `data/dobris.json` je odvozená databáze, proto je označená ODbL.
  Ve hře musí být uvedeno „Mapová data © přispěvatelé OpenStreetMap“.
- **DMR 5G © ČÚZK**, CC BY 4.0, stahování po listech LAZ přes ATOM službu (`atom.cuzk.gov.cz`).
  Bodové čtení z ImageServeru ČÚZK vrací 403, proto listy. Data jsou převzorkovaná a vyhlazená.
- **DMP 1G © ČÚZK**, CC BY 4.0, listy LAZ z `openzu.cuzk.gov.cz` (stejné listy jako DMR). Berou se jen body třídy budova: z nich výška okapu, hřebene a tvar střechy.
- **RÚIAN © ČÚZK**, CC BY 4.0: výměnný formát VFR obce Dobříš (kód 540111) z `vdp.cuzk.gov.cz`, bere se z něj jen počet podlaží stavebních objektů.
- Ortofoto a panoramata jsou jen vizuální předloha, nic z nich se do hry nekopíruje.

## Formát `data/dobris.json`

Souřadnice jsou herní (x na východ, z na jih, počátek na startu) v decimetrech jako celá čísla, výšky v dm nad nejnižším bodem trati.

- `dem`: výšková mřížka, `h[j * nx + i]`
- `buildings`: `[stěny, střecha, tvar, barva fasády, barva střechy, x, z, x, z, …]`; tvar 0 sedlová, 1 valbová, 2 plochá, 3 stanová, 4 pultová, 5 sedlová s hřebenem napříč delší strany
- `landmarks`: půdorysy ručně modelovaných dominant, `moved` říká, o kolik metrů se odsunuly od silnice; modely jsou v `js/landmarks.js`, předlohou jsou fotky z Wikimedia Commons, nic se z nich nekopíruje
- `areas`, `paved`: `[druh, x, z, …]`, druh `lawn` je trávník se stromy u radnice; `water`: `{ name, level, p }`
- `streets`: `[šířka, x, z, …]`; `barriers`: `[typ, x, z, …]`; typ 0 zeď, 1 opěrná zeď, 2 plot, 3 živý plot
- `paths`, `streams`, `treeRows`: čáry; `lamps`, `trees`: dvojice x, z, stejně `statues` (sochy z OSM)
- `chimneys`: trojice x, z, výška (komíny z OSM)
- `cars`: trojice x, z, směr v setinách radiánu (zaparkovaná auta v plochách parkovišť)
- `shops`: indexy budov z `buildings`, ve kterých je podle OSM obchod, restaurace, banka a podobně (dostanou výlohy)

V `js/tracks-dobris.js` jsou navíc `stand` (bod ve světě, u kterého stojí tribuna) a úseky `sett` (kostky podle `surface=sett`) a `urban` (centrum s obrubníkem a chodníkem místo svodidla), oba od a do jako body ve světě. `crossings` jsou body přechodů pro chodce. Body místo metrů od startu sedí i na obrácené trati.

## Odchylky od skutečnosti

Co ve hře neodpovídá skutečné Dobříši a proč. Ostatní (osa ulic, půdorysy, reliéf) je z dat.

**Trať a ulice**

- Osa trati je vyhlazená, aby se dala projet: roh Pražské a U Pivovaru je ujetý až o 15 m, nejostřejší zatáčky mají poloměr 15 m.
- Šířky ulic jsou odhad podle kategorie, v OSM skoro chybí.
- Podél trati vede svodidlo a výběh 3 m. Boční ulice proto u svodidla končí, trať je od běžného provozu oddělená.
- V centru kolem Mírového náměstí a u startu je místo svodidla obrubník, zvýšený chodník a sloupky. Hranice, o kterou se auto zastaví, je stejná jako jinde, sloupky nejsou na skutečných místech.
- Namalované jsou jen přechody, které jsou v OSM označené jako vyznačené a leží na ose trati (13). Pruhy mají obecný rozměr.
- Silnice je širší než skutečná, takže stromořadí, zdi a ploty, které podle OSM stojí u skutečné vozovky, jsou odsunuté za výběh.
- Tribuna stojí na louce u Pražské asi kilometr za startem, na startu by zakryla obchodní pavilon. Reklamní tabule jsou jako na ostatních tratích hry, v Dobříši nic takového není.

**Budovy**

- 77 domů u trati je oříznutých, nejvýš o 9 m, aby nezasahovaly do výběhu.
- 61 drobných staveb je vynechaných kvůli velikosti, dalších 7 po oříznutí příliš zmenšilo a 3 ustoupily dominantám.
- Bývalá synagoga je odsunutá o 11,7 m od silnice.
- Výška okapu, hřebene a tvar střechy jsou u 2246 z 2488 domů změřené z DMP 1G. Sken je starší (kolem roku 2011), u novějších domů a tam, kde je bodů málo, platí počet podlaží z RÚIAN (127 domů), jinak z OSM, jinak odhad podle typu a půdorysu (3 m na podlaží).
- Tvar střechy se z bodů jen rozpoznává mezi sedlovou podél delší strany, sedlovou napříč, valbovou a plochou. Složité střechy (L, věžičky, vikýře) jsou zjednodušené na jeden z těchto tvarů, sklon je omezený.
- Věžák u Pražské má v OSM výšku 60 m, podle DMP měří asi 46 m a tak je i ve hře.
- Okna jsou z obecné textury: na vysokých domech je řidší rozestup a dlouhé ploché domy mají štítové stěny bez oken. Skutečné rozmístění oken neodpovídá.
- Výlohy v přízemí mají domy s obchodem nebo restaurací podle OSM, které stojí u trati nebo na náměstí. Výlohy jsou obecné, bez skutečných nápisů a názvů.
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
- Podrobnější textura země (ostřejší okraje cest, štěrku a trávníků) je jen v okolí trati, dál je hrubší.
- Osvětlení městských tratí je upravené (silnější slunce, světlejší odraz od země), aby fasády ve stínu nebyly tmavé.
- Les do 60 m od trati je hustší a ze 4/5 listnatý jako na ortofotu u Pražské (zámecký park), OSM druh dřevin skoro neuvádí. Dál od trati převažují smrky.
- Zaparkovaná auta stojí jen v plochách parkovišť z OSM (řady podle `orientation`, nejvýš `capacity`, obsazenost asi 65 %). Stání podél ulic OSM nezná a stání, která padnou do širšího výběhu trati, odpadají.
