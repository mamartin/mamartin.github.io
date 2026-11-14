# Nástroje pro tratě ze skutečných měst

Převádí skutečné město (Dobříš, Příbram) na trať hry. Hra tyhle skripty nepotřebuje, slouží jen k přegenerování dat.
Spouští se v této složce, potřebují Node 20+ a příkaz `unzip`.

```bash
npm install                       # laz-perf na čtení výškopisu
node fetch-data.mjs [město]       # OSM, DMR 5G, DMP 1G, RÚIAN a ortofoto do data/<město>/ (necommituje se)
node osm2track.mjs [město]        # vygeneruje ../js/tracks-<město>.js a ../data/<město>.bin
node check-scene.mjs [město|vse]  # ověří vygenerované soubory
```

Město je první argument a odpovídá souboru `cities/<město>.mjs`, bez něj se bere Dobříš. Za město jde případně, co se má stáhnout:
`node fetch-data.mjs dobris osm`, `dmr`, `dmp`, `ruian` nebo `orto` stáhne jen část dat, jméno dotazu (třeba `osm_shops` nebo `osm_signs`) jen ten dotaz
a `listy` vypíše mapové listy DMR 5G / DMP 1G, které zasahují do výřezu města. Průzkum okruhů je v `loops.mjs` a `preview.mjs`
(průjezdní body v `cities/<město>-loops.json`, výsledky a náhledy v `data/<město>/loops/`), pohled shora na hotovou scénu dá `preview-scene.mjs`.

Test celé hry (testy kroků generátoru, kontrola všech vygenerovaných měst, závody autopilotem v headless prohlížeči a měření výkonu) je `npm test` ve složce `zavody`, viz `../test/README.md`.

## Generátor

`osm2track.mjs` jen volá kroky v `gen/` v pevném pořadí (pořadí kroků je i pořadí ve výstupu). Kroky sdílejí jeden stav
(`gen/inputs.mjs`: vstupy, osa trati, dotazy na prostor, `out` s kulisami, `def` s definicí trati):

| Modul | Co dělá |
|---|---|
| `gen/inputs.mjs` | načte stažená data města, konstanty (šířky, výběh, mřížka) |
| `gen/track.mjs` | trasa po ulicích, šířky z katastru (případně rozšířené v zatáčkách), definice trati, úseky (kostky, značení, mosty, obrubníky) a druh okraje po stranách (zábradlí, tráva, chodník) |
| `gen/space.mjs` | převod do souřadnic hry, vzdálenost od osy, rozsah scény, ústup fasád a dominant za výběh |
| `gen/buildings.mjs` | domy (výšky z DMP, podlaží z RÚIAN, barvy fasád podle zón, střechy z ortofota, styl fasády) a dominanty |
| `gen/ortho.mjs` | barva střechy z ortofota ČÚZK (medián pixelů půdorysu) a jejich paleta |
| `gen/surfaces.mjs` | zeleň, voda s hladinou, náměstí a parkoviště |
| `gen/traffic.mjs` | výlohy, přechody, zaparkovaná auta, značky, semafory, ostrůvky, autobusy |
| `gen/lines.mjs` | ulice mimo trať, pěšiny, potoky, zdi a ploty |
| `gen/cadastre.mjs` | zpevněné dvory a ploty zahrad z katastru (`parcels`) |
| `gen/nature.mjs` | lampy, stromy, sochy, komíny, koruny stromů z DMP |
| `gen/terrain.mjs` | výšková mřížka |
| `gen/output.mjs` | zápis scény a trati, souhrn do konzole |

Testy kroků na malých umělých vstupech (bez stažených dat) jsou v `test/`: `node --test "tools/test/*.test.mjs"` ze složky `zavody`.
Při úpravě, která výstup měnit nemá, stačí porovnat `data/<město>.bin` a `js/tracks-<město>.js` před a po: generátor je deterministický.

## Nové město

Všechno, co je u města ruční volba nebo oprava dat, je v `cities/<město>.mjs`; převod sám (`osm2track.mjs`) je pro všechna města stejný.

1. `cities/<město>.mjs` podle `cities/dobris.mjs`: jméno, výřez `bbox` pro OSM, kód obce v RÚIAN (`obec`), střed průzkumu `survey`.
   Listy DMR doplní `node fetch-data.mjs <město> listy`, stačí ty pod tratí a 560 m kolem ní.
2. `node fetch-data.mjs <město>` stáhne data.
3. Kandidátní okruhy jako průjezdní body (souřadnice v metrech od `survey`, x na východ, y na sever, u bodu jméno ulice pro kontrolu)
   do `cities/<město>-loops.json`, pak `node loops.mjs <město>` a `node preview.mjs <město>` je změří a nakreslí.
4. Vybraný okruh (`loop`), start na rovném kusu (`start`) a místo tribuny (`stand`) do nastavení, pak `node osm2track.mjs <město>`
   a `node check-scene.mjs <město>`.
5. Trať do hry: import `js/tracks-<město>.js` v `js/tracks.js`, závod do `test/limits.mjs`.
6. Dominanty: OSM id budov do `landmarks`, ruční modely do `js/landmarks.js` (bez modelu zůstane jen půdorys a hra ji vynechá s varováním).
   Zóny fasád (`centre`, `walls`, `facadeZone`), obrubníky v centru (`urban`) a ruční doplňky (`lawns`, `gardens`, `squareStreet`, `extraTrees`) jsou volitelné.
   Pro město bez svodidel: `urban.all` dá obrubník a chodník na celou trať (svodidlo jen kde OSM má `barrier=guard_rail`), sloupky kolem centra a jinde zábradlí;
   `markings` čte z OSM pruhy, kostky, parkování v ulici, semafory na přechodech a kruhové objezdy; `parcels` bere z katastru zpevněné dvory a ploty zahrad k ulici;
   `measureLandmarks` změří věž dominanty v DMP 1G (výška, poloha, šířka, výška lodi) pro ruční model; dominanta mimo stažené DMP dostane výšky z `landmarkPeaks`.
   `widths` mění šířku trati: `scale`, `min` a `max` pro skutečnou šířku ulice (výchozí ×1,5 v mezích 10–13 m), `corner` ji v zatáčkách rozšíří o `corner × 1/R` (nejvýš o 3,5 m).
7. Dominanta daleko od trati (za dosahem kulis 400 m): `far` se středem a poloměrem vezme stavby a stromy kolem ní do scény,
   výšková mřížka hry ji pokryje bez umělých kopců z okraje a její model v `js/landmarks.js` má slabší mlhu. Hustá zástavba může potřebovat vyšší `maxSceneKb` (výchozí 160 kB).

## Zdroje dat

- **OpenStreetMap** přes Overpass API, licence ODbL 1.0. `data/<město>.bin` je odvozená databáze, proto je označená ODbL.
  Ve hře musí být uvedeno „Mapová data © přispěvatelé OpenStreetMap“.
- **DMR 5G © ČÚZK**, CC BY 4.0, stahování po listech LAZ přes ATOM službu (`atom.cuzk.gov.cz`).
  Bodové čtení z ImageServeru ČÚZK vrací 403, proto listy. Data jsou převzorkovaná a vyhlazená.
- **DMP 1G © ČÚZK**, CC BY 4.0, listy LAZ z `openzu.cuzk.gov.cz` (stejné listy jako DMR). Body třídy budova dávají výšku okapu, hřebene a tvar střechy, body vysoké vegetace polohy a výšky stromů.
- **RÚIAN © ČÚZK**, CC BY 4.0: výměnný formát VFR obce (Dobříš má kód 540111) z `vdp.cuzk.gov.cz`, bere se z něj počet podlaží stavebních objektů a hranice silničních pozemků (způsob využití 16 silnice a 17 ostatní komunikace), podle nichž se měří šířka ulic. S `parcels` navíc všechny parcely: zastavěná plocha a nádvoří, dvory, komunikace a manipulační plochy jsou zpevněné, zahrady sousedící s ulicí mají plot.
- **Ortofoto © ČÚZK**, CC BY 4.0, přes WMS (`ags.cuzk.gov.cz`, EPSG:5514) po dlaždicích 500 m s 1 m na pixel, jen tam, kde jsou budovy. Bere se z něj jen barva střech (medián pixelů uvnitř půdorysu bez okrajů a zeleně, seskupený do 24 odstínů a sytější, protože snímek je zamlžený); obraz sám se do hry nekopíruje.
- Panoramata jsou jen vizuální předloha, nic z nich se do hry nekopíruje.

## Formát `data/<město>.bin`

Soubor zapisuje a čte `js/scenecodec.js` (společný pro hru i nástroje; v nástrojích `loadScene` z `lib/city.mjs`). Je to gzip,
uvnitř `TOSC`, verze, JSON kostra scény a za ní proudy celých čísel (zigzag varinty rozdílů: výšková mřížka od roviny sousedů,
obrysy od předchozího bodu, řady n-tic od předchozí n-tice). Rozbalená scéna je objekt s poli níže. Proti dřívějšímu JSON je
soubor Příbrami 173 kB místo 744 kB a přenáší se o 40 % méně dat než JSON zabalený serverem; limit `maxSceneKb` platí pro soubor.

Souřadnice jsou herní (x na východ, z na jih, počátek na startu) v decimetrech jako celá čísla, výšky v dm nad nejnižším bodem trati.

- `dem`: výšková mřížka, `h[j * nx + i]`
- `buildings`: `[stěny, střecha, tvar, barva fasády, barva střechy, x, z, x, z, …]`; tvar 0 sedlová, 1 valbová, 2 plochá, 3 stanová, 4 pultová, 5 sedlová s hřebenem napříč delší strany
- `landmarks`: půdorysy ručně modelovaných dominant, `moved` říká, o kolik metrů se odsunuly od silnice; modely jsou v `js/landmarks.js`, předlohou jsou fotky z Wikimedia Commons, nic se z nich nekopíruje
- `levels`: dvojice index budovy, počet podlaží (jen kde se liší od výšky stěny / 3 m), podle nich jsou řady oken
- `facades`: dvojice index budovy, styl fasády: 1 pásová okna (školy, úřady, obchody s plochou střechou), 2 panelák s lodžiemi (plochá střecha od 11 m, jinak od 17 m), 3 starý dům v centru s římsou, soklem a vyšším přízemím
- `areas`, `paved`: `[druh, x, z, …]`, druh `lawn` je trávník se stromy u radnice, `yard` zpevněný dvůr nebo plocha z katastru; `water`: `{ name, level, p }`
- `streets`: `[šířka, x, z, …]`; `barriers`: `[typ, x, z, …]`; typ 0 zeď, 1 opěrná zeď, 2 plot, 3 živý plot
- `paths`, `streams`, `treeRows`: čáry; `lamps`, `trees`: dvojice x, z, stejně `statues` (sochy z OSM)
- `canopy`: čtveřice x, z, výška, poloměr koruny (stromy z DMP 1G)
- `chimneys`: trojice x, z, výška (komíny z OSM)
- `cars`: trojice x, z, směr v setinách radiánu (zaparkovaná auta v plochách parkovišť)
- `buses`: trojice x, z, směr v setinách radiánu (autobusy u nástupišť stanovišť, která mají v OSM aspoň čtyři zastávky stejného jména: Mírové náměstí a železniční stanice; autobus stojí u zhruba 60 % nástupišť, nástupiště má vpravo)
- `shops`: indexy budov z `buildings`, ve kterých je podle OSM obchod, restaurace, banka a podobně (dostanou výlohy)
- `signs`: pětice druh, hodnota, x, z, natočení v setinách radiánu; druh 0 dej přednost, 1 stop, 2 nejvyšší rychlost (hodnota km/h), 3 obec, 4 zastávka (hodnota je index do `signNames`), 5 semafor (hodnota 1 na trati, 0 na vedlejší ulici), 6 radar

V `js/tracks-<město>.js` jsou navíc `stand` (bod ve světě, u kterého stojí tribuna), `far` (vzdálená místa `[x, z, poloměr]`, terén hry je pokryje), `bridges` (mosty, kde osa nesleduje DMR) a úseky `sett` (kostky podle `surface=sett`) a `urban` (centrum s obrubníkem a chodníkem místo svodidla), oba od a do jako body ve světě. S `markings` a `urban.all` k nim přibudou úseky `bollards` (sloupky místo zábradlí), `markings` (`[od, do, pruhů]`: 0 bez čar, 1 jednopruhová, 3–4 čáry mezi pruhy, jinde středová čára), `parking` (`[od, do, bod na straně]`: tam auta stojí u chodníku a zábradlí chybí) a `islands` (`[x, z, poloměr]` ostrůvků kruhových objezdů, `[x, z, poloměr, 1]` přejízdný střed z kostek, když trať jede přes střed malého objezdu). S `urban.all` je navíc `edges` (`[od, do, bod na straně, druh]`): `rail` zábradlí na mostech a tam, kde terén za chodníkem padá o víc než 1,5 m, `grass` travnatý pás místo chodníku tam, kde do 30 m od okraje nestojí dům; jinde je chodník bez zábradlí. Úseky delší než třetina kola jsou rozdělené, protože hra úsek měří kratším směrem. `crossings` jsou body přechodů pro chodce. Body místo metrů od startu sedí i na obrácené trati.

## Odchylky od skutečnosti: Dobříš

Co ve hře neodpovídá skutečné Dobříši a proč. Ostatní (osa ulic, půdorysy, reliéf) je z dat.

**Trať a ulice**

- Osa trati je vyhlazená, aby se dala projet: roh Pražské a U Pivovaru je ujetý až o 15 m, nejostřejší zatáčky mají poloměr 15 m.
- Šířky ulic OSM skoro nemá. Měří se šířka silničního pozemku v katastru (RÚIAN) a vozovka je z ní 52 %, poměr je nastavený tak, aby silnice II. třídy měly v průměru 8 m (jejich pozemky mají v Dobříši medián 15,5 m). Pozemek zahrnuje i chodníky a příkopy, takže jde o odhad. Bez měření (asi polovina úseků, účelové komunikace a náměstí) zůstává odhad podle kategorie.
- Podél trati vede svodidlo a výběh 3 m. Boční ulice proto u svodidla končí, trať je od běžného provozu oddělená.
- V centru kolem Mírového náměstí a u startu je místo svodidla obrubník, zvýšený chodník a sloupky. Hranice, o kterou se auto zastaví, je stejná jako jinde, sloupky nejsou na skutečných místech.
- Namalované jsou jen přechody, které jsou v OSM označené jako vyznačené a leží na ose trati (13). Pruhy mají obecný rozměr.
- Čáry podle pruhů z OSM (obytné ulice bez čar), zpevněné dvory a ploty zahrad k ulici z katastru jako v Příbrami. Malý kruhový objezd, přes jehož střed trať vede, má přejízdný střed z kostek o poloměru 3,3 m; skutečný střed je větší.
- Dlažba (náměstí, přejízdný střed) drží méně než asfalt (94 %, na mokru 86 %), drncá v kameře a ovladači a má svůj zvuk; AI s tím počítá.
- Silnice je širší než skutečná, takže stromořadí, zdi a ploty, které podle OSM stojí u skutečné vozovky, jsou odsunuté za výběh.
- Tribuna stojí na louce u Pražské asi kilometr za startem, na startu by zakryla obchodní pavilon. Reklamní tabule jsou jako na ostatních tratích hry, v Dobříši nic takového není.

**Budovy**

- 77 domů u trati je oříznutých, nejvýš o 9,5 m, aby nezasahovaly do výběhu.
- 61 drobných staveb je vynechaných kvůli velikosti, dalších 6 po oříznutí příliš zmenšilo a 3 ustoupily dominantám.
- Bývalá synagoga je odsunutá o 11 m od silnice.
- Výška okapu, hřebene a tvar střechy jsou u 2247 z 2489 domů změřené z DMP 1G. Sken je starší (kolem roku 2011), u novějších domů a tam, kde je bodů málo, platí počet podlaží z RÚIAN (127 domů), jinak z OSM, jinak odhad podle typu a půdorysu (3 m na podlaží).
- Tvar střechy se z bodů jen rozpoznává mezi sedlovou podél delší strany, sedlovou napříč, valbovou a plochou. Složité střechy (L, věžičky, vikýře) jsou zjednodušené na jeden z těchto tvarů, sklon je omezený.
- Věžák u Pražské má v OSM výšku 60 m, podle DMP měří asi 46 m a tak je i ve hře.
- Okna jsou z obecné textury: na vysokých domech je řidší rozestup a dlouhé ploché domy mají štítové stěny bez oken. Stěna, která přiléhá k sousednímu domu, okna nemá. Skutečné rozmístění oken neodpovídá. Styl fasády je odhad podle druhu budovy a polohy: školy a úřady s plochou střechou mají pásová okna, vysoké domy sloupce lodžií (u skutečného domu můžou být jinde nebo chybět), staré domy v centru římsu, sokl a vyšší přízemí.
- Domy do L, T a U jsou rozdělené na křídla, každé má vlastní sedlovou nebo valbovou střechu se stejným sklonem (hlavní křídlo po delší straně, ostatní kolmo na něj). Rozdělení je geometrický odhad z půdorysu, skutečné střechy můžou být složitější.
- Výlohy v přízemí mají domy s obchodem nebo restaurací podle OSM, které stojí u trati nebo na náměstí. Výlohy jsou obecné, bez skutečných nápisů a názvů.
- Barvy fasád jsou z palety, ne podle konkrétních domů. U startu a na východě Mírového náměstí jsou palety podle panoramat (bílá a krémová, resp. světle modrá, krémová a žlutá), na domy se ale rozdělují náhodně.
- Barvy střech jsou u 2245 z 2489 domů z ortofota (24 odstínů, sytost a jas upravené), u ostatních (střecha pod stromy, malý dům) z palety. Ortofoto je novější než sken DMP, takže u přestavěných domů nemusí barva odpovídat tvaru.

**Dominanty**

- Modely jsou ruční podle fotek z Wikimedia Commons, proporce sedí, detail ne. Přízemí a parter jsou přibližné.
- Zámecké střechy jsou kvádry křídel, tvarované tisy ve francouzském parku jsou odvozené z fotek.
- Zámek má světle lososovou omítku s bílými lizénami podle fotek a panoramat, OSM uvádí `burlywood`.
- Štěrk na nádvoří a předzámčí je ohraničený ručně v `js/landmarks.js` (`CASTLE_GRAVEL`), trávníky, parter a socha na nádvoří jsou z OSM.

**Náměstí a zeleň**

- Mírové náměstí nemá v OSM plochu, obrys dlažby je obal jeho ulic.
- Stromy na trávnících u radnice a dva před jejím průčelím v OSM nejsou, doplněné jsou podle fotek.
- OSM zná jen 42 lamp a 43 stromů: lampy podél trati jsou rozmístěné procedurálně.
- Stromy, které zachytil DMP 1G (vyšší než 4 m), stojí na svých místech s výškou podle skenu z doby kolem roku 2011. Body jsou na tvar koruny moc řídké, šíře koruny je proto odvozená z výšky a všechny jsou listnaté. DMP má vegetaci jen ve větších porostech (les, park, břehy), zahrady, stromořadí a les dál od trati se proto dál osazují procedurálně, ale jen tam, kde do 8 m žádný změřený strom není. Koruny a kmeny jsou dál nízkopolygonové; strukturu listí, kůry a březových znaků jim dává malá dlaždicová textura promítnutá ze tří os (`js/foliage.js`), bez trojúhelníků a volání navíc. Koruny se ve větru pohupují (kmen stojí, poryvy běží krajinou). Listnaté koruny do 75 m od kamery mají navíc tři průhledné plošky s lístky přes střed (6 trojúhelníků na strom, jedno volání), které rozbijí rovný obrys dvacetistěnu.
- Na Mírovém náměstí jsou místo běžných lamp historické se dvěma koulemi jako na panoramatech, polohy jsou ale procedurální. Stromy podél náměstí z panoramat doplněné nejsou, v OSM chybí a odhadovat jejich polohy by bylo vymýšlení.
- Podrobnější textura země (ostřejší okraje cest, štěrku a trávníků) je jen v okolí trati, dál je hrubší.
- Osvětlení městských tratí je upravené (silnější teplé slunce, slabší modrá obloha, světlejší odraz od země), stíny ve stínu domů dodává předpočítané stínění.
- Předpočítané stínění (`js/ao.js`) počítá hra při stavbě města, ne generátor: domy do 300 m od trati se vykreslí do rastru výšek po 1 m (střecha jako polovina své výšky) a každý vrchol stěny a střechy zjistí, kolik oblohy zakrývají okolní domy. Ztmavne hlavně světlo oblohy, u paty zdí je navíc tmavší pás. Stejně ztmavne chodník u domů a na zemi je kolem domů rozmazaný tmavý lem. Stromy, auta a lidé do toho nepatří, ty stíní jen efekt přes obraz (Vysoká a Ultra).
- Předpočítané stíny domů od slunce (`js/sunshadow.js`): ze stejného rastru výšek se pro buňky 2 × 2 m spočítá výška, pod kterou je bod ve stínu (pochod ke slunci). Shader země, krajnice, silnice, domů, stromů i lidí podle ní ztlumí přímé slunce, ale jen dál, než sahá skutečná stínová mapa kolem auta (bez stínové mapy všude). Střechy se nestíní, v noci se nepočítá.
- Povrchy (`js/grounddetail.js`): chodník má betonové dlaždice 0,5 m se spárami (po pásu podél trati), tráva skvrny ve dvou měřítkách, zem a dvory zrno. Domy (`js/buildingdetail.js`) mají zrno a skvrny omítky, tmavší sokl do 0,6 m a na šikmých střechách řady tašek, které se z dálky rozplynou. Vše je jedna malá dlaždicová textura v shaderu.
- Hloubka fasád (`js/facade.js`) je odhad, ne měření: okna jsou zapuštěná 22 cm, pásová okna 15 cm, výlohy 30 cm a lodžie paneláků 1,2 m (parallax v shaderu do 90 m od kamery). Sklo odráží oblohu podle barev biomu, ne skutečné okolí. Domy do 30 m od trati mají pod okny parapety jako geometrii.
- Drobnosti ulic (`js/streetdetail.js`) jsou kulisa bez dat: poklopy, kanálové vpusti u obrubníku, záplaty a zalité praskliny v asfaltu, koše a lavičky na chodníku jsou rozmístěné náhodně (stále stejně), mimo přechody a start.
- Les do 60 m od trati je hustší a ze 4/5 listnatý jako na ortofotu u Pražské (zámecký park), OSM druh dřevin skoro neuvádí; mezery mezi změřenými stromy se doplňují. Dál od trati převažují smrky.
- Zaparkovaná auta stojí jen v plochách parkovišť z OSM (řady podle `orientation`, nejvýš `capacity`, obsazenost asi 65 %). Stání podél ulic OSM nezná a stání, která padnou do širšího výběhu trati, odpadají.
- Život ve městě je kulisa bez dat: lidé u přechodů, diváci na startovní rovince (160 m na obě strany) a v centru za sloupky, chodci na chodnících a auta čekající v bočních ulicích (širších než 5 m) na výjezd do trati jsou rozmístění náhodně. Všichni stojí za okrajem trati. Postavy (`js/people.js`) jsou kvádry s jednou malou texturou (512 × 128 px) s 8 druhy oblečení, obličejem a vlasy nebo kšiltovkou; druh i pohyb si shader odvodí z polohy instance, barva instance obarví jen oblečení. Diváci se pohupují a část z nich občas zvedne ruce, chodci a auta stojí. Terén těsně za okrajem trati je o 0,7 m níž (pod krajnicí), proto postavy stojí aspoň v úrovni chodníku. Pod lidmi, koši a lavičkami je měkký stín (průhledná skvrna, jedno volání na skupinu, do 90 m).
- Pohyb ve městě (jen kulisa, při pauze stojí): chodci na chodnících jdou podél trati tam a zpět v úseku, kde je za okrajem volno (aspoň 10 m, nejvýš 60 m na každou stranu), na konci se otočí; kde místo není, postava stojí jako dřív. Polohu přepisuje hra každý snímek, krok (nohy a ruce) dělá shader. Auta (`js/traffic.js`) jezdí po okruzích ulic mimo trať: z ulic širších než 3,5 m vznikne graf (`js/streetgraph.js`), vypadnou úseky blíž než 9 m k okraji trati a dál než 280 m od ní a opakovaně se odstraní slepé konce, takže auto může jet pořád dál a nikde se neotáčí. Jedno auto na 115 m sítě (nejvýš 40), jezdí vpravo, před křižovatkou zpomalí, náhodně odbočí a drží odstup za autem před sebou; v křižovatce si přednost nedávají a mohou se krátce překrýt.
- Noční závod (volba Noc) svítí lampami z OSM a doplněnými podél trati: kruh světla pod každou lampou je obecný, okna svítí náhodně (asi třetina), výlohy všechny.

**Značky**

- Dopravní značky, semafory, radary a zastávky jsou jen ty, které jsou v OSM (51 kolem trati). Uzel značky leží v OSM na ose silnice, ve hře stojí vpravo od řidiče, kterému platí (podle `direction`), a kde by padla do výběhu, ustoupí za něj.
- Kresba značek je zjednodušená. Deska zastávky je obecná, jen se jménem zastávky z OSM.
- Semafory jsou jen na jediné světelné křižovatce Pražská × Mírové náměstí (4 návěstidla z OSM). Tvar podle panoramat: na trati pozinkovaný stožár se šikmým výložníkem nad pruhem a opakovačem na sloupu, na vedlejších ramenech k náměstí sloupek. Světla se střídají v obecném 40s cyklu (hlavní proti vedlejší), skutečný signální plán neznáme a na jízdu nemají vliv.
- Autobusy jsou kulisa: OSM ví, kde jsou nástupiště, ne kdy tam co stojí. Autobus (obecný 12m, barvy bez označení dopravce) stojí u zhruba 60 % nástupišť na Mírovém náměstí a u železniční stanice; kde by zasáhl do výběhu trati nebo do jiného autobusu, chybí.

## Odchylky od skutečnosti: Příbram

Okruh B (4,2 km): Husova k Březovým Horám, Mariánská a Milínská na náměstí T. G. Masaryka a Plzeňskou zpět. Platí totéž co u Dobříše (vyhlazená osa, odhad šířek, výběh, obecná okna a palety); navíc:

- Start je na rovném kusu Husovy mezi Plzeňskou a Březovými Horami, na náměstí by nebyla rovina pro start. Tribuna stojí na volném místě vpravo 320 m za startem.
- Most Husovy přes železnici je v OSM most a reliéf pod ním DMR nemá, kontrola výšky osy ho vynechává.
- Svatá Hora je 650 m od trati, za dosahem kulis. Areál s okolím (200 m) je ve scéně navíc a terén hry sahá až za něj. Ambity, čtyři osmiboké kaple a bazilika jsou ruční modely podle půdorysů z OSM a popisu (kaple s lucernami, Pražský portál uprostřed východního křídla); barvy střech a kopulí jsou odhad, výšky také. Ambity jsou zjednodušené na obdélník křídel 10 m kolem nádvoří.
- Modely Svaté Hory mají slabší mlhu než okolí, aby byly z trati vidět jako silueta (na úsecích, kde trať míří na východ, ve vzdálenosti 750–1300 m).
- Trať je užší než v Dobříši a blíž skutečným ulicím: šířka z katastru ×1,2, nejméně 8,5 m (většina rovinek má 8,5–9 m), v zatáčkách je rozšířená podle křivosti až na 13 m, aby se daly projet v šesti autech.
- 89 domů u trati je oříznutých, nejvýš o 7,5 m; scéna je kvůli hustší zástavbě a zpevněným plochám z katastru větší (174 kB, limit 200 kB). Barvy střech jsou z ortofota u 2671 z 3635 domů.
- OSM u trati nezná žádné svodidlo, proto je po celé trati obrubník a chodník, sloupky kolem náměstí. Zábradlí je jen na mostech a tam, kde terén za chodníkem podle DMR padá; kde do 30 m od okraje nestojí dům, je místo chodníku tráva. Skutečné okraje se místy liší (zídky, ploty, chodník jen na jedné straně OSM u trati spolehlivě nezná).
- Auta v Mariánské stojí podle `parking:*` z OSM, obsazenost (asi 65 %) je náhodná a stojí za obrubníkem, ne v jízdním pruhu, aby nepřekážela.
- Kostel sv. Jakuba: výška a poloha věže jsou změřené v DMP, výška lodi je odhad (DMP ji pod stromy nezachytil); barvy fasády a měděné střechy věže jsou podle fotek odhadem. Kostel sv. Vojtěcha a Vojtěšský důl (šachetní budova s věží) mají výšky z DMP, tvar střechy věže je zjednodušený jehlan. Ševčinský důl (160 m od trati) je za okrajem stažených bodů DMP: má stejný model zděné těžní věže s výškou odhadnutou podle fotek (21 m, hranol 15 m).
- Semafory stojí na přechodech, které jsou v OSM `crossing=traffic_signals`; malý kruhový objezd na konci náměstí nemá ostrůvek, protože ho trať míjí bokem a ostrůvek by ležel na chodníku (přejízdný střed dostane jen objezd, jehož střed je celý ve vozovce, jako v Dobříši).
- Řady oken mají počet podlaží z RÚIAN, nebo z OSM `building:levels`, jinak odhad z výšky stěny.

## Zkušební realistický vzhled

Nastavení „Realistická grafika (zkouška)“ (`S.real`, ne na nízké kvalitě) staví svět jinak; vypnuté se nic z toho nenačte a hra vypadá jako dřív. Řídí to `js/real.js`, podklady jsou v `assets/real/` (zdroje a licence v `assets/real/ZDROJE.md`).

```
node tools/fetch-real.mjs                 # textury a nebe z Poly Haven (CC0) do assets/real/
node tools/fetch-ortho.mjs pribram         # ortofoto ČÚZK kolem celé trati: dlaždice 260 × 260 m po 17 cm do assets/real/orto/
node tools/fetch-people.mjs               # postavy z poly.pizza (Quaternius, CC0) do assets/real/people/
```

- **Silnice**: původní textura (skvrny, čáry) a k ní zrno, normálová mapa a hrubost skutečného asfaltu (3 m na opakování).
- **Krajnice**: chodník a travnatý pás jsou zvláštní sítě s texturami dlažby a trávy (UV v metrech), ostatní krajnice zůstává.
- **Zem**: do 95 m od osy trati letecký snímek místo kreslené země (Příbram a Dobříš; nové město se přidá do `ORTO_CITIES` v `js/real.js`). Dlaždice leží v mřížce hry (stahují se v EPSG:3857, sever nahoře jako ve hře) a terén se v tomto vzhledu dělí na čtverce po stejné mřížce, každý s vlastním materiálem a jednou fotkou. Fotka se nahraje, když je kamera do 430 m od středu dlaždice, a nad 680 m se uvolní. Pod tratí zůstává kreslená zem, tmavá místa snímku (stíny, koruny stromů) se tlumí.
- **Domy**: omítka a tašky ze skutečných textur včetně hrbolků (`js/buildingdetail.js`), okna zůstávají kreslená.
- **Stromy**: do 95 m tvary s větvemi a listy z knihovny ez-tree (`vendor/ez-tree.es.js`, MIT; `js/realtrees.js`), dál původní tvary. 2,5–8 tis. trojúhelníků na strom.
- **Auta ve městě**: do 70 m tvar závodního vozu bez křídla (`townCarShape` v `js/car.js`, asi 7 tis. trojúhelníků) s lesklým lakem, dál krabice.
- **Nebe**: HDR snímek místo kresleného nebe (jen za jasného dne), slunce ve snímku natočené podle slunce hry; pro odrazy je slunce přitlumené.
- **Lidé**: do 45 m modely postav (Quaternius, CC0; `js/realpeople.js`, stahuje `node tools/fetch-people.mjs`), dál kvádry. Model se při načtení postaví do klidové pózy, kostra se zahodí a z vah kostí zbude u vrcholu číslo končetiny a váha; mávání a chůzi dělá shader jako u kvádrů. Barva instance obarví jen svršek. 1,9–5,8 tis. trojúhelníků na postavu.
- **Okna**: textura oken čtyřikrát jemnější (2048 px) a kreslená podrobně: šambrána s římsou, plastický rám, tmavý pokoj za sklem, záclony, žaluzie nebo roleta (`fineWindow` v `js/town.js`). Pásová okna, paneláky a výlohy zůstávají.
- **Tvary domů** (`rich` v `addBuilding`, `js/mass.js`; domy do 60 m od okraje trati): šikmá střecha přesahuje stěnu, pod ní je podhled, žlab a u konce dlouhé stěny svod; štíty mají přetaženou střechu a světlé prkno; u hřebene je komín. Na nejdelší stěně s okny otočené k trati jsou dveře (ostění, křídlo, nadsvětlík, schod) místo okna v přízemí; těsně u trati stojí na úrovni chodníku. Domy s výlohou, pásovými okny a paneláky dveře nemají.
- **Drobnosti z kovu** (materiál `metal` v `js/real.js`, odráží oblohu): lampy mají kulatý zúžený stožár s patkou, výložník do oblouku a ploché svítidlo, historické lampy kulaté koule; sloupky značek a semaforů jsou kulaté, desky značek se lehce lesknou; zábradlí u chodníku jsou trubky místo plochých pásků, sloupky v centru mají prstenec a oblou hlavu; svodidlo mimo město má vlnu (dva hřbety) místo hladké desky.

Měření 13. 11. 2026 (M4, 1600 × 900, Příbram, vysoká kvalita): čas snímku 5,4–6,6 ms původně a 5,4–8,8 ms s realistickým vzhledem; trojúhelníků až 2,35 mil. místo 0,32 mil. (ulice se zaparkovanými auty). Limity v `test/limits.mjs` platí pro původní vzhled.
