# Podklady zkušebního realistického vzhledu

Všechno v této složce stahují skripty `tools/fetch-real.mjs`, `tools/fetch-ortho.mjs` a `tools/fetch-people.mjs`.

| Soubory | Zdroj | Licence |
|---|---|---|
| `asphalt_track_*`, `concrete_pavers_02_*`, `leafy_grass_*`, `clay_roof_tiles_02_*`, `white_stucco_*` (barva, normála, hrubost, 1k JPG) | Poly Haven, polyhaven.com | CC0 |
| `sky.hdr` (Kloofendal 48d Partly Cloudy, Pure Sky, 2k) | Poly Haven, polyhaven.com | CC0 |
| `people/*.glb` (šest postav s kostrou; stahuje `tools/fetch-people.mjs`) | Quaternius, quaternius.com, přes poly.pizza | CC0 |
| `orto/<město>/*.jpg`, `orto/<město>.json` (pás do 100 m kolem trati, dlaždice 260 × 260 m po 17 cm; Příbram 32, Dobříš 27 dlaždic) | Ortofoto ČR, © ČÚZK, WMS `ags.cuzk.gov.cz` | CC BY 4.0 |

Stromy (tvar, textury kůry a listí) vytváří knihovna ez-tree (`vendor/ez-tree.es.js`, © Daniel Greenheck, MIT, licence ve `vendor/ez-tree.LICENSE`).
