# Beleggingsdashboard met dagelijkse krant

Persoonlijke beleggingsapp: portefeuille bijhouden (DEGIRO-CSV-import) en elke ochtend een korte "krant" over wat er gebeurde en waarom. Informatief, geen koop- of verkoopadvies. Zie [SPEC.md](SPEC.md).

## Structuur

| Map | Inhoud |
|---|---|
| `web/` | Frontend (vanilla HTML/CSS/JS), gehost op GitHub Pages |
| `web/tests/` | Testpagina voor parser en importlogica (open in de browser) |
| `supabase/` | Databaseschema met Row Level Security |
| `worker/` | Cloudflare Worker (fase 3) |
| `tools/serve.ps1` | Lokale webserver zonder Node/Python |

## Lokaal draaien

```powershell
powershell -ExecutionPolicy Bypass -File tools\serve.ps1
```

Open daarna http://localhost:8080/ (app) of http://localhost:8080/tests/ (tests).

## Geheimen

Er staan geen geheime sleutels in de frontend of in git. `web/js/config.js` bevat alleen de Supabase-URL en de publieke *anon key*; die is publiek bedoeld, de beveiliging zit in RLS. Alle echte sleutels (Claude, koersdata, Supabase service key) worden Worker-secrets; zie `.dev.vars.example`.
