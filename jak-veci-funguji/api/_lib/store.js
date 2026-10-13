import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

// Každá odpověď je jeden soubor JSON. Na Vercelu leží v úložišti Blob,
// při lokálním zkoušení ve složce z proměnné FEEDBACK_DIR.
const LOCAL = process.env.FEEDBACK_DIR ? resolve(process.env.FEEDBACK_DIR) : null;
const ACCESS = process.env.BLOB_ACCESS === "public" ? "public" : "private";
const PREFIX = "feedback/";
export const MAX_LISTED = 2000;

export const configured = () => Boolean(LOCAL || process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
const isOurs = (path) => typeof path === "string" && /^feedback\/\d{4}-\d{2}\/[a-z0-9-]+\.json$/.test(path);

function localPath(path) {
  const full = resolve(LOCAL, path);
  if (!full.startsWith(LOCAL + sep)) throw new Error("bad-path");
  return full;
}

export async function save(path, record) {
  if (!isOurs(path)) throw new Error("bad-path");
  const text = JSON.stringify(record, null, 2);
  if (LOCAL) {
    await mkdir(dirname(localPath(path)), { recursive: true });
    await writeFile(localPath(path), text, { flag: "wx" });
    return;
  }
  const { put } = await import("@vercel/blob");
  await put(path, text, { access: ACCESS, contentType: "application/json; charset=utf-8", addRandomSuffix: false });
}

async function paths() {
  if (LOCAL) {
    const out = [];
    const months = await readdir(join(LOCAL, "feedback"), { withFileTypes: true }).catch(() => []);
    for (const m of months) if (m.isDirectory()) for (const f of await readdir(join(LOCAL, "feedback", m.name))) out.push(`${PREFIX}${m.name}/${f}`);
    return out.filter(isOurs);
  }
  const { list } = await import("@vercel/blob");
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
    for (const b of page.blobs) if (isOurs(b.pathname)) out.push(b.pathname);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor && out.length < MAX_LISTED);
  return out;
}

async function read(path) {
  if (LOCAL) return JSON.parse(await readFile(localPath(path), "utf8"));
  const { get } = await import("@vercel/blob");
  const found = await get(path, { access: ACCESS, useCache: false });
  if (!found || found.statusCode !== 200) return null;
  return JSON.parse(await new Response(found.stream).text());
}

// Všechny odpovědi, nejnovější první. Čte se po malých dávkách, ať se úložiště nezahltí.
export async function listAll() {
  const all = (await paths()).sort().reverse().slice(0, MAX_LISTED), items = [];
  for (let i = 0; i < all.length; i += 12) {
    const batch = await Promise.all(all.slice(i, i + 12).map(async (path) => {
      try { const record = await read(path); return record ? { path, ...record } : null; } catch { return null; }
    }));
    items.push(...batch.filter(Boolean));
  }
  return items;
}

export async function remove(path) {
  if (!isOurs(path)) throw new Error("bad-path");
  if (LOCAL) { await rm(localPath(path), { force: true }); return; }
  const { del } = await import("@vercel/blob");
  await del(path);
}
