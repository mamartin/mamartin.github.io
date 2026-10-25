// Pomocné funkce sdílené všemi dashboardy.

// Vytvoří element; texty jdou přes textContent, takže data ze zdrojů nemůžou
// vložit HTML.
export function h(tag, attrs = {}, ...deti) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === "") continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  el.append(...deti.filter((d) => d != null && d !== false));
  return el;
}

// Odkaz ven; cokoli jiného než http(s) se vykreslí jako prostý text.
export function odkaz(url, text, trida) {
  if (!/^https?:\/\//i.test(url ?? "")) return h("span", { class: trida }, text);
  return h("a", { href: url, class: trida, target: "_blank", rel: "noopener" }, text);
}

export function datumDlouhe(datum, sDnem = true) {
  if (!datum) return "";
  // „2026-10-25“ je den v Praze, ne půlnoc UTC.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(datum) ? new Date(`${datum}T12:00:00`) : new Date(datum);
  return d.toLocaleDateString("cs-CZ", { ...(sDnem && { weekday: "long" }), day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Prague" });
}

const rtf = new Intl.RelativeTimeFormat("cs", { numeric: "auto" });
export function pred(iso) {
  if (!iso) return "";
  const min = Math.round((new Date(iso) - Date.now()) / 60000);
  if (Math.abs(min) < 60) return rtf.format(min, "minute");
  if (Math.abs(min) < 36 * 60) return rtf.format(Math.round(min / 60), "hour");
  return rtf.format(Math.round(min / 1440), "day");
}

const fmt = new Intl.NumberFormat("cs-CZ", { notation: "compact", maximumFractionDigits: 1 });
export const cislo = (n) => fmt.format(n ?? 0);

// JSON, nebo null, když soubor ještě neexistuje.
export async function nacti(url) {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
