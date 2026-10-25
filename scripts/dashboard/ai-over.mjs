// Zkontroluje shrnutí, které napsal Claude (dashboard/data/ai/shrnuti.json),
// doplní datum, zahodí odkazy, které nejsou v podkladech, a uloží kopii
// do archivu. Když je shrnutí rozbité nebo chybí, vrátí poslední platné
// z gitu – stránka pak ukáže starší shrnutí s jeho datem, ale čerstvá data.
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KOREN = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DATA = join(KOREN, "dashboard/data/ai");
const SHRNUTI = join(DATA, "shrnuti.json");
const ARCHIV = join(DATA, "archiv");
const KATEGORIE = ["modely", "produkty", "vyzkum", "byznys", "regulace", "spolecnost"];

const pragaDen = (iso) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Europe/Prague" });

function vratPosledni(duvod) {
  console.log(`::warning::Shrnutí se nepoužije (${duvod}), zůstává předchozí.`);
  try {
    execFileSync("git", ["checkout", "HEAD", "--", "dashboard/data/ai/shrnuti.json"], { cwd: KOREN, stdio: "ignore" });
  } catch {
    // Předchozí verze v gitu ještě není (první běh) – stránka shrnutí vynechá.
  }
}

function zkontroluj(s, povolene) {
  if (typeof s !== "object" || !s) throw new Error("není objekt");
  for (const pole of ["titulek", "souhrn"]) {
    if (typeof s[pole] !== "string" || !s[pole].trim()) throw new Error(`chybí ${pole}`);
  }
  if (!Array.isArray(s.novinky)) throw new Error("chybí novinky");
  let zahozeno = 0;
  const novinky = s.novinky.flatMap((n) => {
    if (typeof n?.nadpis !== "string" || typeof n?.text !== "string") return [];
    const zdroje = (Array.isArray(n.zdroje) ? n.zdroje : []).filter((z) => {
      const ok = typeof z?.url === "string" && povolene.has(z.url);
      if (!ok) zahozeno++;
      return ok;
    });
    if (!zdroje.length) return [];
    return [{
      nadpis: n.nadpis.trim(),
      text: n.text.trim(),
      kategorie: KATEGORIE.includes(n.kategorie) ? n.kategorie : "spolecnost",
      dulezitost: [1, 2, 3].includes(n.dulezitost) ? n.dulezitost : 1,
      zdroje: zdroje.map((z) => ({ nazev: String(z.nazev ?? "").trim() || new URL(z.url).hostname, url: z.url })),
    }];
  });
  if (zahozeno) console.log(`::warning::Zahozeno ${zahozeno} odkazů, které nejsou v podkladech.`);
  if (novinky.length < 3) throw new Error(`jen ${novinky.length} platných novinek`);
  return {
    titulek: s.titulek.trim(),
    souhrn: s.souhrn.trim(),
    novinky,
    sledovat: Array.isArray(s.sledovat) ? s.sledovat.filter((x) => typeof x === "string" && x.trim()).slice(0, 4) : [],
  };
}

const zdroje = JSON.parse(await readFile(join(DATA, "zdroje.json"), "utf8"));
const povolene = new Set([
  ...zdroje.clanky.map((c) => c.url),
  ...zdroje.hn.flatMap((h) => [h.url, h.diskuse]),
  ...zdroje.modely.map((m) => m.url),
  ...zdroje.vyzkum.flatMap((v) => [v.url, v.arxiv]),
]);

let surove;
try {
  surove = JSON.parse(await readFile(SHRNUTI, "utf8"));
} catch (e) {
  vratPosledni(e.code === "ENOENT" ? "soubor chybí" : "neplatný JSON");
  process.exit(0);
}

// Soubor stejný jako v gitu = Claude ho nepřepsal a je tam včerejší shrnutí.
function nezmeneno() {
  try {
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", "dashboard/data/ai/shrnuti.json"], { cwd: KOREN, stdio: "ignore" });
    return execFileSync("git", ["ls-files", "dashboard/data/ai/shrnuti.json"], { cwd: KOREN }).length > 0;
  } catch {
    return false;
  }
}
if (nezmeneno()) {
  vratPosledni("Claude soubor nepřepsal");
  process.exit(0);
}

let shrnuti;
try {
  shrnuti = zkontroluj(surove, povolene);
} catch (e) {
  vratPosledni(e.message);
  process.exit(0);
}

const datum = pragaDen(zdroje.stazeno);
const vystup = JSON.stringify({ datum, vygenerovano: new Date().toISOString(), ...shrnuti }, null, 2) + "\n";
await writeFile(SHRNUTI, vystup);
await mkdir(ARCHIV, { recursive: true });
await writeFile(join(ARCHIV, `${datum}.json`), vystup);

const dny = (await readdir(ARCHIV)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 10)).sort().reverse();
await writeFile(join(ARCHIV, "index.json"), JSON.stringify(dny) + "\n");
console.log(`Shrnutí ${datum}: ${shrnuti.novinky.length} novinek.`);
