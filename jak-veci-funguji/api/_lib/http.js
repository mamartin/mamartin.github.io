import { createHash, timingSafeEqual } from "node:crypto";

// Odkud smí formulář posílat odpovědi: z tohohle webu samotného a z jeho starší kopie na GitHub Pages.
// Jiný web je nepošle, ani kdyby okopíroval celý formulář.
const ALLOWED = (process.env.ALLOWED_ORIGINS || "https://mamartin.github.io").split(",").map((s) => s.trim()).filter(Boolean);
function sameSite(req, origin) {
  try { return new URL(origin).host === (req.headers["x-forwarded-host"] || req.headers.host); } catch { return false; }
}

export function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

// Vrátí hlavičky pro prohlížeč, když požadavek přišel z povoleného webu, jinak null.
export function cors(req) {
  const origin = req.headers.origin || "";
  if (!ALLOWED.includes(origin) && !sameSite(req, origin)) return null;
  return { "Access-Control-Allow-Origin": origin, Vary: "Origin", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" };
}

// Přečte tělo požadavku jako JSON. Vercel ho někdy rozebere sám, lokální server ne.
export async function readJson(req, limit = 16000) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  let text = typeof req.body === "string" ? req.body : Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  if (!text) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw new Error("too-large");
      chunks.push(chunk);
    }
    text = Buffer.concat(chunks).toString("utf8");
  }
  if (text.length > limit) throw new Error("too-large");
  return JSON.parse(text || "{}");
}

// Porovná heslo z hlavičky s heslem v nastavení projektu tak, aby se z doby odpovědi nedalo nic vyčíst.
export function isAdmin(req) {
  const expected = process.env.ADMIN_PASSWORD || "";
  if (expected.length < 8) return false;
  const auth = req.headers.authorization || "";
  const given = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const a = createHash("sha256").update(given).digest(), b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
