// Stáhne podklady pro AI dashboard: blogy laboratoří, média, Hacker News,
// populární modely a články na Hugging Face. Výsledek uloží do
// dashboard/data/ai/zdroje.json – z něj pak Claude píše shrnutí dne
// a stránka z něj vykresluje seznamy. Bez závislostí, stačí Node 20+.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KOREN = join(dirname(fileURLToPath(import.meta.url)), "../..");
const VYSTUP = join(KOREN, "dashboard/data/ai/zdroje.json");

const UA = "Mozilla/5.0 (compatible; mamartin-dashboard/1.0; +https://mamartin.github.io/dashboard/)";
const HODINA = 3600 * 1000;
// Laboratoře publikují jen párkrát týdně, proto delší okno; co už bylo
// ve včerejším shrnutí, Claude pozná podle předchozího shrnuti.json.
const OKNO_CLANKY = 4 * 24 * HODINA;
const OKNO_HN = 36 * HODINA;

const FEEDY = [
  { id: "openai", nazev: "OpenAI", typ: "lab", url: "https://openai.com/news/rss.xml" },
  { id: "anthropic", nazev: "Anthropic", typ: "lab", url: "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml", poznamka: "neoficiální feed (Anthropic RSS nemá)" },
  { id: "deepmind", nazev: "Google DeepMind", typ: "lab", url: "https://deepmind.google/blog/rss.xml" },
  { id: "google", nazev: "Google AI", typ: "lab", url: "https://blog.google/technology/ai/rss/" },
  { id: "huggingface", nazev: "Hugging Face", typ: "lab", url: "https://huggingface.co/blog/feed.xml" },
  { id: "verge", nazev: "The Verge", typ: "media", url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml" },
  { id: "techcrunch", nazev: "TechCrunch", typ: "media", url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
  { id: "willison", nazev: "Simon Willison", typ: "media", url: "https://simonwillison.net/atom/everything/" },
];

// Které příběhy z Hacker News se týkají AI (podle titulku).
const AI_TITULEK = /\b(AI|A\.I\.|AGI|LLMs?|GPT[\w.-]*|ChatGPT|Claude|Anthropic|OpenAI|Gemini|DeepMind|Llama|Mistral|DeepSeek|Qwen|Grok|xAI|Copilot|Hugging ?Face|agentic|machine learning|neural|diffusion|transformers?|inference|fine-?tun\w*|RAG|MCP|prompt\w*)\b/i;

async function stahni(url, typ = "text") {
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return typ === "json" ? res.json() : res.text();
}

const ENTITY = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function dekoduj(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
      if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1));
      return ENTITY[e.toLowerCase()] ?? m;
    });
}
function bezHtml(s) {
  return dekoduj(dekoduj(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
function zkrat(s, n) {
  return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s;
}
function tag(xml, jmeno) {
  const m = xml.match(new RegExp(`<${jmeno}(?:\\s[^>]*)?>([\\s\\S]*?)</${jmeno}>`, "i"));
  return m ? m[1] : "";
}

// RSS 2.0 i Atom, jen to, co potřebujeme: titulek, odkaz, datum, perex.
function parsujFeed(xml) {
  const polozky = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  return polozky.map((p) => {
    let url = bezHtml(tag(p, "link"));
    if (!url) {
      const odkazy = [...p.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
      const hlavni = odkazy.find((l) => /rel=["']alternate/.test(l)) ?? odkazy.find((l) => !/rel=/.test(l)) ?? odkazy[0];
      url = hlavni?.match(/href=["']([^"']+)/)?.[1] ?? "";
    }
    const datum = new Date(bezHtml(tag(p, "pubDate") || tag(p, "published") || tag(p, "updated") || tag(p, "dc:date")));
    return {
      nazev: bezHtml(tag(p, "title")),
      url: dekoduj(url),
      datum: isNaN(datum) ? null : datum.toISOString(),
      popis: zkrat(bezHtml(tag(p, "description") || tag(p, "summary") || tag(p, "content")), 400),
    };
  });
}

async function nactiFeedy(ted) {
  const zdroje = [];
  const clanky = [];
  await Promise.all(FEEDY.map(async (f) => {
    const zaznam = { id: f.id, nazev: f.nazev, typ: f.typ, url: f.url, ...(f.poznamka && { poznamka: f.poznamka }) };
    try {
      const polozky = parsujFeed(await stahni(f.url))
        .filter((p) => p.nazev && p.url && p.datum && ted - new Date(p.datum) < OKNO_CLANKY)
        .slice(0, 12);
      clanky.push(...polozky.map((p) => ({ zdroj: f.id, ...p })));
      zdroje.push({ ...zaznam, ok: true, pocet: polozky.length });
    } catch (e) {
      zdroje.push({ ...zaznam, ok: false, chyba: e.message });
    }
  }));
  clanky.sort((a, b) => b.datum.localeCompare(a.datum));
  zdroje.sort((a, b) => FEEDY.findIndex((f) => f.id === a.id) - FEEDY.findIndex((f) => f.id === b.id));
  return { zdroje, clanky };
}

async function nactiHn(ted) {
  const od = Math.floor((ted - OKNO_HN) / 1000);
  const data = await stahni(`https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=1000&numericFilters=created_at_i%3E${od},points%3E30`, "json");
  return data.hits
    .filter((h) => h.title && AI_TITULEK.test(h.title))
    .sort((a, b) => b.points - a.points)
    .slice(0, 20)
    .map((h) => ({
      nazev: h.title,
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      diskuse: `https://news.ycombinator.com/item?id=${h.objectID}`,
      body: h.points,
      komentare: h.num_comments ?? 0,
      datum: h.created_at,
    }));
}

async function nactiModely() {
  const data = await stahni("https://huggingface.co/api/models?sort=trendingScore&limit=12", "json");
  return data.map((m) => ({
    id: m.id,
    autor: m.id.split("/")[0],
    nazev: m.id.split("/").slice(1).join("/"),
    uloha: m.pipeline_tag ?? null,
    lajky: m.likes,
    stazeni: m.downloads,
    trend: m.trendingScore,
    vytvoreno: m.createdAt,
    url: `https://huggingface.co/${m.id}`,
  }));
}

async function nactiVyzkum() {
  const data = await stahni("https://huggingface.co/api/daily_papers?limit=50", "json");
  return data
    .sort((a, b) => (b.paper.upvotes ?? 0) - (a.paper.upvotes ?? 0))
    .slice(0, 10)
    .map(({ paper: p }) => ({
      nazev: bezHtml(p.title),
      url: `https://huggingface.co/papers/${p.id}`,
      arxiv: `https://arxiv.org/abs/${p.id}`,
      hlasy: p.upvotes ?? 0,
      datum: p.publishedAt,
      souhrn: zkrat(bezHtml(p.summary ?? ""), 500),
    }));
}

// Jeden spadlý zdroj nesmí shodit celý běh – místo dat se zapíše chyba.
async function zkus(id, nazev, url, fn) {
  try {
    const data = await fn();
    return { zaznam: { id, nazev, typ: "data", url, ok: true, pocet: data.length }, data };
  } catch (e) {
    return { zaznam: { id, nazev, typ: "data", url, ok: false, chyba: e.message }, data: [] };
  }
}

const ted = Date.now();
const [feedy, hn, modely, vyzkum] = await Promise.all([
  nactiFeedy(ted),
  zkus("hn", "Hacker News", "https://news.ycombinator.com", () => nactiHn(ted)),
  zkus("hf-modely", "Hugging Face – populární modely", "https://huggingface.co/models?sort=trending", nactiModely),
  zkus("hf-papers", "Hugging Face – články dne", "https://huggingface.co/papers", nactiVyzkum),
]);

const vysledek = {
  stazeno: new Date(ted).toISOString(),
  zdroje: [...feedy.zdroje, hn.zaznam, modely.zaznam, vyzkum.zaznam],
  clanky: feedy.clanky,
  hn: hn.data,
  modely: modely.data,
  vyzkum: vyzkum.data,
};

await mkdir(dirname(VYSTUP), { recursive: true });
await writeFile(VYSTUP, JSON.stringify(vysledek, null, 2) + "\n");

for (const z of vysledek.zdroje) console.log(`${z.ok ? "✓" : "✗"} ${z.nazev}: ${z.ok ? z.pocet : z.chyba}`);
if (vysledek.zdroje.every((z) => !z.ok)) {
  console.error("Nepodařilo se stáhnout žádný zdroj.");
  process.exit(1);
}
