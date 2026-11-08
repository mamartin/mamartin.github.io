// Převod skutečného města na trať: definice trati (js/tracks-<město>.js) a kulisy (data/<město>.bin).
// Použití: node osm2track.mjs [město]   (bez města Dobříš; data stáhne fetch-data.mjs, nastavení je v cities/)
//
// Souřadnice výstupu jsou herní: x na východ, z na jih, počátek na startu.
// Kulisy jsou v decimetrech (celá čísla), výšky v dm nad nejnižším bodem trati.
// Kroky jsou v gen/*.mjs a sdílejí jeden stav (gen/inputs.mjs); pořadí kroků určuje pořadí ve výstupu.
import { writeFileSync } from 'node:fs';
import { loadCity } from './lib/city.mjs';
import { loadInputs } from './gen/inputs.mjs';
import { buildTrack, trackSpans, edgeSpans } from './gen/track.mjs';
import { addSpace, addHouses } from './gen/space.mjs';
import { buildBuildings } from './gen/buildings.mjs';
import { buildSurfaces } from './gen/surfaces.mjs';
import { buildTraffic } from './gen/traffic.mjs';
import { buildLines } from './gen/lines.mjs';
import { buildCadastre } from './gen/cadastre.mjs';
import { buildNature } from './gen/nature.mjs';
import { buildTerrain } from './gen/terrain.mjs';
import { sceneOf, writeScene, trackSource, report } from './gen/output.mjs';

const ctx = await loadCity();
const g = await loadInputs(ctx);
g.sceneUrl = `data/${ctx.city.id}.bin`;

buildTrack(g);      // osa, šířky, tribuna
trackSpans(g);      // kostky, značení, mosty
addSpace(g);        // dotazy na vzdálenost od trati, rozsah scény
buildBuildings(g);  // domy a dominanty
addHouses(g);
buildSurfaces(g);   // zeleň, voda, náměstí a parkoviště
buildTraffic(g);    // výlohy, přechody, auta, značky, semafory, ostrůvky, autobusy
buildLines(g);      // ulice, pěšiny, potoky, zdi
if (g.city.parcels) buildCadastre(g); // dvory a ploty z katastru
buildNature(g);     // lampy, stromy, sochy, komíny
buildTerrain(g);    // výšková mřížka
edgeSpans(g);       // obrubníky, zábradlí, vzdálená místa

const scene = sceneOf(g);
const size = writeScene(ctx.scene, scene);
writeFileSync(ctx.track, trackSource(g.def, ctx.city.exportName));
report(g, scene, size);
