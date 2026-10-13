// Lokální server na vyzkoušení: funkce z api/ a stránka administrace z public/.
// Odpovědi ukládá do složky .data místo do úložiště na Vercelu.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// nastavení z .env.local (heslo do administrace pro lokální zkoušení)
if (existsSync(join(root, ".env.local"))) for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
process.env.FEEDBACK_DIR ||= join(root, ".data");
process.env.ALLOWED_ORIGINS ||= "https://mamartin.github.io,http://localhost:8322,http://127.0.0.1:8322";

const handlers = { feedback: (await import("../api/feedback.js")).default, admin: (await import("../api/admin.js")).default };
const port = Number(process.env.PORT || 8787);
createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://x");
  const api = pathname.match(/^\/api\/(feedback|admin)$/);
  if (api) return handlers[api[1]](req, res);
  if (pathname === "/" || pathname === "/index.html") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(await readFile(join(root, "public", "index.html")));
  }
  res.statusCode = 404;
  res.end("Nenalezeno");
}).listen(port, () => console.log(`Zpětná vazba běží na http://localhost:${port}, odpovědi jdou do ${process.env.FEEDBACK_DIR}`));
