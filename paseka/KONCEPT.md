# Paseka: koncept hry

> *Hra o tom, jak se les vrací.*

## V jedné větě

Klidná budovatelská hra na malém vznášejícím se ostrůvku: z holiny po kůrovci znovu vypěstuješ živý smíšený les. Rostliny, houby a zvířata na sebe navazují, střídají se roční období a hlavní odměnou je pohled na to, jak krajina ožívá.

## Proč zrovna tohle

- **Příroda tu není jen kulisa, ale samotná mechanika.** Hráč nestaví domy, pěstuje vztahy mezi druhy: bříza připraví půdu buku, mrtvé dřevo nakrmí datla, louka přiláká včely.
- **Má to blízko k domovu.** Inspirací je Šumava: smrkové souše, vrbovka na pasekách, tůně, rys. Hra se ale do jedné krajiny nezamyká.
- **Dá se to rozšiřovat bez konce.** Každý nový druh, biom nebo jev je jen další záznam v datech a pár řádků modelu. Herní smyčka zůstává stejná.
- **Grafika může vyniknout.** Malá diorámová scéna se dá vyladit do detailu: vítr, světlo, roční období, svatojánské mušky v noci.

## Příběh a tón

Ostrůvek je kus horského údolí po kalamitě. Na jedné straně stojí zbytek živého lesa, uprostřed holina se suchými smrky a pařezy, kolem louka a malá tůň. Hráč je neviditelný duch místa. Nemá ruce ani sekeru, jen semínka a trpělivost.

Tón je klidný a laskavý. Hra nemá prohru ani časový tlak. Nepříznivé jevy jako sucho, vichřice nebo kůrovec přicházejí, ale nic nezničí úplně. Jen ukážou, že pestrý les je odolnější než smrková monokultura.

## Herní smyčka

```
 pozoruj ──► zasaď ──► roste a šíří se ──► přilákává další život
    ▲                                              │
    └──────── nové druhy, „živa“ a cíle ◄──────────┘
```

1. **Živa** je jediná měna, kterou vyrábí všechno živé na ostrově. Čím pestřejší společenství, tím víc živy.
2. Za živu hráč **sází** rostliny na šestiúhelníková políčka.
3. Rostliny **rostou** po fázích (semenáček, mladý, dospělý) a dospělé se samy **šíří** na vhodná sousední políčka.
4. Každé políčko má **půdu, vlhkost a světlo**. Rostliny je mění: stromy stíní, opad vytváří humus, olše u vody obohacuje půdu.
5. Když políčka splní podmínky, **přijdou zvířata**: včely k rozkvetlé louce, zajíc na okraj lesa, datel k souším, rys až do velkého lesa s dostatkem kořisti.
6. Nové objevy se zapisují do **herbáře** a odemykají další druhy a cíle.

### Sukcese jako páteř postupu

Postup kopíruje skutečný vývoj lesa:

| Fáze | Typické druhy | Co přináší |
|---|---|---|
| Holina | vrbovka, maliník, třtina | kryje půdu, první humus, nektar |
| Pionýrský les | bříza, jeřáb, vrba | stín pro mladé stromky, potrava ptákům |
| Přechodný les | smrk, modřín, kapradí | vlhké mikroklima, jehličí |
| Klimaxový les | buk, jedle, javor | vysoká pestrost, mrtvé dřevo, velcí savci |

Buk zasazený rovnou na holinu přežívá špatně, pod břízou se mu daří. Hráč na tohle přijde sám pozorováním, hra ho jen jemně navádí.

### Roční období a počasí

- **Jaro:** klíčení, světle zelené listí, pyl ve vzduchu.
- **Léto:** kvetoucí vrbovka, plná zeleň, v noci svatojánské mušky.
- **Podzim:** barevné listí, padající lístky, houby a semena.
- **Zima:** sníh, holé listnáče, klid. Rostliny nerostou, ale hráč plánuje.
- **Počasí** (déšť, mlha, bouřka, sucho) se do simulace promítá vlhkostí a vypadá hezky.

### Cíle

Hra nemá skóre jako v arkádě. Má **index pestrosti** a sadu cílů, třeba „Ať na ostrově zakvete 20 vrbovek“, „Přilákej datla“ nebo „Přečkej sucho bez ztráty jediného buku“. Splněním cílů jednoho ostrova se odemkne další.

## Grafika (hlavní pilíř)

Cíl: **každý snímek obrazovky má vypadat jako ilustrace.**

1. **Diorama.** Ostrůvek se vznáší v oblacích. Okraje políček ukazují vrstvy půdy (drn, hlína, jíl, kámen) a pod ostrovem visí skála. Kamera je úzká a blízká, rozostření na okrajích obrazu (tilt-shift) dělá z krajiny maketu.
2. **Stylizovaný low-poly.** Ploché stínování, pár set trojúhelníků na strom, ručně laděné palety místo textur. Každý druh je procedurální model s drobnou náhodou, takže žádné dva stromy nejsou stejné.
3. **Všechno se hýbe.** Jediný sdílený „vítr“ ohýbá trávu, kapradí, květy i koruny stromů, každou rostlinu podle její výšky.
4. **Světlo vypráví čas.** Plynulý cyklus dne (svítání, poledne, západ, měsíc a hvězdy) a roční období, které přebarví celou scénu: trávu, listí, oblohu, sníh na horních plochách.
5. **Částice dávají život.** Pyl, padající listí, sněhové vločky, svatojánské mušky se zářením (bloom) a jiskřičky při zasazení.
6. **Hmatová odezva.** Zasazená rostlina vyroste s pružným „poskočením“, políčko pod kurzorem jemně svítí, každá akce má viditelný a později i slyšitelný efekt.
7. **Barevný jazyk.** Teplé, mírně odbarvené přírodní tóny. Sytou barvu dostává jen to, co je důležité: květy, houby, zvířata, rozhraní.

### Zvuk (později)

Generativní ambient: vítr podle síly větru ve scéně, ptáci podle druhů na ostrově, cvrčci v létě v noci, déšť. Žádná smyčka, která by po deseti minutách lezla na nervy.

## Technické řešení

Stejně jako u Turbo Okruhu: **čisté HTML a ES moduly, three.js z CDN, žádný build.** Hra běží na GitHub Pages a otevře se v mobilu i na počítači.

```
paseka/
  index.html, style.css
  js/
    main.js            vstupní bod, smyčka, propojení systémů
    core/              náhoda a šum, (později) ukládání, události
    data/              DRUHY, ROČNÍ OBDOBÍ, (později) biomy, zvířata, cíle
    world/             hex mřížka, ostrov, voda, obloha a světlo, čas
    life/              modely rostlin, flóra, tráva, (později) simulace a fauna
    render/            sdílené materiály (vítr, sníh), postprocessing
    fx/                částice
    ui/                (později) HUD, herbář, cíle
```

### Principy rozšiřitelnosti

- **Data místo kódu.** Druh je záznam v `data/species.js`: jméno, latinský název, zajímavost, kde roste, model a barvy pro každé roční období. Nový druh = nový záznam + funkce modelu.
- **Roční období jsou palety.** `data/seasons.js` drží barvy a „množství“ (listí, květy, houby, sníh, částice) pro každé období. Scéna mezi nimi plynule prolíná, takže nové období nebo biom znamená jen novou paletu.
- **Jeden materiálový systém.** Všechny přírodní materiály procházejí funkcí `natureMaterial()`, která přidá vítr a sníh. Nové efekty (mokro po dešti, námraza, kvetení) se doplní na jednom místě a projeví se všude.
- **Políčko je jednotka simulace.** Hex mřížka drží vlastnosti políček (typ, výška, vlhkost; později živiny a světlo). Simulace bude běžet v pomalých tikách nezávisle na vykreslování.
- **Systémy jsou oddělené.** Svět, flóra, tráva, částice a obloha o sobě vědí jen přes sdílený stav (čas, paleta). Systém se dá přidat nebo vypnout bez zásahu do ostatních.

## Plán po etapách

| # | Etapa | Obsah | Stav |
|---|---|---|---|
| 0 | **Náladová scéna** | ostrov z hexů, tráva ve větru, 6 rostlin k sázení a 4 další prvky krajiny, den a noc, 4 roční období, částice, sázení kliknutím | **hotovo (prototyp)** |
| 1 | Živa a růst | měna, ceny druhů, fáze růstu, šíření semen | |
| 2 | Půda a sukcese | vlhkost, humus, stín; druhy s nároky, prosperita a úhyn | |
| 3 | Počasí | déšť, mlha, bouřka, sucho, vichřice, dopad na simulaci | |
| 4 | Fauna | včely, motýli, zajíc, srnec, datel, sova, rys; animace a chování | |
| 5 | Herbář a cíle | encyklopedie objevů, cíle ostrova, ukládání do prohlížeče | |
| 6 | Zvuk | generativní ambient a zvuky akcí | |
| 7 | Další ostrovy | rašeliniště, potoční niva, bučina, alpínská louka | |
| 8 | Hloubka | podzemní síť hub (pohled pod povrch s kořeny), kůrovec jako výzva, sdílení ostrova odkazem | |

## Ukázka (etapa 0)

`index.html` v této složce je první náladová scéna. Neobsahuje ještě žádná pravidla, ověřuje jen vizuální směr:

- otáčení kamery tažením, přiblížení kolečkem nebo dvěma prsty,
- volba ročního období a času (posuvník, pauza, časosběr),
- výběr rostliny v dolní liště (klávesy 1 až 6) a zasazení kliknutím na políčko,
- najetí na políčko ukáže jeho typ a vlhkost, tedy základ budoucí simulace.
