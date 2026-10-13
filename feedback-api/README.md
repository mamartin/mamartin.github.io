# Zpětná vazba k článkům Jak věci fungují

Malý projekt pro Vercel. Formulář pod každým článkem pošle odpověď funkci `api/feedback`, ta ji uloží jako soubor JSON do úložiště Vercel Blob. Stránka v `public/` je administrace: po zadání hesla odpovědi načte přes `api/admin`.

## Nastavení na Vercelu

1. Nový projekt z repozitáře `mamartin/mamartin.github.io`, **Root Directory** `feedback-api`.
2. V projektu záložka Storage: vytvořit úložiště **Blob** s přístupem **Private** a připojit ho k projektu.
3. Settings → Environment Variables: přidat `ADMIN_PASSWORD` (aspoň 8 znaků).
4. Znovu nasadit (Deployments → Redeploy), aby se nastavení projevilo.
5. Adresu projektu zapsat do `jak-veci-funguji/feedback.js` do konstanty `ENDPOINT`.

## Lokální zkoušení

```bash
npm run dev
```

Server běží na `http://localhost:8787` a odpovědi ukládá do složky `.data`. Heslo si vezme ze souboru `.env.local` (`ADMIN_PASSWORD=…`).
