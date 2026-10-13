# Jak věci fungují

Články s interaktivními modely. Každý článek je samostatná stránka ve vlastní složce, společné jsou jen `style.css` a `feedback.js`.

Web jde nasadit dvěma způsoby. Na GitHub Pages běží jen stránky. Na Vercelu k nim přibudou dvě funkce ve složce `api/`, které přijímají zpětnou vazbu čtenářů a ukládají ji jako soubory JSON do úložiště Vercel Blob. Stránka `admin/` odpovědi po zadání hesla zobrazí.

## Nastavení na Vercelu

1. Nový projekt z repozitáře `mamartin/mamartin.github.io`, **Root Directory** `jak-veci-funguji`.
2. V projektu záložka Storage: vytvořit úložiště **Blob** s přístupem **Private** a připojit ho k projektu.
3. Settings → Environment Variables: přidat `ADMIN_PASSWORD` (aspoň 8 znaků).
4. Znovu nasadit (Deployments → Redeploy), aby se nastavení projevilo.

Formulář pod články se na Vercelu zapne sám. Aby fungoval i na kopii na GitHub Pages, zapíše se adresa projektu do konstanty `REMOTE` v `feedback.js`.

## Lokální zkoušení

```bash
npm run dev
```

Web i funkce běží na `http://localhost:8787`, odpovědi se ukládají do složky `.data`. Heslo do administrace si server vezme ze souboru `.env.local` (`ADMIN_PASSWORD=…`).
