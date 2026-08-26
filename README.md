# Elroqblik

Privat lade- og økonomioverblik til en Škoda Elroq. Appen samler bildata fra
MyŠkoda, ladehistorik, Energinets DK1-priser og sammenligninger af
ladeløsninger i ét dansk dashboard.

## Teknologi

- Next.js 16 og React 19 via vinext/Vite
- Cloudflare Worker med Static Assets
- Cloudflare D1 og Drizzle-migrationer
- Cloudflare Access som adgangskontrol
- Ét Cron Trigger hvert 30. minut; jobplanen afgør selv, hvilke synkroniseringer
  der skal køre

## Lokal udvikling

Krav: Node.js `>=22.13.0` samt Linux med `flock` og GNU `timeout`.

```bash
npm ci
npm run db:migrate:local
npm run dev
```

Opret lokale secrets i en ignoreret `.dev.vars`:

```text
SMARTCAR_STORAGE_KEY=<en lang tilfældig hemmelighed>
```

MyŠkoda-adgangskoden gemmes ikke. Det roterende sessions-token krypteres med
AES-GCM ved hjælp af `SMARTCAR_STORAGE_KEY`.

## Database og migrationer

Runtime-koden opretter ikke selv tabeller. Alle schemaændringer skal ligge som
versionerede migrationer i `drizzle/` og anvendes før den tilhørende kode
deployes.

```bash
npm run db:generate
npm run db:migrate:local
npm run db:migrate:remote
```

`db:migrate:remote` ændrer produktionsdatabasen og skal derfor køres bevidst
inden deployment af kode, der kræver en ny migration.

## Kvalitetskontrol

```bash
npm run typecheck
npm run lint
npm test
```

`npm test` bygger den deploybare Worker og kører de automatiske tests. Et
checkpoint bør først deployes, når alle tre kommandoer består.

## Deployment

Worker-konfigurationen findes i `wrangler.jsonc`. Ikke-hemmelige værdier ligger
under `vars`; secrets sættes i Cloudflare og må ikke committes.

```bash
npx wrangler secret put SMARTCAR_STORAGE_KEY
npm run db:migrate:remote
npm run deploy:dry-run
```

Selve produktionen deployes normalt via repositoryets Cloudflare/GitHub-
integration. `deploy:dry-run` kontrollerer Worker-pakken uden at ændre den live
app.

## Datakvalitet

- MyŠkoda er en uofficiel integration til Volkswagens mobile API og kan kræve
  vedligeholdelse, hvis login- eller dataformat ændres.
- AC/DC bruges som et foreløbigt estimat for hjemme/offentlig opladning, når
  MyŠkoda ikke leverer en lokation.
- Energinet leverer rå spotpris. Appens estimerede hjemmepris er ikke en faktura
  fra Clever Power og vises derfor som et estimat.
- Ladeforslag og prisoverblik er information; appen fjernstyrer ikke bilen eller
  ladeboksen.

## Centrale mapper

- `app/` – brugerflade og API-ruter
- `app/api/vehicle/` – MyŠkoda, Smartcar og kørehistorik
- `app/api/charging/` – ladeposter og import
- `app/api/prices/` – Energinets pris-cache
- `worker/` – Worker-entrypoint, Access-validering og scheduler
- `db/` og `drizzle/` – schema og migrationer
- `tests/` – automatiske tests
