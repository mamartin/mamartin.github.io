// Lokální server na vyzkoušení celého webu: stránky ze složky a funkce z api/.
// Odpovědi ukládá do složky .data místo do úložiště na Vercelu.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// nastavení z .env.local (heslo do administrace pro lokální zkoušení)
if (existsSync(join(root, ".env.local"))) for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
process.env.FEEDBACK_DIR ||= join(root, ".data");

const handlers = { feedback: (await import("../api/feedback.js")).default, admin: (await import("../api/admin.js")).default };
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon" };
const port = Number(process.env.PORT || 8787);

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://x");
  const api = pathname.match(/^\/api\/(feedback|admin)$/);
  if (api) return handlers[api[1]](req, res);
  // soubory webu; nic, co začíná tečkou, a nic mimo složku
  let file = resolve(root, "." + decodeURIComponent(pathname));
  const hidden = pathname.split("/").some((p) => p.startsWith(".")) || /^\/(api|scripts|node_modules)\//.test(pathname);
  if (hidden || (file !== root && !file.startsWith(root + sep))) { res.statusCode = 404; return res.end("Nenalezeno"); }
  try {
    if ((await stat(file)).isDirectory()) {
      if (!pathname.endsWith("/")) { res.statusCode = 308; res.setHeader("Location", pathname + "/"); return res.end(); }
      file = join(file, "index.html");
    }
    const body = await readFile(file);
    res.setHeader("Content-Type", TYPES[extname(file)] || "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    res.end(body);
  } catch { res.statusCode = 404; res.end("Nenalezeno"); }
}).listen(port, () => console.log(`Web běží na http://localhost:${port}, odpovědi jdou do ${process.env.FEEDBACK_DIR}`));
