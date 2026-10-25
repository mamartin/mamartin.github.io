// AI dashboard: načte shrnutí dne (data/ai/shrnuti.json, píše ho Claude)
// a podklady (data/ai/zdroje.json, stahuje skript) a vykreslí je.
import { h, odkaz, datumDlouhe, pred, cislo, nacti } from "./spolecne.js";

const KATEGORIE = {
  modely: "Modely",
  produkty: "Produkty",
  vyzkum: "Výzkum",
  byznys: "Byznys",
  regulace: "Regulace",
  spolecnost: "Společnost",
};

const $ = (id) => document.getElementById(id);
let filtr = null;
let shrnuti = null;

function vykresliShrnuti(s, zdroje) {
  shrnuti = s;
  if (!s) {
    $("titulek").textContent = "Shrnutí zatím není";
    $("souhrn").textContent = "Podklady níže jsou aktuální, shrnutí se objeví po příštím ranním běhu.";
    $("novinky").replaceChildren();
    $("filtry").replaceChildren();
    $("sledovat-box").hidden = true;
    return;
  }
  $("titulek").textContent = s.titulek;
  $("souhrn").textContent = s.souhrn;
  document.title = `AI dnes – ${s.titulek}`;

  // Upozornění, když je shrnutí starší než stažená data (ranní AI krok selhal).
  const den = zdroje && new Date(zdroje.stazeno).toLocaleDateString("sv-SE", { timeZone: "Europe/Prague" });
  $("stari").hidden = !den || den === s.datum;
  $("stari").textContent = `shrnutí z ${datumDlouhe(s.datum, false)}`;

  const pouzite = Object.keys(KATEGORIE).filter((k) => s.novinky.some((n) => n.kategorie === k));
  if (filtr && !pouzite.includes(filtr)) filtr = null;
  $("filtry").replaceChildren(
    ...(pouzite.length > 1 ? [null, ...pouzite] : []).map((k) =>
      h("button", {
        class: "chip", type: "button", "aria-pressed": String(filtr === k),
        onclick: () => { filtr = k; vykresliShrnuti(shrnuti, zdroje); },
      }, k ? KATEGORIE[k] : "Vše"),
    ),
  );

  const novinky = s.novinky.filter((n) => !filtr || n.kategorie === filtr);
  $("novinky").replaceChildren(...novinky.map((n) =>
    h("li", { "data-w": n.dulezitost, style: `--k: var(--k-${n.kategorie})` },
      h("div", { class: "news-top" },
        h("span", { class: "cat" }, KATEGORIE[n.kategorie] ?? n.kategorie),
        h("span", { class: "weight", title: ["", "zajímavé", "důležité", "zásadní"][n.dulezitost], "aria-label": `důležitost ${n.dulezitost} ze 3` },
          ...[1, 2, 3].map((i) => h("i", { class: i <= n.dulezitost ? "on" : "" }))),
      ),
      h("h3", {}, n.nadpis),
      h("p", {}, n.text),
      h("div", { class: "sources" }, ...n.zdroje.map((z) => odkaz(z.url, z.nazev))),
    ),
  ));

  $("sledovat-box").hidden = !s.sledovat?.length;
  $("sledovat").replaceChildren(...(s.sledovat ?? []).map((x) => h("li", {}, x)));
}

function polozka(url, nazev, ...radek) {
  return h("li", {}, odkaz(url, nazev, "t"), h("div", { class: "sub" }, ...radek.filter(Boolean).map((x) => h("span", {}, x))));
}

function vykresliZdroje(z) {
  const jmena = Object.fromEntries(z.zdroje.map((s) => [s.id, s]));
  const clanky = (typ) => z.clanky.filter((c) => jmena[c.zdroj]?.typ === typ).slice(0, 12);
  const prazdne = (el) => { if (!el.children.length) el.append(h("li", { class: "empty" }, "Za poslední dny nic.")); };

  $("stazeno").textContent = `Všechno, z čeho shrnutí vychází. Staženo ${pred(z.stazeno)}.`;
  for (const typ of ["lab", "media"]) {
    const el = $(typ === "lab" ? "labs" : "media");
    el.replaceChildren(...clanky(typ).map((c) => polozka(c.url, c.nazev, jmena[c.zdroj].nazev, pred(c.datum))));
    prazdne(el);
  }
  $("hn").replaceChildren(...z.hn.slice(0, 12).map((x) =>
    h("li", {}, odkaz(x.url, x.nazev, "t"), h("div", { class: "sub" },
      h("span", {}, `${cislo(x.body)} bodů`), odkaz(x.diskuse, `${cislo(x.komentare)} komentářů`), h("span", {}, pred(x.datum)))),
  ));
  prazdne($("hn"));
  $("modely").replaceChildren(...z.modely.map((m) =>
    polozka(m.url, m.nazev, m.autor, m.uloha, `♥ ${cislo(m.lajky)}`, `↓ ${cislo(m.stazeni)}`)));
  prazdne($("modely"));
  $("vyzkum").replaceChildren(...z.vyzkum.map((v) =>
    h("li", {}, odkaz(v.url, v.nazev, "t"),
      h("div", { class: "sub" }, h("span", {}, `▲ ${cislo(v.hlasy)}`), odkaz(v.arxiv, "arXiv")),
      v.souhrn && h("details", {}, h("summary", {}, "abstrakt"), h("p", {}, v.souhrn))),
  ));
  prazdne($("vyzkum"));

  $("stav").replaceChildren(...z.zdroje.map((s) =>
    h("li", { class: s.ok ? "ok" : "bad", title: s.ok ? s.poznamka ?? "" : s.chyba }, s.nazev)));
}

async function vyberDen(den, zdroje) {
  const s = await nacti(den ? `data/ai/archiv/${den}.json` : "data/ai/shrnuti.json");
  filtr = null;
  vykresliShrnuti(s, den ? null : zdroje);
  $("den").textContent = s ? datumDlouhe(s.datum) : "";
}

const [s, zdroje, archiv] = await Promise.all([
  nacti("data/ai/shrnuti.json"),
  nacti("data/ai/zdroje.json"),
  nacti("data/ai/archiv/index.json"),
]);
vykresliShrnuti(s, zdroje);
$("den").textContent = datumDlouhe(s?.datum ?? zdroje?.stazeno);
if (zdroje) vykresliZdroje(zdroje);

if (archiv?.length > 1) {
  const sel = $("archiv");
  sel.replaceChildren(...archiv.map((d, i) => h("option", { value: i ? d : "" }, i ? datumDlouhe(d, false) : "Dnes")));
  sel.hidden = false;
  sel.onchange = () => vyberDen(sel.value, zdroje);
}
