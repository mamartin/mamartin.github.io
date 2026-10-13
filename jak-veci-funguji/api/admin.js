import { isAdmin, send } from "./_lib/http.js";
import { configured, listAll, MAX_LISTED, remove } from "./_lib/store.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// GET /api/admin: všechny odpovědi. DELETE /api/admin?path=…: smaže jednu. Obojí jen s heslem.
export default async function handler(req, res) {
  if ((process.env.ADMIN_PASSWORD || "").length < 8) return send(res, 503, { error: "V nastavení projektu chybí heslo ADMIN_PASSWORD (aspoň 8 znaků)." });
  if (!isAdmin(req)) { await wait(700); return send(res, 401, { error: "Špatné heslo." }); }
  if (!configured()) return send(res, 503, { error: "K projektu není připojené úložiště Blob." });
  try {
    if (req.method === "GET") {
      const items = await listAll();
      return send(res, 200, { items, limit: MAX_LISTED });
    }
    if (req.method === "DELETE") {
      const path = new URL(req.url, "http://x").searchParams.get("path") || "";
      try { await remove(path); } catch (err) { if (err.message === "bad-path") return send(res, 400, { error: "Takový soubor tu není." }); throw err; }
      return send(res, 200, { ok: true });
    }
    send(res, 405, { error: "Jen GET a DELETE." });
  } catch (err) {
    console.error("Administrace selhala:", err);
    send(res, 500, { error: "Úložiště neodpovědělo. Podrobnosti jsou v logu funkce na Vercelu." });
  }
}
