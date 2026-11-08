# Test hry

Jeden příkaz ověří, že hra funguje, a při chybě skončí nenulovým kódem. Potřebuje Node 20+:

```bash
cd zavody
npm install                      # Playwright a three.js 0.169.0 (jen pro test, hra je dál bez buildu)
npx playwright install chromium  # jednou, pokud Chromium pro Playwright na počítači ještě není
npm test
```

Co se děje:

1. `tools/check-scene.mjs vse` zkontroluje data všech vygenerovaných tratí ze skutečných měst (bez surového DMR v `tools/data/<město>/` část přeskočí).
2. Hra se spustí v headless Chromiu (WebGL přes SwiftShader) ze statického serveru s `Cache-Control: no-store`, service worker je zablokovaný.
   three.js z CDN se podstrčí z `node_modules/three`, písma z Google Fonts se vynechají, jiné vnější požadavky se zablokují.
3. **Výkon:** na 20 bodech podél Dobříše stojí kamera za autem (7 m za ním, 2,7 m nad ním, poměr stran 16:9, kvalita Vysoká)
   a po `renderer.info.reset()` se scéna jednou vykreslí i se stíny. Vypíše se průměr a maximum volání (draw calls)
   a trojúhelníků. Nad limitem test selže.
4. **Závody:** Dobříš po směru, Dobříš obráceně a Šumavský okruh, 2 kola bez zbraní, hráče řídí autopilot, čas běží 100× rychleji.
   Ověří se, že dojela všechna auta, že nejlepší kolo hráče odpovídá průměrné rychlosti 45–200 km/h
   a že v konzoli nebyla žádná chyba.

Limity, tratě, počet kol a zrychlení jsou na jednom místě v `test/limits.mjs`. Podrobné výsledky (hodnoty v každém bodě,
časy všech aut) se uloží do `test/out/vysledek.json`, který se necommituje. Celý běh trvá asi minutu a půl.

Ladicí rozhraní hry je `window.__game` (blok „debug / testy“ na konci `js/main.js`): `start`, `autopilot`, `setTimeScale`,
`toMenu`, `selectTrack`, `aimSun`, `info`, `race`, `world`, `scene`, `camera`, `renderer`.

## Podrobné měření vykreslování

`node test/perf-lod.mjs` (po `npm install`) měří cenu vykreslování po celé trati Dobříš: kamera za autem v každém
bodě po 10 m, jedno vykreslení se stíny, průměr a maximum volání a trojúhelníků pro vysokou i nízkou kvalitu.
`--breakdown` je rozdělí podle částí scény (terén, trať, domy, stromy…), `--shots složka` uloží snímky zblízka
a zdálky, `--race` přidá závod autopilotem (2 kola tam i zpět) a `--quality none --race` pustí jen závod.
Auta na roštu v menu se do měření nepočítají. Limity nemá, slouží k porovnání před a po změně.
