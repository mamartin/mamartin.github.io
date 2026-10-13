import { randomBytes } from "node:crypto";
import { cors, readJson, send } from "./_lib/http.js";
import { configured, save } from "./_lib/store.js";

const RATINGS = ["ano", "zcasti", "ne"];
const MAX_TEXT = 2000;
// hrubá pojistka proti zahlcení: jedna běžící instance funkce uloží nejvýš tolik odpovědí za minutu
const PER_MINUTE = 20;
let recent = [];

const clean = (v) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, MAX_TEXT) : "");

// POST /api/feedback: uloží jednu odpověď čtenáře jako soubor.
export default async function handler(req, res) {
  const headers = cors(req);
  if (!headers) return send(res, 403, { error: "Odsud se odpovědi posílat nedají." });
  if (req.method === "OPTIONS") { res.statusCode = 204; for (const [k, v] of Object.entries(headers)) res.setHeader(k, v); return res.end(); }
  if (req.method !== "POST") return send(res, 405, { error: "Jen POST." }, headers);
  if (!configured()) return send(res, 503, { error: "Úložiště zatím není nastavené." }, headers);

  let body;
  try { body = await readJson(req); } catch { return send(res, 400, { error: "Zprávu se nepodařilo přečíst." }, headers); }

  const article = typeof body.article === "string" && /^[a-z0-9-]{1,40}$/.test(body.article) ? body.article : "";
  const rating = RATINGS.includes(body.rating) ? body.rating : "";
  const liked = clean(body.liked), missing = clean(body.missing);
  if (!article) return send(res, 400, { error: "Chybí název článku." }, headers);
  if (!rating && !liked && !missing) return send(res, 400, { error: "Zpráva je prázdná." }, headers);

  // Roboti vyplní i pole, které člověk nevidí, a odešlou formulář hned. Takové zprávy potichu zahodíme.
  const robot = Boolean(body.website) || !(Number(body.elapsed) >= 2500);
  if (robot) return send(res, 200, { ok: true }, headers);

  const now = Date.now();
  recent = recent.filter((t) => now - t < 60000);
  if (recent.length >= PER_MINUTE) return send(res, 429, { error: "Teď přišlo moc zpráv najednou, zkuste to za chvíli." }, headers);
  recent.push(now);

  const at = new Date(now), stamp = at.toISOString().replace(/[-:.]/g, "").slice(0, 15).toLowerCase();
  const path = `feedback/${at.toISOString().slice(0, 7)}/${stamp}-${article}-${randomBytes(4).toString("hex")}.json`;
  try {
    await save(path, { at: at.toISOString(), article, rating, liked, missing });
  } catch (err) {
    console.error("Uložení odpovědi selhalo:", err);
    return send(res, 500, { error: "Zprávu se nepodařilo uložit." }, headers);
  }
  send(res, 200, { ok: true }, headers);
}
